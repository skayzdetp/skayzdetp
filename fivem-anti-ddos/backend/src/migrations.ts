export interface Migration {
  version: number
  sql: string
}

/** Append-only list. Never edit an applied migration – add a new one instead. */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'user')),
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER
);

-- id = SHA-256 of the session token (the token itself only lives in the cookie)
CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ip         TEXT,
  user_agent TEXT
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expires ON sessions(expires_at);

CREATE TABLE servers (
  id                TEXT PRIMARY KEY,
  owner_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  key_hash          TEXT NOT NULL UNIQUE,   -- SHA-256 of the API key
  key_prefix        TEXT NOT NULL,          -- non-secret start of the key, for display
  enabled           INTEGER NOT NULL DEFAULT 1,
  config_json       TEXT NOT NULL,
  config_rev        INTEGER NOT NULL DEFAULT 1,
  lists_rev         INTEGER NOT NULL DEFAULT 1,
  created_at        INTEGER NOT NULL,

  -- runtime status, written by the resource's sync requests
  last_seen_at      INTEGER,
  last_ip           TEXT,
  resource_version  TEXT,
  server_name       TEXT,
  players           INTEGER,
  max_players       INTEGER,
  tick_ms           REAL,
  onesync           TEXT,
  build             TEXT,
  endpoint_privacy  INTEGER,
  attack_active     INTEGER NOT NULL DEFAULT 0,
  attack_since      INTEGER,
  applied_config_rev INTEGER NOT NULL DEFAULT 0,
  applied_lists_rev  INTEGER NOT NULL DEFAULT 0,
  last_session      TEXT,
  last_seq          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX servers_owner ON servers(owner_id);

CREATE TABLE list_entries (
  id         TEXT PRIMARY KEY,
  server_id  TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  list       TEXT NOT NULL CHECK (list IN ('block', 'allow')),
  kind       TEXT NOT NULL CHECK (kind IN ('ip', 'cidr', 'identifier')),
  value      TEXT NOT NULL,
  reason     TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  UNIQUE (server_id, list, kind, value)
);
CREATE INDEX list_entries_server ON list_entries(server_id, list);

CREATE TABLE events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id   TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  ts          INTEGER NOT NULL,
  type        TEXT NOT NULL,
  rule        TEXT,
  severity    TEXT NOT NULL,
  action      TEXT NOT NULL,
  ip          TEXT,
  identifier  TEXT,
  player_name TEXT,
  detail      TEXT,
  count       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX events_server ON events(server_id, id DESC);
CREATE INDEX events_ts ON events(ts);

-- one row per server and minute
CREATE TABLE stats_minute (
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  bucket    INTEGER NOT NULL,
  attempts  INTEGER NOT NULL DEFAULT 0,
  allowed   INTEGER NOT NULL DEFAULT 0,
  blocked   INTEGER NOT NULL DEFAULT 0,
  monitored INTEGER NOT NULL DEFAULT 0,
  kicked    INTEGER NOT NULL DEFAULT 0,
  banned    INTEGER NOT NULL DEFAULT 0,
  cancelled INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (server_id, bucket)
) WITHOUT ROWID;

CREATE TABLE stats_rule_minute (
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  bucket    INTEGER NOT NULL,
  rule      TEXT NOT NULL,
  blocked   INTEGER NOT NULL DEFAULT 0,
  monitored INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (server_id, bucket, rule)
) WITHOUT ROWID;
`,
  },
]
