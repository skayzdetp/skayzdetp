FXS = FXS or {}

--- Sliding-window rate limiter.
--- Every key owns a small array of hit timestamps (ms); old ones are dropped on the next hit.
--- Memory is bounded by `maxKeys` and the limit the caller enforces; `sweep` removes idle keys.
local RateLimit = {}
RateLimit.__index = RateLimit
FXS.RateLimit = RateLimit

function RateLimit.new(maxKeys)
    return setmetatable({ keys = {}, size = 0, maxKeys = maxKeys or 50000 }, RateLimit)
end

--- Register one hit for `key`; returns how many hits (including this one) happened within `windowMs`.
--- When the table is full, previously unseen keys are not tracked (returns 1) – tracked keys keep working,
--- so a flood of unique keys can never grow memory without bound.
function RateLimit:hit(key, nowMs, windowMs)
    local b = self.keys[key]
    if not b then
        if self.size >= self.maxKeys then return 1 end
        b = { first = 1, last = 0, seen = nowMs }
        self.keys[key] = b
        self.size = self.size + 1
    end

    local cutoff = nowMs - windowMs
    local first, last = b.first, b.last
    while first <= last and b[first] <= cutoff do
        b[first] = nil
        first = first + 1
    end
    if first > last then first, last = 1, 0 end

    -- keep the indices small
    if first > 256 then
        table.move(b, first, last, 1)
        for i = last - first + 2, last do b[i] = nil end
        last = last - first + 1
        first = 1
    end

    last = last + 1
    b[last] = nowMs
    b.first, b.last, b.seen = first, last, nowMs
    return last - first + 1
end

--- Number of hits within the window, without registering one.
function RateLimit:peek(key, nowMs, windowMs)
    local b = self.keys[key]
    if not b then return 0 end
    local cutoff = nowMs - windowMs
    local n = 0
    for i = b.first, b.last do
        if b[i] > cutoff then n = n + 1 end
    end
    return n
end

function RateLimit:reset(key)
    if self.keys[key] then
        self.keys[key] = nil
        self.size = self.size - 1
    end
end

--- Drop keys that were not touched for `maxIdleMs`.
function RateLimit:sweep(nowMs, maxIdleMs)
    local removed = 0
    for key, b in pairs(self.keys) do
        if nowMs - b.seen > maxIdleMs then
            self.keys[key] = nil
            self.size = self.size - 1
            removed = removed + 1
        end
    end
    return removed
end

function RateLimit:clear()
    self.keys = {}
    self.size = 0
end
