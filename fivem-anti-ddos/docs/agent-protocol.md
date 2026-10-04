# Protokoll Resource ⇄ Backend (Version 1)

Die Resource ruft in einem festen Intervall (Standard 10 s, im Dashboard einstellbar: 5–60 s) **einen** Endpunkt auf.
Er liefert Statistik und Ereignisse nach oben und bringt Einstellungen und Listen nach unten.

Das Backend ruft die Resource nie von sich aus an – der Game-Server braucht also **keinen offenen Port** für das Backend.

## Authentifizierung

```
Authorization: Bearer fxs_<43 Zeichen>
```

* Der Key ist zufällig (256 Bit). Im Backend liegt nur sein SHA-256-Hash.
* Ungültiger oder rotierter Key → `401`, deaktivierter Server → `403`.
* Die Prüfung läuft **vor** dem Einlesen des Bodys (billig für Angreifer ohne Key abzuweisen). Pro IP sind 30 Fehlversuche pro Minute erlaubt,
  danach `429`.

## `GET /api/agent/v1/whoami`

Prüft nur den Key. Antwort: `{ "ok": true, "protocol": 1, "serverId": "srv_…", "name": "…" }`

## `POST /api/agent/v1/sync`

### Request (JSON, max. 512 KiB)

```jsonc
{
  "protocol": 1,
  "resource": { "version": "1.0.0", "session": "k3j9x0a1b2c3", "seq": 12 },
  "server":   { "name": "My RP", "players": 31, "maxPlayers": 64, "tickMs": 4.5,
                "onesync": "on", "build": "FXServer-master SERVER v1.0.0.…", "endpointPrivacy": false },
  "state":    { "configRev": 3, "listsRev": 2, "attack": false },
  "stats":    { "attempts": 120, "allowed": 110, "blocked": 8, "monitored": 2, "kicked": 0, "banned": 1, "cancelled": 14,
                "byRule": { "connectionFlood": { "blocked": 6, "monitored": 0 } } },
  "events":   [ { "ts": 1790000000, "type": "connection_blocked", "rule": "connectionFlood", "severity": "warn",
                  "action": "blocked", "ip": "203.0.113.5", "identifier": "license:…", "name": "Bob",
                  "detail": "11 connection attempts within 30s from this IP (limit 10)", "count": 87 } ]
}
```

| Feld | Bedeutung |
|---|---|
| `resource.session` | Zufällige ID, ändert sich bei jedem Resource-Start |
| `resource.seq` | Laufende Nummer der **Daten-Batches** (Statistik + Events). `0` = dieser Request trägt keine Daten |
| `state.configRev` / `listsRev` | Revision, die die Resource **gerade aktiv** hat (`0` = noch nichts empfangen) |
| `state.attack` | Ob die Resource gerade einen Angriff erkannt hat |
| `stats.*` | Zähler seit dem letzten *bestätigten* Batch |
| `events[]` | Gleiche Ereignisse sind zu einem mit `count` zusammengefasst (max. 60 verschiedene pro Batch, kritische dürfen mehr) |

Hinweise zur Toleranz: Das Backend **klemmt** Zahlen statt abzulehnen, ignoriert ungültige Einzel-Events und akzeptiert `[]` anstelle von `{}`
(FiveMs `json.encode` macht aus leeren Tabellen `[]`). Ein kaputter Statistik-Abschnitt verhindert nie die Auslieferung der Einstellungen.

### Response `200`

```jsonc
{
  "ok": true, "protocol": 1, "serverTime": 1790000010, "pollIntervalSec": 10,
  "ackSeq": 12,
  "configRev": 4, "config": { … },      // nur wenn state.configRev ≠ configRev
  "listsRev": 2,  "lists": { "block": [ { "kind": "ip", "value": "1.2.3.4", "reason": "…", "ttl": 3600 } ], "allow": [ … ] }
                                         // nur wenn state.listsRev ≠ listsRev; kompletter Stand, kein Delta
}
```

* `config` ist die vollständige, **normalisierte** Konfiguration (siehe `backend/src/catalog.ts`).
* `ttl` in den Listen ist „Sekunden bis zum Ablauf“ (`null` = dauerhaft) – so spielt die Uhr des Game-Servers keine Rolle.
* Die Resource validiert alles erneut gegen ihr eigenes Schema (`resource/fxshield/generated/schema.lua`) und führt **niemals** Code aus der Antwort aus.

### Zuverlässigkeit

* **Wiederholung ohne Doppelzählung:** Schlägt ein Sync fehl (Timeout, Backend down), behält die Resource den Batch („in flight“) und sendet ihn
  beim nächsten Versuch **mit derselben `seq`**. Das Backend merkt sich pro Server `(session, seq)` und verarbeitet einen Batch genau einmal.
  Neue Daten sammeln sich währenddessen separat und gehen im nächsten Batch raus.
* **Kein Dauerblocker:** Antwortet das Backend mit `400`/`413`/`422`, wirft die Resource den Batch weg (Wiederholen würde nie klappen).
* **Backoff:** nach Fehlern 10 s → 20 s → 40 s → 60 s; bei `401`/`403`/`426` alle 60 s.
* **Schnelle Bestätigung:** Wurde gerade eine neue Konfiguration/Liste angewendet, sendet die Resource nach ~1 s einen weiteren Sync, damit das Dashboard
  „aktiv“ anzeigen kann.
* **Backend offline:** Die Resource arbeitet mit der letzten Konfiguration weiter (Cache-Datei `cache.json`).

### Fehlercodes

| Status | `error` | Bedeutung |
|---|---|---|
| 400 | `invalid_payload` | Body unlesbar / Pflichtfelder fehlen |
| 401 | `invalid_key` | Key unbekannt oder rotiert |
| 403 | `server_disabled` | Server im Dashboard deaktiviert |
| 413 | – | Body größer als 512 KiB |
| 426 | `unsupported_protocol` | Resource spricht ein anderes Protokoll |
| 429 | `rate_limited` | Zu viele Anfragen (Limit pro Key: `AGENT_RATE_LIMIT_PER_MIN`, Standard 60/min) |

## Ereignis-Typen (`events[].type`)

`connection_blocked`, `auto_ban`, `event_flood`, `entity_spam`, `chat_flood`, `player_kicked`, `attack_started`, `attack_ended`,
`resource_started`, `warning`, `events_dropped`. Weitere Typen sind erlaubt (`^[a-z][a-z0-9_]{0,31}$`) und werden im Dashboard mit ihrem Namen angezeigt.
`severity`: `info` | `warn` | `critical`. `action`: `logged` (auch Monitor-Modus) | `blocked` | `cancelled` | `kicked` | `banned`.
