local T, Harness = ...

local function limiter(maxKeys)
    return Harness.new().env.FXS.RateLimit.new(maxKeys)
end

T.test('counts hits inside the window and expires old ones', function()
    local rl = limiter()
    T.eq(rl:hit('a', 1000, 10000), 1)
    T.eq(rl:hit('a', 2000, 10000), 2)
    T.eq(rl:hit('a', 9999, 10000), 3)
    T.eq(rl:hit('a', 11000, 10000), 3, 'the hit at t=1000 expired, t=2000/9999/11000 remain')
    T.eq(rl:hit('a', 12001, 10000), 3, 't=2000 expired too')
    T.eq(rl:hit('a', 40000, 10000), 1, 'everything expired')
end)

T.test('the window edge is exclusive (a hit exactly windowMs ago is gone)', function()
    local rl = limiter()
    rl:hit('a', 0, 1000)
    T.eq(rl:hit('a', 1000, 1000), 1)
    T.eq(rl:peek('a', 1999, 1000), 1)
end)

T.test('keys are independent', function()
    local rl = limiter()
    for _ = 1, 5 do rl:hit('a', 0, 1000) end
    T.eq(rl:hit('b', 0, 1000), 1)
    T.eq(rl:peek('a', 0, 1000), 5)
    T.eq(rl:peek('missing', 0, 1000), 0)
end)

T.test('stays correct over many hits (index compaction)', function()
    local rl = limiter()
    local now = 0
    local last
    for _ = 1, 5000 do
        now = now + 10
        last = rl:hit('busy', now, 1000) -- ~100 hits per window, indices keep growing
    end
    T.eq(last, 100)
    T.ok(rl.keys.busy.first <= 300, 'indices were compacted')
end)

T.test('shrinking the window at runtime (config change) drops the older hits', function()
    local rl = limiter()
    rl:hit('k', 0, 5000)
    T.eq(rl:hit('k', 4000, 5000), 2)
    T.eq(rl:hit('k', 4500, 1000), 2, 'only the hits at 4000 and 4500 are inside a 1s window')
end)

T.test('maxKeys bounds memory: unseen keys are not tracked, tracked ones keep working', function()
    local rl = limiter(3)
    rl:hit('a', 0, 1000)
    rl:hit('b', 0, 1000)
    rl:hit('c', 0, 1000)
    T.eq(rl:hit('d', 0, 1000), 1)
    T.eq(rl:hit('d', 0, 1000), 1, 'never counted above 1 – fail-open')
    T.eq(rl.size, 3)
    T.eq(rl:hit('a', 10, 1000), 2, 'existing key still tracked')
end)

T.test('sweep removes idle keys', function()
    local rl = limiter()
    rl:hit('old', 0, 1000)
    rl:hit('new', 900000, 1000)
    T.eq(rl:sweep(1000000, 600000), 1)
    T.eq(rl.size, 1)
    T.ok(rl.keys.new ~= nil)
end)

T.test('reset and clear', function()
    local rl = limiter()
    rl:hit('a', 0, 1000)
    rl:reset('a')
    T.eq(rl:peek('a', 0, 1000), 0)
    T.eq(rl.size, 0)
    rl:hit('x', 0, 1000)
    rl:clear()
    T.eq(rl.size, 0)
end)
