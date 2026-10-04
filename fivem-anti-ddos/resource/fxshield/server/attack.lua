FXS = FXS or {}

local U = FXS.Util
local Settings = FXS.Settings
local Stats = FXS.Stats

--- Under-attack mode: watches how many connection attempts arrive (and how many get rejected) per minute.
--- When a threshold is crossed the state flips to "attack": per-IP limits get tighter and – if configured –
--- only returning players may join. It ends `minDurationSec` after the last trigger.
local Attack = {}
FXS.Attack = Attack

local WINDOW = 60 -- seconds the rates are measured over

Attack.state = 'normal'
Attack.since = nil
Attack.untilAt = nil
Attack.peakAttempts = 0
Attack.peakBlocked = 0

local attempts, blocked, stamp = {}, {}, {}

local function slot(now)
    local i = now % WINDOW + 1
    if stamp[i] ~= now then
        stamp[i], attempts[i], blocked[i] = now, 0, 0
    end
    return i
end

function Attack.recordAttempt(now)
    local i = slot(now)
    attempts[i] = attempts[i] + 1
end

function Attack.recordBlocked(now)
    local i = slot(now)
    blocked[i] = blocked[i] + 1
end

--- Attempts and rejections within the last minute.
function Attack.rates(now)
    local a, b = 0, 0
    for i = 1, WINDOW do
        local s = stamp[i]
        if s and now - s < WINDOW then
            a = a + attempts[i]
            b = b + blocked[i]
        end
    end
    return a, b
end

local function startAttack(now, c, a, b)
    Attack.state = 'attack'
    Attack.since = now
    Attack.peakAttempts, Attack.peakBlocked = a, b
    local why
    if c.mode == 'on' then
        why = 'enabled manually in the dashboard'
    else
        why = ('%d rejected / %d total connection attempts in the last minute'):format(b, a)
    end
    if c.mode == 'monitor' then why = why .. ' (monitor mode: no restrictions applied)' end
    Stats.event({ type = 'attack_started', severity = 'critical', action = 'logged', detail = why })
    U.warn('under attack – ' .. why)
end

local function endAttack(now)
    local lasted = now - (Attack.since or now)
    Attack.state = 'normal'
    Attack.since, Attack.untilAt = nil, nil
    Stats.event({
        type = 'attack_ended',
        severity = 'info',
        action = 'logged',
        detail = ('attack mode ended after %ds (peak %d attempts / %d rejected per minute)'):format(lasted, Attack.peakAttempts, Attack.peakBlocked),
    })
    U.log('attack mode ended')
end

--- Call about once per second.
function Attack.tick(now)
    local c = Settings.get('attackMode')
    local a, b = Attack.rates(now)

    local want
    if c.mode == 'off' then
        want = false
    elseif c.mode == 'on' then
        want = true
    else
        if b >= c.triggerBlockedPerMin or a >= c.triggerAttemptsPerMin then
            Attack.untilAt = now + c.minDurationSec
            want = true
        else
            want = Attack.state == 'attack' and Attack.untilAt ~= nil and now < Attack.untilAt
        end
    end

    if want and Attack.state ~= 'attack' then
        startAttack(now, c, a, b)
    elseif not want and Attack.state == 'attack' then
        endAttack(now)
    elseif want then
        if a > Attack.peakAttempts then Attack.peakAttempts = a end
        if b > Attack.peakBlocked then Attack.peakBlocked = b end
    end
end

--- True while an attack is detected (also in monitor mode) – reported to the backend.
function Attack.isAttackState()
    return Attack.state == 'attack'
end

--- True while the restrictions are really applied (auto / on, not monitor).
function Attack.active()
    if Attack.state ~= 'attack' then return false end
    local mode = Settings.get('attackMode').mode
    return mode == 'auto' or mode == 'on'
end

--- How the "returning players only" gate behaves right now: 'enforce', 'monitor' or nil (not applicable).
function Attack.gateMode()
    if Attack.state ~= 'attack' then return nil end
    local mode = Settings.get('attackMode').mode
    if mode == 'auto' or mode == 'on' then return 'enforce' end
    if mode == 'monitor' then return 'monitor' end
    return nil
end

--- Factor applied to the per-IP connection limits (1.0 normally, smaller during an attack).
function Attack.limitFactor()
    if Attack.active() then
        return Settings.get('attackMode').limitPercent / 100
    end
    return 1.0
end

function Attack.reset()
    Attack.state, Attack.since, Attack.untilAt = 'normal', nil, nil
    Attack.peakAttempts, Attack.peakBlocked = 0, 0
    attempts, blocked, stamp = {}, {}, {}
end
