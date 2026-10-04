FXS = FXS or {}

local U = FXS.Util
local Settings = FXS.Settings
local Stats = FXS.Stats
local Lists = FXS.Lists
local Attack = FXS.Attack
local Known = FXS.Known
local Players = FXS.Players
local RateLimit = FXS.RateLimit

--- Connection guard: decides for every `playerConnecting` whether the player may come in.
--- Order: allowlist → blocklist / temp bans → connection flood → under-attack gate → identity / name → accounts per IP.
local Guard = {}
FXS.Guard = Guard

Guard.ipLimiter = RateLimit.new()
Guard.licenseLimiter = RateLimit.new()

-- ─── name checks ────────────────────────────────────────────────────────────

--- Control characters, zero-width / invisible characters, bidi overrides, broken UTF-8.
local function hasHiddenChars(name)
    if not utf8.len(name) then return true end
    if name:find('%c') then return true end
    if name:find('\xE2\x80\x8B', 1, true) then return true end -- U+200B zero-width space
    if name:find('\xE2\x81\xA0', 1, true) then return true end -- U+2060 word joiner
    if name:find('\xEF\xBB\xBF', 1, true) then return true end -- U+FEFF zero-width no-break space
    if name:find('\xE2\x80[\xAA-\xAE]') then return true end -- U+202A..202E bidi embeddings / overrides
    if name:find('\xE2\x81[\xA6-\xA9]') then return true end -- U+2066..2069 bidi isolates
    return false
end

local BLANKS = { '\xC2\xA0', '\xE3\x80\x80', '\xE3\x85\xA4', '\xEF\xBE\xA0', '\xE2\x80\xAF', '\xE2\x81\x9F', '\xE1\x9A\x80' }

--- A name that renders as nothing: whitespace, NBSP, Hangul fillers, …
local function looksEmpty(name)
    local s = name
    for _, seq in ipairs(BLANKS) do s = s:gsub(seq, '') end
    s = s:gsub('\xE2\x80[\x80-\x8A]', '') -- U+2000..200A spaces
    s = s:gsub('%s', '')
    return s == ''
end

--- Returns a problem description and the message key, or nil when the identity is fine.
function Guard.checkIdentity(info, cfg)
    if cfg.requireLicense and not U.isLan() and not info.idByType.license and not info.idByType.license2 then
        return 'no Rockstar license identifier', 'invalidIdentity'
    end

    local name = info.name or ''
    if cfg.blockEmptyName and looksEmpty(name) then
        return 'empty player name', 'invalidName'
    end
    local length = utf8.len(name) or #name
    if length > cfg.maxNameLength then
        return ('player name too long (%d characters, limit %d)'):format(length, cfg.maxNameLength), 'invalidName'
    end
    if cfg.blockHiddenChars and hasHiddenChars(name) then
        return 'hidden or control characters in the player name', 'invalidName'
    end
    return nil
end

-- ─── evaluation ─────────────────────────────────────────────────────────────

local function emitBlock(ctx, rule, detail, severity)
    Stats.count('blocked')
    Stats.rule(rule, 'blocked')
    -- the "returning players only" gate must not keep the attack alive by itself
    if rule ~= 'attackMode' then Attack.recordBlocked(ctx.now) end
    Stats.event({
        type = 'connection_blocked',
        rule = rule,
        severity = severity or 'warn',
        action = 'blocked',
        group = ctx.ip or ctx.license,
        ip = ctx.ip,
        identifier = ctx.license,
        name = ctx.name,
        detail = detail,
    })
end

local function emitMonitored(ctx, rule, detail)
    ctx.monitored = true
    Stats.rule(rule, 'monitored')
    Stats.event({
        type = 'connection_blocked',
        rule = rule,
        severity = 'info',
        action = 'logged',
        group = ctx.ip or ctx.license,
        ip = ctx.ip,
        identifier = ctx.license,
        name = ctx.name,
        detail = 'would block: ' .. detail,
    })
end

local function reject(rule, msgKey, detail)
    return { allow = false, rule = rule, msgKey = msgKey, detail = detail }
end

--- Pure decision function (no natives): info = { ip, ids, idByType, license, name } → { allow = bool, rule?, msgKey?, detail? }
function Guard.evaluate(info, now, nowMs)
    local P = Settings.cfg.protections
    Stats.count('attempts')
    Attack.recordAttempt(now)

    local ctx = { ip = info.ip, license = info.license, name = info.name, now = now, monitored = false }

    -- 1. allowlisted players and loopback (local testing) are never touched
    if info.ip == '127.0.0.1' or Lists.isAllowed(info.ip, info.ids, now) then
        Stats.count('allowed')
        return { allow = true, bypass = true }
    end

    -- 2. blocklist / temporary bans
    local entry, source = Lists.isBlocked(info.ip, info.ids, now)
    if entry then
        local rule = source == 'ban' and 'tempBan' or 'blocklist'
        local msgKey = entry.msg or 'banned'
        emitBlock(ctx, rule, entry.reason or 'listed', 'info')
        return reject(rule, msgKey, entry.reason)
    end

    -- 3. connection flood (every attempt is counted, even when a later check rejects it)
    local cf = P.connectionFlood
    if cf.mode ~= 'off' then
        local factor = Attack.limitFactor()
        local maxIp = math.max(1, math.floor(cf.maxAttemptsPerIp * factor))
        local maxLicense = math.max(1, math.floor(cf.maxAttemptsPerLicense * factor))
        local windowMs = cf.windowSec * 1000

        local ipCount = info.ip and Guard.ipLimiter:hit(info.ip, nowMs, windowMs) or 0
        local licenseCount = info.license and Guard.licenseLimiter:hit(info.license, nowMs, windowMs) or 0

        local detail, banKeys
        if ipCount > maxIp then
            detail = ('%d connection attempts within %ds from this IP (limit %d)'):format(ipCount, cf.windowSec, maxIp)
            banKeys = { info.ip }
        elseif licenseCount > maxLicense then
            detail = ('%d connection attempts within %ds with this license (limit %d)'):format(licenseCount, cf.windowSec, maxLicense)
            banKeys = { info.license }
        end

        if detail then
            if cf.mode == 'monitor' then
                emitMonitored(ctx, 'connectionFlood', detail)
            else
                if cf.banSec > 0 then
                    Lists.ban(banKeys, cf.banSec, 'connection flood', 'rateLimited', now)
                    Stats.count('banned')
                    Stats.event({
                        type = 'auto_ban',
                        rule = 'connectionFlood',
                        severity = 'critical',
                        action = 'banned',
                        group = ctx.ip or ctx.license,
                        ip = ctx.ip,
                        identifier = ctx.license,
                        name = ctx.name,
                        detail = detail .. ('; blocked for %ds'):format(cf.banSec),
                    })
                end
                emitBlock(ctx, 'connectionFlood', detail)
                return reject('connectionFlood', 'rateLimited', detail)
            end
        end
    end

    -- 4. under-attack gate: strangers wait, returning players get in
    local gate = Attack.gateMode()
    if gate and P.attackMode.newPlayers == 'block' and not Known.has(info.license) then
        local detail = 'unknown license while the server is under attack'
        if gate == 'monitor' then
            emitMonitored(ctx, 'attackMode', detail)
        else
            emitBlock(ctx, 'attackMode', detail, 'info')
            return reject('attackMode', 'attackMode', detail)
        end
    end

    -- 5. identity / name
    local idc = P.identityCheck
    if idc.mode ~= 'off' then
        local detail, msgKey = Guard.checkIdentity(info, idc)
        if detail then
            if idc.mode == 'monitor' then
                emitMonitored(ctx, 'identityCheck', detail)
            else
                emitBlock(ctx, 'identityCheck', detail)
                return reject('identityCheck', msgKey, detail)
            end
        end
    end

    -- 6. accounts per IP
    local pp = P.playersPerIp
    if pp.mode ~= 'off' and info.ip then
        local connected = Players.perIp[info.ip] or 0
        if connected >= pp.maxPlayers then
            local detail = ('%d players already connected from this IP (limit %d)'):format(connected, pp.maxPlayers)
            if pp.mode == 'monitor' then
                emitMonitored(ctx, 'playersPerIp', detail)
            else
                emitBlock(ctx, 'playersPerIp', detail)
                return reject('playersPerIp', 'tooManyPerIp', detail)
            end
        end
    end

    Stats.count('allowed')
    if ctx.monitored then Stats.count('monitored') end
    return { allow = true }
end

--- `playerConnecting` handler. Errors never block a player (fail open).
function Guard.onConnecting(playerName, setKickReason, deferrals)
    local src = source
    local ok, err = pcall(function()
        local info = Players.collect(src, playerName)
        local verdict = Guard.evaluate(info, U.now(), U.nowMs())
        if not verdict.allow then
            setKickReason(Settings.msg(verdict.msgKey))
            CancelEvent()
        end
    end)
    if not ok then
        U.logThrottled('connect-error', 60, 'err', 'connection check failed, letting the player in: ' .. tostring(err))
    end
end

--- Housekeeping: forget idle rate-limit keys.
function Guard.sweep(nowMs)
    Guard.ipLimiter:sweep(nowMs, 15 * 60 * 1000)
    Guard.licenseLimiter:sweep(nowMs, 15 * 60 * 1000)
end

function Guard.reset()
    Guard.ipLimiter:clear()
    Guard.licenseLimiter:clear()
end
