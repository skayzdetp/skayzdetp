-- ─────────────────────────────────────────────────────────────────────────
-- AUTO-GENERATED from backend/src/catalog.ts  (npm run gen:lua-schema)
-- Do not edit by hand – changes will be overwritten.
-- It describes every setting the dashboard can change (type, limits, default),
-- so the resource can validate whatever it receives from the backend.
-- ─────────────────────────────────────────────────────────────────────────

FXS = FXS or {}
FXS.CONFIG_VERSION = 1

FXS.Schema = {
    general = {
        pollIntervalSec = { type = 'int', min = 5, max = 60, default = 10 },
    },

    protections = {
        connectionFlood = {
            modes = { 'off', 'monitor', 'enforce' },
            default = 'enforce',
            fields = {
                maxAttemptsPerIp = { type = 'int', min = 1, max = 200, default = 10 },
                maxAttemptsPerLicense = { type = 'int', min = 1, max = 200, default = 6 },
                windowSec = { type = 'int', min = 5, max = 600, default = 30 },
                banSec = { type = 'int', min = 0, max = 604800, default = 300 },
            },
        },
        playersPerIp = {
            modes = { 'off', 'monitor', 'enforce' },
            default = 'monitor',
            fields = {
                maxPlayers = { type = 'int', min = 1, max = 128, default = 4 },
            },
        },
        identityCheck = {
            modes = { 'off', 'monitor', 'enforce' },
            default = 'enforce',
            fields = {
                requireLicense = { type = 'bool', default = true },
                maxNameLength = { type = 'int', min = 8, max = 200, default = 100 },
                blockHiddenChars = { type = 'bool', default = true },
                blockEmptyName = { type = 'bool', default = true },
            },
        },
        attackMode = {
            modes = { 'off', 'monitor', 'auto', 'on' },
            default = 'auto',
            fields = {
                triggerBlockedPerMin = { type = 'int', min = 5, max = 10000, default = 40 },
                triggerAttemptsPerMin = { type = 'int', min = 20, max = 100000, default = 600 },
                minDurationSec = { type = 'int', min = 30, max = 3600, default = 180 },
                newPlayers = { type = 'select', options = { 'allow', 'block' }, default = 'block' },
                limitPercent = { type = 'int', min = 10, max = 100, default = 50 },
            },
        },
        gameEventFlood = {
            modes = { 'off', 'monitor', 'enforce' },
            default = 'enforce',
            fields = {
                windowSec = { type = 'int', min = 1, max = 60, default = 5 },
                maxExplosions = { type = 'int', min = 1, max = 1000, default = 15 },
                maxParticles = { type = 'int', min = 1, max = 2000, default = 120 },
                maxFires = { type = 'int', min = 1, max = 1000, default = 30 },
                maxProjectiles = { type = 'int', min = 1, max = 1000, default = 25 },
                action = { type = 'select', options = { 'cancel', 'kick', 'tempban' }, default = 'cancel' },
                strikes = { type = 'int', min = 1, max = 1000, default = 30 },
                banSec = { type = 'int', min = 60, max = 604800, default = 3600 },
            },
        },
        entitySpam = {
            modes = { 'off', 'monitor', 'enforce' },
            default = 'monitor',
            fields = {
                windowSec = { type = 'int', min = 1, max = 60, default = 10 },
                maxEntities = { type = 'int', min = 5, max = 2000, default = 40 },
                action = { type = 'select', options = { 'cancel', 'kick', 'tempban' }, default = 'cancel' },
                strikes = { type = 'int', min = 1, max = 1000, default = 20 },
                banSec = { type = 'int', min = 60, max = 604800, default = 3600 },
            },
        },
        entityLockdown = {
            modes = { 'off', 'relaxed', 'strict' },
            default = 'off',
            fields = {
            },
        },
        chatFlood = {
            modes = { 'off', 'monitor', 'enforce' },
            default = 'enforce',
            fields = {
                windowSec = { type = 'int', min = 1, max = 60, default = 5 },
                maxMessages = { type = 'int', min = 1, max = 100, default = 8 },
                maxLength = { type = 'int', min = 20, max = 2000, default = 400 },
                action = { type = 'select', options = { 'cancel', 'kick' }, default = 'cancel' },
                strikes = { type = 'int', min = 1, max = 100, default = 10 },
            },
        },
    },

    messages = {
        blocked = { type = 'text', maxLength = 200, default = 'Connection rejected by FX Shield.' },
        banned = { type = 'text', maxLength = 200, default = 'You are banned from this server.' },
        rateLimited = { type = 'text', maxLength = 200, default = 'Too many connection attempts. Please wait a moment and try again.' },
        attackMode = { type = 'text', maxLength = 200, default = 'The server is under attack and currently only accepts returning players. Please try again later.' },
        invalidIdentity = { type = 'text', maxLength = 200, default = 'Your Rockstar license could not be verified.' },
        invalidName = { type = 'text', maxLength = 200, default = 'Your player name contains invalid characters. Please change it and reconnect.' },
        tooManyPerIp = { type = 'text', maxLength = 200, default = 'Too many players are already connected from your network.' },
        kicked = { type = 'text', maxLength = 200, default = 'You were removed from the server for abusive behaviour.' },
    },
}
