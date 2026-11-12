// npx tsx --test scripts/sync-core.test.ts (part of `npm test`)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { needsDownload } from './sync-core';

const may = 'Wed, 06 May 2026 16:00:10 GMT';

test('a changed ETag means a new file', () => {
	assert.equal(needsDownload({ storedEtag: '"a"', etag: '"b"', lastModified: may }), true);
	assert.equal(needsDownload({ storedEtag: '"a"', etag: '"a"', lastModified: may }), false);
});

test('without a stored ETag, Last-Modified is compared with our download', () => {
	const before = new Date('2026-05-01T00:00:00Z');
	const after = new Date('2026-11-12T03:00:00Z');
	assert.equal(needsDownload({ etag: '"a"', lastModified: may, downloadedAt: before }), true);
	assert.equal(needsDownload({ etag: '"a"', lastModified: may, downloadedAt: after }), false);
});

test('a law we never downloaded, or a file without a date, is downloaded', () => {
	assert.equal(needsDownload({ etag: '"a"', lastModified: may }), true);
	assert.equal(needsDownload({ etag: '"a"', lastModified: null, downloadedAt: new Date() }), true);
});

test('force downloads even an unchanged file', () => {
	assert.equal(needsDownload({ force: true, storedEtag: '"a"', etag: '"a"', lastModified: may }), true);
});
