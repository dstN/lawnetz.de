import { test, expect } from '@playwright/test';

/**
 * Law and norm pages answer If-Modified-Since with 304 when nothing changed
 * (src/http-cache.ts), so crawlers do not fetch ~150,000 unchanged pages.
 */
test.skip(!process.env.DB_URL, 'needs DB_URL and tests/fixtures/laws.sql');

for (const path of ['/gg', '/gg/art_1', '/en/englisch_gg/article_1']) {
	test(`${path} sends Last-Modified and answers a conditional GET with 304`, async ({ request }) => {
		const first = await request.get(path);
		expect(first.status()).toBe(200);
		const lastModified = first.headers()['last-modified'];
		expect(Date.parse(lastModified)).not.toBeNaN();
		expect(first.headers()['cache-control']).toContain('no-cache');

		const again = await request.get(path, { headers: { 'If-Modified-Since': lastModified } });
		expect(again.status()).toBe(304);
		expect(await again.text()).toBe('');

		// A copy from before the last change gets the page again
		const older = new Date(Date.parse(lastModified) - 1000).toUTCString();
		const stale = await request.get(path, { headers: { 'If-Modified-Since': older } });
		expect(stale.status()).toBe(200);
	});
}
