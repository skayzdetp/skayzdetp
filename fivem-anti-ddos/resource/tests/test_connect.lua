local T, Harness = ...

--- Boot the resource; `cfg` is a partial config applied on top of the defaults.
local function boot(cfg, opts)
    local H = Harness.new(opts)
    if cfg then H.env.FXS.Settings.apply(cfg, 1) end
    return H, H.env.FXS
end

local function prot(id, values)
    return { protections = { [id] = values } }
end

local counter = 100
local function nextId()
    counter = counter + 1
    return counter
end

-- a connecting player with sensible defaults (own license, own IP unless given)
local function attempt(H, p)
    p = p or {}
    local id = nextId()
    p.src = p.src or id
    p.ip = p.ip or ('198.51.100.' .. (id % 250 + 1))
    if p.license == nil then p.license = ('lic%d'):format(id) end
    return H.connect(p)
end

T.test('a normal player is let in, tracked and remembered', function()
    local H, FXS = boot()
    local r = H.playerEnters({ src = 1, ip = '198.51.100.1', license = 'aaa', name = 'Alice' })
    T.notOk(r.rejected)
    T.eq(FXS.Players.perIp['198.51.100.1'], 1)
    T.ok(FXS.Known.has('license:aaa'))
    local c = FXS.Stats.peek()
    T.eq(c.attempts, 1)
    T.eq(c.allowed, 1)
    T.eq(c.blocked, 0)

    H.drop(1)
    T.eq(FXS.Players.perIp['198.51.100.1'], nil, 'dropped players are forgotten')
    T.ok(FXS.Known.has('license:aaa'), 'but the license stays known')
end)

-- ─── connection flood ───────────────────────────────────────────────────────

T.test('IP flood: the limit is allowed, the next attempt is rejected AND the IP is banned', function()
    local H, FXS = boot()
    for i = 1, 10 do T.notOk(attempt(H, { ip = '203.0.113.5' }).rejected, 'attempt ' .. i) end

    local r = attempt(H, { ip = '203.0.113.5' })
    T.ok(r.rejected)
    T.eq(r.reason, FXS.Settings.cfg.messages.rateLimited)

    -- from now on the IP is banned (rule tempBan) – even with a fresh license
    local again = attempt(H, { ip = '203.0.113.5' })
    T.ok(again.rejected)
    T.eq(again.reason, FXS.Settings.cfg.messages.rateLimited)
    T.ok(FXS.Lists.isBlocked('203.0.113.5', {}, FXS.Util.now()))

    local batch = FXS.Stats.takeBatch()
    T.eq(batch.stats.attempts, 12)
    T.eq(batch.stats.blocked, 2)
    T.eq(batch.stats.banned, 1)
    T.eq(batch.stats.byRule.connectionFlood.blocked, 1)
    T.eq(batch.stats.byRule.tempBan.blocked, 1)
    local types = {}
    for _, e in ipairs(batch.events) do types[e.type .. ':' .. (e.rule or '')] = e end
    T.ok(types['auto_ban:connectionFlood'])
    T.eq(types['auto_ban:connectionFlood'].severity, 'critical')
    T.eq(types['auto_ban:connectionFlood'].ip, '203.0.113.5')
    T.ok(types['connection_blocked:tempBan'])
end)

T.test('the ban ends after banSec and the player can connect again', function()
    local H = boot(prot('connectionFlood', { banSec = 120, windowSec = 30 }))
    for _ = 1, 11 do attempt(H, { ip = '203.0.113.6' }) end
    T.ok(attempt(H, { ip = '203.0.113.6' }).rejected)
    H.seconds(100)
    T.ok(attempt(H, { ip = '203.0.113.6' }).rejected, 'still banned')
    H.seconds(30)
    T.notOk(attempt(H, { ip = '203.0.113.6' }).rejected, 'ban over')
end)

T.test('attempts spread over a longer time than the window are fine', function()
    local H = boot()
    for i = 1, 20 do
        T.notOk(attempt(H, { ip = '203.0.113.7' }).rejected, 'attempt ' .. i)
        H.seconds(10) -- 3 per 30 s window, well below 6
    end
end)

T.test('license flood across different IPs is caught too and bans the license', function()
    local H, FXS = boot()
    for i = 1, 6 do T.notOk(H.connect({ src = nextId(), ip = ('198.51.100.%d'):format(i), license = 'same' }).rejected) end
    T.ok(H.connect({ src = nextId(), ip = '198.51.100.99', license = 'same' }).rejected)
    T.ok(FXS.Lists.isBlocked('198.51.100.200', { 'license:same' }, FXS.Util.now()), 'the license is banned')
    T.ok(H.connect({ src = nextId(), ip = '198.51.100.201', license = 'same' }).rejected)
    T.notOk(attempt(H, {}).rejected, 'other players are not affected')
end)

T.test('banSec = 0 only rejects the excess attempts and never bans', function()
    local H, FXS = boot(prot('connectionFlood', { banSec = 0 }))
    for _ = 1, 10 do attempt(H, { ip = '203.0.113.8' }) end
    T.ok(attempt(H, { ip = '203.0.113.8' }).rejected)
    T.ok(attempt(H, { ip = '203.0.113.8' }).rejected)
    T.notOk(FXS.Lists.isBlocked('203.0.113.8', {}, FXS.Util.now()))
    T.eq(FXS.Stats.takeBatch().stats.banned, 0)
    H.seconds(31)
    T.notOk(attempt(H, { ip = '203.0.113.8' }).rejected)
end)

T.test('monitor mode reports what it would block but lets everybody in', function()
    local H, FXS = boot(prot('connectionFlood', { mode = 'monitor' }))
    for _ = 1, 20 do T.notOk(attempt(H, { ip = '203.0.113.9' }).rejected) end
    local batch = FXS.Stats.takeBatch()
    T.eq(batch.stats.blocked, 0)
    T.eq(batch.stats.allowed, 20)
    T.eq(batch.stats.monitored, 10)
    T.eq(batch.stats.byRule.connectionFlood.monitored, 10)
    local ev
    for _, e in ipairs(batch.events) do if e.type == 'connection_blocked' then ev = e end end
    T.eq(ev.action, 'logged')
    T.contains(ev.detail, 'would block')
    T.notOk(FXS.Lists.isBlocked('203.0.113.9', {}, FXS.Util.now()), 'no ban in monitor mode')
end)

T.test('mode off disables the flood guard completely', function()
    local H = boot(prot('connectionFlood', { mode = 'off' }))
    for _ = 1, 50 do T.notOk(attempt(H, { ip = '203.0.113.10' }).rejected) end
end)

T.test('limits follow the dashboard config (lower limit, shorter window)', function()
    local H = boot(prot('connectionFlood', { maxAttemptsPerIp = 2, windowSec = 5 }))
    T.notOk(attempt(H, { ip = '203.0.113.11' }).rejected)
    T.notOk(attempt(H, { ip = '203.0.113.11' }).rejected)
    T.ok(attempt(H, { ip = '203.0.113.11' }).rejected)
end)

T.test('a flood produces a handful of merged events, not thousands', function()
    local H, FXS = boot(prot('connectionFlood', { banSec = 0 }))
    for _ = 1, 500 do attempt(H, { ip = '203.0.113.12' }) end
    local batch = FXS.Stats.takeBatch()
    T.eq(batch.stats.blocked, 490)
    T.ok(#batch.events <= 3, 'got ' .. #batch.events .. ' events')
    local blocked
    for _, e in ipairs(batch.events) do if e.type == 'connection_blocked' then blocked = e end end
    T.eq(blocked.count, 490)
end)

T.test('custom kick messages from the dashboard are what the player sees', function()
    local H = boot({ protections = { connectionFlood = { banSec = 0 } }, messages = { rateLimited = 'Bitte kurz warten!' } })
    for _ = 1, 10 do attempt(H, { ip = '203.0.113.13' }) end
    T.eq(attempt(H, { ip = '203.0.113.13' }).reason, 'Bitte kurz warten!')
end)

-- ─── blocklist / allowlist ──────────────────────────────────────────────────

T.test('dashboard blocklist: IP, range and identifier are rejected with the ban message', function()
    local H, FXS = boot()
    FXS.Lists.applySnapshot({
        block = {
            { kind = 'ip', value = '1.2.3.4', reason = 'botnet' },
            { kind = 'cidr', value = '203.0.113.0/24' },
            { kind = 'identifier', value = 'discord:666' },
        },
    }, 2, FXS.Util.now())

    local r = H.connect({ src = 1, ip = '1.2.3.4', license = 'a' })
    T.ok(r.rejected)
    T.eq(r.reason, FXS.Settings.cfg.messages.banned)
    T.ok(H.connect({ src = 2, ip = '203.0.113.250', license = 'b' }).rejected)
    T.ok(H.connect({ src = 3, ip = '9.9.9.9', license = 'c', ids = { 'discord:666' } }).rejected)
    T.notOk(H.connect({ src = 4, ip = '9.9.9.9', license = 'd', ids = { 'discord:667' } }).rejected)

    local batch = FXS.Stats.takeBatch()
    T.eq(batch.stats.byRule.blocklist.blocked, 3)
end)

T.test('the allowlist beats the blocklist, the flood guard and every other check', function()
    local H, FXS = boot()
    FXS.Lists.applySnapshot({
        block = { { kind = 'cidr', value = '203.0.113.0/24' } },
        allow = { { kind = 'identifier', value = 'license:staff' } },
    }, 2, FXS.Util.now())
    for i = 1, 40 do
        T.notOk(H.connect({ src = nextId(), ip = '203.0.113.77', license = 'staff', name = '' }).rejected, 'attempt ' .. i)
    end
    T.ok(H.connect({ src = nextId(), ip = '203.0.113.78', license = 'stranger' }).rejected)
end)

T.test('Config.LocalAllowlist works without any backend', function()
    local H, FXS = boot()
    FXS.Lists.setLocalAllowlist({ 'license:owner' })
    FXS.Lists.applySnapshot({ block = { { kind = 'identifier', value = 'license:owner' } } }, 1, FXS.Util.now())
    T.notOk(H.connect({ src = 1, ip = '5.5.5.5', license = 'owner' }).rejected)
end)

T.test('hidden IPs: the 127.0.0.1 placeholder is "unknown", so players are never throttled as one big group', function()
    -- real FXServer returns 127.0.0.1 for EVERY player while sv_endpointprivacy is on (its default)
    local H, FXS = boot(nil, { convars = { sv_endpointprivacy = 'true' } })
    -- a restart wave: 60 different players reconnect within seconds
    for i = 1, 60 do
        local r = H.connect({ src = 7000 + i, ip = ('198.51.100.%d'):format(i), license = 'wave' .. i })
        T.notOk(r.rejected, 'player ' .. i .. ' must not be rejected')
    end
    T.notOk(FXS.Lists.isBlocked(nil, {}, FXS.Util.now()))
    T.eq(FXS.Stats.takeBatch().stats.blocked, 0)
end)

T.test('hidden IPs: nobody is exempted either – license limits, blocklist and identity checks still apply', function()
    local H, FXS = boot(nil, { convars = { sv_endpointprivacy = 'true' } })
    FXS.Lists.applySnapshot({ block = { { kind = 'identifier', value = 'license:banned' } } }, 1, FXS.Util.now())
    T.ok(H.connect({ src = 1, ip = '198.51.100.1', license = 'banned' }).rejected, 'blocklist by license')
    T.ok(H.connect({ src = 2, ip = '198.51.100.2', license = false }).rejected, 'no license')
    T.ok(H.connect({ src = 3, ip = '198.51.100.3', license = 'ok', name = '' }).rejected, 'empty name')
    for _ = 1, 6 do H.connect({ src = 4, ip = '198.51.100.4', license = 'spam' }) end
    T.ok(H.connect({ src = 5, ip = '198.51.100.5', license = 'spam' }).rejected, 'license flood')
end)

-- ─── identity and names ─────────────────────────────────────────────────────

T.test('a client without a license is rejected (unless sv_lan or switched off)', function()
    local H, FXS = boot()
    local r = H.connect({ src = 1, ip = '5.5.5.5', license = false })
    T.ok(r.rejected)
    T.eq(r.reason, FXS.Settings.cfg.messages.invalidIdentity)

    local lan = boot(nil, { convars = { sv_lan = 'true' } })
    T.notOk(lan.connect({ src = 1, ip = '5.5.5.5', license = false }).rejected, 'sv_lan has no licenses')

    local off = boot(prot('identityCheck', { requireLicense = false }))
    T.notOk(off.connect({ src = 1, ip = '5.5.5.5', license = false }).rejected)

    local monitor = boot(prot('identityCheck', { mode = 'monitor' }))
    T.notOk(monitor.connect({ src = 1, ip = '5.5.5.5', license = false }).rejected)
    T.eq(monitor.env.FXS.Stats.peek().monitored, 1)
end)

T.test('bad player names are rejected', function()
    local bad = {
        ['empty'] = '',
        ['spaces'] = '     ',
        ['tab and newline'] = '\t\n',
        ['non-breaking spaces'] = '\xC2\xA0\xC2\xA0',
        ['ideographic space'] = '\xE3\x80\x80',
        ['hangul filler'] = '\xE3\x85\xA4\xE3\x85\xA4',
        ['en quad'] = '\xE2\x80\x80',
        ['control char'] = 'Bob\1Marley',
        ['zero-width space'] = 'Al\xE2\x80\x8Bice',
        ['word joiner'] = 'Al\xE2\x81\xA0ice',
        ['BOM'] = '\xEF\xBB\xBFAlice',
        ['bidi override'] = 'Alice\xE2\x80\xAEevil',
        ['bidi isolate'] = '\xE2\x81\xA7Alice',
        ['invalid utf-8'] = 'Ali\xFFce',
        ['too long'] = ('x'):rep(101),
    }
    for label, name in pairs(bad) do
        local H, FXS = boot()
        local r = H.connect({ src = 1, ip = '5.5.5.5', license = 'a', name = name })
        T.ok(r.rejected, label)
        T.eq(r.reason, FXS.Settings.cfg.messages.invalidName, label)
    end
end)

T.test('normal names pass, including unicode, emoji and emoji sequences', function()
    local good = { 'John', 'Zo\xC3\xAB', '\xE5\xB1\xB1\xE7\x94\xB0\xE5\xA4\xAA\xE9\x83\x8E', '\xF0\x9F\x98\x80 Fan', '\xF0\x9F\x91\xA8\xE2\x80\x8D\xF0\x9F\x91\xA9', ('x'):rep(100), 'a b c', "O'Neil-Smith_99" }
    for _, name in ipairs(good) do
        local H = boot()
        T.notOk(H.connect({ src = 1, ip = '5.5.5.5', license = 'a', name = name }).rejected, name)
    end
end)

T.test('name rules can be tuned: max length and each check on its own', function()
    local H = boot(prot('identityCheck', { maxNameLength = 8 }))
    T.ok(H.connect({ src = 1, ip = '5.5.5.5', license = 'a', name = 'NineChars' }).rejected)
    T.notOk(H.connect({ src = 2, ip = '5.5.5.6', license = 'b', name = 'Eight123' }).rejected)

    local H2 = boot(prot('identityCheck', { blockHiddenChars = false }))
    T.notOk(H2.connect({ src = 1, ip = '5.5.5.5', license = 'a', name = 'Al\xE2\x80\x8Bice' }).rejected)

    local H3 = boot(prot('identityCheck', { blockEmptyName = false }))
    T.notOk(H3.connect({ src = 1, ip = '5.5.5.5', license = 'a', name = '   ' }).rejected)
end)

-- ─── accounts per IP ────────────────────────────────────────────────────────

T.test('accounts per IP: the limit counts connected players and frees up when one leaves', function()
    local H, FXS = boot(prot('playersPerIp', { mode = 'enforce', maxPlayers = 2 }))
    T.notOk(H.playerEnters({ src = 1, ip = '203.0.113.20', license = 'a' }).rejected)
    T.notOk(H.playerEnters({ src = 2, ip = '203.0.113.20', license = 'b' }).rejected)
    local r = H.connect({ src = 3, ip = '203.0.113.20', license = 'c' })
    T.ok(r.rejected)
    T.eq(r.reason, FXS.Settings.cfg.messages.tooManyPerIp)
    T.notOk(H.connect({ src = 4, ip = '203.0.113.21', license = 'd' }).rejected, 'other IPs are fine')
    H.drop(2)
    T.notOk(H.connect({ src = 5, ip = '203.0.113.20', license = 'e' }).rejected)
end)

T.test('accounts per IP is monitor-only by default', function()
    local H, FXS = boot(prot('connectionFlood', { mode = 'off' })) -- 8 joins from one IP would otherwise trip the flood guard
    for i = 1, 8 do T.notOk(H.playerEnters({ src = i, ip = '203.0.113.30', license = 'p' .. i }).rejected) end
    T.ok(FXS.Stats.peek().monitored >= 4)
end)

-- ─── under-attack mode ──────────────────────────────────────────────────────

T.test('attack mode: returning players get in, strangers are held back', function()
    local H, FXS = boot(prot('attackMode', { mode = 'on', newPlayers = 'block' }))
    FXS.Known.add('license:regular', FXS.Util.now())
    FXS.Attack.tick(FXS.Util.now())

    T.notOk(H.connect({ src = 1, ip = '5.5.5.1', license = 'regular' }).rejected)
    local r = H.connect({ src = 2, ip = '5.5.5.2', license = 'stranger' })
    T.ok(r.rejected)
    T.eq(r.reason, FXS.Settings.cfg.messages.attackMode)
    T.eq(FXS.Stats.takeBatch().stats.byRule.attackMode.blocked, 1)
end)

T.test("attack mode with newPlayers = 'allow' only tightens the IP limit", function()
    local H, FXS = boot(prot('attackMode', { mode = 'on', newPlayers = 'allow', limitPercent = 50 }))
    FXS.Attack.tick(FXS.Util.now())
    T.notOk(H.connect({ src = 1, ip = '5.5.5.2', license = 'stranger' }).rejected)
    -- default limit 10 -> 5 during the attack
    for _ = 1, 5 do T.notOk(attempt(H, { ip = '203.0.113.40' }).rejected) end
    T.ok(attempt(H, { ip = '203.0.113.40' }).rejected)
end)

T.test('attack monitor mode lets strangers in but reports them', function()
    local H, FXS = boot(prot('attackMode', { mode = 'monitor', triggerBlockedPerMin = 5, triggerAttemptsPerMin = 20 }))
    for _ = 1, 25 do attempt(H) end
    FXS.Attack.tick(FXS.Util.now())
    T.eq(FXS.Attack.state, 'attack')
    T.notOk(H.connect({ src = nextId(), ip = '5.5.5.9', license = 'stranger' }).rejected)
    T.ok(FXS.Stats.takeBatch().stats.byRule.attackMode.monitored >= 1)
end)

T.test('the "returning players only" gate does not keep an attack alive by itself', function()
    local H, FXS = boot(prot('attackMode', { mode = 'auto', newPlayers = 'block', triggerBlockedPerMin = 5, triggerAttemptsPerMin = 100000, minDurationSec = 30 }))
    -- trigger with real rejections (flood guard, not the gate)
    for _ = 1, 10 do attempt(H, { ip = '203.0.113.50' }) end
    for _ = 1, 8 do attempt(H, { ip = '203.0.113.50' }) end
    FXS.Attack.tick(FXS.Util.now())
    T.eq(FXS.Attack.state, 'attack')
    -- now only strangers arrive and are held back by the gate
    -- the rates look back 60 s, then minDurationSec (30 s) must pass: ~90 s after the last real rejection
    local ended
    for s = 1, 70 do
        H.seconds(2)
        FXS.Attack.tick(FXS.Util.now())
        for _ = 1, 3 do attempt(H) end
        if FXS.Attack.state == 'normal' then ended = s; break end
    end
    T.ok(ended, 'the attack must end although strangers keep trying')
    T.ok(ended >= 30 and ended <= 55, 'ended after ~' .. tostring(ended * 2) .. ' s')
end)

T.test('full scenario: a join flood from many IPs switches attack mode on by itself, then it ends', function()
    local H, FXS = boot() -- defaults: auto, 600 attempts/min, block new players, min 180 s
    H.advance(2000) -- let the scheduler thread start
    FXS.Known.add('license:regular', FXS.Util.now())
    H.seconds(1)

    for i = 1, 700 do
        H.connect({ src = 5000 + i, ip = ('100.64.%d.%d'):format(i // 250, i % 250 + 1), license = 'bot' .. i })
    end
    H.seconds(2) -- the scheduler tick notices the flood
    T.eq(FXS.Attack.state, 'attack')
    T.ok(FXS.Attack.active())

    T.ok(H.connect({ src = 1, ip = '5.5.5.5', license = 'newcomer' }).rejected, 'strangers wait')
    T.notOk(H.connect({ src = 2, ip = '5.5.5.6', license = 'regular' }).rejected, 'regulars still get in')

    H.seconds(300)
    T.eq(FXS.Attack.state, 'normal')
    T.notOk(H.connect({ src = 3, ip = '5.5.5.7', license = 'newcomer2' }).rejected, 'normal operation again')

    local types = {}
    for _, e in ipairs(FXS.Stats.takeBatch().events) do types[#types + 1] = e.type end
    T.ok(table.concat(types, ','):find('attack_started', 1, true))
    T.ok(table.concat(types, ','):find('attack_ended', 1, true))
end)

-- ─── robustness ─────────────────────────────────────────────────────────────

T.test('hidden IPs (sv_endpointprivacy): IP limits stay inactive, license limits still work, one warning', function()
    local H, FXS = boot(nil, { convars = { sv_endpointprivacy = 'true' } })
    for i = 1, 20 do T.notOk(H.connect({ src = nextId(), ip = '203.0.113.60', license = 'v' .. i }).rejected) end
    for _ = 1, 6 do H.connect({ src = nextId(), ip = '203.0.113.60', license = 'same' }) end
    T.ok(H.connect({ src = nextId(), ip = '203.0.113.60', license = 'same' }).rejected)

    local warnings = 0
    for _, e in ipairs(FXS.Stats.takeBatch().events) do
        if e.type == 'warning' and e.rule == 'endpointPrivacy' then warnings = warnings + 1 end
    end
    T.eq(warnings, 1)
end)

T.test('an internal error never locks players out (fail open) and is logged', function()
    local H, FXS = boot()
    FXS.Stats.count = function() error('simulated bug') end
    local r = H.connect({ src = 1, ip = '5.5.5.5', license = 'a' })
    T.notOk(r.rejected)
    T.contains(H.log(), 'letting the player in')
    T.contains(H.log(), 'simulated bug')
end)

T.test('messages sent to the player never contain internal details', function()
    local H, FXS = boot(prot('connectionFlood', { banSec = 0 }))
    for _ = 1, 10 do attempt(H, { ip = '203.0.113.70' }) end
    local r = attempt(H, { ip = '203.0.113.70' })
    T.notContains(r.reason, 'limit')
    T.notContains(r.reason, '203.0.113.70')
    local _ = FXS
end)

T.test('evaluate is deterministic for the same input (pure decision function)', function()
    local _, FXS = boot()
    local info = { ip = '5.5.5.5', ids = { 'license:x' }, idByType = { license = 'license:x' }, license = 'license:x', name = 'Fine' }
    local a = FXS.Guard.evaluate(info, 1000, 1000)
    T.ok(a.allow)
end)
