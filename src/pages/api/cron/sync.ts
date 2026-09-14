import type { APIRoute } from 'astro';
import { db } from '../../../db/index';
import * as schema from '../../../db/schema';
import { fetchAndParseLaw } from '../../../../scripts/fetch-law';
import { sql } from 'drizzle-orm';

export const prerender = false;

// Priority laws to update on cron trigger
const PRIORITY_LAWS = [
	'bgb',
	'gg',
	'stgb',
	'hgb',
	'zpo',
	'stpo',
	'vwgo',
	'bdsg_2018',
	'urhg',
	'ddg',
	'arbzg',
	'kschg',
	'betrvg',
];

export const ALL: APIRoute = async ({ request, url }) => {
	const secret = process.env.CRON_SECRET;
	const token = url.searchParams.get('token') || request.headers.get('x-cron-token');

	// Require CRON_SECRET to be configured and matched
	if (!secret || token !== secret) {
		return new Response(
			JSON.stringify({
				error: 'Unauthorized: Invalid or missing cron secret token',
				hint: 'Set CRON_SECRET in your .env and pass ?token=YOUR_SECRET or header x-cron-token',
			}),
			{
				status: 401,
				headers: { 'Content-Type': 'application/json' },
			}
		);
	}

	const startTime = Date.now();
	let updatedCount = 0;
	const updatedLaws: string[] = [];
	const errors: Record<string, string> = {};

	for (const slug of PRIORITY_LAWS) {
		try {
			const law = await fetchAndParseLaw(slug);
			if (!law) continue;

			updatedCount++;
			updatedLaws.push(slug);

			if (db) {
				// Upsert law
				await db
					.insert(schema.laws)
					.values({
						slug: law.slug,
						abbreviation: law.abbreviation,
						title: law.title,
						language: 'de',
						normCount: law.norms.length,
						sourceUrl: law.sourceUrl,
						lastSyncedAt: new Date(),
						createdAt: new Date(),
					})
					.onDuplicateKeyUpdate({
						set: {
							abbreviation: law.abbreviation,
							title: law.title,
							normCount: law.norms.length,
							lastSyncedAt: new Date(),
						},
					});

				// Upsert norms
				for (const norm of law.norms) {
					const normId = `${law.slug}:${norm.slug}`;
					const paragraphsJson = norm.paragraphs.map((p: any) => {
						if (typeof p === 'string') {
							const m = p.match(/^\s*\((\d+[a-z]?)\)/);
							return { number: m ? m[1] : null, text: p, html: p };
						}
						return {
							number: p.number ?? null,
							text: p.text || '',
							html: p.html || p.text || '',
						};
					});
					const contentText = norm.paragraphs
						.map((p: any) => (typeof p === 'string' ? p : p.text || ''))
						.join('\n');

					await db
						.insert(schema.norms)
						.values({
							id: normId,
							lawSlug: law.slug,
							normSlug: norm.slug,
							identifier: norm.identifier,
							title: norm.title,
							paragraphs: paragraphsJson,
							contentText,
							orderIndex: norm.orderIndex,
							language: 'de',
							createdAt: new Date(),
						})
						.onDuplicateKeyUpdate({
							set: {
								identifier: norm.identifier,
								title: norm.title,
								paragraphs: paragraphsJson,
								contentText,
								orderIndex: norm.orderIndex,
							},
						});
				}
			}
		} catch (err: any) {
			errors[slug] = err.message;
		}
	}

	const durationMs = Date.now() - startTime;

	if (db) {
		try {
			await db.insert(schema.syncLogs).values({
				lawsChecked: PRIORITY_LAWS.length,
				lawsUpdated: updatedCount,
				status: Object.keys(errors).length > 0 ? 'partial' : 'success',
				durationMs,
				details: { updatedLaws, errors },
			});
		} catch {}
	}

	return new Response(
		JSON.stringify({
			success: true,
			timestamp: new Date().toISOString(),
			durationSeconds: (durationMs / 1000).toFixed(2),
			lawsChecked: PRIORITY_LAWS.length,
			lawsUpdated: updatedCount,
			updatedLaws,
			errors: Object.keys(errors).length > 0 ? errors : undefined,
		}),
		{
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		}
	);
};
