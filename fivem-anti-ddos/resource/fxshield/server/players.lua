FXS = FXS or {}

local U = FXS.Util
local Lists = FXS.Lists

--- Connected players: who is behind a server id (IP, identifiers, name) and how many share an IP.
local Players = {}
FXS.Players = Players

Players.byId = {}
Players.perIp = {}
Players.ipUnavailable = false

local function key(src)
    return tonumber(src) or src
end

--- Read IP, identifiers and name for a player id (works while connecting and when connected).
function Players.collect(src, name)
    local ids = U.identifiers(src)
    local ip
    local ok, endpoint = pcall(GetPlayerEndpoint, src)
    if ok then ip = U.normalizeIp(endpoint) end
    ip = ip or ids.ip

    if not ip and not Players.ipUnavailable then
        Players.ipUnavailable = true
        U.warn('could not read player IP addresses (sv_endpointprivacy enabled?). IP based protections are inactive.')
        FXS.Stats.event({
            type = 'warning',
            rule = 'endpointPrivacy',
            severity = 'warn',
            action = 'logged',
            detail = 'Player IP addresses are not available (sv_endpointprivacy?). IP based protections cannot work.',
        })
    end

    if not name then
        local ok2, n = pcall(GetPlayerName, src)
        name = ok2 and n or nil
    end

    return {
        src = key(src),
        ip = ip,
        ids = ids.list,
        idByType = ids.byType,
        license = U.licenseOf(ids),
        name = name,
    }
end

--- Start tracking a joined player.
function Players.add(src)
    local k = key(src)
    if Players.byId[k] then Players.remove(k) end
    local info = Players.collect(src)
    Players.byId[k] = info
    if info.ip then Players.perIp[info.ip] = (Players.perIp[info.ip] or 0) + 1 end
    return info
end

function Players.remove(src)
    local k = key(src)
    local info = Players.byId[k]
    if not info then return nil end
    Players.byId[k] = nil
    if info.ip then
        local n = (Players.perIp[info.ip] or 1) - 1
        Players.perIp[info.ip] = n > 0 and n or nil
    end
    return info
end

--- Tracked info, or freshly collected (not tracked) for a player we have not seen join – e.g. after a resource restart.
function Players.get(src)
    local k = key(src)
    return Players.byId[k] or Players.collect(src)
end

--- Staff / allowlisted players skip the in-game guards.
function Players.isExempt(src, now)
    local info = Players.get(src)
    if Lists.isAllowed(info.ip, info.ids, now) then return true end
    if Config and Config.BypassAce and Config.BypassAce ~= '' and IsPlayerAceAllowed then
        local ok, allowed = pcall(IsPlayerAceAllowed, tostring(src), Config.BypassAce)
        if ok and allowed then return true end
    end
    return false
end

--- Every stable identifier plus the IP – what gets banned when a player is punished.
function Players.banKeys(info)
    local keys = {}
    for _, id in ipairs(info.ids or {}) do keys[#keys + 1] = id end
    if info.ip then keys[#keys + 1] = info.ip end
    return keys
end

function Players.reset()
    Players.byId, Players.perIp, Players.ipUnavailable = {}, {}, false
end
