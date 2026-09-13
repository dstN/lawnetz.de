const mysql = require('mysql2/promise');
require('dotenv').config();

// Robust HTML entity decoder
function decodeHtml(html) {
  if (!html) return '';
  return html
    .replace(/&#(\d+);/g, (_, dec) => {
      try {
        return String.fromCodePoint(parseInt(dec, 10));
      } catch {
        return _;
      }
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch {
        return _;
      }
    })
    .replace(/&nbsp;/gi, ' ')
    .replace(/&ndash;/gi, '–')
    .replace(/&mdash;/gi, '—')
    .replace(/&lsquo;/gi, '‘')
    .replace(/&rsquo;/gi, '’')
    .replace(/&ldquo;/gi, '“')
    .replace(/&rdquo;/gi, '”')
    .replace(/&hellip;/gi, '…')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

const PREFIX_WORDS = ['Book', 'Division', 'Subdivision', 'Title', 'Subtitle', 'Chapter', 'Subchapter', 'Part', 'Annex', 'Schedule', 'Appendix', 'Section', 'Article', 'Sections', 'Articles'];
const PREFIX_REGEX_STR = '(?:' + PREFIX_WORDS.map(w => `${w}|${w.toUpperCase()}`).join('|') + ')';
const NUMBER_OR_WORD = '(?:[0-9]+[a-z]?|[IVXLCDM]+|ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE|TEN|ELEVEN|TWELVE|THIRTEEN|FOURTEEN|FIFTEEN|SIXTEEN|SEVENTEEN|EIGHTEEN|NINETEEN|TWENTY|FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH|NINTH|TENTH|ELEVENTH|TWELFTH)';

const SPLIT_REGEX = new RegExp(`^(${PREFIX_REGEX_STR}\\s*${NUMBER_OR_WORD})(?=[A-Z][a-z]|(?<=[0-9][a-z]?)[A-Z])(.*)$`);

async function main() {
  const isDryRun = process.argv.includes('--dry-run');
  console.log(`[REPAIR] Connecting to MySQL (dry-run: ${isDryRun})...`);

  const conn = await mysql.createConnection(process.env.DB_URL);

  const [norms] = await conn.query(`
    SELECT id, law_slug, norm_slug, identifier, title, paragraphs, content_text
    FROM norms
    WHERE language = 'en'
    ORDER BY law_slug, order_index
  `);

  console.log(`[REPAIR] Analyzing ${norms.length} English norms...`);

  const toUpdate = [];

  for (const norm of norms) {
    let changed = false;

    let ident = decodeHtml(norm.identifier || '').trim();
    let title = decodeHtml(norm.title || '').trim();
    let contentText = decodeHtml(norm.content_text || '');
    let paragraphs = norm.paragraphs;

    // 1. Check unchop (if ident ended with single letter due to previous run)
    const chopMatch = ident.match(/^(.*(?:\s+[0-9]+|[IVXLCDM]+|[A-Z]{2,}))([A-Z])$/);
    if (chopMatch && title && /^[a-z]/.test(title)) {
      ident = chopMatch[1];
      title = chopMatch[2] + title;
      changed = true;
    }

    // 2. Check glued structural headings
    if (!title) {
      const match = ident.match(SPLIT_REGEX);
      if (match) {
        ident = match[1].trim();
        title = match[2].trim();
        changed = true;
      }
    }

    // 3. Entity decode comparison
    if (ident !== norm.identifier || title !== norm.title || contentText !== norm.content_text) {
      changed = true;
    }

    // 4. Paragraphs JSON entity decode
    if (Array.isArray(paragraphs)) {
      let pChanged = false;
      const cleanedP = paragraphs.map(p => {
        const text = typeof p === 'string' ? p : (p.text || '');
        const decText = decodeHtml(text);
        if (decText !== text) pChanged = true;
        return typeof p === 'string' ? decText : { ...p, text: decText };
      });
      if (pChanged) {
        paragraphs = cleanedP;
        changed = true;
      }
    }

    if (changed) {
      toUpdate.push({
        id: norm.id,
        identifier: ident,
        title,
        paragraphs: typeof paragraphs === 'string' ? paragraphs : JSON.stringify(paragraphs),
        contentText,
      });
    }
  }

  console.log(`[REPAIR] Found ${toUpdate.length} norms needing update.`);

  if (toUpdate.length > 0 && !isDryRun) {
    console.log(`[REPAIR] Executing batch updates...`);
    const chunkSize = 250;
    for (let i = 0; i < toUpdate.length; i += chunkSize) {
      const chunk = toUpdate.slice(i, i + chunkSize);
      await conn.beginTransaction();
      for (const item of chunk) {
        await conn.query(`
          UPDATE norms
          SET identifier = ?,
              title = ?,
              paragraphs = ?,
              content_text = ?
          WHERE id = ?
        `, [item.identifier, item.title, item.paragraphs, item.contentText, item.id]);
      }
      await conn.commit();
      process.stdout.write(`\r  Updated ${Math.min(i + chunkSize, toUpdate.length)}/${toUpdate.length}`);
    }
    console.log('\n[REPAIR] All updates committed successfully.');
  }

  await conn.end();
}

main().catch(err => {
  console.error('[REPAIR] Error:', err);
  process.exit(1);
});
