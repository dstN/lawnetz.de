#!/usr/bin/env node

/**
 * fetch-toc.ts
 *
 * Fetches the daily XML table of contents from gesetze-im-internet.de,
 * parses it, and writes structured JSON to src/data/toc.json.
 *
 * Data source: https://www.gesetze-im-internet.de/gii-toc.xml
 * DTD reference: https://www.gesetze-im-internet.de/dtd/1.0/gii-toc.dtd
 *
 * XML structure:
 *   <items>
 *     <item>
 *       <title>Bürgerliches Gesetzbuch</title>
 *       <link>http://www.gesetze-im-internet.de/bgb/xml.zip</link>
 *     </item>
 *     ...
 *   </items>
 *
 * Output JSON structure:
 *   {
 *     "meta": { "fetchedAt": "...", "source": "...", "count": 6234 },
 *     "laws": [
 *       {
 *         "title": "Bürgerliches Gesetzbuch",
 *         "slug": "bgb",
 *         "xmlUrl": "http://www.gesetze-im-internet.de/bgb/xml.zip",
 *         "firstLetter": "B"
 *       },
 *       ...
 *     ],
 *     "index": { "A": [...slugs], "B": [...slugs], ... }
 *   }
 *
 * Usage:
 *   npx tsx scripts/fetch-toc.ts
 *   npx tsx scripts/fetch-toc.ts --output ./custom/path/toc.json
 */

import { XMLParser } from 'fast-xml-parser';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Types ───────────────────────────────────────────────────────────────────

interface RawTocItem {
  title: string;
  link: string;
}

interface RawTocXml {
  items: {
    item: RawTocItem | RawTocItem[];
  };
}

interface LawEntry {
  /** Full official title of the law */
  title: string;
  /** URL slug derived from the XML download path, e.g. "bgb" */
  slug: string;
  /** Original XML zip download URL */
  xmlUrl: string;
  /** First letter of the title (uppercase) for index grouping */
  firstLetter: string;
}

interface TocData {
  meta: {
    fetchedAt: string;
    source: string;
    count: number;
  };
  laws: LawEntry[];
  index: Record<string, string[]>;
}

// ── Config ──────────────────────────────────────────────────────────────────

const TOC_URL = 'https://www.gesetze-im-internet.de/gii-toc.xml';
const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT = resolve(__dirname, '..', 'src', 'data', 'toc.json');

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract the law slug from the XML download URL.
 *
 * @example
 *   "http://www.gesetze-im-internet.de/bgb/xml.zip" → "bgb"
 *   "http://www.gesetze-im-internet.de/1-dm-goldm_nzg/xml.zip" → "1-dm-goldm_nzg"
 */
function extractSlug(xmlUrl: string): string {
  try {
    const url = new URL(xmlUrl);
    // Path is like "/bgb/xml.zip" → extract "bgb"
    const segments = url.pathname.split('/').filter(Boolean);
    // The slug is the first segment (the law directory name)
    return segments.length >= 1 ? segments[0] : '';
  } catch {
    // Fallback: regex extraction
    const match = xmlUrl.match(/gesetze-im-internet\.de\/([^/]+)\//);
    return match?.[1] ?? '';
  }
}

/**
 * Determine the first letter for alphabetical grouping.
 * - Letters A-Z are grouped under their uppercase letter
 * - Numbers and special characters are grouped under "#"
 */
function getFirstLetter(title: string): string {
  const cleaned = title.trim();
  if (!cleaned) return '#';

  const firstChar = cleaned[0].toUpperCase();
  // Check if it's a letter (A-Z, including German umlauts)
  if (/[A-ZÄÖÜ]/.test(firstChar)) {
    // Map umlauts to their base letter for consistent grouping
    const umlautMap: Record<string, string> = { Ä: 'A', Ö: 'O', Ü: 'U' };
    return umlautMap[firstChar] ?? firstChar;
  }

  return '#'; // Numbers, special characters
}

/**
 * German-aware locale sort comparator for law titles.
 */
function germanSort(a: LawEntry, b: LawEntry): number {
  return a.title.localeCompare(b.title, 'de-DE', { sensitivity: 'base' });
}

// ── Main ────────────────────────────────────────────────────────────────────

async function fetchToc(): Promise<void> {
  const outputPath = parseArgs();

  console.log('📥 Fetching TOC from:', TOC_URL);
  const startTime = performance.now();

  // 1. Fetch the XML
  const response = await fetch(TOC_URL);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch TOC: ${response.status} ${response.statusText}`
    );
  }
  const xmlText = await response.text();
  console.log(`   ✓ Downloaded ${(xmlText.length / 1024).toFixed(1)} KB`);

  // 2. Parse XML → JavaScript object
  const parser = new XMLParser({
    ignoreAttributes: true,
    isArray: (name) => name === 'item', // Always treat <item> as array
    trimValues: true,
  });

  const parsed: RawTocXml = parser.parse(xmlText);

  // 3. Normalize: ensure items is always an array
  const rawItems: RawTocItem[] = Array.isArray(parsed.items.item)
    ? parsed.items.item
    : [parsed.items.item];

  console.log(`   ✓ Parsed ${rawItems.length} items from XML`);

  // 4. Transform to structured LawEntry objects
  const laws: LawEntry[] = rawItems
    .map((item) => {
      const slug = extractSlug(item.link);
      if (!slug) {
        console.warn(`   ⚠ Skipping item with invalid URL: ${item.link}`);
        return null;
      }

      return {
        title: item.title,
        slug,
        xmlUrl: item.link,
        firstLetter: getFirstLetter(item.title),
      } satisfies LawEntry;
    })
    .filter((entry): entry is LawEntry => entry !== null)
    .sort(germanSort);

  // 5. Build alphabetical index
  const index: Record<string, string[]> = {};
  for (const law of laws) {
    const letter = law.firstLetter;
    if (!index[letter]) {
      index[letter] = [];
    }
    index[letter].push(law.slug);
  }

  // 6. Assemble output
  const tocData: TocData = {
    meta: {
      fetchedAt: new Date().toISOString(),
      source: TOC_URL,
      count: laws.length,
    },
    laws,
    index,
  };

  // 7. Write to disk
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(tocData, null, 2), 'utf-8');

  const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
  console.log(`\n✅ Done in ${elapsed}s`);
  console.log(`   📄 Written to: ${outputPath}`);
  console.log(`   📊 Total laws: ${laws.length}`);
  console.log(`   📇 Index groups: ${Object.keys(index).length}`);

  // Print top-5 groups by size
  const sortedGroups = Object.entries(index)
    .sort(([, a], [, b]) => b.length - a.length)
    .slice(0, 5);
  console.log('   📈 Largest groups:');
  for (const [letter, slugs] of sortedGroups) {
    console.log(`      ${letter}: ${slugs.length} laws`);
  }
}

function parseArgs(): string {
  const args = process.argv.slice(2);
  const outputIdx = args.indexOf('--output');
  if (outputIdx !== -1 && args[outputIdx + 1]) {
    return resolve(args[outputIdx + 1]);
  }
  return DEFAULT_OUTPUT;
}

// ── Execute ─────────────────────────────────────────────────────────────────

fetchToc().catch((error: unknown) => {
  console.error('\n❌ Error fetching TOC:', error);
  process.exit(1);
});
