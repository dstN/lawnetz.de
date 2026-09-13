#!/usr/bin/env node

/**
 * fetch-law.ts
 *
 * Downloads law XML packages from gesetze-im-internet.de,
 * unzips the XML in memory using fflate, parses the gii-norm.dtd structure
 * using fast-xml-parser, and writes structured JSON to src/data/laws/<slug>.json.
 *
 * Preserves exact URL patterns from gesetze-im-internet.de:
 * - "§ 138"   → "__138"  (e.g. /bgb/__138)
 * - "§ 50a"   → "__50a"
 * - "Art 1"   → "art_1"  (e.g. /gg/art_1)
 * - "Art 20a" → "art_20a"
 * - "Präambel"→ "praeambel"
 * - "Anhang"  → "anhang"
 * - "Anlage"  → "anlage"
 *
 * Usage:
 *   npx tsx scripts/fetch-law.ts bgb
 *   npx tsx scripts/fetch-law.ts gg stgb hgb
 *   npx tsx scripts/fetch-law.ts --top
 */

import { XMLParser } from 'fast-xml-parser';
import * as fflate from 'fflate';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Top laws for initial dataset
export const TOP_LAWS = [
  'gg',       // Grundgesetz
  'bgb',      // Bürgerliches Gesetzbuch
  'stgb',     // Strafgesetzbuch
  'hgb',      // Handelsgesetzbuch
  'zpo',      // Zivilprozessordnung
  'stpo',     // Strafprozessordnung
  'vwgo',     // Verwaltungsgerichtsordnung
  'bdsg_2018',// Bundesdatenschutzgesetz
  'agg',      // Allgemeines Gleichbehandlungsgesetz
  'urhg',     // Urheberrechtsgesetz
  'arbzg',    // Arbeitszeitgesetz
  'burlg',    // Bundesurlaubsgesetz
  'ifsg',     // Infektionsschutzgesetz
  'sgb_1',    // Sozialgesetzbuch I
  'stvo_2013' // Straßenverkehrs-Ordnung
];

// ── Types ───────────────────────────────────────────────────────────────────

export interface LawOutlineNode {
  type: 'structure';
  levelCode?: string;
  designation?: string; // e.g. "Buch 1", "Abschnitt 1"
  title?: string;       // e.g. "Allgemeiner Teil"
}

export interface ParagraphData {
  number?: string | null;
  text: string;
  html?: string;
}

export interface LawNorm {
  type: 'norm';
  doknr: string;
  slug: string;          // e.g. "__138" or "art_1"
  identifier: string;    // e.g. "§ 138" or "Art 1"
  title: string;         // e.g. "Sittenwidriges Rechtsgeschäft; Wucher"
  paragraphs: Array<ParagraphData | string>;  // Structured or text paragraphs
  footnotes?: string;
  orderIndex: number;
}

export type LawItem = LawOutlineNode | LawNorm;

export interface LawData {
  slug: string;
  title: string;
  abbreviation: string;
  enactmentDate?: string;
  latestChange?: string;
  citation?: string;
  sourceUrl: string;
  fetchedAt: string;
  items: LawItem[];
  norms: LawNorm[];
}

// ── Helper Functions ────────────────────────────────────────────────────────

/**
 * Generate official gesetze-im-internet compatible URL slug from norm identifier
 * e.g. "§ 138" -> "__138"
 *      "§ 50a" -> "__50a"
 *      "Art 1" -> "art_1"
 *      "Art 20a" -> "art_20a"
 *      "Präambel" -> "praeambel"
 */
export function normIdentifierToSlug(identifier: string): string {
  if (!identifier) return 'index';
  const clean = identifier.trim();

  // Paragraph: "§ 138" -> "__138", "§ 138a" -> "__138a"
  if (clean.startsWith('§')) {
    const num = clean.replace(/^§+\s*/, '').replace(/\s+/g, '_').toLowerCase();
    return `__${num}`;
  }

  // Article: "Art 1" -> "art_1", "Art. 1" -> "art_1"
  if (/^Art\.?/i.test(clean)) {
    const num = clean.replace(/^Art\.?\s*/i, '').replace(/\s+/g, '_').toLowerCase();
    return `art_${num}`;
  }

  // Common special sections
  const specialMap: Record<string, string> = {
    'präambel': 'praeambel',
    'praeambel': 'praeambel',
    'eingangsformel': 'eingangsformel',
    'schlussformel': 'schlussformel',
    'anhang': 'anhang',
    'anlage': 'anlage',
  };

  const lower = clean.toLowerCase();
  for (const [key, val] of Object.entries(specialMap)) {
    if (lower.startsWith(key)) {
      const rest = lower.replace(key, '').trim().replace(/\s+/g, '_');
      return rest ? `${val}_${rest}` : val;
    }
  }

  // Fallback: clean safe slug
  return clean
    .toLowerCase()
    .replace(/[äÄ]/g, 'ae')
    .replace(/[öÖ]/g, 'oe')
    .replace(/[üÜ]/g, 'ue')
    .replace(/[ß]/g, 'ss')
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Clean XML/HTML text content into clean readable strings
 */
function cleanText(text: any): string {
  if (!text) return '';
  if (typeof text === 'string') {
    return text.replace(/\s+/g, ' ').trim();
  }
  if (typeof text === 'number') {
    return String(text);
  }
  if (Array.isArray(text)) {
    return text.map(cleanText).filter(Boolean).join(' ');
  }
  if (typeof text === 'object') {
    const parts: string[] = [];
    for (const [key, val] of Object.entries(text)) {
      if (key.startsWith('@_')) continue;
      parts.push(cleanText(val));
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }
  return '';
}

/**
 * Parse a raw <P>...</P> element from gii-norm XML into structured paragraph data.
 * Preserves the exact document order of introductory text, lists (<DL>), and trailing text.
 */
function parseRawP(rawPXml: string): ParagraphData {
  const inner = rawPXml.replace(/^<P[^>]*>/i, '').replace(/<\/P>$/i, '').trim();

  // Extract Absatz number if available, e.g. "(1)", "(2a)", etc.
  const match = inner.match(/^\s*\((\d+[a-z]?)\)/);
  const number = match ? match[1] : null;

  const hasFormatting = /<DL|<TABLE|<BR|<I>|<B>|<U>|<SUB>|<SUP>|<SP|<NB/i.test(inner);
  if (!hasFormatting) {
    const text = cleanText(inner);
    return { number, text, html: text };
  }

  // Convert XML list and layout tags to clean HTML
  const html = inner
    .replace(/<DL[^>]*>/gi, '<dl class="norm-dl">')
    .replace(/<\/DL>/gi, '</dl>')
    .replace(/<DT[^>]*>(.*?)<\/DT>/gi, '<dt class="norm-dt">$1</dt>')
    .replace(/<DD[^>]*>/gi, '<dd class="norm-dd">')
    .replace(/<\/DD>/gi, '</dd>')
    .replace(/<LA[^>]*>/gi, '<div class="norm-la">')
    .replace(/<\/LA>/gi, '</div>')
    .replace(/<BR\s*\/?>/gi, '<br />')
    .replace(/<SP[^>]*>(.*?)<\/SP>/gi, '<span class="norm-sp">$1</span>')
    .replace(/<NB[^>]*>(.*?)<\/NB>/gi, '<span class="norm-nb">$1</span>');

  // Convert to clean formatted plain text preserving exact sentence order
  const text = inner
    .replace(/<DT[^>]*>\s*(.*?)\s*<\/DT>/gi, '\n  $1 ')
    .replace(/<LA[^>]*>/gi, '')
    .replace(/<\/LA>/gi, '')
    .replace(/<DD[^>]*>/gi, '')
    .replace(/<\/DD>/gi, '')
    .replace(/<DL[^>]*>/gi, '')
    .replace(/<\/DL>/gi, '\n')
    .replace(/<BR\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim();

  return { number, text, html };
}

/**
 * Extract paragraph list from XML textdaten preserving document order
 */
function extractParagraphs(contentNode: any): ParagraphData[] {
  if (!contentNode) return [];
  const rawStr = typeof contentNode === 'string'
    ? contentNode
    : (typeof contentNode === 'object' ? contentNode['#text'] || contentNode.Content || '' : String(contentNode));
  if (!rawStr) return [];

  const pRegex = /<P[\s\S]*?<\/P>/gi;
  const matches = rawStr.match(pRegex);
  if (!matches || matches.length === 0) {
    const single = parseRawP(rawStr);
    return single.text ? [single] : [];
  }

  return matches.map(parseRawP);
}

// ── Main Downloader & Parser ────────────────────────────────────────────────

export async function fetchAndParseLaw(slug: string): Promise<LawData> {
  const zipUrl = `https://www.gesetze-im-internet.de/${slug}/xml.zip`;
  console.log(`[fetch-law] Fetching ${slug} from ${zipUrl}...`);

  const res = await fetch(zipUrl, {
    headers: {
      'User-Agent': 'LawNetz.de XML Pipeline (barrierefrei & open-source)',
    },
    redirect: 'follow',
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch ${zipUrl}: HTTP ${res.status} ${res.statusText}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const zipBytes = new Uint8Array(arrayBuffer);

  // Unzip using fflate
  const unzipped = fflate.unzipSync(zipBytes);
  const xmlFilename = Object.keys(unzipped).find(name => name.endsWith('.xml'));

  if (!xmlFilename) {
    throw new Error(`No XML file found in zip archive for ${slug}`);
  }

  const xmlBytes = unzipped[xmlFilename];
  const xmlString = new TextDecoder('utf-8').decode(xmlBytes);

  // Parse XML with raw Content node preservation
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    trimValues: true,
    stopNodes: ['*.Content', 'Content', '*.textdaten.text.Content'],
  });

  const parsed = parser.parse(xmlString);
  const dokumente = parsed.dokumente;
  if (!dokumente) {
    throw new Error(`Invalid gii-norm XML: missing <dokumente> root tag`);
  }

  const rawNorms = Array.isArray(dokumente.norm) ? dokumente.norm : [dokumente.norm];

  let lawTitle = '';
  let lawAbbr = slug.toUpperCase();
  let enactmentDate: string | undefined;
  let latestChange: string | undefined;
  let citation: string | undefined;

  const items: LawItem[] = [];
  const norms: LawNorm[] = [];

  for (let i = 0; i < rawNorms.length; i++) {
    const norm = rawNorms[i];
    if (!norm || !norm.metadaten) continue;

    const meta = norm.metadaten;
    const doknr = norm['@_doknr'] || `norm_${i}`;

    // First norm typically contains global law metadata
    if (i === 0) {
      if (meta.langue) lawTitle = cleanText(meta.langue);
      if (meta.amtabk) lawAbbr = cleanText(meta.amtabk);
      else if (meta.jurabk) lawAbbr = cleanText(meta.jurabk);
      if (meta['ausfertigung-datum']) enactmentDate = cleanText(meta['ausfertigung-datum']);
      if (meta.fundstelle) citation = cleanText(meta.fundstelle);

      if (meta.standangabe) {
        const standList = Array.isArray(meta.standangabe) ? meta.standangabe : [meta.standangabe];
        const lastStand = standList[standList.length - 1];
        if (lastStand?.standkommentar) {
          latestChange = cleanText(lastStand.standkommentar);
        }
      }
    }

    // Structure heading (e.g. Buch 1, Abschnitt 2)
    if (meta.gliederungseinheit) {
      const gl = meta.gliederungseinheit;
      const designation = cleanText(gl.gliederungsbez);
      const title = cleanText(gl.gliederungstitel);
      const levelCode = cleanText(gl.gliederungskennzahl);

      const outlineItem: LawOutlineNode = {
        type: 'structure',
        levelCode: levelCode || undefined,
        designation: designation || undefined,
        title: title || undefined,
      };
      items.push(outlineItem);
      continue;
    }

    // Individual norm / article / paragraph
    if (meta.enbez) {
      const identifier = cleanText(meta.enbez);
      const title = cleanText(meta.titel);
      const normSlug = normIdentifierToSlug(identifier);

      let paragraphs: ParagraphData[] = [];
      let footnotes: string | undefined;

      if (norm.textdaten) {
        if (norm.textdaten.text) {
          const content = norm.textdaten.text.Content || norm.textdaten.text;
          paragraphs = extractParagraphs(content);
        }
        if (norm.textdaten.fussnoten) {
          const fn = cleanText(norm.textdaten.fussnoten);
          if (fn) footnotes = fn;
        }
      }

      const lawNorm: LawNorm = {
        type: 'norm',
        doknr,
        slug: normSlug,
        identifier,
        title,
        paragraphs,
        footnotes,
        orderIndex: norms.length,
      };

      items.push(lawNorm);
      norms.push(lawNorm);
    }
  }

  // Fallback title if empty
  if (!lawTitle) {
    lawTitle = lawAbbr || slug.toUpperCase();
  }

  const lawData: LawData = {
    slug,
    title: lawTitle,
    abbreviation: lawAbbr,
    enactmentDate,
    latestChange,
    citation,
    sourceUrl: `https://www.gesetze-im-internet.de/${slug}/`,
    fetchedAt: new Date().toISOString(),
    items,
    norms,
  };

  return lawData;
}

// ── Runner ──────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const outDir = resolve(__dirname, '../src/data/laws');
  await mkdir(outDir, { recursive: true });

  let slugsToFetch: string[] = [];

  if (args.includes('--top')) {
    slugsToFetch = TOP_LAWS;
  } else if (args.length > 0) {
    slugsToFetch = args.filter(a => !a.startsWith('-'));
  } else {
    console.log('Usage: npx tsx scripts/fetch-law.ts [slug] | --top');
    process.exit(1);
  }

  console.log(`[fetch-law] Starting download of ${slugsToFetch.length} laws...`);

  for (const slug of slugsToFetch) {
    try {
      const startTime = performance.now();
      const law = await fetchAndParseLaw(slug);
      const outFile = resolve(outDir, `${slug}.json`);
      await writeFile(outFile, JSON.stringify(law, null, 2), 'utf-8');
      const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
      console.log(`[fetch-law] ✓ Saved ${slug} (${law.norms.length} norms) to ${outFile} in ${elapsed}s`);
    } catch (err: any) {
      console.error(`[fetch-law] ✗ Error fetching ${slug}:`, err.message);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(__filename)) {
  main();
}
