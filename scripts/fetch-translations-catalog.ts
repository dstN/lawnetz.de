import fs from 'fs';
import path from 'path';

async function fetchEnglishTranslations() {
  console.log('Fetching English translations directory from gesetze-im-internet.de...');
  const res = await fetch('https://www.gesetze-im-internet.de/Teilliste_translations.html');
  const text = await res.text();

  // Pattern: <p><a href="englisch_xxx/index.html"><abbr title="...">ABBR</abbr></a><br />FULL TITLE<br />...
  const paragraphs = text.split(/<p>\s*<a href=["'](englisch_[^"']+\/index\.html)["']/);
  
  const translations = [];

  for (let i = 1; i < paragraphs.length; i += 2) {
    const href = paragraphs[i];
    const chunk = paragraphs[i + 1] || '';
    const slug = href.replace('/index.html', '');
    const germanSlug = slug.replace('englisch_', '');

    // Extract abbreviation and title
    const abbrMatch = chunk.match(/<abbr[^>]*>([^<]+)<\/abbr>/i) || chunk.match(/^[^<]+/);
    const abbr = abbrMatch ? abbrMatch[1].trim() : germanSlug.toUpperCase();

    // Title is after </a><br /> up to the next <br /> or translation note
    const afterA = chunk.replace(/^[^>]*<\/a>\s*<br\s*\/?>/i, '');
    const titleMatch = afterA.split(/<br\s*\/?>/i)[0] || '';
    const title = titleMatch.replace(/<[^>]+>/g, '').replace(/&#220;/g, 'Ü').replace(/&#228;/g, 'ä').replace(/&#8217;/g, "'").trim();

    translations.push({
      slug,
      germanSlug,
      abbreviation: abbr,
      title: title || abbr,
      sourceUrl: `https://www.gesetze-im-internet.de/${slug}/index.html`,
    });
  }

  console.log(`Parsed ${translations.length} English translated laws.`);
  const outPath = path.resolve('src/data/translations.json');
  fs.writeFileSync(outPath, JSON.stringify(translations, null, 2), 'utf-8');
  console.log(`Saved to ${outPath}`);
}

fetchEnglishTranslations().catch(console.error);
