FXS = FXS or {}

local U = FXS.Util
local Settings = FXS.Settings
local Lists = FXS.Lists
local Known = FXS.Known

--- Persists what was last received from the backend (config + lists) and the returning-player set,
--- so protection is active immediately after a restart even if the backend is unreachable.
--- Files live in the resource folder and are written with SaveResourceFile.
local Cache = {}
FXS.Cache = Cache

local CACHE_FILE = 'cache.json'
local KNOWN_FILE = 'known.json'

local function resource()
    return GetCurrentResourceName()
end

local function write(file, data)
    local ok, encoded = pcall(json.encode, data)
    if not ok then
        U.logThrottled('cache-encode', 300, 'warn', 'could not encode cache: ' .. tostring(encoded))
        return false
    end
    local saved = SaveResourceFile(resource(), file, encoded, -1)
    if not saved then
        U.logThrottled('cache-write-' .. file, 300, 'warn', ('could not write %s (is the resource folder writable?)'):format(file))
    end
    return saved
end

local function read(file)
    local raw = LoadResourceFile(resource(), file)
    if type(raw) ~= 'string' or raw == '' then return nil end
    local ok, data = pcall(json.decode, raw)
    if ok and type(data) == 'table' then return data end
    U.warn(('ignoring unreadable %s'):format(file))
    return nil
end

--- Save config + lists (small, written whenever they change).
function Cache.save()
    return write(CACHE_FILE, {
        v = 1,
        savedAt = U.now(),
        configRev = Settings.rev,
        config = Settings.cfg,
        listsRev = Lists.rev,
        lists = Lists.exportSnapshot(U.now()),
    })
end

--- Save returning players (can be large, written occasionally and on stop).
function Cache.saveKnown(force)
    if not force and not Known.dirty then return false end
    local ok = write(KNOWN_FILE, { v = 1, savedAt = U.now(), players = Known.export() })
    if ok then Known.dirty = false end
    return ok
end

--- Load everything that exists. Returns true when a config was restored.
function Cache.load()
    local now = U.now()
    local restored = false

    local data = read(CACHE_FILE)
    if data and type(data.config) == 'table' then
        Settings.apply(data.config, tonumber(data.configRev) or 0)
        restored = true
        if type(data.lists) == 'table' then
            Lists.applySnapshot(data.lists, tonumber(data.listsRev) or 0, now)
        end
    end

    local known = read(KNOWN_FILE)
    if known then Known.import(known.players, now) end
    return restored
end
