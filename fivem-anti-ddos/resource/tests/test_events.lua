local T, Harness = ...

local function boot(cfg, opts)
    local H = Harness.new(opts)
    if cfg then H.env.FXS.Settings.apply(cfg, 1) end
    H.env.FXS.Stats.reset() -- drop the startup event
    return H, H.env.FXS
end

local function prot(id, values)
    return { protections = { [id] = values } }
end

local function player(H, src, extra)
    local p = { src = src, ip = '203.0.113.' .. src, license = 'lic' .. src, name = 'Player' .. src }
    for k, v in pairs(extra or {}) do p[k] = v end
    H.playerEnters(p)
    return p
end

-- events: sender first, then the payload (just like OneSync passes it)
local function explode(H, src) return H.fire('explosionEvent', src, src, {}) end
local function ptfx(H, src) return H.fire('ptFxEvent', src, src, {}) end
local function fire(H, src) return H.fire('fireEvent', src, src, {}) end
local function projectile(H, src) return H.fire('startProjectileEvent', src, src, {}) end

local function count(H, fn, src, n)
    local cancelled = 0
    for _ = 1, n do if fn(H, src) then cancelled = cancelled + 1 end end
    return cancelled
end

-- ─── game events ────────────────────────────────────────────────────────────

T.test('explosions: up to the limit pass, the excess is cancelled (nobody is punished by default)', function()
    local H, FXS = boot()
    player(H, 1)
    T.eq(count(H, explode, 1, 15), 0, 'default limit is 15 per 5 s')
    T.ok(explode(H, 1), 'the 16th is cancelled')
    T.ok(explode(H, 1))
    T.eq(#H.kicks, 0, 'action = cancel never kicks')

    local batch = FXS.Stats.takeBatch()
    T.eq(batch.stats.cancelled, 2)
    T.eq(batch.stats.byRule.gameEventFlood.blocked, 2)
    T.eq(batch.events[1].type, 'event_flood')
    T.eq(batch.events[1].action, 'cancelled')
    T.eq(batch.events[1].identifier, 'license:lic1')
    T.contains(batch.events[1].detail, 'explosions')
end)

T.test('the window slides: after it passes the player may explode again', function()
    local H = boot(prot('gameEventFlood', { maxExplosions = 3, windowSec = 5 }))
    player(H, 1)
    T.eq(count(H, explode, 1, 3), 0)
    T.ok(explode(H, 1))
    H.seconds(6)
    T.notOk(explode(H, 1))
end)

T.test('every event kind has its own counter and limit', function()
    local H = boot(prot('gameEventFlood', { maxExplosions = 1, maxParticles = 2, maxFires = 3, maxProjectiles = 4, windowSec = 5 }))
    player(H, 1)
    T.eq(count(H, explode, 1, 3), 2)
    T.eq(count(H, ptfx, 1, 3), 1)
    T.eq(count(H, fire, 1, 4), 1)
    T.eq(count(H, projectile, 1, 5), 1)
end)

T.test('players are counted separately', function()
    local H = boot(prot('gameEventFlood', { maxExplosions = 2 }))
    player(H, 1)
    player(H, 2)
    T.eq(count(H, explode, 1, 5), 3)
    T.eq(count(H, explode, 2, 2), 0)
end)

T.test('monitor mode only reports', function()
    local H, FXS = boot(prot('gameEventFlood', { mode = 'monitor', maxExplosions = 2 }))
    player(H, 1)
    T.eq(count(H, explode, 1, 10), 0, 'nothing is cancelled')
    local batch = FXS.Stats.takeBatch()
    T.eq(batch.stats.cancelled, 0)
    T.eq(batch.stats.byRule.gameEventFlood.monitored, 8)
    T.eq(batch.events[1].action, 'logged')
    T.contains(batch.events[1].detail, 'would cancel')
end)

T.test('off mode ignores everything', function()
    local H = boot(prot('gameEventFlood', { mode = 'off', maxExplosions = 1 }))
    player(H, 1)
    T.eq(count(H, explode, 1, 20), 0)
end)

T.test('kick: after the strike threshold the player is dropped with the configured message', function()
    local H, FXS = boot({
        protections = { gameEventFlood = { action = 'kick', strikes = 5, maxExplosions = 2 } },
        messages = { kicked = 'Explosion spam is not allowed.' },
    })
    player(H, 1)
    T.eq(count(H, explode, 1, 2), 0)
    T.eq(count(H, explode, 1, 4), 4, 'four strikes: still online')
    T.eq(#H.kicks, 0)
    T.ok(explode(H, 1), 'strike five')
    T.eq(#H.kicks, 1)
    T.eq(H.kicks[1].src, 1)
    T.eq(H.kicks[1].reason, 'Explosion spam is not allowed.')

    local batch = FXS.Stats.takeBatch()
    T.eq(batch.stats.kicked, 1)
    local kicked
    for _, e in ipairs(batch.events) do if e.type == 'player_kicked' then kicked = e end end
    T.eq(kicked.severity, 'critical')
    T.eq(kicked.identifier, 'license:lic1')
end)

T.test('strikes expire: spreading violations over minutes never reaches the threshold', function()
    local H = boot({ protections = { gameEventFlood = { action = 'kick', strikes = 5, maxExplosions = 1, windowSec = 1 } } })
    player(H, 1)
    for _ = 1, 20 do
        explode(H, 1)
        explode(H, 1) -- one strike per round
        H.seconds(30)
    end
    T.eq(#H.kicks, 0)
end)

T.test('tempban: identifiers and IP are banned, the player cannot just reconnect', function()
    local H, FXS = boot({ protections = { gameEventFlood = { action = 'tempban', strikes = 3, banSec = 600, maxExplosions = 1 } } })
    player(H, 1, { ids = { 'discord:999' } })
    explode(H, 1)
    for _ = 1, 3 do explode(H, 1) end
    T.eq(#H.kicks, 1)

    local now = FXS.Util.now()
    T.ok(FXS.Lists.isBlocked('9.9.9.9', { 'license:lic1' }, now), 'license banned')
    T.ok(FXS.Lists.isBlocked('9.9.9.9', { 'discord:999' }, now), 'discord banned')
    T.ok(FXS.Lists.isBlocked('203.0.113.1', {}, now), 'IP banned')

    local r = H.connect({ src = 50, ip = '8.8.8.8', license = 'lic1' })
    T.ok(r.rejected, 'rejoin with the same license is refused')
    T.eq(r.reason, FXS.Settings.cfg.messages.kicked)
    T.eq(FXS.Stats.takeBatch().stats.banned, 1)

    H.seconds(601)
    T.notOk(H.connect({ src = 51, ip = '8.8.8.8', license = 'lic1' }).rejected, 'ban expired')
end)

T.test('staff is exempt: allowlist and ACE bypass', function()
    local H, FXS = boot(prot('gameEventFlood', { maxExplosions = 1 }))
    FXS.Lists.applySnapshot({ allow = { { kind = 'identifier', value = 'license:lic1' } } }, 1, FXS.Util.now())
    player(H, 1)
    player(H, 2)
    player(H, 3)
    H.aces[2] = { ['fxshield.bypass'] = true }
    T.eq(count(H, explode, 1, 10), 0, 'allowlisted')
    T.eq(count(H, explode, 2, 10), 0, 'ACE fxshield.bypass')
    T.eq(count(H, explode, 3, 10), 9, 'a normal player is limited')
end)

T.test('invalid senders are ignored without errors', function()
    local H = boot(prot('gameEventFlood', { maxExplosions = 1 }))
    for _, sender in ipairs({ 0, -1, 'abc', '' }) do
        T.notOk(H.fire('explosionEvent', sender, sender, {}))
        T.notOk(H.fire('explosionEvent', sender, sender, {}))
    end
    T.notOk(H.fire('explosionEvent', nil, nil, {}))
    T.eq(H.log():find('handler failed', 1, true), nil)
end)

T.test('a bug inside a handler never breaks gameplay (fail open) and is logged', function()
    local H, FXS = boot(prot('gameEventFlood', { maxExplosions = 1 }))
    player(H, 1)
    explode(H, 1)
    FXS.Stats.count = function() error('simulated bug') end
    T.notOk(explode(H, 1), 'the error is contained, the event is not cancelled')
    T.contains(H.log(), 'explosionEvent handler failed')
end)

T.test('a player who joined before the resource started is still limited', function()
    local H = Harness.new({ load = false })
    H.player({ src = 7, ip = '203.0.113.7', license = 'old', name = 'Early' })
    H.joined[7] = true -- already online
    H.load()
    H.env.FXS.Settings.apply(prot('gameEventFlood', { maxExplosions = 2 }), 1)
    H.advance(10)
    T.eq(count(H, explode, 7, 5), 3)
end)

-- ─── entity spam ────────────────────────────────────────────────────────────

local function spawn(H, owner, n, etype, pop)
    local cancelled = 0
    for i = 1, n do
        local handle = 10000 + math.random(1, 1e9)
        H.entity(handle, owner, etype or 2, pop)
        if H.fire('entityCreating', owner, handle) then cancelled = cancelled + 1 end
        local _ = i
    end
    return cancelled
end

T.test('entity spam: enforce cancels the excess of script-created entities', function()
    local H, FXS = boot(prot('entitySpam', { mode = 'enforce', maxEntities = 5, windowSec = 10 }))
    player(H, 1)
    T.eq(spawn(H, 1, 5), 0)
    T.eq(spawn(H, 1, 3), 3)
    T.eq(FXS.Stats.takeBatch().events[1].type, 'entity_spam')
end)

T.test('entity spam: ambient population, server-created entities and unknown types are ignored', function()
    local H = boot(prot('entitySpam', { mode = 'enforce', maxEntities = 5 })) -- 5 is the schema minimum
    player(H, 1)
    T.eq(spawn(H, 1, 50, 1, 5), 0, 'ambient pedestrians / traffic (population type 1-5)')
    T.eq(spawn(H, 0, 50), 0, 'owner 0 = created by the server')
    T.eq(spawn(H, 1, 50, 9), 0, 'unknown entity type')
    T.eq(spawn(H, 1, 7, 3, 7), 2, 'objects created by scripts are counted')
end)

T.test('entity spam is monitor-only by default', function()
    local H, FXS = boot()
    player(H, 1)
    T.eq(spawn(H, 1, 200), 0)
    T.ok(FXS.Stats.takeBatch().stats.byRule.entitySpam.monitored > 0)
end)

-- ─── chat ───────────────────────────────────────────────────────────────────

local function chat(H, src, message)
    return H.fire('chatMessage', src, src, 'Player', message or 'hello')
end

T.test('chat flood: too many messages are cancelled', function()
    local H = boot()
    player(H, 1)
    for _ = 1, 8 do T.notOk(chat(H, 1)) end
    T.ok(chat(H, 1))
    H.seconds(6)
    T.notOk(chat(H, 1))
end)

T.test('chat flood: oversized messages are cancelled', function()
    local H, FXS = boot()
    player(H, 1)
    T.notOk(chat(H, 1, ('x'):rep(400)))
    T.ok(chat(H, 1, ('x'):rep(401)))
    T.contains(FXS.Stats.takeBatch().events[1].detail, 'chat message of 401')
end)

T.test('chat flood: kick after repeated violations; console and staff are ignored', function()
    local H = boot(prot('chatFlood', { action = 'kick', strikes = 3, maxMessages = 1 }))
    player(H, 1)
    player(H, 2)
    H.aces[2] = { ['fxshield.bypass'] = true }
    for _ = 1, 10 do
        chat(H, 1)
        if #H.kicks > 0 then break end -- a kicked player sends nothing more
    end
    T.eq(#H.kicks, 1)
    T.eq(H.kicks[1].src, 1)
    for _ = 1, 20 do T.notOk(chat(H, 2)) end
    for _ = 1, 20 do T.notOk(H.fire('chatMessage', 0, 0, 'console', 'hi')) end
end)

-- ─── lockdown ───────────────────────────────────────────────────────────────

T.test('entity lockdown: applied to the default and in-use buckets, released again, never touched when off', function()
    local H = boot()
    player(H, 1, { bucket = 5 })
    H.env.FXS.Events.applyLockdown()
    T.deepEq(H.lockdown, {}, 'off + never managed = no native call')

    H.env.FXS.Settings.apply(prot('entityLockdown', { mode = 'strict' }), 2)
    T.eq(H.lockdown[0], 'strict')
    T.eq(H.lockdown[5], 'strict')

    H.env.FXS.Settings.apply(prot('entityLockdown', { mode = 'relaxed' }), 3)
    T.eq(H.lockdown[0], 'relaxed')

    H.env.FXS.Settings.apply(prot('entityLockdown', { mode = 'off' }), 4)
    T.eq(H.lockdown[0], 'inactive', 'released when switched off')
    T.eq(H.lockdown[5], 'inactive')
end)

T.test('entity lockdown on a server build without the native only warns', function()
    local H = boot()
    H.env.SetRoutingBucketEntityLockdownMode = nil
    H.env.FXS.Settings.apply(prot('entityLockdown', { mode = 'strict' }), 2)
    T.contains(H.log(), 'no entity lockdown support')
end)

-- ─── exports for other resources ────────────────────────────────────────────

T.test('exports.allow rate-limits custom events of other resources', function()
    local H = boot()
    player(H, 1)
    player(H, 2)
    H.aces[2] = { ['fxshield.bypass'] = true }
    local allow = H.exports.allow
    T.ok(allow(1, 'shop:buy', 3, 10))
    T.ok(allow(1, 'shop:buy', 3, 10))
    T.ok(allow(1, 'shop:buy', 3, 10))
    T.notOk(allow(1, 'shop:buy', 3, 10), 'fourth call within the window')
    T.ok(allow(1, 'other:event', 3, 10), 'separate key')
    T.ok(allow(0, 'shop:buy', 3, 10), 'the server itself is never limited')
    for _ = 1, 10 do T.ok(allow(2, 'shop:buy', 1, 10), 'staff passes') end
    H.seconds(11)
    T.ok(allow(1, 'shop:buy', 3, 10))
end)
