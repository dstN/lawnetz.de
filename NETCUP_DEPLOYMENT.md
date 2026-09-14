# Netcup Webhosting & Deployment für LawNetz

Anleitung für das Deployment auf Netcup-Webhosting-Tarifen (Plesk/WCP) unter Node.js, Phusion Passenger und MySQL.

---

## 1. Sicherheits- und Datenschutzarchitektur

### SQL-Injection-Schutz
- **Abfrageerstellung**: Datenbankabfragen in `src/db/index.ts` werden über Drizzle ORM ausgeführt.
- **Prepared Statements**: Parameter (z. B. `lawSlug`, `normSlug`, Sprach- und Filterparameter) werden als parametrisierte Werte (`?`) übergeben.
- **Keine dynamische String-Konkatenation**: Es erfolgt keine Zusammensetzung von SQL-Befehlen aus ungeprüften Benutzereingaben.
- **Scraper und Synchronisationsskripte**: Auch die Skripte in `scripts/` nutzen parametrisierte Abfragen.

### Datenschutz und Cookie-Verzicht
- **Keine Cookies**: LawNetz setzt keine Cookies (`Set-Cookie` Header werden nicht gesendet).
- **Lokale Ressourcen**:
  - Schriftarten (*Atkinson Hyperlegible* und *Lexend*) liegen lokal unter `/fonts/` auf dem Server.
  - Keine Abhängigkeiten zu externen Content Delivery Networks (CDNs) oder Schriftarten-Diensten.
  - Keine Webanalyse-, Telemetrie- oder Werbedienste.
  - Volltextsuche via Pagefind läuft clientseitig im Browser des Nutzers.
- **LocalStorage**: Die vom Nutzer gewählte Darstellungspräferenz (Dunkel-/Hellmodus) wird im lokalen Browserspeicher abgelegt und nicht an den Server übertragen.
- **Rechtliche Einordnung**: Da keine einwilligungspflichtigen Informationen auf Endgeräten gespeichert oder ausgelesen werden (§ 25 TDDDG) und keine Nutzerprofile gebildet werden, ist kein Cookie-Banner erforderlich.
- **Content Security Policy (CSP)**: Sowohl über die Middleware (`src/middleware.ts`) als auch über `.htaccess` wird eine restriktive CSP ausgeliefert:
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
   CRON_SECRET=a8f92b7c6d1e45903cde89712bf3456789abcdef
   ```
   > [!TIP]
   > Sie müssen **keine** Einzelfelder (`DB_HOST`, `DB_USER`, `DB_PASSWORD` etc.) anlegen – die Angabe der `DB_URL` reicht vollkommen für Drizzle ORM, Drizzle Kit und alle Sync-Skripte aus.
   >
   > Auch in den **GitHub Secrets** müssen **keine** Datenbank-Zugangsdaten hinterlegt werden: Die `.env`-Datei verbleibt sicher auf Ihrem Netcup-Server und wird beim automatischen Deployment über GitHub Actions bewusst ausgeschlossen (`--exclude='.env'`).

4. Tabellenstruktur einrichten:
   ```bash
   npm run db:push
   ```
   Alternativ kann das Schema manuell über phpMyAdmin mit `drizzle/schema.sql` eingespielt werden.

---

## 4. Automatische Aktualisierung (Cronjobs)

Auf Shared-Hosting-Paketen laufen Cronjobs häufig in einer eingeschränkten Chroot-Umgebung ohne direkten Zugriff auf globale Node.js-Binaries. Für die tägliche Aktualisierung stehen zwei Möglichkeiten zur Verfügung:

### Option A: HTTP-Aufruf über Plesk (Empfohlen)
Plesk ruft die Aktualisierungsroute per HTTP ab. Die Verarbeitung erfolgt im laufenden Node.js-Prozess:

1. In Plesk unter **Geplante Aufgaben (Cronjobs)** auf **Aufgabe hinzufügen** klicken.
2. Aufgabentyp: **URL abrufen**.
3. URL eintragen:
   ```text
   https://www.lawnetz.de/api/cron/sync?token=DEIN_CRON_SECRET
   ```
4. Ausführungszeit: Täglich um `03:00` Uhr (`0 3 * * *`).
5. Der Endpunkt prüft den Parameter `token` gegen `CRON_SECRET` aus der `.env`. Bei fehlendem oder falschem Token wird der Zugriff mit `401 Unauthorized` abgewiesen.

### Option B: Ausführung per Shell-Befehl
Falls SSH-Zugriff mit Node.js konfiguriert ist:
1. Pfad zu Node.js ermitteln (`which node`).
2. Cronjob als **Befehl ausführen**:
   ```bash
   cd /var/www/vhosts/deinedomain.de/httpdocs && /opt/plesk/node/26/bin/node scripts/sync-daily.ts >> logs/cron.log 2>&1
   ```

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

Im Repository ist ein Workflow für kontinuierliche Integration und automatisches Deployment eingerichtet (`.github/workflows/deploy.yml`), der nach dem bewährten **Bewerby-Muster** arbeitet:

- **Passwortbasierte Authentifizierung**: Netcup-Webhosting bietet im WCP/Plesk primär Passwort-Authentifizierung für SSH/FTP. Die Verbindung erfolgt sicher über `sshpass` direkt mit OpenSSH (ohne unsichere Drittanbieter-Actions).
- **Chroot-kompatibles Tar-Streaming**: Da in der Netcup-Chroot-Umgebung häufig kein `rsync` installiert ist, wird das gebaute Release als Tar-Stream über SSH direkt in ein Staging-Verzeichnis (`dist.new`) entpackt.
- **Atomare Umschaltung (Zero-Downtime)**: `dist.new` wird blitzschnell zu `dist` umbenannt (der vorherige Release bleibt als `dist.prev` für Rollbacks erhalten).
- **Automatischer Smoke-Test & Rollback**: Nach dem Neustart von Phusion Passenger prüft die Pipeline per `curl`, ob die Website erreichbar ist (HTTP 200) und ob Sicherheitsgrenzen eingehalten werden (die `.env` und `package.json` dürfen nicht öffentlich abrufbar sein). Bei Fehlern schlägt automatisch ein Rollback auf `dist.prev` an.

### Erforderliche GitHub Secrets

Hinterlege unter **Settings** → **Secrets and variables** → **Actions** (oder unter **Environments** → `production`):

| Secret | Beispielwert | Beschreibung |
| :--- | :--- | :--- |
| `DEPLOY_SSH_HOST` | `lawnetz.de` *(oder Server-IP)* | Hostname oder IP-Adresse deines Netcup-Servers |
| `DEPLOY_SSH_USER` | `hosting123456` *(oder `k123456`)* | Der SSH- / FTP-Benutzername deines Webhosting-Pakets |
| `DEPLOY_SSH_PASSWORD` | `DeinSicheresPasswort` | Das Passwort dieses Zugangs (**kein SSH-Schlüssel nötig!**) |
| `DEPLOY_PATH` | `/httpdocs` *(oder `/lawnetz.de`)* | Anwendungsstamm im Netcup-Chroot (was `pwd` nach dem SSH-Login ausgibt) |
| `DEPLOY_DOMAIN` | `www.lawnetz.de` | Domain für den automatischen Smoke-Test nach dem Deployment |
| `DEPLOY_SSH_HOSTKEY` | *(optional)* | Ausgabe von `ssh-keyscan -t ed25519 lawnetz.de` zur Pinning-Prüfung |

> [!TIP]
> Die bestehende `.env`-Datei auf dem Server bleibt unangetastet: Sie liegt dauerhaft in deinem Anwendungsstamm auf Netcup und wird von GitHub Actions weder überschrieben noch gelöscht.
> In den GitHub Secrets müssen daher **keine** Datenbank-Zugangsdaten gespeichert werden.
