local T, Harness = ...

--- A started resource with a given attack-mode config.
local function setup(attack)
    local H = Harness.new()
    local env = H.env
    env.FXS.Settings.apply({ protections = { attackMode = attack or {} } }, 1)
    env.FXS.Stats.reset() -- drop the startup event
    return H, env.FXS
end

local function pump(FXS, H, perSecond, seconds, fn)
    for _ = 1, seconds do
        for _ = 1, perSecond do fn() end
        H.seconds(1)
        FXS.Attack.tick(FXS.Util.now())
    end
end

local function eventTypes(FXS)
    local batch = FXS.Stats.takeBatch()
    local types = {}
    for _, e in ipairs(batch.events) do types[#types + 1] = e.type end
    return types, batch
end

T.test('rates are measured over the last 60 seconds only', function()
    local H, FXS = setup()
    local A = FXS.Attack
    for _ = 1, 10 do A.recordAttempt(FXS.Util.now()) end
    for _ = 1, 3 do A.recordBlocked(FXS.Util.now()) end
    local a, b = A.rates(FXS.Util.now())
    T.eq(a, 10)
    T.eq(b, 3)
    H.seconds(30)
    for _ = 1, 5 do A.recordAttempt(FXS.Util.now()) end
    a = A.rates(FXS.Util.now())
    T.eq(a, 15)
    H.seconds(31) -- the first batch is now > 60 s old
    a, b = A.rates(FXS.Util.now())
    T.eq(a, 5)
    T.eq(b, 0)
end)

T.test('automatic mode starts when rejections per minute reach the threshold', function()
    local H, FXS = setup({ mode = 'auto', triggerBlockedPerMin = 20, triggerAttemptsPerMin = 100000, minDurationSec = 60 })
    local A = FXS.Attack
    pump(FXS, H, 1, 10, function() A.recordBlocked(FXS.Util.now()) end)
    T.eq(A.state, 'normal', '10 rejections are below the trigger')
    pump(FXS, H, 2, 6, function() A.recordBlocked(FXS.Util.now()) end)
    T.eq(A.state, 'attack')
    T.ok(A.active())
    T.ok(A.isAttackState())
    local types = eventTypes(FXS)
    T.deepEq(types, { 'attack_started' })
end)

T.test('automatic mode also starts on a raw attempts flood', function()
    local H, FXS = setup({ mode = 'auto', triggerBlockedPerMin = 100000, triggerAttemptsPerMin = 50, minDurationSec = 30 })
    local A = FXS.Attack
    pump(FXS, H, 10, 6, function() A.recordAttempt(FXS.Util.now()) end)
    T.eq(A.state, 'attack')
end)

T.test('the attack stays on for the minimum duration and then ends with a summary event', function()
    local H, FXS = setup({ mode = 'auto', triggerBlockedPerMin = 10, triggerAttemptsPerMin = 100000, minDurationSec = 120 })
    local A = FXS.Attack
    pump(FXS, H, 5, 3, function() A.recordBlocked(FXS.Util.now()) end)
    T.eq(A.state, 'attack')

    H.seconds(60)
    A.tick(FXS.Util.now())
    T.eq(A.state, 'attack', 'rates dropped but the minimum duration is not over')

    pump(FXS, H, 0, 130, function() end)
    T.eq(A.state, 'normal')
    T.notOk(A.active())

    local types, batch = eventTypes(FXS)
    T.deepEq(types, { 'attack_started', 'attack_ended' })
    T.contains(batch.events[2].detail, 'peak')
end)

T.test('triggers keep extending the attack', function()
    local H, FXS = setup({ mode = 'auto', triggerBlockedPerMin = 10, triggerAttemptsPerMin = 100000, minDurationSec = 60 })
    local A = FXS.Attack
    pump(FXS, H, 6, 20, function() A.recordBlocked(FXS.Util.now()) end) -- continuous pressure for 20 s
    local before = A.untilAt
    pump(FXS, H, 6, 20, function() A.recordBlocked(FXS.Util.now()) end)
    T.ok(A.untilAt > before)
    T.eq(A.state, 'attack')
end)

T.test("mode 'on' forces an attack, switching to 'off' ends it", function()
    local H, FXS = setup({ mode = 'on' })
    local A = FXS.Attack
    A.tick(FXS.Util.now())
    T.eq(A.state, 'attack')
    T.ok(A.active())
    T.eq(A.gateMode(), 'enforce')
    FXS.Settings.apply({ protections = { attackMode = { mode = 'off' } } }, 2)
    A.tick(FXS.Util.now())
    T.eq(A.state, 'normal')
    T.eq(A.gateMode(), nil)
    local _ = H
end)

T.test("mode 'monitor' reports an attack but never applies restrictions", function()
    local H, FXS = setup({ mode = 'monitor', triggerBlockedPerMin = 10, triggerAttemptsPerMin = 100000 })
    local A = FXS.Attack
    pump(FXS, H, 6, 4, function() A.recordBlocked(FXS.Util.now()) end)
    T.eq(A.state, 'attack')
    T.ok(A.isAttackState(), 'reported to the backend')
    T.notOk(A.active(), 'but no restrictions')
    T.eq(A.gateMode(), 'monitor')
    T.eq(A.limitFactor(), 1.0)
    local _, batch = eventTypes(FXS)
    T.contains(batch.events[1].detail, 'monitor mode')
end)

T.test("mode 'off' never starts, even under heavy load", function()
    local H, FXS = setup({ mode = 'off', triggerBlockedPerMin = 5, triggerAttemptsPerMin = 20 })
    local A = FXS.Attack
    pump(FXS, H, 50, 5, function() A.recordAttempt(FXS.Util.now()); A.recordBlocked(FXS.Util.now()) end)
    T.eq(A.state, 'normal')
end)

T.test('limit factor shrinks the per-IP limits while the attack is active', function()
    local H, FXS = setup({ mode = 'on', limitPercent = 40 })
    FXS.Attack.tick(FXS.Util.now())
    T.near(FXS.Attack.limitFactor(), 0.4, 0.0001)
    local _ = H
end)

T.test('reset clears everything', function()
    local H, FXS = setup({ mode = 'on' })
    FXS.Attack.tick(FXS.Util.now())
    FXS.Attack.recordAttempt(FXS.Util.now())
    FXS.Attack.reset()
    T.eq(FXS.Attack.state, 'normal')
    T.eq(FXS.Attack.rates(FXS.Util.now()), 0)
    local _ = H
end)
