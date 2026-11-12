import 'dotenv/config';
import { db } from '../src/db/index';
import { fetchAndParseLaw } from './fetch-law';
import { saveLaw } from './sync-core';

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
  await saveLaw(law);

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
