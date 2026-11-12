# LawNetz

Webplattform für das deutsche Bundesrecht und amtliche englische Übersetzungen auf Basis von Daten des Bundesministeriums der Justiz (gesetze-im-internet.de).

## Übersicht

LawNetz bereitet rund 6.130 Gesetze und Rechtsverordnungen des Bundes sowie 135 amtliche englische Übersetzungen auf. Die Anwendung setzt auf serverseitiges Rendering, barrierefreie Typografie und eine lokale Volltextsuche ohne externe Abhängigkeiten.

## Merkmale

- **Architektur**: Server-Side Rendering (SSR) mit Astro und Node.js.
- **Barrierefreiheit**:
  - Orientierung an den Erfolgskriterien der Web Content Accessibility Guidelines (WCAG 2.2 Stufe AAA).
  - Tastaturnavigation mit sequenziellen Kurzbefehlen (`G` gefolgt von Navigationstasten, `?` für die Übersicht).
  - Kontrastverhältnisse von mindestens 7:1 für Fließtext im Hell- und Dunkelmodus.
  - Sprungmarken (Skip-Links) und ARIA-Landmarks für Screenreader.
- **Datenschutz & Sicherheit**:
  - Keine Verwendung von Tracking-Cookies oder Werbediensten.
  - Sämtliche Schriftarten (*Atkinson Hyperlegible*, *Lexend*) werden lokal vom Webserver ausgeliefert.
  - Clientseitige Volltextsuche via Pagefind ohne Übertragung von Suchanfragen an Dritte.
  - Parametrisierte SQL-Abfragen über Drizzle ORM zur Vermeidung von SQL-Injections.
  - Restriktive Content Security Policy (CSP).
- **Zweisprachigkeit**:
  - Umschaltung zwischen deutschen Gesetzestexten und den vom Bundesministerium der Justiz herausgegebenen englischen Übersetzungen.
- **Layout**:
  - Responsives Layout mit einheitlicher Inhaltsbreite für Desktop- und Mobilgeräte.

## Technologie-Stack

| Bereich | Komponente |
| :--- | :--- |
| **Framework** | [Astro](https://astro.build/) (Server-Side Rendering) |
| **Adapter** | `@astrojs/node` |
| **Laufzeitumgebung** | Node.js mit Phusion Passenger (Netcup Webhosting) |
| **Datenbank** | MySQL mit [Drizzle ORM](https://orm.drizzle.team/) |
| **Typografie** | *Atkinson Hyperlegible* und *Lexend* (lokal gehostet) |
| **Suchfunktion** | [Pagefind](https://pagefind.app/) (clientseitige Volltextsuche) |
| **CSS** | Vanilla CSS mit Custom Properties |

## Lokale Entwicklung

### Voraussetzungen
- Node.js ≥ 22
- Git Bash oder Unix-Shell

### Installation

```bash
git clone https://github.com/dstN/lawnetz.de.git
cd lawnetz.de
npm install
cp .env.example .env
npm run dev
```

Die Anwendung ist anschließend unter `http://localhost:4321` erreichbar.

## Verfügbare Befehle

| Befehl | Funktion |
| :--- | :--- |
| `npm run dev` | Startet den Astro-Entwicklungsserver |
| `npm run build` | Erstellt den Produktions-Build (`dist/server/` und `dist/client/`) |
| `npm run preview` | Startet den gebauten Server lokal zur Vorschau |
| `npm run fetch-toc` | Aktualisiert das Inhaltsverzeichnis aller Bundesgesetze |
| `npm run sync:translations` | Synchronisiert den Katalog englischer Übersetzungen |
| `npm run scrape:all` | Importiert Gesetze in die MySQL-Datenbank |
| `npm run sync:daily` | Prüft alle fälligen Gesetze und lädt geänderte nach (`-- --force` lädt alle, `-- --slug bgb` nur eines); derselbe Code wie der nächtliche Cronjob |
| `npm run db:push` | Überträgt das Drizzle-Schema auf die MySQL-Datenbank |
| `npm test` | Smoke-Test des Builds: Datenbestand, keine Drittanbieter, Schriften |
| `npm run test:a11y` | Playwright: axe-core und eigene Prüfungen für WCAG 2.2 AAA (siehe unten) |

### Barrierefreiheitstests

`tests/e2e/a11y.spec.ts` prüft jede Seite mit axe-core und mit `tests/e2e/fixtures/aaa.ts`, das die AAA-Kriterien misst, für die axe keine Regeln hat: Zielgröße 44 × 44 px (2.5.5), Textdarstellung (1.4.8), Ort (2.4.8), Tastatur (2.1.3) und Fokus (2.4.12, 2.4.13). Dazu kommen Umbruch bei 320 px (1.4.10) sowie Begriffe und Abkürzungen (3.1.3, 3.1.4). `tests/e2e/glossary.spec.ts` gleicht jeden Eintrag in `src/data/glossary.json` mit dem Gesetzestext ab.

Die Gesetzes- und Normseiten brauchen MySQL. Die CI lädt dafür `tests/fixtures/laws.sql` (einige Gesetze von gesetze-im-internet.de) in einen Service-Container. Lokal genauso, mit einer leeren Datenbank, nie der Produktionsdatenbank:

```bash
export DB_URL=mysql://root@127.0.0.1:3306/lawnetz_test
npx drizzle-kit push --force
mysql -u root lawnetz_test < tests/fixtures/laws.sql
npm run build && npm run test:a11y
```

Ohne `DB_URL` werden diese Tests übersprungen. Wie die Fixture entsteht, steht in `tests/fixtures/make-db-fixture.mjs`.

## Deployment

Hinweise zur Bereitstellung auf Netcup-Webhosting (Plesk mit Phusion Passenger, MySQL und Cronjob-Konfiguration) sind in [NETCUP_DEPLOYMENT.md](./NETCUP_DEPLOYMENT.md) dokumentiert.

## Versionierung und Releases

Versionen folgen [Semantic Versioning](https://semver.org/lang/de/), die Änderungen stehen in [CHANGELOG.md](./CHANGELOG.md). **Major**, wenn ein Release einen Handgriff auf dem Server braucht (`db:push`, Cronjob, `.env`), **Minor** für neue Funktionen, **Patch** für Korrekturen.

Jeder Push auf `main` deployt. Ein Release dazu:

1. Die Einträge unter `[Unreleased]` im Changelog unter eine neue Überschrift `## [X.Y.Z] – JJJJ-MM-TT` setzen; was vor dem Deploy auf dem Server zu tun ist, gehört in einen Abschnitt „Betrieb (vor dem Deploy)“.
2. `npm version X.Y.Z --no-git-tag-version` (setzt `package.json` und `package-lock.json`).
3. Committen, dann `git tag vX.Y.Z` und `git push origin main vX.Y.Z`.

Der Tag startet `.github/workflows/release.yml`: Er prüft, dass Tag, `package.json` und Changelog dieselbe Version nennen, und legt das GitHub-Release mit dem Changelog-Abschnitt als Text an.

## Datenquelle & Lizenz

- **Datenquelle**: Amtlicher Datenbestand des Bundesministeriums der Justiz und des Bundesamts für Justiz, bereitgestellt über [gesetze-im-internet.de](https://www.gesetze-im-internet.de). Gemäß § 5 Abs. 1 UrhG genießen amtliche Werke keinen urheberrechtlichen Schutz.
- **Quellcode**: Open Source.
