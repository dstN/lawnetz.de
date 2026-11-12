import { test, expect } from '@playwright/test';
import glossary from '../../src/data/glossary.json' with { type: 'json' };

/**
 * Every glossary entry must still be what its norm says. Laws change; when a
 * definition moves or is reworded, this fails instead of the glossary quietly
 * pointing at the wrong norm. Runs against tests/fixtures/laws.sql, which
 * holds every norm the glossary names.
 */
test.skip(!process.env.DB_URL, 'needs DB_URL and tests/fixtures/laws.sql');

for (const [language, entries] of [
	['de', glossary.de],
	['en', glossary.en],
] as const) {
	for (const entry of entries) {
		test(`${entry.term}: ${entry.law}/${entry.norm} defines it`, async ({ request }) => {
			const path = `${language === 'en' ? '/en' : ''}/${entry.law}/${entry.norm}`;
			const response = await request.get(path);
			expect(response.status(), path).toBe(200);
			// The page text, with markup and whitespace runs flattened
			const text = (await response.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
			expect(text).toContain(entry.match.replace(/\s+/g, ' '));
		});
	}
}
