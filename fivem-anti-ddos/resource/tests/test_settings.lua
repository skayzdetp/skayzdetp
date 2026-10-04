local T, Harness = ...

local function settings()
    local env = Harness.new().env
    return env.FXS.Settings, env
end

T.test('defaults are complete and valid', function()
    local S, env = settings()
    local cfg = S.defaults()
    T.eq(cfg.v, env.FXS.CONFIG_VERSION)
    T.eq(cfg.general.pollIntervalSec, 10)
    for id, pdef in pairs(env.FXS.Schema.protections) do
        T.eq(cfg.protections[id].mode, pdef.default, id)
        for key in pairs(pdef.fields) do T.ok(cfg.protections[id][key] ~= nil, id .. '.' .. key) end
    end
    T.eq(cfg.protections.connectionFlood.mode, 'enforce')
    T.eq(cfg.protections.playersPerIp.mode, 'monitor')
    T.ok(#cfg.messages.banned > 0)
end)

T.test('normalize is idempotent', function()
    local S = settings()
    local once = S.normalize({ protections = { connectionFlood = { maxAttemptsPerIp = 12345, mode = 'monitor' } } })
    T.deepEq(S.normalize(once), once)
end)

T.test('numbers are clamped, rounded and coerced; always integers', function()
    local S = settings()
    local cf = S.normalize({
        protections = { connectionFlood = { maxAttemptsPerIp = 99999, windowSec = -5, banSec = 12.6, maxAttemptsPerLicense = '7' } },
    }).protections.connectionFlood
    T.eq(cf.maxAttemptsPerIp, 200)
    T.eq(cf.windowSec, 5)
    T.eq(cf.banSec, 13)
    T.eq(cf.maxAttemptsPerLicense, 7)
    T.eq(math.type(cf.banSec), 'integer')
    T.eq(math.type(cf.maxAttemptsPerIp), 'integer')
end)

T.test('wrong types, NaN, infinity and unknown options fall back to defaults', function()
    local S = settings()
    local cfg = S.normalize({
        general = { pollIntervalSec = 'fast' },
        protections = {
            connectionFlood = { mode = 'destroy', windowSec = 0 / 0, banSec = math.huge },
            identityCheck = { requireLicense = 'yes' },
            gameEventFlood = { action = 'nuke' },
            bogus = { mode = 'enforce' },
        },
    })
    T.eq(cfg.general.pollIntervalSec, 10)
    T.eq(cfg.protections.connectionFlood.mode, 'enforce')
    T.eq(cfg.protections.connectionFlood.windowSec, 30)
    T.eq(cfg.protections.connectionFlood.banSec, 300)
    T.eq(cfg.protections.identityCheck.requireLicense, true)
    T.eq(cfg.protections.gameEventFlood.action, 'cancel')
    T.eq(cfg.protections.bogus, nil)
end)

T.test('garbage input never crashes', function()
    local S = settings()
    local defaults = S.defaults()
    for _, junk in ipairs({ 5, 'x', true }) do T.deepEq(S.normalize(junk), defaults) end
    T.deepEq(S.normalize(nil), defaults)
    T.deepEq(S.normalize({ protections = 'no', general = 5, messages = true }), defaults)
end)

T.test('messages are cleaned and fall back when empty', function()
    local S = settings()
    local cfg = S.normalize({ messages = { banned = '  Go\0away\n ', kicked = '', blocked = 5 } })
    T.eq(cfg.messages.banned, 'Go away')
    T.eq(cfg.messages.kicked, S.defaults().messages.kicked)
    T.eq(cfg.messages.blocked, S.defaults().messages.blocked)
end)

T.test('apply activates the config, stores the revision and notifies listeners', function()
    local S = settings()
    local seen
    S.onChange(function(new, old) seen = { new = new.protections.attackMode.mode, old = old.protections.attackMode.mode } end)
    S.apply({ protections = { attackMode = { mode = 'on' } } }, 9)
    T.eq(S.rev, 9)
    T.eq(S.get('attackMode').mode, 'on')
    T.deepEq(seen, { new = 'on', old = 'auto' })
end)

T.test('a failing listener does not break apply', function()
    local S, env = settings()
    S.onChange(function() error('boom') end)
    S.apply({}, 1)
    T.eq(S.rev, 1)
    local H = env
    T.ok(H ~= nil)
end)

T.test('msg falls back to the generic message for unknown keys', function()
    local S = settings()
    T.eq(S.msg('doesNotExist'), S.cfg.messages.blocked)
end)
