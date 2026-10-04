# FX Shield – Schutz für FiveM-Server, verwaltet im Web-Dashboard

Eine **Resource** läuft auf deinem FiveM-Server, verbindet sich per **API-Key** mit **deinem Backend** und setzt die
Schutz-Einstellungen durch, die du im **Dashboard** (React + shadcn/ui) einstellst – ohne Server-Neustart.

```
  FiveM-Server                              Dein Backend                          Browser
┌─────────────────────┐   HTTPS + API-Key  ┌──────────────────────────┐          ┌──────────────┐
│ resource/fxshield   │ ─────────────────► │ Node.js · SQLite         │ ◄─────── │  Dashboard   │
│ (Lua, nur serverseitig) │ Statistik, Events │ API  +  Dashboard-Auslieferung │  Login   │ (shadcn/ui)  │
│                     │ ◄───────────────── │                          │          └──────────────┘
└─────────────────────┘ Einstellungen, Listen └──────────────────────────┘
```

```
backend/            Node.js-Backend (Fastify + SQLite) und das Dashboard (backend/dashboard)
resource/fxshield/  Die FiveM-Resource – dieser Ordner kommt in dein resources-Verzeichnis
resource/tests/     Lua-Tests (Unit-Tests mit nachgebautem FiveM + End-to-End-Treiber)
docs/               Protokoll zwischen Resource und Backend
```

---

## ⚠️ Ehrlich: Was FX Shield kann – und was nicht

FX Shield ist ein **Schutz auf Anwendungsebene (Layer 7)**. Es läuft *innerhalb* deines FiveM-Servers.

**Das hilft zuverlässig gegen**

| Angriff / Problem | Schutzmodul |
|---|---|
| Join-/Reconnect-Floods, Bots, die alle Slots füllen | Connection flood guard, Under-attack mode |
| Mehrere Accounts / Bots hinter einer IP | Accounts per IP |
| Clients ohne gültige Lizenz, leere/unsichtbare/Exploit-Namen | Identity & name check |
| Cheater-Clients, die den Server per **Event-Spam** crashen oder laggen (Explosionen, Partikel, Feuer, Projektile) | Game event flood guard |
| Entity-Spam (Fahrzeuge/Peds/Objekte), Chat-Flood | Entity spam guard, Entity lockdown, Chat flood guard |
| Bekannte Angreifer (IPs, IP-Bereiche, Lizenzen, Discord-IDs …) | Block-/Allowlist |

**Das kann ein Script prinzipiell nicht**

* **Volumetrische Angriffe auf Netzwerkebene** (UDP-/TCP-Fluten, die deine Leitung füllen). Pakete, die den Server erst
  erreichen, *nachdem* die Leitung voll ist, kann keine Resource mehr aufhalten – auch diese nicht.
  Dagegen helfen nur: ein **Hoster mit DDoS-Filter**, ein **FiveM-tauglicher Proxy-/Tunnel-Dienst** und/oder
  Firewall-Regeln auf dem Host (Beispiel unten).
* Die Resource sieht einen Verbindungsversuch erst, wenn FXServer ihn bis zum Script-Event (`playerConnecting`) durchgereicht hat.
  FiveM ruft die Handler **aller** Resources auf – auch für Versuche, die FX Shield abweist. FX Shield verhindert den *Beitritt*,
  nicht dass teure Handler anderer Resources (Whitelist-/Queue-Skripte mit Datenbankabfragen) trotzdem laufen. Wer das vermeiden will,
  prüft dort zuerst `exports.fxshield:isBlocked(ip)` und bricht früh ab.

Realistisch heißt das: **FX Shield + DDoS-geschützter Hoster** ist ein guter Schutz. FX Shield allein schützt die
Spielmechanik und die Slots, aber nicht deine Bandbreite.

### Status der Tests

| Was | Wie geprüft |
|---|---|
| Backend (Auth, API-Keys, Config, Listen, Protokoll, Statistik) | 77 automatische Tests |
| Resource-Logik (alle Schutzmodule, Sync, Cache, Fehlerfälle) | 130 Lua-Tests gegen einen nachgebauten FiveM-Server |
| Zusammenspiel Resource ⇄ Backend | End-to-End-Test: die echte Lua-Resource spricht per echtem HTTP mit dem echten Backend (Konfig ändern, Blocklist, Statistik, Ausfall des Backends, Key-Wechsel) |
| Dashboard | Headless-Browser-Durchlauf (Setup, Server anlegen, Einstellungen speichern, Listen, Events, Accounts, Light/Dark, Mobil) ohne Konsolenfehler |
| **Auf einem echten FXServer** | **nicht getestet** – dafür stand keine Umgebung zur Verfügung. Die verwendeten FiveM-Funktionen und -Events sind Standard, aber teste die Resource zuerst auf einem Testserver (siehe „Empfohlener Einstieg“). |
| Docker-Image | Dockerfile geschrieben, die Build-/Runtime-Schritte lokal nachgestellt; das Image selbst wurde nicht gebaut |

---

## Schnellstart

### 1. Backend starten

Voraussetzung: **Node.js 22.13 oder neuer** (`node -v`). Keine Datenbank und kein Compiler nötig – SQLite ist in Node eingebaut.

```bash
cd backend
npm install
npm run build
npm start
```

Beim ersten Start steht in der Konsole ein **einmaliges Setup-Token**:

```
│  1. Open http://localhost:8080
│  2. Create the administrator account with this setup token:
│     Qk3vJ0…
```

Öffne die Adresse, gib das Token ein und lege deinen Admin-Account an. (Optional: eigenes Token per `SETUP_TOKEN` in der `.env`.)

> **Mit Docker:** `docker compose up -d --build`, das Token liest du mit `docker compose logs fxshield`.

### 2. Server anlegen

Im Dashboard **Add server** → Namen eingeben → du bekommst den **API-Key** (wird nur **einmal** angezeigt, gespeichert wird nur sein Hash)
und den fertigen `server.cfg`-Block.

### 3. Resource installieren

1. Kopiere den Ordner `resource/fxshield` in dein FiveM-`resources`-Verzeichnis (z. B. `resources/[local]/fxshield`).
2. Trage in die `server.cfg` ein – **weit oben, vor deinen anderen Resources**:

   ```cfg
   set fxshield_url "https://shield.example.com"
   set fxshield_key "fxs_…dein_key…"
   ensure fxshield
   ```

   Verwende `set`, **niemals** `setr` oder `sets` – die würden den Key an alle Spieler schicken.
3. Server (neu)starten. In der Server-Konsole erscheint:

   ```
   [fxshield] FX Shield v1.0.0 starting (OneSync: on)
   [fxshield] connected to the backend (config revision 1, 0 blocklist entries)
   ```

   Im Dashboard steht der Server nach wenigen Sekunden auf **Online**.

### 4. Dich selbst schützen (wichtig)

Trage dich **vor** dem Scharfschalten in die **Allowlist** ein (Dashboard → *Block / allow lists → Allowlist*, z. B. `license:…` oder deine IP)
und/oder in die `config.lua` der Resource (`Config.LocalAllowlist`, funktioniert auch bei ausgefallenem Backend).
Allowlist-Einträge werden von **keinem** Schutzmodul angefasst.

---

## Das Dashboard

| Bereich | Was du dort machst |
|---|---|
| **Servers** | Übersicht aller Server mit Status, Spielerzahl, Blockierungen der letzten 24 h; neue Server anlegen |
| **Overview** | Status (Online, Spieler, Reaktionszeit, Version), **Panik-Schalter** für den Under-attack-Modus, Verlauf der Verbindungen (1 h – 7 d), „Was wurde gestoppt“, letzte Ereignisse |
| **Protections** | **Alle Schutzmodule einstellen**: Modus, Grenzwerte, Sperrdauer, Meldungen. Presets (Balanced / Strict / Monitor only). Änderungen erreichen den Server in wenigen Sekunden; die Seite zeigt, ob sie schon *aktiv* sind |
| **Block / allow lists** | IPs, IP-Bereiche (CIDR), Lizenzen, Discord-/Steam-IDs … sperren oder erlauben; mehrere Einträge auf einmal einfügen; optional mit Ablaufzeit |
| **Events** | Protokoll aller Vorfälle; direkt aus einem Eintrag IP oder Identifier sperren/erlauben |
| **Settings** | Umbenennen, Server deaktivieren, **API-Key rotieren**, löschen |
| **Accounts** (Admin) | Weitere Accounts anlegen (sehen nur eigene Server) oder Admins ernennen |

### Die Schutzmodule und ihre Standardwerte

Jedes Modul hat drei Modi: **Off**, **Monitor** (nur erkennen und melden – *nichts* wird blockiert) und **Enforce** (erkennen und handeln).

| Modul | Was es tut | Standard |
|---|---|---|
| **Connection flood guard** | Begrenzt Verbindungsversuche pro IP und pro Lizenz in einem Zeitfenster, sperrt Wiederholungstäter zeitweise | Enforce · 10 Versuche/IP, 6/Lizenz in 30 s → 5 min Sperre |
| **Accounts per IP** | Max. gleichzeitig verbundene Spieler pro IP | Monitor · 4 |
| **Identity & name check** | Lizenz Pflicht; Namen leer/zu lang/mit unsichtbaren oder Steuerzeichen | Enforce |
| **Under-attack mode** | Erkennt Floods (abgewiesene oder gesamte Versuche pro Minute), verschärft IP-Limits und lässt – wenn gewünscht – nur **bekannte Spieler** (schon einmal beigetreten) herein | Automatic · ab 40 abgewiesenen oder 600 Versuchen/min, mind. 3 min |
| **Game event flood guard** *(OneSync)* | Begrenzt Explosionen, Partikel, Feuer, Projektile pro Spieler; überzählige Events werden abgebrochen, optional Kick/Bann | Enforce · nur abbrechen |
| **Entity spam guard** *(OneSync)* | Begrenzt vom Client erzeugte Entities (Fahrzeuge, Peds, Objekte) | Monitor |
| **Entity lockdown** *(OneSync)* | FXServers eingebaute Sperre: Clients dürfen keine Entities selbst erzeugen | Off (kann Resources brechen!) |
| **Chat flood guard** | Nachrichten pro Zeit und maximale Länge (Standard-`chat`-Resource) | Enforce · nur abbrechen |

Vorsichtige Standardwerte sind Absicht: Ein Schutz, der echte Spieler aussperrt, ist schlimmer als keiner.

### Empfohlener Einstieg

1. **Zuerst auf einem Testserver** ausprobieren.
2. Dich in die **Allowlist** eintragen (siehe oben).
3. Preset **„Monitor only“** wählen und ein paar Tage laufen lassen. Unter *Events* siehst du, was blockiert *worden wäre*.
4. Wenn die Meldungen plausibel sind: Preset **„Balanced“** (oder gezielt einzelne Module auf *Enforce*).
5. Den **Under-attack mode** auf *Automatic* lassen; bei einem laufenden Angriff mit dem **Panik-Schalter** (*Always on*) sofort verschärfen.

Falls dir ein legitimer Spieler gesperrt wurde: Konsole `fxshield unban <ip|identifier>`, Allowlist-Eintrag setzen, oder das Modul im Dashboard auf *Monitor* stellen.

---

## Betrieb im Internet

* **HTTPS ist Pflicht**, sobald das Backend öffentlich erreichbar ist (der API-Key und die Dashboard-Sitzung laufen sonst im Klartext).
  Am einfachsten mit einem Reverse Proxy, z. B. [Caddy](https://caddyserver.com) (holt Zertifikate automatisch):

  ```
  shield.example.com {
      reverse_proxy localhost:8080
  }
  ```

  Dann in der `backend/.env`: `PUBLIC_URL=https://shield.example.com` und `TRUST_PROXY=true`.
* Die Resource läuft **weiter und schützt weiter**, wenn das Backend nicht erreichbar ist: Sie nutzt die zuletzt empfangenen
  Einstellungen und Listen (liegen in `cache.json` im Resource-Ordner) und liefert Statistik/Events nach, sobald die Verbindung wieder da ist.
  Auch ein Angriff auf dein Backend lässt die Server also nicht ungeschützt.
* **Backups:** alles liegt in einer SQLite-Datei (`backend/data/fxshield.db`, bzw. das Docker-Volume `fxshield-data`). Für ein
  konsistentes Backup den Dienst kurz stoppen oder `sqlite3 fxshield.db ".backup backup.db"` verwenden.
* **Aufbewahrung:** Ereignisse 14 Tage, Statistik 30 Tage (einstellbar, siehe unten).
* **Accounts:** Der erste Account ist Administrator. Weitere legst du unter *Accounts* an – diese Accounts sehen nur ihre eigenen Server.
  Eine öffentliche Selbstregistrierung gibt es bewusst nicht.

### Konfiguration des Backends (`backend/.env`)

Alles ist optional; Vorlage: `backend/.env.example`.

| Variable | Standard | Bedeutung |
|---|---|---|
| `PORT` / `HOST` | `8080` / `0.0.0.0` | Adresse des HTTP-Servers |
| `DATABASE_PATH` | `./data/fxshield.db` | SQLite-Datei (Ordner wird angelegt) |
| `PUBLIC_URL` | – | Öffentliche Adresse (aktiviert „Secure“-Cookies bei `https://`) |
| `TRUST_PROXY` | `false` | `true` hinter einem Reverse Proxy (echte Client-IP aus `X-Forwarded-For`) |
| `SESSION_TTL_HOURS` | `168` | Dauer der Dashboard-Sitzung |
| `EVENT_RETENTION_DAYS` / `STATS_RETENTION_DAYS` | `14` / `30` | Aufbewahrung |
| `AGENT_RATE_LIMIT_PER_MIN` | `60` | Max. Sync-Anfragen pro API-Key und Minute |
| `SETUP_TOKEN` | zufällig | Token für den ersten Admin |
| `LOG_LEVEL` | `info` | `trace` … `error` |

### Zusätzlich: Netzwerk-Härtung auf dem Host (optional, nur mit Root-Zugriff)

Wenn dein Server auf einem eigenen Linux-Host läuft, kann die Firewall Floods **vor** FXServer verwerfen. Beispiel (an dein System
anpassen und **erst testen**, falsche Regeln sperren auch echte Spieler aus):

```bash
# neue TCP-Verbindungen auf 30120: pro Quell-IP max. 20/s (Burst 40), alles darüber verwerfen
iptables -A INPUT -p tcp --dport 30120 -m conntrack --ctstate NEW \
  -m hashlimit --hashlimit-above 20/sec --hashlimit-burst 40 \
  --hashlimit-mode srcip --hashlimit-name fivem_tcp -j DROP
```

Gegen echte Volumen-Angriffe brauchst du trotzdem Filterung beim **Hoster**.

---

## Die FiveM-Resource im Detail

Ordner: `resource/fxshield` – serverseitig, es wird **nichts an Spieler** ausgeliefert.

* **Konfiguration:** `server.cfg` (`fxshield_url`, `fxshield_key`, optional `fxshield_debug true`) und `config.lua` (lokale Allowlist, ACE-Name).
* **Ausnahme für Team-Mitglieder (In-Game-Schutz):** `add_ace group.admin fxshield.bypass allow`
* **Konsolenbefehle** (nur Server-Konsole): `fxshield status` · `fxshield sync` · `fxshield bans` · `fxshield ban <ip|identifier> [minuten]` · `fxshield unban <ip|identifier>`
* **Exports für andere Resources:**
  `exports.fxshield:isBlocked(ipOderIdentifier)`, `exports.fxshield:isUnderAttack()`,
  `exports.fxshield:allow(source, 'meine:event', limit, sekunden)` (Rate-Limit für eigene Events),
  `exports.fxshield:ban(wert, sekunden, grund)`, `exports.fxshield:unban(wert)`.
* **Sicherheitsprinzipien:** Alles, was vom Backend kommt, wird als *nicht vertrauenswürdig* behandelt – jeder Wert wird gegen ein Schema geprüft und
  auf Grenzen geklemmt, es wird **nie Code** aus der Antwort ausgeführt. Bei einem Fehler in der Resource wird der Spieler **durchgelassen**
  (Fail-open), damit ein Bug nie alle aussperrt.

Voraussetzungen: FXServer mit `lua54` (Standard), für die In-Game-Schutzmodule **OneSync**. Für IP-basierte Limits dürfen die IPs nicht verborgen sein
(`sv_endpointprivacy` aus) und – hinter einem Proxy – muss dieser die echte Client-IP weiterreichen.

Protokoll Resource ⇄ Backend: [docs/agent-protocol.md](docs/agent-protocol.md).

---

## Entwicklung

```bash
cd backend
npm install
npm run dev              # Backend mit Auto-Reload auf :8080
npm run dev:dashboard    # Dashboard (Vite) auf :5173, leitet /api an das Backend weiter

npm test                 # Backend-, HTTP- und End-to-End-Tests (der E2E-Test braucht Lua 5.4, sonst wird er übersprungen)
npm run typecheck
cd .. && lua5.4 resource/tests/run.lua    # Lua-Tests der Resource
```

* Alle Schutzmodule sind **einmal** in `backend/src/catalog.ts` definiert (Felder, Grenzen, Standardwerte, Texte). Daraus entstehen
  die Validierung im Backend, die Formulare im Dashboard **und** das Lua-Schema der Resource (`npm run gen:lua-schema` →
  `resource/fxshield/generated/schema.lua`). Ein Test stellt sicher, dass beides nicht auseinanderläuft.
* Neues Schutzmodul: Eintrag im Katalog, `npm run gen:lua-schema`, Handler in `resource/fxshield/server/`, Test – das Dashboard zeigt es automatisch an.
* Die UI-Texte des Dashboards sind aktuell Englisch.

## Fehlersuche

| Symptom | Ursache / Lösung |
|---|---|
| Dashboard zeigt „Waiting for connection“ | `fxshield_url`/`fxshield_key` in der `server.cfg` prüfen, Konsole nach `[fxshield]`-Meldungen durchsuchen; `fxshield status` ausführen; Erreichbarkeit: `curl -H "Authorization: Bearer fxs_…" https://deine-url/api/agent/v1/whoami` |
| Konsole: *rejected the API key (HTTP 401)* | Key falsch oder rotiert → neuen Key im Dashboard erzeugen und in die `server.cfg` eintragen |
| Konsole: *IP based protections are inactive* | `sv_endpointprivacy` ist an oder die IP ist nicht lesbar – IP-Limits können dann nicht arbeiten |
| In-Game-Schutz tut nichts | OneSync ist aus (das Dashboard weist darauf hin) |
| Ein Spieler wird zu Unrecht gesperrt | `fxshield unban …`, Allowlist-Eintrag, Modul auf *Monitor*; Details stehen unter *Events* |
| `Cannot find module 'node:sqlite'` | Node ist zu alt – Version 22.13 oder neuer installieren |

## Ideen für später

Discord-/Webhook-Alarme bei Angriffen, geteilte Bedrohungslisten zwischen Servern, deutsche Oberfläche, 2-Faktor-Login,
Postgres statt SQLite für sehr viele Server, Export der Blocklist als Firewall-Regelwerk (ipset/nftables).
