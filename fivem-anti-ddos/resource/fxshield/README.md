# fxshield – die FiveM-Resource

Serverseitige Resource (Lua 5.4, nichts wird an Spieler ausgeliefert). Sie verbindet sich mit deinem FX-Shield-Backend und setzt
die im Dashboard eingestellten Schutzmodule durch. Vollständige Anleitung: [Haupt-README](../../README.md).

## Installation

1. Diesen Ordner nach `resources/[local]/fxshield` kopieren.
2. In die `server.cfg` – **weit oben, vor den anderen Resources**:

   ```cfg
   set fxshield_url "https://shield.example.com"
   set fxshield_key "fxs_…"
   ensure fxshield
   ```

   `set`, **nicht** `setr`/`sets` (sonst sehen alle Spieler den Key).
3. **Empfohlen:** `sv_endpointprivacy false` in die `server.cfg`. FXServer verbirgt Spieler-IPs standardmäßig (`GetPlayerEndpoint` liefert `127.0.0.1`);
   ohne IPs sind die IP-basierten Limits inaktiv, die lizenzbasierten Schutzfunktionen laufen weiter.
4. Optional: Team von den In-Game-Schutzmodulen ausnehmen: `add_ace group.admin fxshield.bypass allow`

## Dateien

| Datei | Zweck |
|---|---|
| `fxmanifest.lua` | Manifest (`server_only`, keine Client-/Shared-Dateien) |
| `config.lua` | Backend-URL/Key (aus der server.cfg), **lokale Allowlist**, ACE-Name, Debug |
| `generated/schema.lua` | **Generiert** aus dem Schutz-Katalog des Backends (`npm run gen:lua-schema`) – nicht von Hand ändern |
| `server/util.lua` | Hilfsfunktionen (IP-Parsing, Text-Bereinigung, Logging) |
| `server/ratelimit.lua` | Gleitendes Zeitfenster pro Schlüssel, Speicher begrenzt |
| `server/lists.lua` | Block-/Allowlist, IP-Bereiche, Identifier, Ablaufzeiten, temporäre Sperren |
| `server/settings.lua` | Prüft jede empfangene Konfiguration gegen das Schema |
| `server/stats.lua` | Zähler und zusammengefasste Ereignisse bis zum nächsten Sync |
| `server/attack.lua` | Erkennung/Verlauf des Under-attack-Modus |
| `server/known.lua` | „Bekannte Spieler“ (für den Under-attack-Modus), gespeichert in `known.json` |
| `server/players.lua` | Wer steckt hinter welcher Server-ID (IP, Identifier, Name) |
| `server/cache.lua` | Speichert/lädt Konfiguration und Listen (`cache.json`) |
| `server/guard_connect.lua` | Entscheidung bei jedem `playerConnecting` |
| `server/guard_events.lua` | Explosionen, Partikel, Feuer, Projektile, Entities, Chat, Entity-Lockdown |
| `server/sync.lua` | HTTP-Verbindung zum Backend (Wiederholung, Backoff, Batch-Dedup) |
| `server/main.lua` | Verdrahtung, Konsolenbefehl, Exports |

## Konsole

```
fxshield status                       Zustand, Revisionen, aktive Module, letzte Minute
fxshield sync                         sofort mit dem Backend abgleichen
fxshield bans                         aktive temporäre Sperren
fxshield ban <ip|identifier> [min]    manuell sperren (Standard 60 min)
fxshield unban <ip|identifier>        temporäre Sperre aufheben
```

## Exports

```lua
exports.fxshield:isBlocked('203.0.113.7')              -- IP oder 'license:…' → true/false
exports.fxshield:isUnderAttack()                       -- true solange der Under-attack-Modus Einschränkungen anwendet
exports.fxshield:allow(source, 'shop:buy', 5, 10)      -- max. 5 Aufrufe / 10 s pro Spieler; false = abbrechen
exports.fxshield:ban('license:…', 3600, 'Grund')       -- temporär sperren
exports.fxshield:unban('license:…')
```

Beispiel für ein eigenes, besonders gefährdetes Event:

```lua
RegisterNetEvent('shop:buy', function(item)
    if not exports.fxshield:allow(source, 'shop:buy', 5, 10) then return end
    -- … normale Verarbeitung …
end)
```

## Verhalten, auf das du dich verlassen kannst

* **Fail-open:** Wirft ein Handler dieser Resource einen Fehler, wird der Spieler durchgelassen und der Fehler (gedrosselt) geloggt.
* **Eigene Allowlist** (`Config.LocalAllowlist`) wird nie angefasst. Platzhalter-Adressen (`127.x.x.x`, `0.0.0.0`) gelten als „IP unbekannt“.
* **Backend weg?** Es gelten die zuletzt empfangenen Einstellungen/Listen aus `cache.json`; Statistik wird nachgeliefert.
* **Speicher begrenzt:** Rate-Limit-Tabellen, Listen (20 000 Einträge), bekannte Spieler (50 000) und Ereignispuffer haben feste Obergrenzen.
* Der API-Key wird weder geloggt noch an Clients gesendet.

## Tests

```bash
lua5.4 resource/tests/run.lua                  # vom Repository-Wurzelverzeichnis aus
```
