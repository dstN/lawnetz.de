import fs from 'node:fs';
import path from 'node:path';

/**
 * Automated A11y, Security & Smoke Test Suite for LawNetz
 *
 * Checks:
 * 1. Data Integrity: toc.json and translations.json
 * 2. Prerendered HTML: WCAG 2.2 AAA checks (title, h1 hierarchy, skip-links, ARIA landmarks, lang attribute)
 * 3. Security: Zero external third-party CDNs, fonts or tracking scripts
 * 4. Self-hosted font availability
 */

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
	totalTests++;
	if (condition) {
		passedTests++;
		console.log(`  ✓ PASS: ${testName}`);
	} else {
		failedTests++;
		console.error(`  ✗ FAIL: ${testName}`);
		if (detail) console.error(`    ↳ ${detail}`);
	}
}

console.log('\n=== LawNetz Automated A11y & Smoke Test Suite ===\n');

// ── 1. Data Integrity ──────────────────────────────────────────
console.log('--- 1. Data Catalog Integrity ---');
const tocPath = path.resolve('src/data/toc.json');
const translationsPath = path.resolve('src/data/translations.json');

assert(fs.existsSync(tocPath), 'toc.json exists');
const toc = JSON.parse(fs.readFileSync(tocPath, 'utf-8'));
assert(Array.isArray(toc.laws) && toc.laws.length >= 6000, `toc.json contains ${toc.laws?.length} laws (expected >= 6000)`);

assert(fs.existsSync(translationsPath), 'translations.json exists');
const translations = JSON.parse(fs.readFileSync(translationsPath, 'utf-8'));
assert(Array.isArray(translations) && translations.length >= 130, `translations.json contains ${translations.length} laws (expected >= 130)`);

// Check sample priority laws exist
const samplePriority = ['bgb', 'gg', 'stgb', 'zpo', 'hgb'];
for (const slug of samplePriority) {
	const found = toc.laws.some((l: any) => l.slug === slug);
	assert(found, `Priority law exists in toc: ${slug.toUpperCase()}`);
}

// ── 2. Security & Zero External Dependencies ───────────────────
console.log('\n--- 2. Security & Zero-Third-Party Leaks ---');
const clientDist = path.resolve('dist/client');

if (fs.existsSync(clientDist)) {
	const htmlFiles: string[] = [];

	function collectHtml(dir: string) {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				collectHtml(full);
			} else if (entry.isFile() && entry.name.endsWith('.html')) {
				htmlFiles.push(full);
			}
		}
	}

	collectHtml(clientDist);
	assert(htmlFiles.length > 0, `Prerendered HTML files found (${htmlFiles.length} files)`);

	// Banned external third-party hosts
	const bannedHosts = [
		'fonts.googleapis.com',
		'fonts.gstatic.com',
		'cdn.jsdelivr.net',
		'unpkg.com',
		'cdnjs.cloudflare.com',
		'google-analytics.com',
		'googletagmanager.com',
		'connect.facebook.net',
		'clarity.ms',
	];

	for (const file of htmlFiles) {
		const rel = path.relative(clientDist, file);
		const html = fs.readFileSync(file, 'utf-8');

		for (const host of bannedHosts) {
			const hasLeak = html.includes(host);
			assert(!hasLeak, `Zero external leak to ${host} in ${rel}`);
		}
	}

	// ── 3. WCAG 2.2 AAA & Accessibility Hierarchy ──────────────────
	console.log('\n--- 3. WCAG 2.2 AAA & Accessibility Checks ---');

	for (const file of htmlFiles) {
		const rel = path.relative(clientDist, file);
		const html = fs.readFileSync(file, 'utf-8');

		// Check <html lang="...">
		const hasLang = /<html[^>]+lang=["'][a-z]{2}(-[A-Z]{2})?["']/i.test(html);
		assert(hasLang, `Valid html lang attribute in ${rel}`);

		// Check <title>
		const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
		assert(Boolean(titleMatch && titleMatch[1].trim().length > 0), `Non-empty title tag in ${rel}`);

		// Check meta description
		const hasMetaDesc = /<meta[^>]+name=["']description["'][^>]+content=["'][^"']+["']/i.test(html);
		assert(hasMetaDesc, `Valid meta description in ${rel}`);

		// Check single <h1> per page
		const h1Count = (html.match(/<h1[\s>]/gi) || []).length;
		assert(h1Count === 1, `Exactly one <h1> per page in ${rel} (found ${h1Count})`);

		// Check skip-links
		const hasSkipLink = html.includes('href="#main-content"');
		assert(hasSkipLink, `Skip link to #main-content in ${rel}`);

		// Check main landmark
		const hasMainLandmark = /<main[^>]+id=["']main-content["']/i.test(html);
		assert(hasMainLandmark, `Accessible main landmark in ${rel}`);

		// Check no broken template strings
		const hasNaN = html.includes('NaN');
		const hasUndefined = html.includes('undefined');
		const hasObjObj = html.includes('[object Object]');
		assert(!hasNaN && !hasUndefined && !hasObjObj, `No broken template variables in ${rel}`);

		// Check W3C ARIA allowed roles (e.g. aside must not have role="dialog")
		const hasIllegalAsideRole = /<aside[^>]+role=["']dialog["']/i.test(html);
		assert(!hasIllegalAsideRole, `No illegal role="dialog" on <aside> in ${rel}`);

		// Check all buttons have accessible names (aria-label or inner text)
		const buttonMatches = html.match(/<button[\s\S]*?<\/button>/gi) || [];
		let allButtonsAccessible = true;
		for (const btn of buttonMatches) {
			const hasAriaLabel = /aria-label=["'][^"']+["']/i.test(btn);
			const hasText = />[\s]*[a-zA-Z0-9§]/.test(btn);
			if (!hasAriaLabel && !hasText) {
				allButtonsAccessible = false;
				break;
			}
		}
		assert(allButtonsAccessible, `All <button> elements have accessible names in ${rel}`);
	}
} else {
	console.log('  [Notice] dist/client not found. Run `npm run build` before executing HTML checks.');
}

// ── 4. Self-Hosted Fonts ───────────────────────────────────────
console.log('\n--- 4. Self-Hosted Fonts Availability ---');
const fontsDir = path.resolve('public/fonts');
assert(fs.existsSync(fontsDir), 'public/fonts directory exists');

const requiredFonts = [
	'atkinson-hyperlegible-regular.woff2',
	'atkinson-hyperlegible-700.woff2',
	'lexend-regular.woff2',
	'lexend-700.woff2',
];

for (const font of requiredFonts) {
	const fontPath = path.join(fontsDir, font);
	assert(fs.existsSync(fontPath), `Required font exists: ${font}`);
}

// ── Summary ────────────────────────────────────────────────────
console.log('\n=================================================');
console.log(`Results: ${passedTests} passed, ${failedTests} failed, ${totalTests} total.`);
console.log('=================================================\n');

if (failedTests > 0) {
	process.exit(1);
} else {
	process.exit(0);
}
