const mysql = require('mysql2/promise');
const fs = require('fs');
require('dotenv').config();
const { scrapeEnglishLaw } = require('./scrape-en-law.cjs');

async function main() {
  const translations = JSON.parse(fs.readFileSync('src/data/translations.json', 'utf8'));
  const conn = await mysql.createConnection(process.env.DB_URL);

  console.log(`Starting scrape for ${translations.length} English laws...`);
  let successCount = 0;
  let totalNorms = 0;

  for (let i = 0; i < translations.length; i++) {
    const t = translations[i];
    try {
      console.log(`[${i + 1}/${translations.length}] Scraping ${t.slug}...`);
      const count = await scrapeEnglishLaw(t.slug, conn);
      if (count > 0) {
        successCount++;
        totalNorms += count;
      }
    } catch (err) {
      console.error(`Error scraping ${t.slug}:`, err.message);
    }
  }

  console.log(`Finished! Successfully scraped ${successCount}/${translations.length} English laws (${totalNorms} total norms).`);
  await conn.end();
}

main().catch(console.error);
