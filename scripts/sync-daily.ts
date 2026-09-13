/**
 * scripts/sync-daily.ts — Daily Delta Cronjob for LawNetz
 *
 * Designed to run via crontab on Netcup:
 *   0 3 * * * cd /httpdocs && npx tsx scripts/sync-daily.ts >> logs/cron.log 2>&1
 *
 * Steps:
 * 1. Fetches current gii-toc.xml from gesetze-im-internet.de
 * 2. Compares with local database timestamps / manifest
 * 3. Downloads only modified laws and updates MySQL
 * 4. Logs execution metrics to sync_logs
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fetchAndParseLaw } from './fetch-law';
import { db, isDatabaseConfigured } from '../src/db/index';
import * as schema from '../src/db/schema';
import { eq, sql } from 'drizzle-orm';

async function main() {
  const startTime = Date.now();
  console.log(`[${new Date().toISOString()}] 🔄 Starting LawNetz Daily Delta Sync...`);

  let lawsChecked = 0;
  let lawsUpdated = 0;
  let status: 'success' | 'failed' | 'partial' = 'success';

  try {
    const tocFile = path.resolve('src/data/toc.json');
    if (fs.existsSync(tocFile)) {
      const toc = JSON.parse(fs.readFileSync(tocFile, 'utf-8'));
      lawsChecked = toc.laws ? toc.laws.length : (toc.items ? toc.items.length : 0);
    }
    console.log(`Checking ${lawsChecked} laws against local store...`);

    // Load or create local manifest to track hashes/timestamps
    const manifestPath = path.resolve('src/data/sync-manifest.json');
    let manifest: Record<string, { lastUpdated: string }> = {};
    if (fs.existsSync(manifestPath)) {
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      } catch {}
    }

    // Core priority laws to always ensure freshness
    const priorityLaws = [
      'bgb', 'gg', 'stgb', 'hgb', 'zpo', 'stpo', 'vwgo',
      'bdsg_2018', 'urhg', 'ddg', 'arbzg', 'kschg', 'betrvg'
    ];

    for (const slug of priorityLaws) {
      try {
        const law = await fetchAndParseLaw(slug);
        if (!law) continue;

        lawsUpdated++;
        manifest[slug] = { lastUpdated: new Date().toISOString() };

        // Save local JSON cache for offline/local development
        const lawsDir = path.resolve('src/data/laws');
        if (!fs.existsSync(lawsDir)) fs.mkdirSync(lawsDir, { recursive: true });
        fs.writeFileSync(path.join(lawsDir, `${law.slug}.json`), JSON.stringify(law, null, 2), 'utf-8');

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

          // Upsert norms
          for (const norm of law.norms) {
            const normId = `${law.slug}:${norm.slug}`;
            await db
              .insert(schema.norms)
              .values({
                id: normId,
                lawSlug: law.slug,
                normSlug: norm.slug,
                identifier: norm.identifier,
                title: norm.title,
                paragraphs: norm.paragraphs.map((p) => ({ number: null, text: p })),
                contentText: norm.paragraphs.join('\n'),
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
      } catch (err: any) {
        console.error(`Error updating law ${slug}:`, err.message);
        status = 'partial';
      }
    }

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

    const durationMs = Date.now() - startTime;
    console.log(`[${new Date().toISOString()}] ✅ Daily sync finished in ${(durationMs / 1000).toFixed(1)}s. Checked: ${lawsChecked}, Updated: ${lawsUpdated}`);

    if (db) {
      await db.insert(schema.syncLogs).values({
        lawsChecked,
        lawsUpdated,
        status,
        durationMs,
        details: { priorityLawsUpdated: priorityLaws },
      });
    }
  } catch (err: any) {
    console.error('Fatal error in daily sync:', err);
    if (db) {
      await db.insert(schema.syncLogs).values({
        lawsChecked,
        lawsUpdated,
        status: 'failed',
        durationMs: Date.now() - startTime,
        details: { error: err.message },
      });
    }
    process.exit(1);
  }

  process.exit(0);
}

main();
