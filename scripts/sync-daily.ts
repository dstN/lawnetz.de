/**
 * scripts/sync-daily.ts — sync all due German laws from the command line
 *
 *   npm run sync:daily                    all laws not checked for 20 hours
 *   npm run sync:daily -- --force         download every law, changed or not
 *   npm run sync:daily -- --slug bgb      just this one (add --force to download it)
 *
 * The same code as the nightly cron endpoint (scripts/sync-core.ts), without
 * its 45-second budget. Needs DB_URL (production's .env, or a test database).
 */
import 'dotenv/config';
import { syncDueLaws } from './sync-core';

const args = process.argv.slice(2);
const slug = args.find((_, i) => args[i - 1] === '--slug');

console.log(`[${new Date().toISOString()}] Sync of due German laws${args.includes('--force') ? ' (forced)' : ''}…`);

// Exit explicitly: the MySQL pool would keep the process alive.
syncDueLaws({ force: args.includes('--force'), slug })
	.then((r) => {
		console.log(
			`[${new Date().toISOString()}] Done in ${(r.durationMs / 1000).toFixed(1)} s. ` +
				`Checked ${r.checked}, unchanged ${r.unchanged}, updated ${r.updated}, ` +
				`not found ${r.notFound}, failed ${r.failed}.`,
		);
		process.exit(r.failed > 0 && r.updated + r.unchanged === 0 ? 1 : 0);
	})
	.catch((err) => {
		console.error('[sync-daily] Fatal error:', err);
		process.exit(1);
	});
