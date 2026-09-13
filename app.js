/**
 * LawNetz — Phusion Passenger Entry Point
 *
 * Hosting: Netcup Webhosting (EiWomiSau / Plesk) mit Phusion Passenger & Node.js 26
 * Domain: https://www.lawnetz.de
 *
 * Konfiguration im Netcup Webinterface (WCP/Plesk):
 * - Anwendungsstamm (Prodroot): /httpdocs (oder Projektverzeichnis)
 * - Dokument-Stamm (Docroot): /httpdocs/dist/client
 * - Anwendungsstartdatei (Entry-File): app.js
 */

// Port & Host fuer Phusion Passenger bereitstellen
process.env.HOST = process.env.HOST || '0.0.0.0';
process.env.PORT = process.env.PORT || '3000';

// Astro Node Standalone Server starten
import('./dist/server/entry.mjs').catch((err) => {
  console.error('[LawNetz] Kritischer Fehler beim Starten des Servers:', err);
  process.exit(1);
});
