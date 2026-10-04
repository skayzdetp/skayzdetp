FXS = FXS or {}

local U = FXS.Util
local Settings = FXS.Settings
local Stats = FXS.Stats
local Lists = FXS.Lists
local Attack = FXS.Attack
local Known = FXS.Known
local Players = FXS.Players
local Cache = FXS.Cache
local Guard = FXS.Guard
local Events = FXS.Events
local Sync = FXS.Sync

local resourceName = GetCurrentResourceName()
FXS.version = GetResourceMetadata(resourceName, 'version', 0) or 'unknown'

-- ─── startup ────────────────────────────────────────────────────────────────

local function startup()
    Lists.setLocalAllowlist(Config.LocalAllowlist)

    local restored = Cache.load()
    local onesync = GetConvar('onesync', 'off')

    U.log(('FX Shield v%s starting (OneSync: %s)'):format(FXS.version, onesync))
    if restored then
        U.log(('restored cached configuration (revision %d) and %d blocklist entries'):format(Settings.rev, Lists.remote.block.count))
    end

    if not Sync.configured() then
        U.warn('no backend configured – running with built-in defaults only. Add to your server.cfg:')
        print('    set fxshield_url "https://your-backend.example.com"')
        print('    set fxshield_key "fxs_…"')
    else
        local problem = Sync.checkUrl()
        if problem then U.err(problem) end
    end

    if onesync == 'off' then
        U.warn('OneSync is disabled: the game event, entity and lockdown guards cannot work (connection protection still does).')
    end
    if GetConvar('sv_endpointprivacy', 'false') == 'true' then
        U.warn('sv_endpointprivacy is enabled: player IP addresses are hidden, IP based protections are inactive.')
    end

    Stats.event({
        type = 'resource_started',
        severity = 'info',
        action = 'logged',
        detail = ('fxshield v%s, OneSync %s'):format(FXS.version, onesync),
    })
end

-- ─── game events ────────────────────────────────────────────────────────────

AddEventHandler('playerConnecting', Guard.onConnecting)

AddEventHandler('playerJoining', function()
    local src = source
    local ok, err = pcall(function()
        local info = Players.add(src)
        Known.add(info.license, U.now())
    end)
    if not ok then U.logThrottled('join-error', 60, 'err', 'playerJoining handler failed: ' .. tostring(err)) end
end)

AddEventHandler('playerDropped', function()
    pcall(Players.remove, source)
end)

AddEventHandler('onResourceStop', function(name)
    if name ~= resourceName then return end
    pcall(Cache.save)
    pcall(Cache.saveKnown, true)
end)

Events.register()
Settings.onChange(function() Events.applyLockdown() end)

-- ─── background work ────────────────────────────────────────────────────────

CreateThread(function()
    -- players that were already online when the resource (re)started
    Wait(0)
    for _, id in ipairs(GetPlayers()) do
        pcall(function()
            local info = Players.add(id)
            Known.add(info.license, U.now())
        end)
    end
end)

CreateThread(function() -- backend sync + attack detector, once per second
    Wait(1500)
    while true do
        pcall(Attack.tick, U.now())
        pcall(Sync.step)
        Wait(1000)
    end
end)

CreateThread(function() -- housekeeping
    local ticks = 0
    while true do
        Wait(30000)
        ticks = ticks + 1
        local nowMs, now = U.nowMs(), U.now()
        pcall(Guard.sweep, nowMs)
        pcall(Events.sweep, nowMs)
        pcall(Lists.sweep, now)
        if Events.lockdownManaged then pcall(Events.applyLockdown) end
        if ticks % 20 == 0 then pcall(Cache.saveKnown) end -- every 10 minutes
    end
end)

CreateThread(function() -- scheduler latency probe (reported as "tick delay")
    local last = U.nowMs()
    local avg = 0
    while true do
        Wait(100)
        local now = U.nowMs()
        local drift = math.max(0, now - last - 100)
        avg = avg == 0 and drift or (avg * 0.9 + drift * 0.1)
        Sync.health.tickMs = math.floor(avg * 10 + 0.5) / 10
        last = now
    end
end)

-- ─── console command ────────────────────────────────────────────────────────

local function status()
    local c = Stats.peek()
    local a, b = Attack.rates(U.now())
    print(('^5[fxshield]^7 v%s   backend: %s'):format(FXS.version, Sync.connected and '^2connected^7' or ('^1not connected^7' .. (Sync.lastError and (' (' .. Sync.lastError .. ')') or ''))))
    print(('  config revision %d, lists revision %d, %d blocked / %d allowed list entries, %d temporary bans'):format(
        Settings.rev, Lists.rev, Lists.remote.block.count, Lists.remote.allow.count, Lists.bans.count))
    print(('  attack mode: %s   last minute: %d attempts, %d rejected   returning players: %d'):format(
        Attack.active() and '^1ACTIVE^7' or (Attack.isAttackState() and 'detected (monitor)' or 'normal'), a, b, Known.count()))
    print(('  since last sync: %d attempts, %d allowed, %d blocked, %d cancelled events, %d kicked, %d banned'):format(
        c.attempts, c.allowed, c.blocked, c.cancelled, c.kicked, c.banned))
    local ids = {}
    for id in pairs(Settings.cfg.protections) do ids[#ids + 1] = id end
    table.sort(ids)
    for _, id in ipairs(ids) do
        local mode = Settings.cfg.protections[id].mode
        if mode ~= 'off' then print(('  %-16s %s'):format(id, mode)) end
    end
end

RegisterCommand('fxshield', function(src, args)
    if src ~= 0 then return end -- console only
    local sub = (args[1] or 'status'):lower()

    if sub == 'status' then
        status()
    elseif sub == 'sync' then
        print(Sync.syncNow() and '^5[fxshield]^7 sync requested' or '^3[fxshield]^7 sync not possible right now (not configured or request in progress)')
    elseif sub == 'bans' then
        local list = Lists.bans:entries(U.now())
        if #list == 0 then print('^5[fxshield]^7 no temporary bans') end
        for _, e in ipairs(list) do
            print(('  %-45s %5ds left   %s'):format(e.value, e.expiresAt - U.now(), e.reason or ''))
        end
    elseif sub == 'ban' then
        local target, minutes = args[2], tonumber(args[3]) or 60
        if not target then return print('usage: fxshield ban <ip|identifier> [minutes]') end
        local n = Lists.ban({ target }, math.floor(minutes * 60), 'console', 'banned', U.now())
        print(n > 0 and ('^5[fxshield]^7 banned %s for %d minutes'):format(target, minutes) or '^1[fxshield]^7 not a valid IP / identifier')
    elseif sub == 'unban' then
        if not args[2] then return print('usage: fxshield unban <ip|identifier>') end
        print(Lists.unban(args[2]) and '^5[fxshield]^7 removed' or '^3[fxshield]^7 no such temporary ban')
    else
        print('usage: fxshield [status|sync|bans|ban <ip|identifier> [minutes]|unban <ip|identifier>]')
    end
end, true)

-- ─── exports for other resources ────────────────────────────────────────────

--- exports.fxshield:isBlocked('1.2.3.4' | 'license:…') -> boolean
exports('isBlocked', function(value)
    local kind, v = Lists.classify(value)
    if not kind then return false end
    local ip = kind ~= 'identifier' and v or nil
    local ids = kind == 'identifier' and { v } or nil
    return Lists.isBlocked(ip, ids, U.now()) ~= nil
end)

--- exports.fxshield:isUnderAttack() -> boolean
exports('isUnderAttack', function()
    return Attack.active()
end)

--- Rate-limit your OWN server events:  if not exports.fxshield:allow(source, 'myresource:buy', 5, 10) then return end
--- (at most `limit` calls per `windowSec` per player; allowlisted / bypass players always pass)
exports('allow', function(src, key, limit, windowSec)
    src = tonumber(src)
    if not src or src <= 0 then return true end
    limit, windowSec = tonumber(limit) or 10, tonumber(windowSec) or 1
    local over = Events.over('ext:' .. tostring(key), src, limit, windowSec, U.nowMs())
    if not over then return true end
    return Players.isExempt(src, U.now())
end)

--- exports.fxshield:ban('1.2.3.4' | 'license:…', seconds, reason) -> boolean
exports('ban', function(value, seconds, reason)
    return Lists.ban({ value }, math.floor(tonumber(seconds) or 3600), tostring(reason or 'export'), 'banned', U.now()) > 0
end)

exports('unban', function(value)
    return Lists.unban(value)
end)

startup()
