import type { APIRoute } from 'astro';
import { syncDueLaws } from '../../../../scripts/sync-core';

export const prerender = false;

/**
 * Nightly sync of all German federal laws (Plesk "URL abrufen" cron job).
 *
 * Each call checks due laws for up to 45 seconds, so the request ends before
 * a proxy times out; the cron runs every few minutes for a while each night
 * until every law has been checked (see NETCUP_DEPLOYMENT.md). The work itself
 * is scripts/sync-core.ts, the same code `npm run sync:daily` runs.
 */
const BUDGET_MS = 45_000;

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

	try {
		const result = await syncDueLaws({ budgetMs: BUDGET_MS });
		return new Response(JSON.stringify({ success: true, timestamp: new Date().toISOString(), ...result }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (err) {
		console.error('[cron/sync]', err);
		return new Response(
			JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) }),
			{ status: 500, headers: { 'Content-Type': 'application/json' } }
		);
	}
};
