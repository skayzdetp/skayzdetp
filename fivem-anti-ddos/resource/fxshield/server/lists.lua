FXS = FXS or {}

local U = FXS.Util

local Lists = {}
FXS.Lists = Lists

local MAX_ENTRIES = 20000 -- per store; protects memory if something sends absurd lists

-- ─── Store: one set of IPs, CIDR ranges and identifiers ─────────────────────
-- ip:      exact IP text            -> entry
-- id:      "license:abc.."          -> entry
-- cidr:    prefix length -> network -> entry   (looked up per distinct prefix length, not per entry)
local Store = {}
Store.__index = Store

local function newStore()
    return setmetatable({ ip = {}, id = {}, cidr = {}, prefixes = {}, count = 0 }, Store)
end

local function alive(entry, now)
    return entry.expiresAt == nil or entry.expiresAt > now
end

--- kind: 'ip' | 'cidr' | 'identifier'; expiresAt: unix seconds or nil (permanent)
function Store:add(kind, value, reason, expiresAt, msg)
    local entry = { kind = kind, value = value, reason = reason, expiresAt = expiresAt, msg = msg }
    if kind == 'ip' then
        if not self.ip[value] then
            if self.count >= MAX_ENTRIES then return false end
            self.count = self.count + 1
        end
        self.ip[value] = entry
    elseif kind == 'identifier' then
        if not self.id[value] then
            if self.count >= MAX_ENTRIES then return false end
            self.count = self.count + 1
        end
        self.id[value] = entry
    elseif kind == 'cidr' then
        local net, plen = U.parseCidr(value)
        if not net then return false end
        local bucket = self.cidr[plen]
        if not bucket then
            bucket = {}
            self.cidr[plen] = bucket
            self.prefixes[#self.prefixes + 1] = plen
            table.sort(self.prefixes, function(a, b) return a > b end)
        end
        if not bucket[net] then
            if self.count >= MAX_ENTRIES then return false end
            self.count = self.count + 1
        end
        bucket[net] = entry
    else
        return false
    end
    return true
end

--- Find an entry matching the IP (exact or inside a range) or any of the identifiers.
function Store:match(ip, ids, now)
    if ip then
        local e = self.ip[ip]
        if e and alive(e, now) then return e end
        if #self.prefixes > 0 then
            local n = U.parseIpv4(ip)
            if n then
                for _, plen in ipairs(self.prefixes) do
                    local e2 = self.cidr[plen][n & U.maskFor(plen)]
                    if e2 and alive(e2, now) then return e2 end
                end
            end
        end
    end
    if ids then
        for i = 1, #ids do
            local e = self.id[ids[i]]
            if e and alive(e, now) then return e end
        end
    end
    return nil
end

function Store:remove(kind, value)
    if kind == 'ip' then
        if self.ip[value] then self.ip[value] = nil; self.count = self.count - 1; return true end
    elseif kind == 'identifier' then
        if self.id[value] then self.id[value] = nil; self.count = self.count - 1; return true end
    elseif kind == 'cidr' then
        local net, plen = U.parseCidr(value)
        local bucket = net and self.cidr[plen]
        if bucket and bucket[net] then bucket[net] = nil; self.count = self.count - 1; return true end
    end
    return false
end

function Store:sweep(now)
    local removed = 0
    for k, e in pairs(self.ip) do
        if not alive(e, now) then self.ip[k] = nil; removed = removed + 1 end
    end
    for k, e in pairs(self.id) do
        if not alive(e, now) then self.id[k] = nil; removed = removed + 1 end
    end
    for _, bucket in pairs(self.cidr) do
        for k, e in pairs(bucket) do
            if not alive(e, now) then bucket[k] = nil; removed = removed + 1 end
        end
    end
    self.count = self.count - removed
    return removed
end

--- Flat array of the live entries (for commands / persistence).
function Store:entries(now)
    local out = {}
    for _, e in pairs(self.ip) do if alive(e, now) then out[#out + 1] = e end end
    for _, e in pairs(self.id) do if alive(e, now) then out[#out + 1] = e end end
    for _, bucket in pairs(self.cidr) do
        for _, e in pairs(bucket) do if alive(e, now) then out[#out + 1] = e end end
    end
    table.sort(out, function(a, b) return a.value < b.value end)
    return out
end

-- ─── value parsing ──────────────────────────────────────────────────────────

--- Classify a free-form value: returns kind ('ip' | 'cidr' | 'identifier') and the canonical text, or nil.
function Lists.classify(value)
    if type(value) ~= 'string' then return nil end
    local v = U.trim(value):lower()
    if v:sub(1, 3) == 'ip:' then v = v:sub(4) end
    if v == '' then return nil end

    if v:find('/', 1, true) then
        local net, plen = U.parseCidr(v)
        if not net then return nil end
        if plen == 32 then return 'ip', U.ipv4ToString(net) end
        return 'cidr', U.ipv4ToString(net) .. '/' .. plen
    end

    local ip = U.normalizeIp(v)
    if ip then return 'ip', ip end

    local t, rest = v:match('^(%w+):(.+)$')
    if t and U.STABLE_ID_TYPES[t] then return 'identifier', t .. ':' .. rest end
    return nil
end

-- ─── state ──────────────────────────────────────────────────────────────────

Lists.remote = { block = newStore(), allow = newStore() } -- replaced wholesale by backend snapshots
Lists.localAllow = newStore() -- Config.LocalAllowlist
Lists.bans = newStore() -- temporary bans created by the detectors (memory only)
Lists.rev = 0

function Lists.reset()
    Lists.remote = { block = newStore(), allow = newStore() }
    Lists.localAllow = newStore()
    Lists.bans = newStore()
    Lists.rev = 0
end

--- Build a store from backend / cache entries: { kind, value, reason, ttl = seconds left | expiresAt = unix }.
local function buildStore(entries, now)
    local store = newStore()
    if type(entries) ~= 'table' then return store end
    for _, e in ipairs(entries) do
        if type(e) == 'table' then
            local kind, value = Lists.classify(e.value)
            if kind then
                local expiresAt
                if type(e.expiresAt) == 'number' then
                    expiresAt = math.floor(e.expiresAt)
                elseif type(e.ttl) == 'number' then
                    expiresAt = now + math.floor(e.ttl)
                end
                if not expiresAt or expiresAt > now then
                    local reason = type(e.reason) == 'string' and U.safeText(e.reason, 120) or nil
                    store:add(kind, value, reason, expiresAt)
                end
            end
        end
    end
    return store
end

--- Replace both remote lists with a snapshot from the backend (or from the cache file).
function Lists.applySnapshot(snapshot, rev, now)
    snapshot = type(snapshot) == 'table' and snapshot or {}
    Lists.remote = {
        block = buildStore(snapshot.block, now),
        allow = buildStore(snapshot.allow, now),
    }
    if rev then Lists.rev = rev end
end

--- Snapshot with absolute expiry times, for the cache file.
function Lists.exportSnapshot(now)
    local function dump(store)
        local out = {}
        for _, e in ipairs(store:entries(now)) do
            out[#out + 1] = { kind = e.kind, value = e.value, reason = e.reason, expiresAt = e.expiresAt }
        end
        return out
    end
    return { block = dump(Lists.remote.block), allow = dump(Lists.remote.allow) }
end

function Lists.setLocalAllowlist(values)
    Lists.localAllow = newStore()
    for _, v in ipairs(values or {}) do
        local kind, value = Lists.classify(v)
        if kind then
            Lists.localAllow:add(kind, value, 'Config.LocalAllowlist')
        else
            U.warn(('Config.LocalAllowlist: ignoring invalid entry "%s"'):format(tostring(v)))
        end
    end
end

-- ─── queries ────────────────────────────────────────────────────────────────

--- Is this player on the allowlist (local config or dashboard)? Returns the entry or nil.
function Lists.isAllowed(ip, ids, now)
    return Lists.localAllow:match(ip, ids, now) or Lists.remote.allow:match(ip, ids, now)
end

--- Is this player blocked? Returns entry, source ('ban' = temporary detector ban, 'blocklist' = dashboard).
function Lists.isBlocked(ip, ids, now)
    local e = Lists.bans:match(ip, ids, now)
    if e then return e, 'ban' end
    e = Lists.remote.block:match(ip, ids, now)
    if e then return e, 'blocklist' end
    return nil
end

-- ─── temporary bans ─────────────────────────────────────────────────────────

--- Ban every IP / identifier in `keys` for `seconds`. `msgKey` selects the message the player sees.
function Lists.ban(keys, seconds, reason, msgKey, now)
    local added = 0
    for _, key in ipairs(keys) do
        local kind, value = Lists.classify(key)
        if kind and Lists.bans:add(kind, value, reason, now + seconds, msgKey) then
            added = added + 1
        end
    end
    return added
end

--- Remove a temporary ban. Returns true when something was removed.
function Lists.unban(value)
    local kind, v = Lists.classify(value)
    if not kind then return false end
    return Lists.bans:remove(kind, v)
end

function Lists.sweep(now)
    Lists.bans:sweep(now)
    Lists.remote.block:sweep(now)
    Lists.remote.allow:sweep(now)
    Lists.localAllow:sweep(now)
end
