-- Run from the repository root:   lua5.4 resource/tests/run.lua [name-filter]
-- (needs Lua 5.4 – the same version FiveM uses with `lua54 'yes'`)

local here = (arg and arg[0] or 'resource/tests/run.lua'):match('^(.*)[/\\][^/\\]*$') or '.'
package.path = here .. '/?.lua;' .. package.path

local Harness = require('harness')
Harness.defaultDir = here .. '/../fxshield'

-- ─── tiny test framework ────────────────────────────────────────────────────

local T = { passed = 0, failed = 0, failures = {}, filter = arg and arg[1] }

local function show(v)
    if type(v) == 'string' then return ('%q'):format(v) end
    if type(v) == 'table' then
        local ok, s = pcall(Harness.json.encode, v)
        return ok and s or tostring(v)
    end
    return tostring(v)
end

local function deepEqual(a, b)
    if type(a) ~= type(b) then return false end
    if type(a) ~= 'table' then return a == b end
    for k, v in pairs(a) do if not deepEqual(v, b[k]) then return false end end
    for k in pairs(b) do if a[k] == nil then return false end end
    return true
end

function T.eq(actual, expected, msg)
    if actual ~= expected then
        error(('%sexpected %s, got %s'):format(msg and (msg .. ': ') or '', show(expected), show(actual)), 2)
    end
end

function T.deepEq(actual, expected, msg)
    if not deepEqual(actual, expected) then
        error(('%sexpected %s, got %s'):format(msg and (msg .. ': ') or '', show(expected), show(actual)), 2)
    end
end

function T.ok(cond, msg)
    if not cond then error(msg or 'expected a truthy value', 2) end
end

function T.notOk(cond, msg)
    if cond then error(msg or 'expected a falsy value', 2) end
end

function T.contains(haystack, needle, msg)
    if type(haystack) ~= 'string' or not haystack:find(needle, 1, true) then
        error(('%sexpected %s to contain %s'):format(msg and (msg .. ': ') or '', show(haystack), show(needle)), 2)
    end
end

function T.notContains(haystack, needle, msg)
    if type(haystack) == 'string' and haystack:find(needle, 1, true) then
        error(('%sexpected %s NOT to contain %s'):format(msg and (msg .. ': ') or '', show(haystack), show(needle)), 2)
    end
end

function T.near(actual, expected, tolerance, msg)
    if math.abs(actual - expected) > tolerance then
        error(('%sexpected %s ± %s, got %s'):format(msg and (msg .. ': ') or '', expected, tolerance, actual), 2)
    end
end

local currentFile = ''
function T.test(name, fn)
    local full = currentFile .. ' › ' .. name
    if T.filter and not full:find(T.filter, 1, true) then return end
    local ok, err = xpcall(fn, function(e) return debug.traceback(tostring(e), 2) end)
    if ok then
        T.passed = T.passed + 1
        io.write('  ✓ ', name, '\n')
    else
        T.failed = T.failed + 1
        T.failures[#T.failures + 1] = { name = full, err = err }
        io.write('  ✗ ', name, '\n')
    end
end

-- ─── run ────────────────────────────────────────────────────────────────────

local files = {
    'test_util',
    'test_ratelimit',
    'test_lists',
    'test_settings',
    'test_attack',
    'test_connect',
    'test_events',
    'test_sync',
    'test_main',
}

-- `lua5.4 run.lua test_connect` runs a single file; `lua5.4 run.lua "test_connect › flood"` a single test
local only = T.filter and T.filter:match('^(test_[%w_]+)')
if only then files = { only } end

for _, name in ipairs(files) do
    currentFile = name
    io.write('\n', name, '\n')
    local chunk, err = loadfile(here .. '/' .. name .. '.lua')
    if not chunk then
        T.failed = T.failed + 1
        T.failures[#T.failures + 1] = { name = name, err = err }
        io.write('  ✗ could not load: ', tostring(err), '\n')
    else
        local ok, e = xpcall(chunk, debug.traceback, T, Harness)
        if not ok then
            T.failed = T.failed + 1
            T.failures[#T.failures + 1] = { name = name, err = e }
            io.write('  ✗ file crashed: ', tostring(e), '\n')
        end
    end
end

io.write(('\n%d passed, %d failed\n'):format(T.passed, T.failed))
if T.failed > 0 then
    io.write('\nFailures:\n')
    for _, f in ipairs(T.failures) do io.write('\n● ', f.name, '\n', f.err, '\n') end
    os.exit(1)
end
