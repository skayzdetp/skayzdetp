FXS = FXS or {}

local U = FXS.Util
local Settings = FXS.Settings
local Stats = FXS.Stats
local Lists = FXS.Lists
local Attack = FXS.Attack
local Cache = FXS.Cache

--- Talks to the backend: one POST /api/agent/v1/sync every few seconds carries statistics + events up
--- and brings configuration / lists down. See docs/agent-protocol.md.
---
--- Reliability: a batch that could not be delivered is kept ("in flight") and re-sent with the SAME sequence
--- number until the backend answers – the backend de-duplicates, so nothing is lost or counted twice.
local Sync = {}
FXS.Sync = Sync

local PROTOCOL = 1
local REQUEST_TIMEOUT_MS = 30000

Sync.session = U.randomId(12)
Sync.seq = 0
Sync.inflight = nil
Sync.failures = 0
Sync.connected = false
Sync.busy = false
Sync.busySince = 0
Sync.requestId = 0
Sync.nextAt = 0
Sync.pollSec = 10
Sync.lastOk = nil
Sync.lastError = nil
Sync.startedAt = U.now()
Sync.health = { tickMs = nil } -- filled by main.lua's scheduler probe

function Sync.configured()
    return type(Config.BackendUrl) == 'string' and Config.BackendUrl ~= '' and type(Config.ApiKey) == 'string' and Config.ApiKey ~= ''
end

function Sync.url()
    local base = Config.BackendUrl:gsub('%s+', ''):gsub('/+$', '')
    return base .. '/api/agent/v1/sync'
end

--- Validate the configured URL once at startup. Returns an error message or nil.
function Sync.checkUrl()
    local url = Config.BackendUrl or ''
    local scheme, host = url:match('^(https?)://([^/:]+)')
    if not scheme then
        return 'fxshield_url must start with http:// or https://'
    end
    if scheme == 'http' then
        local private = host == 'localhost' or host:match('^127%.') or host:match('^10%.') or host:match('^192%.168%.')
            or host:match('^172%.1[6-9]%.') or host:match('^172%.2%d%.') or host:match('^172%.3[01]%.')
        if not private then
            U.warn('fxshield_url uses plain http:// – your API key travels unencrypted. Put the backend behind https://.')
        end
    end
    return nil
end

local function serverInfo()
    local name = GetConvar('sv_projectName', '')
    if name == '' then name = GetConvar('sv_hostname', '') end
    return {
        name = U.safeText(name, 120),
        players = GetNumPlayerIndices(),
        maxPlayers = GetConvarInt('sv_maxclients', 0),
        tickMs = Sync.health.tickMs,
        onesync = GetConvar('onesync', 'off'),
        build = U.safeText(GetConvar('version', ''), 120),
        endpointPrivacy = GetConvar('sv_endpointprivacy', 'false') == 'true',
    }
end

--- Assemble the request. Re-uses the unacknowledged batch if there is one, else starts a new one.
function Sync.buildPayload()
    if not Sync.inflight and Stats.hasData() then
        Sync.seq = Sync.seq + 1
        local batch = Stats.takeBatch()
        batch.seq = Sync.seq
        Sync.inflight = batch
    end
    local batch = Sync.inflight

    return {
        protocol = PROTOCOL,
        resource = { version = FXS.version, session = Sync.session, seq = batch and batch.seq or 0 },
        server = serverInfo(),
        state = { configRev = Settings.rev, listsRev = Lists.rev, attack = Attack.isAttackState() },
        stats = batch and batch.stats or {},
        events = batch and batch.events or {},
    }
end

local function scheduleNext(delaySec)
    Sync.nextAt = U.nowMs() + math.floor(delaySec * 1000)
end

local function backoffSec()
    local d = Sync.pollSec * (2 ^ (Sync.failures - 1))
    return math.min(60, d)
end

--- mode: 'retry' (exponential backoff) or 'slow' (config problem – retry every 60 s)
function Sync.fail(message, mode)
    Sync.failures = Sync.failures + 1
    Sync.lastError = message
    if Sync.connected then
        Sync.connected = false
        U.warn('lost connection to the backend – protection continues with the last known configuration')
    end
    U.logThrottled('sync-fail-' .. message, 300, 'warn', 'backend sync failed: ' .. message)
    scheduleNext(mode == 'slow' and 60 or backoffSec())
end

--- Process the HTTP answer.
function Sync.handle(status, text)
    status = tonumber(status) or 0

    if status == 200 then
        local ok, data = pcall(json.decode, text or '')
        if not ok or type(data) ~= 'table' or data.ok ~= true then
            return Sync.fail('the backend sent an invalid response', 'retry')
        end

        Sync.inflight = nil -- acknowledged
        local first = not Sync.connected
        Sync.failures, Sync.connected, Sync.lastOk, Sync.lastError = 0, true, U.now(), nil

        local changed = false
        if type(data.config) == 'table' then
            Settings.apply(data.config, tonumber(data.configRev) or (Settings.rev + 1))
            U.log(('configuration updated (revision %d)'):format(Settings.rev))
            changed = true
        end
        if type(data.lists) == 'table' then
            Lists.applySnapshot(data.lists, tonumber(data.listsRev) or (Lists.rev + 1), U.now())
            U.log(('lists updated: %d blocked, %d allowed entries'):format(Lists.remote.block.count, Lists.remote.allow.count))
            changed = true
        end
        if changed then Cache.save() end

        if first then
            U.log(('connected to the backend (config revision %d, %d blocklist entries)'):format(Settings.rev, Lists.remote.block.count))
        end

        Sync.pollSec = U.clamp(tonumber(data.pollIntervalSec) or Settings.cfg.general.pollIntervalSec, 5, 60)
        -- something new was applied: confirm it quickly, so the dashboard shows "applied" within about a second
        scheduleNext(changed and 1 or Sync.pollSec)
        return true
    end

    if status == 401 then
        return Sync.fail('the backend rejected the API key (HTTP 401) – check fxshield_key', 'slow')
    elseif status == 403 then
        return Sync.fail('this server is disabled in the dashboard (HTTP 403)', 'slow')
    elseif status == 426 then
        return Sync.fail('the backend needs a newer version of this resource (HTTP 426)', 'slow')
    elseif status == 400 or status == 413 or status == 422 then
        -- retrying the identical batch can never succeed – drop it instead of blocking all future syncs
        Sync.inflight = nil
        return Sync.fail(('the backend rejected the request (HTTP %d); dropped the pending batch'):format(status), 'retry')
    end
    return Sync.fail(status == 0 and 'the backend is unreachable' or ('the backend answered HTTP %d'):format(status), 'retry')
end

--- Send one sync request now. Returns false when nothing was sent.
function Sync.send()
    if not Sync.configured() then return false end
    if Sync.busy and (U.nowMs() - Sync.busySince) < REQUEST_TIMEOUT_MS then return false end

    local payload = Sync.buildPayload()
    local ok, body = pcall(json.encode, payload)
    if not ok then
        -- should never happen (all strings are sanitised); drop the batch so we cannot get stuck on it
        Sync.inflight = nil
        U.logThrottled('sync-encode', 300, 'err', 'could not encode the sync request: ' .. tostring(body))
        scheduleNext(Sync.pollSec)
        return false
    end

    Sync.busy, Sync.busySince = true, U.nowMs()
    Sync.requestId = Sync.requestId + 1
    local myId = Sync.requestId
    scheduleNext(Sync.pollSec) -- provisional; the answer sets the real next time

    PerformHttpRequest(Sync.url(), function(status, text)
        if myId ~= Sync.requestId then return end -- a newer request replaced this one
        Sync.busy = false
        local handled, err = pcall(Sync.handle, status, text)
        if not handled then
            U.logThrottled('sync-handle', 60, 'err', 'processing the backend answer failed: ' .. tostring(err))
            Sync.fail('unexpected error while processing the answer', 'retry')
        end
    end, 'POST', body, {
        ['Content-Type'] = 'application/json',
        ['Authorization'] = 'Bearer ' .. Config.ApiKey,
        ['User-Agent'] = 'fxshield/' .. tostring(FXS.version),
    })
    return true
end

--- Called every second by the scheduler thread.
function Sync.step()
    if U.nowMs() >= Sync.nextAt then Sync.send() end
end

--- `fxshield sync` – sync as soon as possible.
function Sync.syncNow()
    Sync.nextAt = 0
    Sync.busy = false
    return Sync.send()
end
