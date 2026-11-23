# Netcup Webhosting & Deployment für LawNetz

Anleitung für das Deployment auf Netcup-Webhosting-Tarifen (Plesk/WCP) unter Node.js, Phusion Passenger und MySQL.

---

## 1. Sicherheits- und Datenschutzarchitektur

### SQL-Injection-Schutz
Alle Datenbankabfragen in `src/db/index.ts` laufen über Drizzle ORM. Parameter (z. B. `lawSlug`, `normSlug`, Sprach- und Filterparameter) gehen als Platzhalter (`?`) in Prepared Statements an die Datenbank; SQL-Befehle werden nie per String-Konkatenation aus ungeprüften Benutzereingaben zusammengesetzt. Die Scraper und Synchronisationsskripte in `scripts/` nutzen ebenfalls parametrisierte Abfragen.

### Datenschutz und Cookie-Verzicht
LawNetz setzt keine Cookies und sendet keinen `Set-Cookie`-Header. Alles Weitere kommt vom eigenen Server oder bleibt im Browser:

- Die Schriftarten (*Atkinson Hyperlegible* und *Lexend*) liegen lokal unter `/fonts/` auf dem Server.
- Es gibt keine Abhängigkeiten zu externen Content Delivery Networks (CDNs) oder Schriftarten-Diensten.
- Es laufen keine Webanalyse-, Telemetrie- oder Werbedienste.
- Die Volltextsuche (Pagefind) läuft im Browser des Nutzers.
- Die gewählte Darstellung (Dunkel-/Hellmodus) steht im LocalStorage des Browsers und wird nicht an den Server übertragen.

Auf Endgeräten werden keine einwilligungspflichtigen Informationen gespeichert oder ausgelesen (§ 25 TDDDG), und es entstehen keine Nutzerprofile. Ein Cookie-Banner ist deshalb nicht erforderlich.

Die Middleware (`src/middleware.ts`) und `.htaccess` liefern beide diese restriktive Content Security Policy (CSP) aus:

```http
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self' https://contact.yinside.de; frame-ancestors 'none'; base-uri 'self'; form-action 'self';
```

---

## 2. Webhosting-Konfiguration in Plesk

In der Plesk-Verwaltung (**Websites & Domains** → Domain auswählen):

### Node.js-Einstellungen
Unter dem Menüpunkt **Node.js**:

| Einstellung | Wert | Erläuterung |
| :--- | :--- | :--- |
| **Node.js-Status** | `Aktiviert` | Aktiviert die Node.js-Laufzeitumgebung |
| **Node.js-Version** | Aktuell verfügbare Version (z. B. `22.x` oder `26.x`) | Über das Dropdown auswählen |
| **Anwendungsmodus** | `production` | Produktionsmodus |
| **Anwendungsstamm** | `/httpdocs` (bzw. Projektverzeichnis) | Verzeichnis mit `app.js` und `package.json` |
| **Dokument-Stamm** | `/httpdocs/dist/client` | Statische Dateien (CSS, JS, Fonts) direkt ausliefern |
| **Anwendungsstartdatei** | `app.cjs` (bzw. `app.js`) | Einstiegspunkt für Phusion Passenger (CommonJS-Wrapper für ESM) |

---

## 3. Datenbank anlegen

1. Unter **Datenbanken** → **Datenbank hinzufügen** eine neue MySQL-Datenbank erstellen (z. B. `k12345_lawnetz`).
2. Einen Datenbankbenutzer mit Passwort anlegen.
3. Im Projektverzeichnis auf dem Server die Datei `.env` anlegen und mit der `DB_URL` befüllen:
   ```ini
   # Direkte MySQL-Verbindungs-URL (Benutzer, Passwort, Host, Port und Datenbank in einer einzigen Zeile)
   DB_URL=mysql://k12345_lawnetzuser:DeinPasswort@localhost:3306/k12345_lawnetz

   # Geheimer Schlüssel zur Absicherung des Cronjob-Endpunkts (für Plesk URL-Aufruf)
   CRON_SECRET=exampleSecret
   ```
   Den Schlüssel einmalig zufällig erzeugen und statt `exampleSecret` eintragen, zum Beispiel mit Node (64 Hex-Zeichen):
   ```bash
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```
   > [!TIP]
   > Einzelfelder (`DB_HOST`, `DB_USER`, `DB_PASSWORD` etc.) sind nicht nötig. Drizzle ORM, Drizzle Kit und alle Sync-Skripte kommen mit `DB_URL` aus.
   >
   > Auch in die **GitHub Secrets** gehören keine Datenbank-Zugangsdaten: Die `.env`-Datei bleibt auf Ihrem Netcup-Server, das automatische Deployment über GitHub Actions schließt sie aus (`--exclude='.env'`).

4. Tabellenstruktur einrichten:
   ```bash
   npm run db:push
   ```
   Alternativ kann das Schema manuell über phpMyAdmin mit `drizzle/schema.sql` eingespielt werden.

---

## 4. Automatische Aktualisierung (Cronjobs)

Auf Shared-Hosting-Paketen laufen Cronjobs häufig in einer eingeschränkten Chroot-Umgebung ohne direkten Zugriff auf globale Node.js-Binaries. Für die tägliche Aktualisierung gibt es zwei Wege:

### Option A: HTTP-Aufruf über Plesk (Empfohlen)
Plesk ruft die Aktualisierungsroute per HTTP ab, die Arbeit erledigt der laufende Node.js-Prozess:

1. In Plesk unter **Geplante Aufgaben (Cronjobs)** auf **Aufgabe hinzufügen** klicken.
2. Aufgabentyp: **URL abrufen**.
3. URL eintragen:
   ```text
   https://www.lawnetz.de/api/cron/sync?token=DEIN_CRON_SECRET
   ```
4. Ausführungszeit: nachts alle 5 Minuten von 01:00 bis 02:55 Uhr (`*/5 1-2 * * *`), also 24 Aufrufe.
5. Der Endpunkt prüft den Parameter `token` gegen `CRON_SECRET` aus der `.env`. Bei fehlendem oder falschem Token wird der Zugriff mit `401 Unauthorized` abgewiesen.

Der Endpunkt prüft alle rund 6.130 Gesetze, aber nicht in einem Aufruf: Jeder Aufruf arbeitet 45 Sekunden lang die Gesetze ab, die am längsten nicht geprüft wurden, und hört dann auf, bevor ein Proxy die Anfrage abbricht. Ein Gesetz ist 20 Stunden nach seiner letzten Prüfung wieder fällig. gesetze-im-internet.de bricht parallele Anfragen ab, deshalb geht es eins nach dem anderen, rund 0,1 Sekunden pro unverändertem Gesetz: Eine volle Runde braucht etwa 10 Minuten, also gut ein Dutzend Aufrufe. Heruntergeladen werden nur Gesetze, deren Datei sich geändert hat (neues ETag, oder ohne gespeichertes ETag: `Last-Modified` nach unserem letzten Download).

Jeder Aufruf, der etwas geprüft hat, steht in `sync_logs` (`details.remaining` = was in dieser Runde noch offen ist). Der Stand pro Gesetz liegt in `law_sync_state`. Die Logik steht in `scripts/sync-core.ts` und ist dieselbe, die `npm run sync:daily` lokal ausführt.

### Option B: Ausführung per Shell-Befehl (geht mit dem jetzigen Deploy nicht)
`scripts/sync-daily.ts` läuft auf dem Server nicht, weder mit `node` noch mit `tsx`:
- Die Skripte importieren ohne Dateiendung (`./fetch-law`); das löst nur `tsx` auf, und `tsx` ist nach `npm prune --omit=dev` nicht installiert (es ist keine Abhängigkeit).
- Der Deploy lädt `scripts/` und `src/data/` hoch, aber nicht `src/db/`, das die Skripte importieren.

Der volle Abgleich aller Gesetze läuft deshalb lokal, mit der `.env` der Produktion: `npm run sync:daily` (nur geänderte Gesetze) oder, etwa nach einer Schemaänderung, die neue Daten speichert, erst `npm run db:push` und dann `npm run sync:daily -- --force`.

---

## 5. Deployment-Ablauf

### 1. Build erstellen
Lokal im Projektverzeichnis ausführen:
```bash
npm run build
```
Der Build erzeugt `dist/server/` und `dist/client/`.

### 2. Dateien übertragen
Folgende Verzeichnisse und Dateien auf den Server in das Anwendungsstammverzeichnis übertragen:

```text
/httpdocs/
├── dist/
├── node_modules/
├── scripts/
├── src/data/
├── app.js
├── package.json
└── .env
```

### 3. Produktions-Abhängigkeiten installieren
In Plesk unter **Node.js** auf **NPM-Installation** klicken oder per SSH ausführen:
```bash
npm install --omit=dev
```

### 4. Datenbestand initialisieren
Für den ersten Datenabruf aller Gesetze in die MySQL-Datenbank per SSH ausführen:
```bash
npm run scrape:all
```

### 5. Anwendung neu starten
In Plesk unter **Node.js** auf **App neu starten** klicken (bzw. `touch tmp/restart.txt`).

---

## 6. Automatisches Deployment über GitHub Actions (CI/CD)

Der Workflow `.github/workflows/deploy.yml` baut und deployt automatisch, nach demselben Muster wie bei Bewerby:

- Netcup-Webhosting bietet im WCP/Plesk vor allem Passwort-Authentifizierung für SSH/FTP. Der Workflow verbindet sich deshalb mit `sshpass` direkt über OpenSSH, ohne Actions von Drittanbietern.
- In der Netcup-Chroot-Umgebung fehlt häufig `rsync`. Das gebaute Release geht deshalb als Tar-Stream über SSH und wird direkt in ein Staging-Verzeichnis (`dist.new`) entpackt.
- Danach wird `dist.new` atomar zu `dist` umbenannt, ohne Ausfallzeit. Das vorherige Release bleibt als `dist.prev` für Rollbacks erhalten.
- Nach dem Neustart von Phusion Passenger prüft die Pipeline per `curl`, ob die Website erreichbar ist (HTTP 200) und ob `.env` und `package.json` nicht öffentlich abrufbar sind. Schlägt eine Prüfung fehl, rollt sie automatisch auf `dist.prev` zurück.

### Erforderliche GitHub Secrets

Hinterlege unter **Settings** → **Secrets and variables** → **Actions** (oder unter **Environments** → `production`):

| Secret | Beispielwert | Beschreibung |
| :--- | :--- | :--- |
| `DEPLOY_SSH_HOST` | `lawnetz.de` *(oder Server-IP)* | Hostname oder IP-Adresse deines Netcup-Servers |
| `DEPLOY_SSH_USER` | `hosting123456` *(oder `k123456`)* | Der SSH- / FTP-Benutzername deines Webhosting-Pakets |
| `DEPLOY_SSH_PASSWORD` | `DeinSicheresPasswort` | Das Passwort dieses Zugangs (kein SSH-Schlüssel nötig) |
| `DEPLOY_PATH` | `/httpdocs` *(oder `/lawnetz.de`)* | Anwendungsstamm im Netcup-Chroot (was `pwd` nach dem SSH-Login ausgibt) |
| `DEPLOY_DOMAIN` | `www.lawnetz.de` | Domain für den automatischen Smoke-Test nach dem Deployment |
| `DEPLOY_SSH_HOSTKEY` | *(optional)* | Ausgabe von `ssh-keyscan -t ed25519 lawnetz.de` zur Pinning-Prüfung |

> [!TIP]
> Die bestehende `.env`-Datei auf dem Server bleibt unangetastet: Sie liegt dauerhaft in deinem Anwendungsstamm auf Netcup und wird von GitHub Actions weder überschrieben noch gelöscht.
> In den GitHub Secrets müssen daher **keine** Datenbank-Zugangsdaten gespeichert werden.
