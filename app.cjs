/**
 * LawNetz — Phusion Passenger Entry Point (CommonJS wrapper for ESM)
 *
 * Phusion Passenger loads the startup file via require() internally.
 * Because package.json sets "type": "module", the .cjs extension forces
 * CommonJS mode so require() succeeds, and dynamic import() loads the ESM Astro server.
 */

process.env.HOST = process.env.HOST || '0.0.0.0';
process.env.PORT = process.env.PORT || '3000';

import('./dist/server/entry.mjs').catch((err) => {
  console.error('[LawNetz] Kritischer Fehler beim Starten des Servers:', err);
  process.exit(1);
});
