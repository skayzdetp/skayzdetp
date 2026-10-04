FXS = FXS or {}

local U = {}
FXS.Util = U

-- ─── numbers / time ─────────────────────────────────────────────────────────

function U.clamp(n, lo, hi)
    if n < lo then return lo end
    if n > hi then return hi end
    return n
end

--- Wall-clock seconds (unix time).
function U.now()
    return os.time()
end

--- Monotonic milliseconds (server uptime). Falls back to the wall clock (1 s resolution) if the native is missing.
function U.nowMs()
    if GetGameTimer then return GetGameTimer() end
    return os.time() * 1000
end

function U.randomId(len)
    local chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
    local out = {}
    for i = 1, len or 12 do
        local n = math.random(1, #chars)
        out[i] = chars:sub(n, n)
    end
    return table.concat(out)
end

-- ─── logging ────────────────────────────────────────────────────────────────

function U.log(msg)
    print(('^5[fxshield]^7 %s'):format(msg))
end

function U.warn(msg)
    print(('^3[fxshield] WARNING:^7 %s'):format(msg))
end

function U.err(msg)
    print(('^1[fxshield] ERROR:^7 %s'):format(msg))
end

function U.debug(msg)
    if Config and Config.Debug then print(('^8[fxshield] debug:^7 %s'):format(msg)) end
end

local throttled = {}
--- Print `msg` at most once per `intervalSec` for the same `key` (keeps the console readable under attack).
function U.logThrottled(key, intervalSec, level, msg)
    local now = U.now()
    local last = throttled[key]
    if last and now - last < intervalSec then return false end
    throttled[key] = now
    local fn = U[level] or U.log
    fn(msg)
    return true
end

-- ─── text ───────────────────────────────────────────────────────────────────

--- Make arbitrary text safe to put into JSON: valid UTF-8, no control characters, at most `maxBytes`.
function U.safeText(value, maxBytes)
    local s = tostring(value == nil and '' or value)
    if not utf8.len(s) then
        s = s:gsub('[\128-\255]', '?')
    end
    s = s:gsub('%c', ' ')
    s = s:gsub('^%s+', '')
    s = s:gsub('%s+$', '')
    if maxBytes and #s > maxBytes then
        local cut = maxBytes
        -- never cut inside a multi-byte character
        while cut > 0 do
            local b = s:byte(cut + 1)
            if b and b >= 0x80 and b < 0xC0 then cut = cut - 1 else break end
        end
        s = s:sub(1, cut)
    end
    return s
end

function U.trim(s)
    return (tostring(s):gsub('^%s+', ''):gsub('%s+$', ''))
end

-- ─── IP addresses ───────────────────────────────────────────────────────────

--- "1.2.3.4" -> 16909060 (nil when not a valid dotted-quad IPv4).
function U.parseIpv4(s)
    if type(s) ~= 'string' then return nil end
    local a, b, c, d = s:match('^(%d+)%.(%d+)%.(%d+)%.(%d+)$')
    if not a then return nil end
    a, b, c, d = tonumber(a), tonumber(b), tonumber(c), tonumber(d)
    if a > 255 or b > 255 or c > 255 or d > 255 then return nil end
    return (a << 24) | (b << 16) | (c << 8) | d
end

function U.ipv4ToString(n)
    return ('%d.%d.%d.%d'):format((n >> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255)
end

function U.maskFor(plen)
    return (0xFFFFFFFF << (32 - plen)) & 0xFFFFFFFF
end

--- "203.0.113.0/24" -> network integer, prefix length (nil when invalid). Prefix must be /8../32.
function U.parseCidr(s)
    if type(s) ~= 'string' then return nil end
    local addr, bits = s:match('^([%d%.]+)/(%d+)$')
    if not addr then return nil end
    local n = U.parseIpv4(addr)
    local plen = tonumber(bits)
    if not n or not plen or plen < 8 or plen > 32 then return nil end
    return n & U.maskFor(plen), plen
end

--- Canonical text form of a player endpoint, or nil when it is unusable
--- (empty, 0.0.0.0 as returned with sv_endpointprivacy, garbage).
function U.normalizeIp(raw)
    if type(raw) ~= 'string' then return nil end
    local s = U.trim(raw)
    if s == '' then return nil end

    local v4 = s:match('^(%d+%.%d+%.%d+%.%d+):%d+$') -- "1.2.3.4:30120"
    if v4 then s = v4 end

    local n = U.parseIpv4(s)
    if n then
        if n == 0 then return nil end
        return U.ipv4ToString(n)
    end

    local inner = s:match('^%[([%x:%.]+)%]') or s -- "[::1]:30120"
    local mapped = inner:lower():match('^::ffff:(%d+%.%d+%.%d+%.%d+)$')
    if mapped then return U.normalizeIp(mapped) end
    if inner:find(':', 1, true) and inner:match('^[%x:%.]+$') and inner ~= '::' then
        return inner:lower()
    end
    return nil
end

-- ─── identifiers ────────────────────────────────────────────────────────────

--- Identifier types that are stable enough to rate-limit, allow or ban on.
U.STABLE_ID_TYPES = { license = true, license2 = true, fivem = true, discord = true, steam = true, xbl = true, live = true }

--- Read a player's identifiers: { list = {'license:..', ...}, byType = { license = 'license:..' }, ip = '1.2.3.4'|nil }
function U.identifiers(src)
    local out = { list = {}, byType = {}, ip = nil }
    local ok, raw = pcall(GetPlayerIdentifiers, src)
    if not ok or type(raw) ~= 'table' then return out end
    for _, id in ipairs(raw) do
        if type(id) == 'string' then
            local t, v = id:match('^(%w+):(.+)$')
            if t then
                t = t:lower()
                if t == 'ip' then
                    out.ip = U.normalizeIp(v)
                elseif U.STABLE_ID_TYPES[t] then
                    local full = t .. ':' .. v:lower()
                    out.list[#out.list + 1] = full
                    out.byType[t] = full
                end
            end
        end
    end
    return out
end

function U.licenseOf(ids)
    return ids.byType.license or ids.byType.license2
end

-- ─── misc ───────────────────────────────────────────────────────────────────

function U.countKeys(t)
    local n = 0
    for _ in pairs(t) do n = n + 1 end
    return n
end

--- Server started with sv_lan: no Rockstar licenses exist, identity checks would reject everyone.
function U.isLan()
    return GetConvar('sv_lan', 'false') == 'true'
end
