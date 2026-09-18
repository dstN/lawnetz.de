#!/usr/bin/env node

/**
 * fetch-toc.ts
 *
 * Fetches the daily table of contents from gesetze-im-internet.de:
 * - XML feed (gii-toc.xml) for complete catalog & XML download URLs
 * - HTML Teillisten (Teilliste_A–Z, 1–9) for official legal abbreviations,
 *   accurate letter groupings (by abbreviation), and exact official PDF filenames.
 *
 * Data sources:
 *   - https://www.gesetze-im-internet.de/gii-toc.xml
 *   - https://www.gesetze-im-internet.de/Teilliste_[A-Z,1-9].html
 *
 * Output JSON structure:
 *   {
 *     "meta": { "fetchedAt": "...", "source": "...", "count": 6132 },
 *     "laws": [
 *       {
 *         "title": "Bürgerliches Gesetzbuch",
 *         "slug": "bgb",
 *         "abbreviation": "BGB",
 *         "firstLetter": "B",
 *         "pdf": "BGB.pdf",
 *         "xmlUrl": "http://www.gesetze-im-internet.de/bgb/xml.zip"
 *       },
 *       ...
 *     ],
 *     "index": { "A": [...slugs], "B": [...slugs], ... }
 *   }
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

interface TeillisteEntry {
  slug: string;
  title: string;
  abbr: string;
  pdf: string | null;
  letter: string;
}

export interface LawEntry {
  /** Full official title of the law */
  title: string;
  /** URL slug derived from the XML download path, e.g. "bgb" */
  slug: string;
  /** Official legal abbreviation (e.g. "GebOSt", "GG", "BGB", "AntiDopG") */
  abbreviation: string;
  /** First letter of the abbreviation for index grouping (A-Z or #) */
  firstLetter: string;
  /** Official PDF filename on gesetze-im-internet.de (e.g. "GebOSt.pdf") */
  pdf: string | null;
  /** Original XML zip download URL */
  xmlUrl: string;
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

function extractSlug(xmlUrl: string): string {
  try {
    const url = new URL(xmlUrl);
    const segments = url.pathname.split('/').filter(Boolean);
    return segments.length >= 1 ? segments[0] : '';
  } catch {
    const match = xmlUrl.match(/gesetze-im-internet\.de\/([^/]+)\//);
    return match?.[1] ?? '';
  }
}

/**
 * Scrapes all alphabetical and digit Teillisten from gesetze-im-internet.de
 * with concurrency limit & retry to get official abbreviations & PDF links.
 */
async function scrapeTeillisten(): Promise<Map<string, TeillisteEntry>> {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  const allKeys = [...letters, ...digits];

  const lawMap = new Map<string, TeillisteEntry>();
  const decoder = new TextDecoder('latin1');

  const queue = [...allKeys];
  const worker = async () => {
    while (queue.length > 0) {
      const key = queue.shift();
      if (!key) break;

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const res = await fetch(`https://www.gesetze-im-internet.de/Teilliste_${key}.html`);
          if (!res.ok) break;
          const buffer = await res.arrayBuffer();
          const html = decoder.decode(buffer);

          const pRegex = /<p><a href="\.\/([^/]+)\/index\.html"><abbr title="([^"]*)">\s*([^<]+?)\s*<\/abbr><\/a>(?:<br\s*\/?>\s*([\s\S]*?))?<\/p>/g;
          let m;
          while ((m = pRegex.exec(html)) !== null) {
            const slug = m[1];
            const title = m[2];
            const abbr = m[3].trim();
            const rest = m[4] || '';
            const pdfMatch = rest.match(/href="(?:\.\/[^/]+\/)?([^"/]+\.pdf)"/);
            const pdf = pdfMatch ? pdfMatch[1] : null;

            lawMap.set(slug, {
              slug,
              title,
              abbr,
              pdf,
              letter: letters.includes(key) ? key : '#',
            });
          }
          break; // success
        } catch {
          if (attempt < 3) {
            await new Promise((r) => setTimeout(r, 250 * attempt));
          }
        }
      }
    }
  };

  await Promise.all([worker(), worker(), worker()]);
  return lawMap;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function fetchToc(): Promise<void> {
  const outputPath = parseArgs();
  console.log('📥 Fetching TOC XML and Teillisten from gesetze-im-internet.de...');
  const startTime = performance.now();

  const [xmlResponse, teillisteMap] = await Promise.all([
    fetch(TOC_URL),
    scrapeTeillisten(),
  ]);

  if (!xmlResponse.ok) {
    throw new Error(`Failed to fetch XML TOC: ${xmlResponse.status} ${xmlResponse.statusText}`);
  }

  const xmlText = await xmlResponse.text();
  const parser = new XMLParser({
    ignoreAttributes: true,
    isArray: (name) => name === 'item',
    trimValues: true,
  });

  const parsed: RawTocXml = parser.parse(xmlText);
  const rawItems: RawTocItem[] = Array.isArray(parsed.items.item)
    ? parsed.items.item
    : [parsed.items.item];

  console.log(`   ✓ Downloaded XML: ${rawItems.length} entries`);
  console.log(`   ✓ Scraped Teillisten: ${teillisteMap.size} entries with abbreviations`);

  // Transform to structured LawEntry objects
  const rawLaws: LawEntry[] = rawItems
    .map((item): LawEntry | null => {
      const slug = extractSlug(item.link);
      if (!slug) return null;

      const teilliste = teillisteMap.get(slug);
      const title = teilliste?.title || item.title;
      const abbreviation = teilliste?.abbr || slug.toUpperCase();

      // Letter from Teilliste or derived from first character of abbreviation
      let firstLetter = teilliste?.letter;
      if (!firstLetter) {
        const char = abbreviation.trim()[0]?.toUpperCase() || '#';
        firstLetter = /[A-Z]/.test(char) ? char : '#';
      }

      const pdf = teilliste?.pdf || `${(abbreviation || slug).trim().replace(/\s+/g, '_')}.pdf`;

      return {
        title,
        slug,
        abbreviation,
        firstLetter,
        pdf,
        xmlUrl: item.link,
      };
    })
    .filter((entry): entry is LawEntry => entry !== null);

  // Sort laws: primary by firstLetter (# comes first or last? Alphabetical: # then A-Z), then by abbreviation
  const sortedLaws = rawLaws.sort((a, b) => {
    if (a.firstLetter !== b.firstLetter) {
      if (a.firstLetter === '#') return -1;
      if (b.firstLetter === '#') return 1;
      return a.firstLetter.localeCompare(b.firstLetter);
    }
    return a.abbreviation.localeCompare(b.abbreviation, 'de-DE', { sensitivity: 'base' });
  });

  // Build alphabetical index
  const index: Record<string, string[]> = {};
  for (const law of sortedLaws) {
    const letter = law.firstLetter;
    if (!index[letter]) {
      index[letter] = [];
    }
    index[letter].push(law.slug);
  }

  // Assemble output
  const tocData: TocData = {
    meta: {
      fetchedAt: new Date().toISOString(),
      source: TOC_URL,
      count: sortedLaws.length,
    },
    laws: sortedLaws,
    index,
  };

  // Write to disk
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(tocData, null, 2), 'utf-8');

  const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
  console.log(`\n✅ Done in ${elapsed}s`);
  console.log(`   📄 Written to: ${outputPath}`);
  console.log(`   📊 Total laws: ${sortedLaws.length}`);
  console.log(`   📇 Index groups: ${Object.keys(index).length}`);
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
