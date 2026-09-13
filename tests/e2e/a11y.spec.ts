import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';
import type { AxeResults, Result } from 'axe-core';

/**
 * Accessibility conformance sweep for LawNetz.de
 *
 * Held to WCAG 2.2 Level AAA plus axe's best-practice ruleset.
 * The enhanced 7:1 contrast threshold (color-contrast-enhanced) catches
 * palette drift that the regex-based smoke tests in scripts/test-a11y-smoke.ts
 * structurally cannot detect (no CSSOM, no layout engine, no computed colours).
 *
 * Every scan runs in both themes: light and dark palettes are independent
 * sets of custom properties, so passing in one says nothing about the other.
 *
 * Scans also run with reduced motion emulated so overlays are at their final
 * opacity by the time axe samples them.
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

/** All prerendered static routes plus a representative dynamic law route. */
const ROUTES: Array<{ path: string; name: string }> = [
	{ path: '/', name: 'Startseite (DE)' },
	{ path: '/gesetze', name: 'Gesetze A-Z' },
	{ path: '/suche', name: 'Suche' },
	{ path: '/aktualitaeten', name: 'Aktualitäten' },
	{ path: '/hinweise', name: 'Hinweise' },
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
	{ path: '/en/accessibility', name: 'Accessibility' },
	{ path: '/en/privacy', name: 'Privacy Policy' },
	{ path: '/en/legal-notice', name: 'Legal Notice' },
	{ path: '/en/keyboard-shortcuts', name: 'Keyboard Shortcuts' },
	{ path: '/en/contact', name: 'Contact (EN)' },
];

type Theme = 'light' | 'dark';

/**
 * Navigate to a page with the given theme pre-set via localStorage,
 * matching the app's no-FOUC inline script in BaseLayout.astro.
 */
async function gotoWithTheme(page: Page, path: string, theme: Theme): Promise<void> {
	await page.addInitScript((value) => {
		localStorage.setItem('lawnetz-theme', value);
	}, theme);
	await page.goto(path);
	// Wait for the main content area to be visible
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

async function expectNoViolations(page: Page, builder = analyze(page)): Promise<void> {
	const results = await builder.analyze();
	expect(formatViolations(results)).toEqual([]);
}

// ─── Desktop: Light + Dark ──────────────────────────────────────────────────
for (const theme of ['light', 'dark'] as const) {
	test.describe(`WCAG 2.2 AAA + best practice — ${theme} theme`, () => {
		for (const route of ROUTES) {
			test(`${route.name} (${route.path}) has no violations`, async ({ page }) => {
				await gotoWithTheme(page, route.path, theme);
				await expectNoViolations(page);
			});
		}
	});
}

// ─── Mobile (390 × 844) ────────────────────────────────────────────────────
test.describe('WCAG 2.2 AAA + best practice — mobile (390px)', () => {
	test.use({ viewport: { width: 390, height: 844 } });

	for (const route of ROUTES) {
		test(`${route.name} (${route.path}) has no violations`, async ({ page }) => {
			await gotoWithTheme(page, route.path, 'light');
			await expectNoViolations(page);
		});
	}

	test('the open navigation drawer has no violations', async ({ page }) => {
		await gotoWithTheme(page, '/', 'light');
		const menuBtn = page.locator('#mobile-menu-toggle');
		await menuBtn.click();
		const drawer = page.locator('#mobile-nav-drawer');
		await expect(drawer).not.toHaveAttribute('hidden');
		await expectNoViolations(page);
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
