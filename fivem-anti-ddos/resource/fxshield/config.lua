Config = {}

-- ─────────────────────────────────────────────────────────────────────────────
--  Connection to your FX Shield backend
--
--  Recommended: put these two lines into your server.cfg (the key then never
--  lives inside the resource folder). Use `set`, NEVER `setr` / `sets` – those
--  would publish the key to every player.
--
--      set fxshield_url "https://shield.example.com"
--      set fxshield_key "fxs_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
--      ensure fxshield
--
--  `ensure fxshield` should be one of the FIRST resources in your server.cfg.
-- ─────────────────────────────────────────────────────────────────────────────
Config.BackendUrl = GetConvar('fxshield_url', '')
Config.ApiKey = GetConvar('fxshield_key', '')

-- ─────────────────────────────────────────────────────────────────────────────
--  Local safety net – works even when the backend is unreachable
--
--  Everything listed here is NEVER blocked, kicked or rate-limited by FX Shield,
--  no matter what the dashboard says. Put yourself (and your staff) here so a
--  wrong setting can never lock you out of your own server.
--  Accepts IPv4 addresses, IPv4 CIDR ranges (203.0.113.0/24) and identifiers.
-- ─────────────────────────────────────────────────────────────────────────────
Config.LocalAllowlist = {
    -- 'license:0123456789abcdef0123456789abcdef01234567',
    -- 'discord:123456789012345678',
    -- '203.0.113.7',
}

-- Players with this ACE permission skip the in-game checks (event / entity / chat guards):
--     add_ace group.admin fxshield.bypass allow
Config.BypassAce = 'fxshield.bypass'

-- Print extra diagnostics to the server console (or: set fxshield_debug true)
Config.Debug = GetConvar('fxshield_debug', 'false') == 'true'
