FXS = FXS or {}

local U = FXS.Util

--- "Returning players": licenses that joined this server before.
--- Used by under-attack mode to let regulars in while strangers have to wait.
--- Persisted to known.json; capped so it can never grow without bound.
local Known = {}
FXS.Known = Known

local CAP = 50000
local MAX_AGE_DAYS = 90

local map = {} -- "license:abc" -> day number (days since epoch) of the last join
local count = 0
Known.dirty = false

local function today(now)
    return now // 86400
end

function Known.add(license, now)
    if not license then return end
    if map[license] == nil then count = count + 1 end
    map[license] = today(now)
    Known.dirty = true
    if count > CAP then Known.evict(now) end
end

function Known.has(license)
    return license ~= nil and map[license] ~= nil
end

function Known.count()
    return count
end

--- Drop entries older than MAX_AGE_DAYS; if still above the cap, drop the oldest ones.
function Known.evict(now)
    local cutoff = today(now) - MAX_AGE_DAYS
    for k, day in pairs(map) do
        if day < cutoff then
            map[k] = nil
            count = count - 1
        end
    end
    if count > CAP then
        local all = {}
        for k, day in pairs(map) do all[#all + 1] = { k = k, d = day } end
        table.sort(all, function(a, b) return a.d < b.d end)
        local target = math.floor(CAP * 0.9)
        for i = 1, count - target do
            map[all[i].k] = nil
        end
        count = target
    end
end

function Known.export()
    return map
end

function Known.import(data, now)
    map, count = {}, 0
    if type(data) ~= 'table' then return end
    for k, day in pairs(data) do
        if type(k) == 'string' and type(day) == 'number' and k:match('^%w+:%S+$') then
            map[k] = math.floor(day)
            count = count + 1
        end
    end
    Known.evict(now)
    Known.dirty = false
end

function Known.reset()
    map, count = {}, 0
    Known.dirty = false
end
