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
| `npm run sync:daily` | Führt den Delta-Sync für Gesetzesänderungen aus |
| `npm run db:push` | Überträgt das Drizzle-Schema auf die MySQL-Datenbank |

## Deployment

Hinweise zur Bereitstellung auf Netcup-Webhosting (Plesk mit Phusion Passenger, MySQL und Cronjob-Konfiguration) sind in [NETCUP_DEPLOYMENT.md](./NETCUP_DEPLOYMENT.md) dokumentiert.

## Datenquelle & Lizenz

- **Datenquelle**: Amtlicher Datenbestand des Bundesministeriums der Justiz und des Bundesamts für Justiz, bereitgestellt über [gesetze-im-internet.de](https://www.gesetze-im-internet.de). Gemäß § 5 Abs. 1 UrhG genießen amtliche Werke keinen urheberrechtlichen Schutz.
- **Quellcode**: Open Source.
