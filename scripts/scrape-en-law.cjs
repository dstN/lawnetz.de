const mysql = require('mysql2/promise');
require('dotenv').config();

// Helper to decode all HTML entities properly
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

function cleanText(text) {
  return decodeHtml(text)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function scrapeEnglishLaw(slug, conn) {
  const indexUrl = `https://www.gesetze-im-internet.de/${slug}/index.html`;
  const fullDocUrl = `https://www.gesetze-im-internet.de/${slug}/${slug}.html`;

  console.log(`[EN-SCRAPE] Fetching ${slug}...`);
  const [resIndex, resDoc] = await Promise.all([
    fetch(indexUrl),
    fetch(fullDocUrl)
  ]);

  if (!resIndex.ok || !resDoc.ok) {
    console.warn(`[EN-SCRAPE] Failed to fetch ${slug}: index=${resIndex.status}, doc=${resDoc.status}`);
    return 0;
  }

  const textIndex = await resIndex.text();
  const textDoc = await resDoc.text();

  // Extract law title and abbreviation from index or doc
  let title = '';
  let abbr = '';
  const titleMatch = textIndex.match(/<title>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    title = cleanText(titleMatch[1]);
    const abbrMatch = title.match(/\(([^)]+)\)$/);
    if (abbrMatch) {
      abbr = abbrMatch[1].replace(/^[^-]+-\s*/, '').trim();
    }
  }

  // Parse sections from index.html table
  // Pattern: <a href="englisch_xxx.html#p0018">Section 1<span class="paratitel">Objective, Scope of Application</span></a>
  const regex = /<a\s+[^>]*href=["'][^"']*#([a-zA-Z0-9_]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const sections = [];
  let m;

  while ((m = regex.exec(textIndex)) !== null) {
    const anchor = m[1];
    const innerHtml = m[2];
    
    // Check if it's a structural heading (strong with <br>) or a regular section
    const isStrong = /<strong[^>]*>([\s\S]*?)<\/strong>/i.test(innerHtml);
    const paratitelMatch = innerHtml.match(/<span\s+class=["']paratitel["']>([\s\S]*?)<\/span>/i);

    let identPart = '';
    let titlePart = '';

    if (isStrong) {
      const strongInner = innerHtml.match(/<strong[^>]*>([\s\S]*?)<\/strong>/i)[1];
      const parts = strongInner.split(/<br\s*\/?>/i);
      if (parts.length >= 2) {
        identPart = cleanText(parts[0]);
        titlePart = cleanText(parts.slice(1).join(' '));
      } else {
        identPart = cleanText(strongInner);
        titlePart = '';
      }
    } else if (paratitelMatch) {
      titlePart = cleanText(paratitelMatch[1]);
      identPart = cleanText(innerHtml.replace(/<span\s+class=["']paratitel["']>[\s\S]*?<\/span>/i, ''));
    } else {
      identPart = cleanText(innerHtml);
    }

    if (!identPart && !titlePart) continue;
    if (identPart.toLowerCase().includes('table of contents') || identPart.toLowerCase().includes('translations')) continue;

    // Norm slug generation: "Section 1" -> "section_1", "Annex" -> "annex", "Art. 1" -> "art_1"
    const normSlug = (identPart || titlePart)
      .toLowerCase()
      .replace(/§\s*/g, 'para_')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || `sec_${sections.length + 1}`;

    sections.push({
      anchor,
      identifier: identPart || `Section ${sections.length + 1}`,
      title: titlePart,
      normSlug,
    });
  }

  console.log(`[EN-SCRAPE] Found ${sections.length} sections in ${slug}`);

  // Now extract text for each section from fullDoc
  const normsToInsert = [];

  for (let i = 0; i < sections.length; i++) {
    const current = sections[i];
    const nextAnchor = i + 1 < sections.length ? sections[i + 1].anchor : null;

    const anchorPattern = new RegExp(`name=["']${current.anchor}["']`, 'i');
    const startMatch = textDoc.search(anchorPattern);
    if (startMatch === -1) continue;

    let endMatch = -1;
    if (nextAnchor) {
      const nextPattern = new RegExp(`name=["']${nextAnchor}["']`, 'i');
      endMatch = textDoc.search(nextPattern);
    }

    const sectionHtml = endMatch !== -1 ? textDoc.slice(startMatch, endMatch) : textDoc.slice(startMatch);

    // Extract paragraphs inside sectionHtml
    // Paragraphs are inside <p> tags
    const pMatches = [...sectionHtml.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)];
    const paragraphs = [];

    for (const pm of pMatches) {
      const pRaw = pm[1];
      // Skip navigation links like "table of contents" or anchor-only paras
      if (pRaw.includes('table of contents') || pRaw.includes('Seitenanfang')) continue;
      const pClean = cleanText(pRaw);
      // Skip the header paragraph if it just repeats Section X and Title
      if (pClean === current.identifier || pClean === current.title || pClean === `${current.identifier} ${current.title}`) {
        continue;
      }
      if (pClean.length > 0) {
        paragraphs.push({ text: pClean });
      }
    }

    const contentText = paragraphs.map(p => p.text).join('\n\n');
    const normId = `${slug}:${current.normSlug}`;

    normsToInsert.push({
      id: normId,
      law_slug: slug,
      norm_slug: current.normSlug,
      identifier: current.identifier,
      title: current.title,
      paragraphs: JSON.stringify(paragraphs),
      content_html: null,
      content_text: contentText,
      order_index: i,
      language: 'en',
    });
  }

  if (normsToInsert.length > 0) {
    // Upsert norms
    console.log(`[EN-SCRAPE] Inserting ${normsToInsert.length} norms for ${slug}...`);
    for (const norm of normsToInsert) {
      await conn.query(`
        INSERT INTO norms (id, law_slug, norm_slug, identifier, title, paragraphs, content_html, content_text, order_index, language, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE
          identifier = VALUES(identifier),
          title = VALUES(title),
          paragraphs = VALUES(paragraphs),
          content_text = VALUES(content_text),
          order_index = VALUES(order_index)
      `, [
        norm.id,
        norm.law_slug,
        norm.norm_slug,
        norm.identifier,
        norm.title,
        norm.paragraphs,
        norm.content_html,
        norm.content_text,
        norm.order_index,
        norm.language
      ]);
    }

    // Update laws table with norm_count and title
    await conn.query(`
      UPDATE laws
      SET norm_count = ?, title = IF(title LIKE '>%' OR title = '', ?, title)
      WHERE slug = ?
    `, [normsToInsert.length, title || slug, slug]);

    console.log(`[EN-SCRAPE] Done for ${slug}: ${normsToInsert.length} norms inserted!`);
  }

  return normsToInsert.length;
}

async function main() {
  const conn = await mysql.createConnection(process.env.DB_URL);
  await scrapeEnglishLaw('englisch_arbst_ttv', conn);
  await conn.end();
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { scrapeEnglishLaw };
