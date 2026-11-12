import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';
import type { AxeResults, Result } from 'axe-core';
import { keyboardViolations, staticViolations } from './fixtures/aaa';

/**
 * Accessibility conformance sweep for LawNetz.de
 *
 * Held to WCAG 2.2 Level AAA plus axe's best-practice ruleset. axe covers what
 * it has rules for (the enhanced 7:1 contrast among them); fixtures/aaa.ts
 * checks the AAA criteria axe cannot: target size, visual presentation,
 * location, keyboard reach and focus appearance (see the comment there).
 *
 * Every page is scanned in both themes, since light and dark are independent
 * sets of custom properties, and at 390px. Reduced motion is emulated so
 * overlays are at their final opacity by the time anything is sampled.
 *
 * The law and norm pages come from MySQL. CI loads tests/fixtures/laws.sql
 * into a service container and passes DB_URL; without DB_URL those tests are
 * skipped rather than run against whatever database the build has baked in.
 */
test.use({ contextOptions: { reducedMotion: 'reduce' } });

const A11Y_TAGS = [
	'wcag2a',
	'wcag2aa',
	'wcag2aaa',
	'wcag21a',
	'wcag21aa',
	'wcag22a',
	'wcag22aa',
	'best-practice',
];

type Route = { path: string; name: string };

const STATIC_ROUTES: Route[] = [
	{ path: '/', name: 'Startseite (DE)' },
	{ path: '/gesetze', name: 'Gesetze A-Z' },
	{ path: '/gesetze?buchstabe=A', name: 'Gesetze, Buchstabe A' },
	{ path: '/suche', name: 'Suche' },
	{ path: '/aktualitaeten', name: 'Aktualitäten' },
	{ path: '/hinweise', name: 'Hinweise' },
	{ path: '/glossar', name: 'Glossar' },
	{ path: '/barrierefreiheit', name: 'Barrierefreiheit' },
	{ path: '/datenschutz', name: 'Datenschutz' },
	{ path: '/impressum', name: 'Impressum' },
	{ path: '/tastenkombinationen', name: 'Tastenkombinationen' },
	{ path: '/kontakt', name: 'Kontakt (DE)' },
	{ path: '/en', name: 'Home (EN)' },
	{ path: '/en/laws', name: 'Laws A-Z' },
	{ path: '/en/search', name: 'Search' },
	{ path: '/en/updates', name: 'Recent Updates' },
	{ path: '/en/about', name: 'About & Source' },
	{ path: '/en/glossary', name: 'Glossary' },
	{ path: '/en/accessibility', name: 'Accessibility' },
	{ path: '/en/privacy', name: 'Privacy Policy' },
	{ path: '/en/legal-notice', name: 'Legal Notice' },
	{ path: '/en/keyboard-shortcuts', name: 'Keyboard Shortcuts' },
	{ path: '/en/contact', name: 'Contact (EN)' },
];

/** From tests/fixtures/laws.sql: a law with a definitions section, one with scattered ones, both languages. */
const LAW_ROUTES: Route[] = [
	{ path: '/gg', name: 'GG, Inhaltsverzeichnis' },
	{ path: '/gg/art_1', name: 'Art 1 GG' },
	{ path: '/arbzg', name: 'ArbZG, mit Begriffsbestimmungen' },
	{ path: '/arbzg/__2', name: '§ 2 ArbZG' },
	{ path: '/bgb', name: 'BGB, mit verstreuten Legaldefinitionen' },
	{ path: '/bgb/__13', name: '§ 13 BGB' },
	{ path: '/en/englisch_gg', name: 'Basic Law, contents' },
	{ path: '/en/englisch_gg/article_1', name: 'Article 1 Basic Law' },
	{ path: '/en/englisch_bgb', name: 'Civil Code, contents' },
	{ path: '/hgb', name: 'HGB, mit verschachtelter Gliederung' },
];

const HAS_DB = Boolean(process.env.DB_URL);
const NO_DB = 'law pages need DB_URL and tests/fixtures/laws.sql';

type Theme = 'light' | 'dark';

/**
 * Navigate to a page with the given theme pre-set via localStorage,
 * matching the app's no-FOUC inline script in BaseLayout.astro.
 */
async function gotoWithTheme(page: Page, path: string, theme: Theme): Promise<void> {
	await page.addInitScript((value) => {
		localStorage.setItem('lawnetz-theme', value);
	}, theme);
	const response = await page.goto(path);
	expect(response?.status(), `${path} should render`).toBe(200);
	await page.waitForLoadState('domcontentloaded');
	// Give the theme script time to apply
	await page.waitForTimeout(200);
}

function analyze(page: Page): AxeBuilder {
	return new AxeBuilder({ page }).withTags(A11Y_TAGS);
}

/**
 * Turns axe's nested result shape into something a failing assertion can
 * actually be read from in CI output.
 */
function formatViolations(results: AxeResults): string[] {
	return results.violations.map((violation: Result) => {
		const targets = violation.nodes
			.slice(0, 4)
			.map(
				(node) =>
					`      ${node.target.join(' ')}\n        ${node.failureSummary?.replace(/\n/g, '\n        ')}`,
			)
			.join('\n');
		const extra =
			violation.nodes.length > 4 ? `\n      ... ${violation.nodes.length - 4} more` : '';
		return `${violation.id} (${violation.impact}): ${violation.help}\n${targets}${extra}`;
	});
}

async function expectNoViolations(page: Page): Promise<void> {
	expect([
		...formatViolations(await analyze(page).analyze()),
		...(await staticViolations(page)),
		...(await keyboardViolations(page)),
	]).toEqual([]);
}

function sweep(routes: Route[], needsDb: boolean): void {
	for (const theme of ['light', 'dark'] as const) {
		test.describe(`WCAG 2.2 AAA + best practice — ${theme} theme`, () => {
			test.skip(needsDb && !HAS_DB, NO_DB);
			for (const route of routes) {
				test(`${route.name} (${route.path}) has no violations`, async ({ page }) => {
					await gotoWithTheme(page, route.path, theme);
					await expectNoViolations(page);
				});
			}
		});
	}

	test.describe('WCAG 2.2 AAA + best practice — mobile (390px)', () => {
		test.skip(needsDb && !HAS_DB, NO_DB);
		test.use({ viewport: { width: 390, height: 844 } });
		for (const route of routes) {
			test(`${route.name} (${route.path}) has no violations`, async ({ page }) => {
				await gotoWithTheme(page, route.path, 'light');
				await expectNoViolations(page);
			});
		}
	});

	// 1.4.10 Reflow: at 320 CSS px (1280px zoomed to 400 %) nothing sticks out
	// sideways. html and body clip overflow-x, which would hide the problem
	// from the eye, so this measures it.
	test.describe('1.4.10 Reflow at 320px', () => {
		test.skip(needsDb && !HAS_DB, NO_DB);
		test.use({ viewport: { width: 320, height: 800 } });
		for (const route of routes) {
			test(`${route.name} (${route.path}) fits without sideways scrolling`, async ({ page }) => {
				await gotoWithTheme(page, route.path, 'light');
				const overflow = await page.evaluate(() => document.body.scrollWidth - innerWidth);
				expect(overflow).toBeLessThanOrEqual(0);
			});
		}
	});
}

sweep(STATIC_ROUTES, false);
sweep(LAW_ROUTES, true);

test.describe('Mobile navigation', () => {
	test.use({ viewport: { width: 390, height: 844 } });

	test('the open navigation drawer has no violations', async ({ page }) => {
		await gotoWithTheme(page, '/', 'light');
		await page.locator('#mobile-menu-toggle').click();
		const drawer = page.locator('#mobile-nav-drawer');
		await expect(drawer).not.toHaveAttribute('hidden');
		await expect(drawer).toHaveClass(/is-open/);
		// The page behind is inert while the drawer is open, so the focus walk
		// covers the drawer alone.
		await expectNoViolations(page);
	});

	test('the drawer closes with Escape and gives focus back to its button', async ({ page }) => {
		await gotoWithTheme(page, '/', 'light');
		const toggle = page.locator('#mobile-menu-toggle');
		await toggle.click();
		await expect(page.locator('#mobile-nav-drawer')).toHaveClass(/is-open/);
		await page.keyboard.press('Escape');
		await expect(page.locator('#mobile-nav-drawer')).toBeHidden();
		await expect(toggle).toBeFocused();
		await expect(page.locator('#main-content')).not.toHaveAttribute('inert');
	});
});

// ─── 2.4.10 Section Headings ───────────────────────────────────────────────
test.describe('2.4.10 Section Headings', () => {
	test.skip(!HAS_DB, NO_DB);

	test('a law’s contents are divided by its own headings', async ({ page }) => {
		await page.goto('/gg');
		await expect(page.getByRole('heading', { level: 2, name: 'I. Die Grundrechte' })).toBeVisible();
		await expect(page.locator('.law-outline h2')).toHaveCount(14);
	});

	test('a deeper level of the outline is a deeper heading', async ({ page }) => {
		await page.goto('/hgb');
		const headings = page.locator('.law-outline :is(h2, h3, h4, h5, h6)');
		await expect(headings.nth(0)).toHaveText('Erstes Buch: Handelsstand');
		await expect(headings.nth(0)).toHaveJSProperty('tagName', 'H2');
		await expect(headings.nth(1)).toHaveText('Erster Abschnitt: Kaufleute');
		await expect(headings.nth(1)).toHaveJSProperty('tagName', 'H3');
	});
});

// ─── Prev / next norm ──────────────────────────────────────────────────────
test.describe('Norm pager', () => {
	test.skip(!HAS_DB, NO_DB);

	test('a long title is shortened at its end, never the norm number', async ({ page }) => {
		// In tests/fixtures/laws.sql the BGB norm after § 276 is § 312b.
		await page.goto('/bgb/__276');
		const next = page.locator('.pager-next');
		const label = await next.locator('.pager-label').boundingBox();
		const id = await next.locator('.pager-id').boundingBox();
		expect(id!.x).toBeGreaterThanOrEqual(label!.x);
		expect(id!.x + id!.width).toBeLessThanOrEqual(label!.x + label!.width + 0.5);
		// The title is what gives way, and the link's title attribute has it whole
		const name = next.locator('.pager-name');
		expect(await name.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
		await expect(next).toHaveAttribute(
			'title',
			'Nächste Norm: § 312b Außerhalb von Geschäftsräumen geschlossene Verträge',
		);
	});
});

// ─── 3.1.4 Abbreviations ───────────────────────────────────────────────────
test.describe('3.1.4 Abbreviations', () => {
	test('the glossary explains the abbreviations used in law texts', async ({ page }) => {
		await page.goto('/glossar');
		const terms = page.locator('section[aria-labelledby="abkuerzungen"] dt');
		await expect(terms.filter({ hasText: /^Abs\.$/ })).toHaveCount(1);
		await expect(terms.filter({ hasText: /^BGBl\.$/ })).toHaveCount(1);
		await expect(terms.filter({ hasText: /^Nr\.$/ })).toHaveCount(1);
	});

	test('a norm page gives its law abbreviation the full title', async ({ page }) => {
		test.skip(!HAS_DB, NO_DB);
		await page.goto('/gg/art_1');
		const title = 'Grundgesetz für die Bundesrepublik Deutschland';
		await expect(page.locator('.breadcrumbs abbr')).toHaveAttribute('title', title);
		await expect(page.locator('.norm-header abbr')).toHaveAttribute('title', title);
	});
});

// ─── 3.1.3 Unusual Words ───────────────────────────────────────────────────
test.describe('3.1.3 Unusual Words', () => {
	test.skip(!HAS_DB, NO_DB);

	test('a law with a definitions section links to it', async ({ page }) => {
		await page.goto('/arbzg');
		const terms = page.locator('#begriffe .definition-link');
		await expect(terms).toHaveCount(1);
		await expect(terms).toHaveAttribute('href', '/arbzg/__2');
	});

	test('a code with scattered definitions lists them from the glossary', async ({ page }) => {
		await page.goto('/bgb');
		await expect(page.locator('#begriffe a', { hasText: 'Verbraucher' })).toHaveAttribute(
			'href',
			'/bgb/__13',
		);
	});

	test('a long list starts folded and opens when a norm page links to it', async ({ page }) => {
		await page.goto('/bgb');
		await expect(page.locator('#begriffe')).not.toHaveAttribute('open');
		// A fresh load: from /bgb, only the fragment would change.
		await page.goto('about:blank');
		await page.goto('/bgb#begriffe');
		await expect(page.locator('#begriffe')).toHaveAttribute('open');
	});

	test('a norm page points to its law’s definitions and the glossary', async ({ page }) => {
		await page.goto('/arbzg/__3');
		const notice = page.locator('.norm-legal-notice');
		await expect(notice.locator('a[href="/arbzg#begriffe"]')).toHaveCount(1);
		await expect(notice.locator('a[href="/glossar"]')).toHaveCount(1);
	});
});

// ─── Contact form specific checks ──────────────────────────────────────────
test.describe('Contact form accessibility', () => {
	test('all form inputs have associated labels', async ({ page }) => {
		await page.goto('/kontakt');
		await page.waitForLoadState('domcontentloaded');

		// Verify label-input associations for visible fields
		for (const id of ['contact-name', 'contact-email', 'contact-message', 'contact-consent']) {
			const label = page.locator(`label[for="${id}"]`);
			await expect(label).toHaveCount(1);
			const input = page.locator(`#${id}`);
			await expect(input).toHaveCount(1);
		}
	});

	test('the status banner has aria-live="polite"', async ({ page }) => {
		await page.goto('/kontakt');
		await page.waitForLoadState('domcontentloaded');
		const banner = page.locator('#form-status-banner');
		await expect(banner).toHaveAttribute('aria-live', 'polite');
	});

	test('honeypot field is hidden from the accessibility tree', async ({ page }) => {
		await page.goto('/kontakt');
		await page.waitForLoadState('domcontentloaded');
		const honeypot = page.locator('.honeypot-field');
		await expect(honeypot).toHaveAttribute('aria-hidden', 'true');
	});
});
