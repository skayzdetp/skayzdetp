-- ─────────────────────────────────────────────────────────────────────────────
--  Test harness: runs the real resource files against a mocked FiveM server.
--  Every Harness.new() builds a fresh Lua environment, so tests never share state.
--  The mock follows FiveM's behaviour where it matters for this resource:
--    * event handlers see the sender in the global `source`; CancelEvent() marks the event cancelled
--    * Wait()/CreateThread() run on a virtual clock (H.advance), os.time() follows it
--    * json.encode turns EMPTY tables into [] (like FiveM's json library)
-- ─────────────────────────────────────────────────────────────────────────────

local Harness = {}

-- ─── JSON (compatible with FiveM's json for the cases we use) ───────────────

local json = {}

local escapes = { ['"'] = '\\"', ['\\'] = '\\\\', ['\b'] = '\\b', ['\f'] = '\\f', ['\n'] = '\\n', ['\r'] = '\\r', ['\t'] = '\\t' }

local function encodeString(s)
    return '"' .. s:gsub('[%c"\\]', function(c) return escapes[c] or ('\\u%04x'):format(c:byte()) end) .. '"'
end

local function isArray(t)
    local n = 0
    for k in pairs(t) do
        if math.type(k) ~= 'integer' or k < 1 then return false end
        n = n + 1
    end
    return n == #t
end

local function encode(v, out)
    local tv = type(v)
    if v == nil then
        out[#out + 1] = 'null'
    elseif tv == 'boolean' then
        out[#out + 1] = tostring(v)
    elseif tv == 'number' then
        if v ~= v or v == math.huge or v == -math.huge then error('cannot encode NaN/Infinity') end
        out[#out + 1] = math.type(v) == 'integer' and tostring(v) or ('%.14g'):format(v)
    elseif tv == 'string' then
        if not utf8.len(v) then error('invalid UTF-8 in string: ' .. v:gsub('[^%g ]', '?')) end
        out[#out + 1] = encodeString(v)
    elseif tv == 'table' then
        if next(v) == nil or isArray(v) then -- empty tables become [] exactly like FiveM
            out[#out + 1] = '['
            for i = 1, #v do
                if i > 1 then out[#out + 1] = ',' end
                encode(v[i], out)
            end
            out[#out + 1] = ']'
        else
            local keys = {}
            for k in pairs(v) do keys[#keys + 1] = tostring(k) end
            table.sort(keys)
            out[#out + 1] = '{'
            for i, k in ipairs(keys) do
                if i > 1 then out[#out + 1] = ',' end
                out[#out + 1] = encodeString(k) .. ':'
                local val = v[k]
                if val == nil then val = v[tonumber(k)] end
                encode(val, out)
            end
            out[#out + 1] = '}'
        end
    else
        error('cannot encode ' .. tv)
    end
end

function json.encode(v)
    local out = {}
    encode(v, out)
    return table.concat(out)
end

function json.decode(s)
    local pos = 1
    local function ws() pos = s:find('[^ \t\r\n]', pos) or #s + 1 end
    local function fail(msg) error(('json: %s at position %d'):format(msg, pos), 0) end
    local parseValue

    local function parseString()
        pos = pos + 1
        local buf = {}
        while true do
            local c = s:sub(pos, pos)
            if c == '' then fail('unterminated string') end
            if c == '"' then pos = pos + 1; break end
            if c == '\\' then
                local e = s:sub(pos + 1, pos + 1)
                local map = { ['"'] = '"', ['\\'] = '\\', ['/'] = '/', b = '\b', f = '\f', n = '\n', r = '\r', t = '\t' }
                if map[e] then
                    buf[#buf + 1] = map[e]
                    pos = pos + 2
                elseif e == 'u' then
                    local cp = tonumber(s:sub(pos + 2, pos + 5), 16) or fail('bad \\u escape')
                    pos = pos + 6
                    if cp >= 0xD800 and cp <= 0xDBFF and s:sub(pos, pos + 1) == '\\u' then
                        local lo = tonumber(s:sub(pos + 2, pos + 5), 16) or fail('bad surrogate')
                        cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00)
                        pos = pos + 6
                    end
                    buf[#buf + 1] = utf8.char(cp)
                else
                    fail('bad escape')
                end
            else
                buf[#buf + 1] = c
                pos = pos + 1
            end
        end
        return table.concat(buf)
    end

    function parseValue()
        ws()
        local c = s:sub(pos, pos)
        if c == '{' then
            pos = pos + 1
            local t = {}
            ws()
            if s:sub(pos, pos) == '}' then pos = pos + 1; return t end
            while true do
                ws()
                if s:sub(pos, pos) ~= '"' then fail('expected string key') end
                local k = parseString()
                ws()
                if s:sub(pos, pos) ~= ':' then fail('expected :') end
                pos = pos + 1
                t[k] = parseValue() -- null -> nil: the key simply does not exist
                ws()
                local d = s:sub(pos, pos)
                pos = pos + 1
                if d == '}' then break end
                if d ~= ',' then fail('expected , or }') end
            end
            return t
        elseif c == '[' then
            pos = pos + 1
            local t, n = {}, 0
            ws()
            if s:sub(pos, pos) == ']' then pos = pos + 1; return t end
            while true do
                n = n + 1
                t[n] = parseValue()
                ws()
                local d = s:sub(pos, pos)
                pos = pos + 1
                if d == ']' then break end
                if d ~= ',' then fail('expected , or ]') end
            end
            return t
        elseif c == '"' then
            return parseString()
        elseif s:sub(pos, pos + 3) == 'true' then
            pos = pos + 4
            return true
        elseif s:sub(pos, pos + 4) == 'false' then
            pos = pos + 5
            return false
        elseif s:sub(pos, pos + 3) == 'null' then
            pos = pos + 4
            return nil
        else
            local num = s:match('^-?%d+%.?%d*[eE]?[+-]?%d*', pos)
            if not num or num == '' then fail('unexpected character') end
            pos = pos + #num
            local n = tonumber(num)
            return math.tointeger(n) or n
        end
    end

    local value = parseValue()
    ws()
    if pos <= #s then fail('trailing data') end
    return value
end

Harness.json = json

-- ─── manifest ───────────────────────────────────────────────────────────────

--- Evaluate fxmanifest.lua with a recording environment.
function Harness.readManifest(dir)
    local m = { server_scripts = {} }
    local env = setmetatable({}, {
        __index = function(_, key)
            return function(value) m[key] = value end
        end,
    })
    local chunk = assert(loadfile(dir .. '/fxmanifest.lua', 't', env))
    chunk()
    return m
end

-- ─── the mock server ────────────────────────────────────────────────────────

local function randomHex(n)
    local t = {}
    for i = 1, n do t[i] = ('%x'):format(math.random(0, 15)) end
    return table.concat(t)
end

--- opts: { dir, convars = {…}, files = {…} (pre-existing resource files), epoch, load = false, config = function(env) … end }
function Harness.new(opts)
    opts = opts or {}
    local dir = opts.dir or os.getenv('FXSHIELD_DIR') or Harness.defaultDir or 'resource/fxshield'

    local H = {
        dir = dir,
        nowMs = opts.startMs or 60000, -- server uptime
        epoch = opts.epoch or 1700000000,
        convars = {},
        files = opts.files or {},
        out = {},
        handlers = {},
        threads = {},
        timeouts = {},
        requests = {},
        commands = {},
        exports = {},
        kicks = {},
        lockdown = {},
        pdata = {}, -- all known players (connecting or joined): src -> { ip, ids, name, bucket }
        joined = {}, -- src -> true once playerJoining happened
        aces = {},
        entities = {},
        canceled = false,
    }
    for k, v in pairs(opts.convars or {}) do H.convars[k] = v end

    local env = setmetatable({}, { __index = _G })
    H.env = env
    env._G = env
    env.json = json

    env.print = function(...)
        local parts = {}
        for i = 1, select('#', ...) do parts[#parts + 1] = tostring((select(i, ...))) end
        local line = table.concat(parts, '\t')
        H.out[#H.out + 1] = line
        if H.verbose then io.write(line, '\n') end
    end

    env.os = setmetatable({
        time = function(t)
            if t then return os.time(t) end
            return H.epoch + H.nowMs // 1000
        end,
        clock = function() return H.nowMs / 1000 end,
    }, { __index = os })

    -- natives ----------------------------------------------------------------
    env.GetGameTimer = function() return H.nowMs end
    env.GetConvar = function(name, default)
        local v = H.convars[name]
        if v == nil then return default end
        return tostring(v)
    end
    env.GetConvarInt = function(name, default)
        local v = H.convars[name]
        if v == nil then return default end
        return tonumber(v) or default
    end
    env.GetCurrentResourceName = function() return 'fxshield' end
    env.GetResourceMetadata = function(_, key)
        if key == 'version' then return H.manifest.version end
        return nil
    end
    env.LoadResourceFile = function(_, file) return H.files[file] end
    env.SaveResourceFile = function(_, file, data)
        H.files[file] = data
        return true
    end

    env.AddEventHandler = function(name, fn)
        H.handlers[name] = H.handlers[name] or {}
        table.insert(H.handlers[name], fn)
    end
    env.RegisterNetEvent = env.AddEventHandler
    env.CancelEvent = function() H.canceled = true end
    env.WasEventCanceled = function() return H.canceled end

    env.CreateThread = function(fn)
        table.insert(H.threads, { co = coroutine.create(fn), wake = H.nowMs })
    end
    env.Wait = function(ms) coroutine.yield(ms or 0) end
    env.SetTimeout = function(ms, fn) table.insert(H.timeouts, { at = H.nowMs + ms, fn = fn }) end

    env.PerformHttpRequest = function(url, cb, method, data, headers)
        local req = { url = url, method = method or 'GET', body = data, headers = headers or {}, cb = cb, at = H.nowMs }
        if data and data ~= '' then
            local ok, decoded = pcall(json.decode, data)
            if ok then req.json = decoded end
        end
        table.insert(H.requests, req)
        if H.autoRespond then
            local status, body = H.autoRespond(req)
            table.insert(H.timeouts, { at = H.nowMs + 20, fn = function() cb(status, body, {}) end })
        end
    end

    env.RegisterCommand = function(name, fn) H.commands[name] = fn end
    env.exports = setmetatable({}, {
        __call = function(_, name, fn) H.exports[name] = fn end,
    })

    local function pd(src) return H.pdata[tonumber(src)] end
    env.GetPlayers = function()
        local list = {}
        for id in pairs(H.joined) do list[#list + 1] = tostring(id) end
        table.sort(list, function(a, b) return tonumber(a) < tonumber(b) end)
        return list
    end
    env.GetNumPlayerIndices = function()
        local n = 0
        for _ in pairs(H.joined) do n = n + 1 end
        return n
    end
    env.GetPlayerEndpoint = function(src)
        local p = pd(src)
        if not p then return nil end
        if H.convars.sv_endpointprivacy == 'true' then return '0.0.0.0' end
        return p.ip
    end
    env.GetPlayerIdentifiers = function(src)
        local p = pd(src)
        if not p then return {} end
        local list = {}
        for _, id in ipairs(p.ids) do list[#list + 1] = id end
        if H.convars.sv_endpointprivacy ~= 'true' and p.ip then list[#list + 1] = 'ip:' .. p.ip end
        return list
    end
    env.GetPlayerName = function(src)
        local p = pd(src)
        return p and p.name or nil
    end
    env.GetPlayerRoutingBucket = function(src)
        local p = pd(src)
        return p and p.bucket or 0
    end
    env.IsPlayerAceAllowed = function(src, ace)
        local a = H.aces[tonumber(src)]
        return a and a[ace] or false
    end
    env.DropPlayer = function(src, reason)
        table.insert(H.kicks, { src = tonumber(src), reason = reason })
        if H.joined[tonumber(src)] then H.drop(src) end
    end

    env.NetworkGetEntityOwner = function(e)
        local ent = H.entities[e]
        return ent and ent.owner or 0
    end
    env.GetEntityType = function(e)
        local ent = H.entities[e]
        return ent and ent.type or 0
    end
    env.GetEntityPopulationType = function(e)
        local ent = H.entities[e]
        return ent and ent.pop or 7
    end
    env.SetRoutingBucketEntityLockdownMode = function(bucket, mode) H.lockdown[bucket] = mode end

    -- engine ----------------------------------------------------------------

    --- Trigger a server event as `src`. Returns true when a handler cancelled it.
    function H.fire(name, src, ...)
        H.canceled = false
        env.source = src
        for _, fn in ipairs(H.handlers[name] or {}) do fn(...) end
        env.source = nil
        return H.canceled
    end

    local function stepThreads()
        local ran = false
        for i = #H.threads, 1, -1 do
            local th = H.threads[i]
            if coroutine.status(th.co) == 'dead' then
                table.remove(H.threads, i)
            elseif th.wake <= H.nowMs then
                local ok, wait = coroutine.resume(th.co)
                if not ok then error('thread crashed: ' .. tostring(wait), 0) end
                th.wake = H.nowMs + math.max(1, tonumber(wait) or 0)
                ran = true
            end
        end
        local due = {}
        for i = #H.timeouts, 1, -1 do
            if H.timeouts[i].at <= H.nowMs then
                table.insert(due, 1, table.remove(H.timeouts, i))
            end
        end
        for _, t in ipairs(due) do
            t.fn()
            ran = true
        end
        return ran
    end

    --- Move the virtual clock forward, running threads and timeouts that become due.
    function H.advance(ms)
        local target = H.nowMs + ms
        while true do
            stepThreads()
            local nextAt = target
            for _, th in ipairs(H.threads) do if th.wake < nextAt then nextAt = th.wake end end
            for _, t in ipairs(H.timeouts) do if t.at < nextAt then nextAt = t.at end end
            if nextAt <= H.nowMs then nextAt = H.nowMs + 1 end
            if nextAt >= target then break end
            H.nowMs = nextAt
        end
        H.nowMs = target
        stepThreads()
    end

    function H.seconds(n) H.advance(n * 1000) end

    -- players ---------------------------------------------------------------

    --- Register a player's data so the natives can answer. p: { src, ip, license, name, ids = {extra identifiers} }
    function H.player(p)
        local src = p.src
        local ids = {}
        if p.license ~= false then ids[#ids + 1] = 'license:' .. (p.license or randomHex(40)) end
        for _, id in ipairs(p.ids or {}) do ids[#ids + 1] = id end
        H.pdata[src] = { ip = p.ip or '198.51.100.7', ids = ids, name = p.name or ('Player' .. src), bucket = p.bucket }
        return H.pdata[src]
    end

    --- Fire playerConnecting. Returns { rejected = bool, reason = string|nil }.
    function H.connect(p)
        H.player(p)
        local reason
        local deferrals = { defer = function() end, update = function() end, done = function() end }
        local rejected = H.fire('playerConnecting', p.src, H.pdata[p.src].name, function(r) reason = r end, deferrals)
        return { rejected = rejected, reason = reason }
    end

    function H.join(p)
        if not H.pdata[p.src] then H.player(p) end
        H.joined[p.src] = true
        H.fire('playerJoining', p.src, p.src)
    end

    function H.drop(src)
        H.joined[tonumber(src)] = nil
        H.fire('playerDropped', tonumber(src), 'left')
    end

    --- Connect and, when accepted, join – like a real player.
    function H.playerEnters(p)
        local r = H.connect(p)
        if not r.rejected then H.join(p) end
        return r
    end

    function H.entity(handle, owner, etype, pop)
        H.entities[handle] = { owner = owner, type = etype or 2, pop = pop or 7 }
        return handle
    end

    --- Events the console printed, as one string (for assertions).
    function H.log()
        return table.concat(H.out, '\n')
    end

    -- load the resource ------------------------------------------------------
    H.manifest = Harness.readManifest(dir)
    if opts.config then opts.config(env, H) end

    function H.load()
        for _, file in ipairs(H.manifest.server_scripts) do
            local chunk, err = loadfile(dir .. '/' .. file, 't', env)
            if not chunk then error(err, 0) end
            chunk()
        end
        return H
    end

    if opts.load ~= false then H.load() end
    return H
end

return Harness
