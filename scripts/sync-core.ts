/**
 * scripts/sync-core.ts — the one sync of German federal law
 *
 * Used by the nightly cron endpoint (src/pages/api/cron/sync.ts) and by the
 * command line (scripts/sync-daily.ts). Until 2026-11 each had its own copy:
 * the script checked all laws, the endpoint, which is what production runs,
 * only 13. One implementation, so that cannot happen again.
 *
 * How a run goes:
 * 1. A law is due when it has not been checked for 20 hours. The run takes the
 *    due laws, longest unchecked first, one after another: gesetze-im-internet.de
 *    resets most connections when asked in parallel (measured 2026-11-12: 86 %
 *    at 15 at a time, 18 % at 2, none one by one at ~0.1 s a law).
 * 2. A HEAD request tells whether the law's xml.zip changed: a new ETag, or,
 *    with no ETag stored yet, a Last-Modified after our last download.
 * 3. Only changed laws are downloaded and saved.
 * 4. A time budget ends the run; the next one carries on where it stopped. The
 *    endpoint gets 45 s a call (proxy timeouts), so a full pass over ~6,130
 *    laws (~10 minutes of HEAD requests) needs a cron call every few minutes
 *    for a while each night; see NETCUP_DEPLOYMENT.md.
 */
import { eq } from 'drizzle-orm';
import toc from '../src/data/toc.json' with { type: 'json' };
import { db, saveLawOutline } from '../src/db/index';
import * as schema from '../src/db/schema';
import { fetchAndParseLaw, type LawData } from './fetch-law';

const DUE_AFTER_MS = 20 * 60 * 60 * 1000;
const USER_AGENT = 'LawNetz.de Sync Pipeline (barrierefrei & open-source)';

/** Writes a law, its outline and its norms. Every sync path saves through here. */
export async function saveLaw(law: LawData): Promise<void> {
	if (!db) throw new Error('[sync] Database is not configured');
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

	await saveLawOutline(law.slug, law.items);

	// 50 at a time over the pool: one by one, the BGB's 2,551 norms take long
	// enough to push a cron call past its budget.
	const rows = law.norms.map((norm) => {
		const paragraphs = norm.paragraphs.map((p) => {
			if (typeof p === 'string') {
				const m = p.match(/^\s*\((\d+[a-z]?)\)/);
				return { number: m ? m[1] : null, text: p, html: p };
			}
			return { number: p.number ?? null, text: p.text || '', html: p.html || p.text || '' };
		});
		const contentText = norm.paragraphs.map((p) => (typeof p === 'string' ? p : p.text || '')).join('\n');
		return { norm, paragraphs, contentText };
	});
	for (let i = 0; i < rows.length; i += 50) {
		await Promise.all(
			rows.slice(i, i + 50).map(({ norm, paragraphs, contentText }) =>
				db
					.insert(schema.norms)
					.values({
						id: `${law.slug}:${norm.slug}`,
						lawSlug: law.slug,
						normSlug: norm.slug,
						identifier: norm.identifier,
						title: norm.title,
						paragraphs,
						contentText,
						orderIndex: norm.orderIndex,
						language: 'de',
						createdAt: new Date(),
					})
					.onDuplicateKeyUpdate({
						set: { identifier: norm.identifier, title: norm.title, paragraphs, contentText, orderIndex: norm.orderIndex },
					}),
			),
		);
	}
}

export interface SyncOptions {
	/** Stop starting new laws after this many ms (the endpoint: 45 s). */
	budgetMs?: number;
	/** Download every law (or `slug`) whether it changed or not. */
	force?: boolean;
	/** Check only this law, due or not. */
	slug?: string;
	log?: (message: string) => void;
}

export interface SyncResult {
	checked: number;
	unchanged: number;
	updated: number;
	notFound: number;
	failed: number;
	/** Due laws this run did not get to */
	remaining: number;
	durationMs: number;
}

/**
 * Whether a law's file at GII differs from our copy. With an ETag from the
 * last check, a different ETag says so; without one (first run, or after an
 * error) the file's Last-Modified is compared with our last download, so a
 * fresh database is not downloaded all over again.
 */
export function needsDownload(file: {
	force?: boolean;
	storedEtag?: string | null;
	etag: string | null;
	lastModified: string | null;
	downloadedAt?: Date;
}): boolean {
	if (file.force) return true;
	if (file.storedEtag) return file.etag !== file.storedEtag;
	const fileDate = file.lastModified ? Date.parse(file.lastModified) : NaN;
	if (!file.downloadedAt || Number.isNaN(fileDate)) return true;
	return fileDate > file.downloadedAt.getTime();
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** HEAD of a law's xml.zip; a reset connection gets two more tries. */
async function head(slug: string): Promise<Response> {
	for (let attempt = 1; ; attempt++) {
		try {
			return await fetch(`https://www.gesetze-im-internet.de/${slug}/xml.zip`, {
				method: 'HEAD',
				headers: { 'User-Agent': USER_AGENT },
			});
		} catch (err) {
			if (attempt === 3) throw err;
			await sleep(1000 * attempt);
		}
	}
}

export async function syncDueLaws(options: SyncOptions = {}): Promise<SyncResult> {
	const { budgetMs = Infinity, force = false, slug, log = console.log } = options;
	if (!db) throw new Error('[sync] Database is not configured');
	const startedAt = Date.now();

	// db is untyped (src/db/index.ts), so the maps say what they hold
	const states = new Map<string, schema.LawSyncState>(
		(await db.select().from(schema.lawSyncState)).map((s: schema.LawSyncState) => [s.slug, s]),
	);
	const downloadedAt = new Map<string, Date>(
		(
			await db
				.select({ slug: schema.laws.slug, lastSyncedAt: schema.laws.lastSyncedAt })
				.from(schema.laws)
				.where(eq(schema.laws.language, 'de'))
		).map((l: { slug: string; lastSyncedAt: Date }) => [l.slug, l.lastSyncedAt]),
	);

	const lastChecked = (s: string) => states.get(s)?.checkedAt?.getTime() ?? 0;
	const due = (slug ? [slug] : toc.laws.map((l) => l.slug))
		.filter((s) => force || slug || startedAt - lastChecked(s) > DUE_AFTER_MS)
		.sort((a, b) => lastChecked(a) - lastChecked(b));

	const result: SyncResult = { checked: 0, unchanged: 0, updated: 0, notFound: 0, failed: 0, remaining: 0, durationMs: 0 };
	const remember = (s: string, values: Partial<typeof schema.lawSyncState.$inferInsert>) =>
		db
			.insert(schema.lawSyncState)
			.values({ slug: s, checkedAt: new Date(), ...values })
			.onDuplicateKeyUpdate({ set: { checkedAt: new Date(), ...values } });

	for (const s of due) {
		if (Date.now() - startedAt > budgetMs) break;
		result.checked++;
		const stored = states.get(s);
		try {
			const res = await head(s);
			if (res.status === 404) {
				result.notFound++;
				await remember(s, { status: 'not_found' });
				continue;
			}
			if (!res.ok) throw new Error(`HEAD ${res.status}`);
			const etag = res.headers.get('etag');
			const lastModified = res.headers.get('last-modified');
			if (needsDownload({ force, storedEtag: stored?.etag, etag, lastModified, downloadedAt: downloadedAt.get(s) })) {
				await saveLaw(await fetchAndParseLaw(s));
				result.updated++;
			} else {
				result.unchanged++;
			}
			await remember(s, { etag, lastModified, status: 'ok' });
		} catch (err) {
			// Checked, so the next run moves on; due again in 20 hours.
			result.failed++;
			log(`[sync] ${s}: ${err instanceof Error ? err.message : String(err)}`);
			await remember(s, { status: 'error' }).catch(() => {});
		}
		if (result.checked % 250 === 0) log(`[sync] ${result.checked}/${due.length} checked, ${result.updated} updated`);
	}

	result.remaining = due.length - result.checked;
	result.durationMs = Date.now() - startedAt;

	// A call with nothing due leaves no row, or 24 calls a night would bury the log.
	if (result.checked > 0) {
		await db
			.insert(schema.syncLogs)
			.values({
				lawsChecked: result.checked,
				lawsUpdated: result.updated,
				status: result.failed === 0 ? 'success' : result.updated + result.unchanged > 0 ? 'partial' : 'failed',
				durationMs: result.durationMs,
				details: { unchanged: result.unchanged, notFound: result.notFound, failed: result.failed, remaining: result.remaining },
			})
			.catch(() => {});
	}
	return result;
}
