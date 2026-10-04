FXS = FXS or {}

local U = FXS.Util

--- Counters and security events collected between two backend syncs.
--- Events with the same (type, rule, ip, identifier) are merged into one with a `count`,
--- so even a flood of thousands of blocked attempts produces only a handful of events.
local Stats = {}
FXS.Stats = Stats

local MAX_EVENTS = 60 -- distinct events kept between two syncs (the counters still count everything)
local MAX_CRITICAL_EXTRA = 50 -- critical events may exceed MAX_EVENTS by this much

local COUNTERS = { 'attempts', 'allowed', 'blocked', 'monitored', 'kicked', 'banned', 'cancelled' }

local state

local function fresh()
    local c = {}
    for _, name in ipairs(COUNTERS) do c[name] = 0 end
    return { counters = c, byRule = {}, events = {}, index = {}, dropped = 0 }
end

state = fresh()

function Stats.reset()
    state = fresh()
end

function Stats.count(name, n)
    state.counters[name] = (state.counters[name] or 0) + (n or 1)
end

--- kind: 'blocked' (a protection acted) or 'monitored' (it would have acted)
function Stats.rule(rule, kind)
    local r = state.byRule[rule]
    if not r then
        r = { blocked = 0, monitored = 0 }
        state.byRule[rule] = r
    end
    r[kind] = r[kind] + 1
end

--- e: { type, rule?, severity?, action?, ip?, identifier?, name?, detail?, count?, group? }
--- Events of the same type + rule + `group` are merged. `group` defaults to the player's identifier, then IP;
--- connection events pass the IP so a botnet with endless fake licenses behind one address stays ONE event.
function Stats.event(e)
    local key = table.concat({ e.type, e.rule or '', e.group or e.identifier or e.ip or e.name or '' }, '|')
    local existing = state.index[key]
    if existing then
        existing.count = existing.count + (e.count or 1)
        if e.detail then existing.detail = U.safeText(e.detail, 300) end
        return existing
    end

    local severity = e.severity or 'info'
    local limit = MAX_EVENTS + (severity == 'critical' and MAX_CRITICAL_EXTRA or 0)
    if #state.events >= limit then
        state.dropped = state.dropped + 1
        return nil
    end

    local entry = {
        ts = U.now(),
        type = e.type,
        rule = e.rule,
        severity = severity,
        action = e.action or 'logged',
        ip = e.ip,
        identifier = e.identifier,
        name = e.name and U.safeText(e.name, 64) or nil,
        detail = e.detail and U.safeText(e.detail, 300) or nil,
        count = e.count or 1,
    }
    state.events[#state.events + 1] = entry
    state.index[key] = entry
    return entry
end

function Stats.hasData()
    if #state.events > 0 or state.dropped > 0 then return true end
    for _, name in ipairs(COUNTERS) do
        if state.counters[name] > 0 then return true end
    end
    return false
end

--- Move everything collected so far into a batch and start counting from zero.
--- Returns { stats = {…counters, byRule}, events = {…} }
function Stats.takeBatch()
    local s = state
    state = fresh()

    if s.dropped > 0 then
        s.events[#s.events + 1] = {
            ts = U.now(),
            type = 'events_dropped',
            severity = 'warn',
            action = 'logged',
            detail = ('%d events were dropped because too many different events happened between two syncs'):format(s.dropped),
            count = s.dropped,
        }
    end

    local stats = {}
    for _, name in ipairs(COUNTERS) do stats[name] = s.counters[name] end
    stats.byRule = s.byRule
    return { stats = stats, events = s.events }
end

--- Totals since the last sync (for the status command).
function Stats.peek()
    return state.counters
end
