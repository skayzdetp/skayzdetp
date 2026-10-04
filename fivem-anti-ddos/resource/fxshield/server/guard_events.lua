FXS = FXS or {}

local U = FXS.Util
local Settings = FXS.Settings
local Stats = FXS.Stats
local Lists = FXS.Lists
local Players = FXS.Players
local RateLimit = FXS.RateLimit

--- In-game abuse guards. They hook events that FiveM / OneSync already expose to server scripts:
---   explosionEvent, ptFxEvent, fireEvent, startProjectileEvent  (OneSync game events, cancellable)
---   entityCreating                                              (OneSync, cancellable)
---   chatMessage                                                 (default `chat` resource)
--- Every handler is wrapped in pcall – a bug here must never break gameplay.
local Events = {}
FXS.Events = Events

local counters = RateLimit.new()
local strikes = RateLimit.new()

-- ─── shared logic ───────────────────────────────────────────────────────────

--- Count one event of `kind` for `src`; returns (isOverLimit, count).
function Events.over(kind, src, limit, windowSec, nowMs)
    local n = counters:hit(kind .. ':' .. tostring(src), nowMs, windowSec * 1000)
    return n > limit, n
end

function Events.punish(rule, p, src, info, detail, now)
    local reason = Settings.msg('kicked')
    if p.action == 'tempban' then
        Lists.ban(Players.banKeys(info), p.banSec, 'abuse: ' .. rule, 'kicked', now)
        Stats.count('banned')
        Stats.event({
            type = 'auto_ban',
            rule = rule,
            severity = 'critical',
            action = 'banned',
            ip = info.ip,
            identifier = info.license,
            name = info.name,
            detail = detail .. ('; banned for %ds'):format(p.banSec),
        })
    else
        Stats.count('kicked')
        Stats.event({
            type = 'player_kicked',
            rule = rule,
            severity = 'critical',
            action = 'kicked',
            ip = info.ip,
            identifier = info.license,
            name = info.name,
            detail = detail,
        })
    end
    pcall(DropPlayer, src, reason)
end

--- A player went over a limit. Returns true when the caller must cancel the event (enforce mode).
function Events.violation(rule, eventType, p, src, detail, now, nowMs)
    local info = Players.get(src)

    if p.mode == 'monitor' then
        Stats.count('monitored')
        Stats.rule(rule, 'monitored')
        Stats.event({
            type = eventType,
            rule = rule,
            severity = 'info',
            action = 'logged',
            ip = info.ip,
            identifier = info.license,
            name = info.name,
            detail = 'would cancel: ' .. detail,
        })
        return false
    end

    Stats.count('cancelled')
    Stats.rule(rule, 'blocked')
    Stats.event({
        type = eventType,
        rule = rule,
        severity = 'warn',
        action = 'cancelled',
        ip = info.ip,
        identifier = info.license,
        name = info.name,
        detail = detail,
    })

    if p.action and p.action ~= 'cancel' then
        local strikeKey = rule .. ':' .. tostring(src)
        if strikes:hit(strikeKey, nowMs, 60000) >= p.strikes then
            strikes:reset(strikeKey)
            Events.punish(rule, p, src, info, detail, now)
        end
    end
    return true
end

--- Shared flow of every limited event. Returns true when the event has to be cancelled.
--- The exemption check (a few table lookups, maybe an ACE call) only runs once a player is over the limit.
local function limited(kind, rule, eventType, p, src, limit, windowSec, what)
    local nowMs = U.nowMs()
    local over, n = Events.over(kind, src, limit, windowSec, nowMs)
    if not over then return false end
    local now = U.now()
    if Players.isExempt(src, now) then return false end
    return Events.violation(rule, eventType, p, src, ('%s: %d within %ds (limit %d)'):format(what, n, windowSec, limit), now, nowMs)
end

local function senderId(sender)
    local id = tonumber(sender)
    if id and id > 0 then return id end
    return nil
end

-- ─── handlers ───────────────────────────────────────────────────────────────

local function gameEvent(kind, field, what)
    return function(sender)
        local p = Settings.get('gameEventFlood')
        if p.mode == 'off' then return end
        local src = senderId(sender)
        if not src then return end
        if limited(kind, 'gameEventFlood', 'event_flood', p, src, p[field], p.windowSec, what) then
            CancelEvent()
        end
    end
end

local onExplosion = gameEvent('explosion', 'maxExplosions', 'explosions')
local onParticle = gameEvent('ptfx', 'maxParticles', 'particle effects')
local onFire = gameEvent('fire', 'maxFires', 'fires')
local onProjectile = gameEvent('projectile', 'maxProjectiles', 'projectiles')

local function onEntityCreating(entity)
    local p = Settings.get('entitySpam')
    if p.mode == 'off' then return end

    local owner = tonumber(NetworkGetEntityOwner(entity))
    if not owner or owner <= 0 then return end -- created by the server / unknown

    -- ambient population (pedestrians, traffic) is created by the game itself – not by scripts
    if GetEntityPopulationType then
        local pop = GetEntityPopulationType(entity)
        if pop and pop >= 1 and pop <= 5 then return end
    end
    local etype = GetEntityType(entity) -- 1 ped, 2 vehicle, 3 object
    if etype ~= 1 and etype ~= 2 and etype ~= 3 then return end

    if limited('entity', 'entitySpam', 'entity_spam', p, owner, p.maxEntities, p.windowSec, 'entities created') then
        CancelEvent()
    end
end

local function onChatMessage(sender, _author, message)
    local p = Settings.get('chatFlood')
    if p.mode == 'off' then return end
    local src = senderId(sender)
    if not src then return end

    local nowMs = U.nowMs()
    local over, n = Events.over('chat', src, p.maxMessages, p.windowSec, nowMs)
    local tooLong = type(message) == 'string' and #message > p.maxLength
    if not over and not tooLong then return end

    local now = U.now()
    if Players.isExempt(src, now) then return end
    local detail
    if tooLong then
        detail = ('chat message of %d bytes (limit %d)'):format(#message, p.maxLength)
    else
        detail = ('chat messages: %d within %ds (limit %d)'):format(n, p.windowSec, p.maxMessages)
    end
    if Events.violation('chatFlood', 'chat_flood', p, src, detail, now, nowMs) then
        CancelEvent()
    end
end

local function guarded(name, fn)
    return function(...)
        local ok, err = pcall(fn, ...)
        if not ok then
            U.logThrottled('events-' .. name, 60, 'err', ('%s handler failed (ignored): %s'):format(name, tostring(err)))
        end
    end
end

function Events.register()
    AddEventHandler('explosionEvent', guarded('explosionEvent', onExplosion))
    AddEventHandler('ptFxEvent', guarded('ptFxEvent', onParticle))
    AddEventHandler('fireEvent', guarded('fireEvent', onFire))
    AddEventHandler('startProjectileEvent', guarded('startProjectileEvent', onProjectile))
    AddEventHandler('entityCreating', guarded('entityCreating', onEntityCreating))
    AddEventHandler('chatMessage', guarded('chatMessage', onChatMessage))
end

-- ─── entity lockdown (FXServer's built-in switch) ───────────────────────────

local LOCKDOWN_MODES = { off = 'inactive', relaxed = 'relaxed', strict = 'strict' }
Events.lockdownManaged = false

--- Apply the configured lockdown mode to the default routing bucket and every bucket players are in.
--- Only touches the setting while it is (or was) managed by FX Shield, so a mode set by another resource survives.
function Events.applyLockdown()
    local mode = Settings.get('entityLockdown').mode
    if mode == 'off' and not Events.lockdownManaged then return false end
    if not SetRoutingBucketEntityLockdownMode then
        U.logThrottled('lockdown-missing', 3600, 'warn', 'this server build has no entity lockdown support (SetRoutingBucketEntityLockdownMode)')
        return false
    end

    local buckets = { [0] = true }
    if GetPlayers and GetPlayerRoutingBucket then
        for _, id in ipairs(GetPlayers()) do
            local ok, bucket = pcall(GetPlayerRoutingBucket, id)
            if ok and type(bucket) == 'number' then buckets[bucket] = true end
        end
    end

    local nativeMode = LOCKDOWN_MODES[mode] or 'inactive'
    for bucket in pairs(buckets) do
        pcall(SetRoutingBucketEntityLockdownMode, bucket, nativeMode)
    end
    Events.lockdownManaged = mode ~= 'off'
    return true
end

function Events.sweep(nowMs)
    counters:sweep(nowMs, 10 * 60 * 1000)
    strikes:sweep(nowMs, 10 * 60 * 1000)
end

function Events.reset()
    counters:clear()
    strikes:clear()
    Events.lockdownManaged = false
end

-- exposed so tests can call the handlers directly
Events.handlers = {
    explosionEvent = onExplosion,
    ptFxEvent = onParticle,
    fireEvent = onFire,
    startProjectileEvent = onProjectile,
    entityCreating = onEntityCreating,
    chatMessage = onChatMessage,
}
