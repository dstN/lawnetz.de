/**
 * Conditional GET for pages built from one law (the law's contents and its norms).
 *
 * Last-Modified is the later of the law's last download (laws.last_synced_at,
 * which the sync only moves when the file at gesetze-im-internet.de changed)
 * and this build: a deploy changes every page's markup and asset names, so a
 * browser must not keep a copy from before it. A crawler asking with
 * If-Modified-Since gets an empty 304 for the ~150,000 pages that did not
 * change, which saves crawl budget and server time.
 *
 * Cache-Control: no-cache has browsers keep the page but ask every time; with
 * Last-Modified alone they would guess a freshness lifetime from its age and
 * show an old law for days.
 */
const BUILT_AT = Date.parse(__BUILT_AT__);

export function notModified(
	request: Request,
	headers: Headers,
	lastSyncedAt: Date | string | null | undefined,
): Response | null {
	const synced = lastSyncedAt ? new Date(lastSyncedAt).getTime() : 0;
	// HTTP dates have whole seconds
	const modified = Math.floor(Math.max(BUILT_AT, Number.isNaN(synced) ? 0 : synced) / 1000) * 1000;
	const lastModified = new Date(modified).toUTCString();
	headers.set('Last-Modified', lastModified);
	headers.set('Cache-Control', 'no-cache');

	const since = Date.parse(request.headers.get('if-modified-since') ?? '');
	if (Number.isNaN(since) || modified > since) return null;
	return new Response(null, {
		status: 304,
		headers: { 'Last-Modified': lastModified, 'Cache-Control': 'no-cache' },
	});
}
