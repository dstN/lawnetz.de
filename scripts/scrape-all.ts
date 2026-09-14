/**
 * scripts/scrape-all.ts — Master Ingestion Pipeline for LawNetz
 *
 * Scrapes:
 * 1. All ~6,130 German federal laws from gii-toc.xml / src/data/toc.json
 * 2. All 135 English translated laws from Teilliste_translations.html
 *
 * Stores into:
 * - MySQL database (if configured via .env: DB_HOST, DB_USER, DB_PASSWORD, DB_NAME)
 * - Local cache in src/data/laws/<slug>.json (for offline resilience)
 *
 * Usage:
 *   npx tsx scripts/scrape-all.ts [--limit 50] [--concurrency 10] [--english-only] [--german-only]
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fetchAndParseLaw } from './fetch-law';
import { db, isDatabaseConfigured } from '../src/db/index';
import * as schema from '../src/db/schema';
import { sql } from 'drizzle-orm';

const args = process.argv.slice(2);
function getArg(flag: string, fallback: string = ''): string {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}

const limit = Number(getArg('--limit', '0'));
const concurrency = Number(getArg('--concurrency', '10'));
const englishOnly = args.includes('--english-only');
const germanOnly = args.includes('--german-only');
const saveJson = args.includes('--save-json');

async function main() {
  console.log('='.repeat(60));
  console.log('🚀 LawNetz Master Data Scraping Pipeline');
  console.log(`Database Configured: ${isDatabaseConfigured() ? '✅ YES (MySQL)' : '⚠️ NO (Local JSON only)'}`);
  console.log(`Concurrency: ${concurrency}`);
  if (limit > 0) console.log(`Limit: ${limit} laws`);
  console.log('='.repeat(60));

  const startTime = Date.now();
  let totalLawsProcessed = 0;
  let totalNormsProcessed = 0;

  // --------------------------------------------------------------------------
  // 1. Ingest German Federal Laws
  // --------------------------------------------------------------------------
  if (!englishOnly) {
    console.log('\n[1/2] Loading German Laws Table of Contents (toc.json)...');
    let tocItems = [];
    const tocFile = path.resolve('src/data/toc.json');
    if (fs.existsSync(tocFile)) {
      const toc = JSON.parse(fs.readFileSync(tocFile, 'utf-8'));
      tocItems = toc.laws || toc.items || [];
    }

    if (limit > 0) {
      tocItems = tocItems.slice(0, limit);
    }

    console.log(`Found ${tocItems.length} German laws to process.`);

    // Concurrency Worker Pool
    let currentIndex = 0;
    const worker = async (workerId: number) => {
      while (currentIndex < tocItems.length) {
        const item = tocItems[currentIndex++];
        try {
          // Download and parse law
          const law = await fetchAndParseLaw(item.slug);
          if (!law) continue;

          totalLawsProcessed++;
          totalNormsProcessed += law.norms.length;

          // Save local JSON cache only if requested or if no database configured
          if (saveJson || !db) {
            const lawsDir = path.resolve('src/data/laws');
            if (!fs.existsSync(lawsDir)) fs.mkdirSync(lawsDir, { recursive: true });
            fs.writeFileSync(path.join(lawsDir, `${law.slug}.json`), JSON.stringify(law, null, 2), 'utf-8');
          }

          // Save to MySQL if active
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

            // Batch insert norms
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

          if (totalLawsProcessed % 25 === 0 || totalLawsProcessed === tocItems.length) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`[Worker ${workerId}] ${totalLawsProcessed}/${tocItems.length} laws processed (${totalNormsProcessed} norms) in ${elapsed}s`);
          }
        } catch (err: any) {
          console.error(`[Worker ${workerId}] Error processing ${item.slug}:`, err.message);
        }
      }
    };

    const workers = Array.from({ length: concurrency }, (_, i) => worker(i + 1));
    await Promise.all(workers);
  }

  // --------------------------------------------------------------------------
  // 2. Ingest English Translated Laws
  // --------------------------------------------------------------------------
  if (!germanOnly) {
    console.log('\n[2/2] Ingesting English Translated Laws...');
    const translationsFile = path.resolve('src/data/translations.json');
    if (fs.existsSync(translationsFile)) {
      const translations = JSON.parse(fs.readFileSync(translationsFile, 'utf-8'));
      console.log(`Found ${translations.length} English translated laws.`);

      for (const t of translations) {
        if (db) {
          try {
            await db
              .insert(schema.laws)
              .values({
                slug: t.slug,
                abbreviation: t.abbreviation,
                title: t.title,
                language: 'en',
                normCount: 0,
                sourceUrl: t.sourceUrl,
                lastSyncedAt: new Date(),
                createdAt: new Date(),
              })
              .onDuplicateKeyUpdate({
                set: {
                  title: sql`VALUES(title)`,
                  lastSyncedAt: new Date(),
                },
              });
          } catch (err: any) {
            console.warn(`Error inserting English law ${t.slug}:`, err.message);
          }
        }
      }
      console.log(`✅ Ingested ${translations.length} English laws into database.`);
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n' + '='.repeat(60));
  console.log(`🎉 Pipeline complete in ${totalTime}s!`);
  console.log(`Total Laws: ${totalLawsProcessed}`);
  console.log(`Total Norms: ${totalNormsProcessed}`);
  console.log('='.repeat(60));
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal scraper error:', err);
  process.exit(1);
});
