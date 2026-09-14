import 'dotenv/config';
import { db } from '../src/db/index';
import * as schema from '../src/db/schema';
import { fetchAndParseLaw } from './fetch-law';

export async function syncLawToDb(slug: string): Promise<void> {
  if (!db) {
    throw new Error('Database is not configured! Cannot sync to DB.');
  }

  console.log(`[sync-law-to-db] Fetching and parsing ${slug}...`);
  const law = await fetchAndParseLaw(slug);
  if (!law) {
    console.warn(`[sync-law-to-db] No data for ${slug}`);
    return;
  }

  console.log(`[sync-law-to-db] Saving ${law.slug} (${law.norms.length} norms) to MySQL...`);

  // Upsert law record
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
        abbreviation: law.abbreviation,
        title: law.title,
        normCount: law.norms.length,
        lastSyncedAt: new Date(),
      },
    });

  // Batch insert/update norms (chunked for high MySQL throughput)
  const chunkSize = 50;
  for (let i = 0; i < law.norms.length; i += chunkSize) {
    const chunk = law.norms.slice(i, i + chunkSize);
    await Promise.all(
      chunk.map(async (norm) => {
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
              identifier: norm.identifier,
              title: norm.title,
              paragraphs: paragraphsJson,
              contentText,
              orderIndex: norm.orderIndex,
            },
          });
      })
    );
  }

  console.log(`[sync-law-to-db] ✓ Successfully synced ${slug} to MySQL.`);
}

const PRIORITY_LAWS = [
  'bgb',
  'gg',
  'stgb',
  'zpo',
  'stpo',
  'hgb',
  'vwgo',
  'urhg',
  'bdsg_2018',
  'ddg',
  'arbzg',
  'kschg',
  'betrvg',
  'agg',
  'ifsg',
  'stvo_2013',
  'ao_1977',
  'sgb_1',
  'beg',
  'zvg',
  'sgg',
  'gvg',
  'hwo',
  'flurbg',
  'patg',
];

async function main() {
  const args = process.argv.slice(2);
  let slugs: string[] = [];

  if (args.includes('--priority') || args.length === 0) {
    slugs = PRIORITY_LAWS;
  } else {
    slugs = args.filter((a) => !a.startsWith('-'));
  }

  console.log(`[sync-law-to-db] Syncing ${slugs.length} laws directly to MySQL...`);
  for (const slug of slugs) {
    try {
      await syncLawToDb(slug);
    } catch (err: any) {
      console.error(`[sync-law-to-db] Failed to sync ${slug}:`, err.message);
    }
  }
  console.log(`[sync-law-to-db] Done syncing ${slugs.length} laws to MySQL.`);
  process.exit(0);
}

if (process.argv[1] && process.argv[1].includes('sync-law-to-db')) {
  main().catch((err) => {
    console.error('Fatal sync error:', err);
    process.exit(1);
  });
}
