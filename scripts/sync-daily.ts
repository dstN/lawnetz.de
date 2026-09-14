/**
 * scripts/sync-daily.ts — Daily Delta Cronjob for LawNetz
 *
 * Designed to run via crontab on Netcup:
 *   0 3 * * * cd /httpdocs && npx tsx scripts/sync-daily.ts >> logs/cron.log 2>&1
 *
 * Steps:
 * 1. Loads all laws from src/data/toc.json (~6,130 laws)
 * 2. Compares with sync-manifest.json using HTTP HEAD (If-None-Match / If-Modified-Since)
 * 3. Skips unchanged laws via HTTP 304 Not Modified (0 bytes, ~10-20ms)
 * 4. Downloads and parses only modified or new laws (HTTP 200)
 * 5. Updates local JSON cache in src/data/laws/<slug>.json and MySQL (if configured)
 * 6. Logs execution metrics to sync_logs
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchAndParseLaw } from './fetch-law';
import { db } from '../src/db/index';
import * as schema from '../src/db/schema';
import { sql } from 'drizzle-orm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ManifestEntry {
  etag?: string;
  lastModified?: string;
  lastSynced: string;
  status?: 'ok' | 'not_found' | 'error';
  normsCount?: number;
}

/**
 * Concurrent async pool runner
 */
async function asyncPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let currentIndex = 0;

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (currentIndex < items.length) {
        const idx = currentIndex++;
        try {
          results[idx] = await fn(items[idx], idx);
        } catch (err: any) {
          // Errors handled inside fn
        }
      }
    }
  );

  await Promise.all(workers);
  return results;
}

async function main() {
  const startTime = Date.now();
  const args = process.argv.slice(2);
  const limitArg = args.find((_, i) => args[i - 1] === '--limit');
  const maxLimit = limitArg ? parseInt(limitArg, 10) : Infinity;
  const force = args.includes('--force');
  const saveJson = args.includes('--save-json');
  const specificSlug = args.find((_, i) => args[i - 1] === '--slug');

  console.log(`[${new Date().toISOString()}] 🔄 Starting LawNetz Daily Delta Sync (ALL laws)...`);

  const tocPath = path.resolve(__dirname, '../src/data/toc.json');
  if (!fs.existsSync(tocPath)) {
    throw new Error(`toc.json not found at ${tocPath}`);
  }

  const toc = JSON.parse(fs.readFileSync(tocPath, 'utf-8'));
  const allLaws: Array<{ slug: string; title: string }> = toc.laws || toc.items || [];
  let targetLaws = specificSlug ? allLaws.filter(l => l.slug === specificSlug) : allLaws;

  if (maxLimit < targetLaws.length) {
    targetLaws = targetLaws.slice(0, maxLimit);
  }

  console.log(`[sync-daily] Total laws to check: ${targetLaws.length}`);

  // Load sync-manifest.json
  const manifestPath = path.resolve(__dirname, '../src/data/sync-manifest.json');
  let manifest: Record<string, ManifestEntry> = {};
  if (fs.existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    } catch {}
  }

  function saveManifest() {
    try {
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
    } catch (err: any) {
      console.error('[sync-daily] Warning: Failed to save manifest:', err.message);
    }
  }

  const lawsDir = path.resolve(__dirname, '../src/data/laws');
  if (!fs.existsSync(lawsDir)) fs.mkdirSync(lawsDir, { recursive: true });

  let checkedCount = 0;
  let skippedUnchanged = 0;
  let notFoundCount = 0;
  let updatedCount = 0;
  let failedCount = 0;
  const toUpdate: Array<{ slug: string; etag?: string; lastModified?: string }> = [];

  console.log(`[sync-daily] Performing delta HEAD checks across ${targetLaws.length} laws (concurrency: 15)...`);

  // Step 1: Rapid HTTP HEAD checks with concurrency 15
  await asyncPool(targetLaws, 15, async (law) => {
    const slug = law.slug;
    checkedCount++;

    if (checkedCount % 500 === 0 || checkedCount === targetLaws.length) {
      console.log(`[sync-daily] HEAD check progress: ${checkedCount}/${targetLaws.length}...`);
    }

    const currentEntry = manifest[slug];
    const headers: Record<string, string> = {
      'User-Agent': 'LawNetz.de Sync Pipeline (barrierefrei & open-source)',
    };

    if (!force && currentEntry?.etag) {
      headers['If-None-Match'] = currentEntry.etag;
    }
    if (!force && currentEntry?.lastModified) {
      headers['If-Modified-Since'] = currentEntry.lastModified;
    }

    try {
      const res = await fetch(`https://www.gesetze-im-internet.de/${slug}/xml.zip`, {
        method: 'HEAD',
        headers,
      });

      if (res.status === 304) {
        // Law has not changed since last check
        skippedUnchanged++;
        return;
      }

      if (res.status === 404) {
        // Obsolete or repealed law with no XML archive
        notFoundCount++;
        manifest[slug] = {
          ...currentEntry,
          status: 'not_found',
          lastSynced: new Date().toISOString(),
        };
        return;
      }

      if (res.status === 200) {
        const etag = res.headers.get('etag') || undefined;
        const lastModified = res.headers.get('last-modified') || undefined;
        toUpdate.push({ slug, etag, lastModified });
        return;
      }

      // Other HTTP status
      toUpdate.push({ slug });
    } catch (err: any) {
      // Network hiccup on HEAD, queue for safe download retry
      toUpdate.push({ slug });
    }
  });

  console.log(
    `[sync-daily] HEAD checks complete: ${skippedUnchanged} unchanged (304), ${notFoundCount} not found (404), ${toUpdate.length} to update/download.`
  );

  // Step 2: Download and parse laws that changed or are new (controlled concurrency: 4)
  if (toUpdate.length > 0) {
    console.log(`[sync-daily] Downloading and parsing ${toUpdate.length} laws (concurrency: 4)...`);
    let processedUpdates = 0;

    await asyncPool(toUpdate, 4, async (item) => {
      const { slug, etag, lastModified } = item;
      try {
        const law = await fetchAndParseLaw(slug);
        if (!law) return;

        // Save local JSON cache only if requested or if no database connected
        if (saveJson || !db) {
          const outFile = path.join(lawsDir, `${law.slug}.json`);
          fs.writeFileSync(outFile, JSON.stringify(law, null, 2), 'utf-8');
        }

        // Upsert to MySQL if database is connected
        if (db) {
          await db
            .insert(schema.laws)
            .values({
              slug: law.slug,
              abbreviation: law.abbreviation,
              title: law.title,
              language: 'de',
              normCount: law.norms.length,
              sourceUrl: law.sourceUrl,
              lastSyncedAt: new Date(),
              createdAt: new Date(),
            })
            .onDuplicateKeyUpdate({
              set: {
                abbreviation: sql`VALUES(abbreviation)`,
                title: sql`VALUES(title)`,
                normCount: sql`VALUES(norm_count)`,
                lastSyncedAt: new Date(),
              },
            });

          for (const norm of law.norms) {
            const normId = `${law.slug}:${norm.slug}`;
            const paragraphsJson = norm.paragraphs.map((p: any) => {
              if (typeof p === 'string') {
                const m = p.match(/^\s*\((\d+[a-z]?)\)/);
                return { number: m ? m[1] : null, text: p, html: p };
              }
              return {
                number: p.number ?? null,
                text: p.text || '',
                html: p.html || p.text || '',
              };
            });
            const contentText = norm.paragraphs
              .map((p: any) => (typeof p === 'string' ? p : p.text || ''))
              .join('\n');

            await db
              .insert(schema.norms)
              .values({
                id: normId,
                lawSlug: law.slug,
                normSlug: norm.slug,
                identifier: norm.identifier,
                title: norm.title,
                paragraphs: paragraphsJson,
                contentText,
                orderIndex: norm.orderIndex,
                language: 'de',
                createdAt: new Date(),
              })
              .onDuplicateKeyUpdate({
                set: {
                  identifier: sql`VALUES(identifier)`,
                  title: sql`VALUES(title)`,
                  paragraphs: sql`VALUES(paragraphs)`,
                  contentText: sql`VALUES(content_text)`,
                  orderIndex: sql`VALUES(order_index)`,
                },
              });
          }
        }

        // Update manifest
        manifest[slug] = {
          etag,
          lastModified,
          lastSynced: new Date().toISOString(),
          status: 'ok',
          normsCount: law.norms.length,
        };

        updatedCount++;
        processedUpdates++;

        if (processedUpdates % 25 === 0) {
          saveManifest();
          console.log(`[sync-daily] Update progress: ${processedUpdates}/${toUpdate.length} saved.`);
        }
      } catch (err: any) {
        failedCount++;
        console.error(`[sync-daily] Error updating ${slug}:`, err.message);
        manifest[slug] = {
          ...manifest[slug],
          lastSynced: new Date().toISOString(),
          status: 'error',
        };
      }
    });
  }

  saveManifest();

  const durationMs = Date.now() - startTime;
  const status: 'success' | 'failed' | 'partial' =
    failedCount === 0 ? 'success' : updatedCount > 0 ? 'partial' : 'failed';

  console.log(
    `[${new Date().toISOString()}] ✅ Daily Delta Sync completed in ${(durationMs / 1000).toFixed(
      1
    )}s. Checked: ${checkedCount}, Unchanged: ${skippedUnchanged}, Updated: ${updatedCount}, Failed: ${failedCount}`
  );

  if (db) {
    try {
      await db.insert(schema.syncLogs).values({
        lawsChecked: checkedCount,
        lawsUpdated: updatedCount,
        status,
        durationMs,
        details: {
          skippedUnchanged,
          notFoundCount,
          failedCount,
        },
      });
    } catch {}
  }
}

main().catch((err) => {
  console.error('[sync-daily] Fatal error:', err);
  process.exit(1);
});
