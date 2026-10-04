FXS = FXS or {}

local U = FXS.Util

--- The active configuration. Whatever arrives from the backend (or the cache file) is treated as
--- untrusted input: every value is validated against the generated schema and clamped to its limits.
local Settings = {}
FXS.Settings = Settings

Settings.cfg = nil
Settings.rev = 0
Settings.listeners = {}

local function normInt(def, v)
    v = tonumber(v)
    if not v or v ~= v or v == math.huge or v == -math.huge then return def.default end
    v = math.floor(v + 0.5)
    if v < def.min then v = def.min elseif v > def.max then v = def.max end
    return math.tointeger(v) or def.default
end

local function normField(def, v)
    if def.type == 'int' then
        return normInt(def, v)
    elseif def.type == 'bool' then
        if type(v) == 'boolean' then return v end
        return def.default
    elseif def.type == 'select' then
        for _, opt in ipairs(def.options) do
            if v == opt then return v end
        end
        return def.default
    elseif def.type == 'text' then
        if type(v) ~= 'string' then return def.default end
        local s = U.safeText(v, def.maxLength * 4)
        if s == '' then return def.default end
        return s
    end
    return def.default
end

--- Turn any input into a complete, valid config table.
function Settings.normalize(raw)
    raw = type(raw) == 'table' and raw or {}
    local rawGeneral = type(raw.general) == 'table' and raw.general or {}
    local rawProt = type(raw.protections) == 'table' and raw.protections or {}
    local rawMsg = type(raw.messages) == 'table' and raw.messages or {}

    local out = { v = FXS.CONFIG_VERSION, general = {}, protections = {}, messages = {} }

    for key, def in pairs(FXS.Schema.general) do
        out.general[key] = normField(def, rawGeneral[key])
    end

    for id, pdef in pairs(FXS.Schema.protections) do
        local rp = type(rawProt[id]) == 'table' and rawProt[id] or {}
        local p = { mode = pdef.default }
        for _, m in ipairs(pdef.modes) do
            if rp.mode == m then p.mode = m end
        end
        for key, def in pairs(pdef.fields) do
            p[key] = normField(def, rp[key])
        end
        out.protections[id] = p
    end

    for key, def in pairs(FXS.Schema.messages) do
        out.messages[key] = normField(def, rawMsg[key])
    end
    return out
end

function Settings.defaults()
    return Settings.normalize({})
end

--- Register a function called after every config change: fn(newCfg, oldCfg).
function Settings.onChange(fn)
    Settings.listeners[#Settings.listeners + 1] = fn
end

--- Validate and activate a config. `rev` is the backend's revision number.
function Settings.apply(raw, rev)
    local old = Settings.cfg
    Settings.cfg = Settings.normalize(raw)
    if rev then Settings.rev = rev end
    for _, fn in ipairs(Settings.listeners) do
        local ok, err = pcall(fn, Settings.cfg, old)
        if not ok then U.err('config listener failed: ' .. tostring(err)) end
    end
    return Settings.cfg
end

--- Settings of one protection: { mode = 'enforce', <fields…> }
function Settings.get(id)
    return Settings.cfg.protections[id]
end

function Settings.msg(key)
    return Settings.cfg.messages[key] or Settings.cfg.messages.blocked
end

Settings.cfg = Settings.defaults()
