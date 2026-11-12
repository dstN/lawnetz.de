# Changelog

Alle nennenswerten Änderungen an LawNetz. Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/), Versionen nach [Semantic Versioning](https://semver.org/lang/de/): **Major** für Änderungen, die Daten oder Betrieb umstellen und einen Handgriff auf dem Server brauchen, **Minor** für neue Funktionen, **Patch** für Korrekturen.

Wie eine Version entsteht, steht im README unter „Versionierung und Releases“.

## [Unreleased]

## [1.0.0] – 2026-11-12

Erste versionierte Fassung. Was davor geschah, steht in der Git-Historie.

### Betrieb (vor dem Deploy)

- `npm run db:push`: legt die Tabellen `law_outline` und `law_sync_state` an.
- Plesk-Cronjob von „täglich 03:00“ auf `*/5 1-2 * * *` umstellen (siehe `NETCUP_DEPLOYMENT.md`).

### Hinzugefügt

- Gliederung der Gesetze (Buch, Abschnitt, Titel …) als Überschriften im Inhaltsverzeichnis (WCAG 2.4.10). Der Abgleich speichert sie in `law_outline`.
- Glossar (`/glossar`, `/en/glossary`) mit den Legaldefinitionen von BGB, StGB, HGB, GG und BUrlG und den Abkürzungen aus Gesetzestexten (WCAG 3.1.3, 3.1.4).
- „Begriffe, die dieses Gesetz bestimmt“ auf jeder Gesetzesseite: Vorschriften namens „Begriffsbestimmungen“ werden erkannt, dazu die Einträge aus dem Glossar.
- Barrierefreiheitstests für WCAG 2.2 AAA: axe-core plus eigene Prüfungen für Zielgröße, Textdarstellung, Ort, Tastatur und Fokus, Umbruch bei 320 px. Die CI prüft auch die Gesetzes- und Normseiten gegen eine Testdatenbank (`tests/fixtures/laws.sql`).
- Test, der jeden Glossar-Eintrag gegen den Gesetzestext prüft.

### Geändert

- Der nächtliche Abgleich prüft alle rund 6.130 Gesetze statt 13. Endpunkt und `npm run sync:daily` nutzen denselben Code (`scripts/sync-core.ts`); der Stand pro Gesetz liegt in `law_sync_state` statt in `src/data/sync-manifest.json`.
- Alle Bedienelemente haben mindestens 44 × 44 px Klickfläche bei unverändertem Aussehen (WCAG 2.5.5). Die Buchstabenleiste im Verzeichnis bricht dafür in mehrere Zeilen um.
- Footer: Links in drei Gruppen (Rechtliches, Hilfe, Projekt).
- Zeilen höchstens 80 Zeichen, Absatzabstände nach WCAG 1.4.8.
- Erklärung zur Barrierefreiheit nennt die nicht erfüllten Kriterien (3.1.5, teilweise 3.1.3).
- Abhängigkeiten aktualisiert, darunter Astro 7.4, Playwright 1.65, axe-core 4.14, dotenv 18.

### Behoben

- Navigation „Vorherige / Nächste Norm“ schnitt den Anfang langer Titel samt Paragrafennummer ab.
- Zugängliche Namen enthielten den sichtbaren Text nicht (Logo, Sprachumschalter, Kopierknöpfe, Buchstabenkacheln; WCAG 2.5.3).
- Englische Seiten hatten deutsche Skip-Links, Theme- und Sprachbeschriftungen (WCAG 3.1.2).
- Geöffnetes Handy-Menü ließ Tab auf die verdeckte Seite dahinter springen.
- Buchstabenleiste am Handy: zu kleine Knöpfe (WCAG 2.5.8) und ab „Q“ abgeschnitten.
- „✕“ in Suchfeldern auch bei leerem Feld sichtbar.
- Abgleich: Abbrüche durch zu viele parallele Anfragen an gesetze-im-internet.de; das Skript beendete sich nach dem Lauf nicht.
