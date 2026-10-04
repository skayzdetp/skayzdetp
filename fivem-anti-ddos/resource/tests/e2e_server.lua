-- ─────────────────────────────────────────────────────────────────────────────
--  End-to-end driver: runs the REAL resource against a REAL backend over HTTP.
--  Started by backend/test/e2e-resource.test.ts, which talks to it with JSON lines:
--      stdin  → {"op":"advance","ms":12000}
--      stdout ← {"ok":true,"result":…}
--  PerformHttpRequest is implemented with curl, so every sync is a genuine HTTP round trip.
-- ─────────────────────────────────────────────────────────────────────────────

local here = (arg and arg[0] or 'resource/tests/e2e_server.lua'):match('^(.*)[/\\][^/\\]*$') or '.'
package.path = here .. '/?.lua;' .. package.path

local Harness = require('harness')
Harness.defaultDir = here .. '/../fxshield'
local json = Harness.json

local url = assert(os.getenv('FXS_URL'), 'FXS_URL missing')
local key = assert(os.getenv('FXS_KEY'), 'FXS_KEY missing')

local H = Harness.new({
    epoch = tonumber(os.getenv('FXS_EPOCH') or ''),
    convars = { fxshield_url = url, fxshield_key = key, sv_maxclients = '48', onesync = 'on', sv_projectName = 'E2E Server' },
})
local FXS = H.env.FXS

local function shellQuote(s)
    return "'" .. tostring(s):gsub("'", "'\\''") .. "'"
end

-- a real HTTP round trip (blocking – the Node side keeps serving while we wait)
H.autoRespond = function(req)
    local tmp = os.tmpname()
    local f = assert(io.open(tmp, 'wb'))
    f:write(req.body or '')
    f:close()
    local args = {}
    for k, v in pairs(req.headers) do args[#args + 1] = '-H ' .. shellQuote(k .. ': ' .. v) end
    local cmd = ('curl -sS --noproxy "*" -m 15 -X %s %s --data-binary @%s -o %s -w "%%{http_code}" %s 2>/dev/null'):format(
        req.method, table.concat(args, ' '), shellQuote(tmp), shellQuote(tmp .. '.out'), shellQuote(req.url))
    local p = io.popen(cmd)
    local status = p:read('a')
    p:close()
    local out = io.open(tmp .. '.out', 'rb')
    local body = out and out:read('a') or ''
    if out then out:close() end
    os.remove(tmp)
    os.remove(tmp .. '.out')
    return tonumber(status) or 0, body
end

local ops = {}

function ops.advance(c)
    H.advance(c.ms)
end

function ops.enter(c)
    local r = H.playerEnters({ src = c.src, ip = c.ip, license = c.license, name = c.name, ids = c.ids })
    return { rejected = r.rejected, reason = r.reason }
end

function ops.connect(c)
    local r = H.connect({ src = c.src, ip = c.ip, license = c.license, name = c.name, ids = c.ids })
    return { rejected = r.rejected, reason = r.reason }
end

function ops.drop(c)
    H.drop(c.src)
end

function ops.fire(c)
    local args = c.args or {}
    local cancelled = H.fire(c.event, c.src, table.unpack(args))
    return { cancelled = cancelled }
end

function ops.syncNow()
    FXS.Sync.syncNow()
    H.advance(100)
end

--- Sync until everything is delivered (nothing in flight, nothing buffered).
function ops.flush()
    for _ = 1, 8 do
        FXS.Sync.syncNow()
        H.advance(100)
        if not FXS.Sync.inflight and not FXS.Stats.hasData() then break end
    end
end

function ops.state()
    return {
        connected = FXS.Sync.connected,
        lastError = FXS.Sync.lastError,
        failures = FXS.Sync.failures,
        configRev = FXS.Settings.rev,
        listsRev = FXS.Lists.rev,
        config = FXS.Settings.cfg,
        blocked = FXS.Lists.remote.block.count,
        allowed = FXS.Lists.remote.allow.count,
        attack = FXS.Attack.isAttackState(),
        inflightSeq = FXS.Sync.inflight and FXS.Sync.inflight.seq or 0,
        requests = #H.requests,
        session = FXS.Sync.session,
    }
end

function ops.log()
    return H.log()
end

for line in io.lines() do
    local ok, cmd = pcall(json.decode, line)
    local reply
    if not ok or type(cmd) ~= 'table' then
        reply = { ok = false, error = 'bad json' }
    elseif not ops[cmd.op] then
        reply = { ok = false, error = 'unknown op ' .. tostring(cmd.op) }
    else
        local success, result = pcall(ops[cmd.op], cmd)
        if success then
            reply = { ok = true, result = result }
        else
            reply = { ok = false, error = tostring(result) }
        end
    end
    io.write(json.encode(reply), '\n')
    io.flush()
end
