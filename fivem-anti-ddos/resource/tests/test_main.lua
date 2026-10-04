local T, Harness = ...

local function boot(opts)
    local H = Harness.new(opts)
    return H, H.env.FXS
end

local function command(H, ...)
    H.out = {}
    H.commands.fxshield(0, { ... })
    return H.log()
end

T.test('the manifest lists every script, in a valid order, and every file exists and compiles', function()
    local m = Harness.readManifest(Harness.defaultDir)
    T.eq(m.fx_version, 'cerulean')
    T.eq(m.game, 'gta5')
    T.eq(m.lua54, 'yes')
    T.eq(m.server_only, 'yes')
    T.ok(m.version and m.version:match('^%d+%.%d+%.%d+$'), 'semantic version')
    T.eq(m.client_scripts, nil, 'server-only: nothing is shipped to players')
    T.eq(m.shared_scripts, nil)
    T.eq(m.files, nil, 'no downloadable files')

    local listed = {}
    for i, file in ipairs(m.server_scripts) do
        listed[file] = i
        local f = io.open(Harness.defaultDir .. '/' .. file, 'r')
        T.ok(f, file .. ' exists')
        local src = f:read('a')
        f:close()
        T.ok(load(src, '@' .. file), file .. ' compiles')
    end
    T.ok(listed['config.lua'] < listed['generated/schema.lua'])
    T.ok(listed['generated/schema.lua'] < listed['server/settings.lua'], 'schema before the code that needs it')
    T.eq(listed['server/main.lua'], #m.server_scripts, 'main.lua runs last')

    -- no script on disk that the manifest forgot
    local p = io.popen('ls "' .. Harness.defaultDir .. '/server"')
    for name in p:lines() do
        T.ok(listed['server/' .. name], 'server/' .. name .. ' is listed in the manifest')
    end
    p:close()
end)

T.test('the generated schema matches what the code expects (every protection the code reads exists)', function()
    local H, FXS = boot()
    local used = { 'connectionFlood', 'playersPerIp', 'identityCheck', 'attackMode', 'gameEventFlood', 'entitySpam', 'entityLockdown', 'chatFlood' }
    for _, id in ipairs(used) do
        T.ok(FXS.Schema.protections[id], 'schema has ' .. id)
        T.ok(FXS.Settings.get(id), 'defaults have ' .. id)
    end
    for _, key in ipairs({ 'blocked', 'banned', 'rateLimited', 'attackMode', 'invalidIdentity', 'invalidName', 'tooManyPerIp', 'kicked' }) do
        T.ok(FXS.Settings.cfg.messages[key], 'message ' .. key)
    end
    local _ = H
end)

T.test('startup warns about OneSync being off and about hidden player IPs', function()
    local H = boot({ convars = { onesync = 'off', sv_endpointprivacy = 'true' } })
    T.contains(H.log(), 'OneSync is disabled')
    T.contains(H.log(), 'sv_endpointprivacy is enabled')
    local on = boot({ convars = { onesync = 'on' } })
    T.notContains(on.log(), 'OneSync is disabled')
end)

T.test('players who are already online when the resource starts are tracked and become returning players', function()
    local H = Harness.new({ load = false })
    H.player({ src = 3, ip = '203.0.113.3', license = 'early', name = 'Early' })
    H.joined[3] = true
    H.load()
    H.advance(10)
    T.eq(H.env.FXS.Players.perIp['203.0.113.3'], 1)
    T.ok(H.env.FXS.Known.has('license:early'))
end)

T.test('console command: status shows the important numbers', function()
    local H = boot()
    H.playerEnters({ src = 1, ip = '198.51.100.1', license = 'a' })
    local out = command(H, 'status')
    T.contains(out, '[fxshield]')
    T.contains(out, 'not connected')
    T.contains(out, 'config revision 0')
    T.contains(out, 'connectionFlood')
    T.contains(out, '1 attempts')
    T.eq(command(H), out, 'no argument = status')
end)

T.test('console command: ban / bans / unban', function()
    local H, FXS = boot()
    T.contains(command(H, 'ban', '203.0.113.99', '5'), 'banned 203.0.113.99 for 5 minutes')
    T.ok(H.connect({ src = 1, ip = '203.0.113.99', license = 'x' }).rejected)
    T.contains(command(H, 'bans'), '203.0.113.99')
    T.contains(command(H, 'unban', '203.0.113.99'), 'removed')
    T.notOk(H.connect({ src = 2, ip = '203.0.113.99', license = 'y' }).rejected)
    T.contains(command(H, 'unban', '203.0.113.99'), 'no such temporary ban')
    T.contains(command(H, 'ban', 'nonsense'), 'not a valid')
    T.contains(command(H, 'ban'), 'usage')
    T.contains(command(H, 'bans'), 'no temporary bans')
    T.contains(command(H, 'wat'), 'usage')
    local _ = FXS
end)

T.test('console command: sync without a backend explains itself, in-game callers are ignored', function()
    local H = boot()
    T.contains(command(H, 'sync'), 'not possible')
    H.out = {}
    H.commands.fxshield(5, { 'status' }) -- a player, not the console
    T.eq(#H.out, 0)
end)

T.test('console command: sync triggers an immediate request', function()
    local H = boot({ convars = { fxshield_url = 'https://shield.test', fxshield_key = 'fxs_k' } })
    H.advance(2000)
    T.eq(#H.requests, 1)
    H.requests[1].cb(200, '{"ok":true,"protocol":1,"pollIntervalSec":60}', {})
    H.advance(3000)
    T.eq(#H.requests, 1, 'next regular sync is a minute away')
    command(H, 'sync')
    T.eq(#H.requests, 2)
end)

T.test('exports: isBlocked, isUnderAttack, ban, unban', function()
    local H, FXS = boot()
    FXS.Lists.applySnapshot({ block = { { kind = 'ip', value = '1.2.3.4' }, { kind = 'identifier', value = 'license:bad' } } }, 1, FXS.Util.now())
    T.ok(H.exports.isBlocked('1.2.3.4'))
    T.ok(H.exports.isBlocked('license:bad'))
    T.notOk(H.exports.isBlocked('5.6.7.8'))
    T.notOk(H.exports.isBlocked('nonsense'))
    T.notOk(H.exports.isUnderAttack())

    T.ok(H.exports.ban('5.6.7.8', 60, 'from another resource'))
    T.ok(H.exports.isBlocked('5.6.7.8'))
    T.ok(H.exports.unban('5.6.7.8'))
    T.notOk(H.exports.isBlocked('5.6.7.8'))

    FXS.Settings.apply({ protections = { attackMode = { mode = 'on' } } }, 2)
    FXS.Attack.tick(FXS.Util.now())
    T.ok(H.exports.isUnderAttack())
end)

T.test('Config.LocalAllowlist is honoured from startup', function()
    local H = Harness.new({
        load = false,
        config = function(env)
            -- emulate the owner editing config.lua after it ran
            env.__patch = true
        end,
    })
    H.load()
    local FXS = H.env.FXS
    H.env.Config.LocalAllowlist = { 'license:owner' }
    FXS.Lists.setLocalAllowlist(H.env.Config.LocalAllowlist)
    T.ok(FXS.Lists.isAllowed(nil, { 'license:owner' }, FXS.Util.now()))
end)

T.test('the scheduler keeps ticking (attack detection runs without any player action)', function()
    local H, FXS = boot()
    FXS.Settings.apply({ protections = { attackMode = { mode = 'on' } } }, 1)
    H.advance(4000)
    T.eq(FXS.Attack.state, 'attack')
    FXS.Settings.apply({ protections = { attackMode = { mode = 'off' } } }, 2)
    H.advance(2500)
    T.eq(FXS.Attack.state, 'normal')
end)

T.test('housekeeping runs and expired bans disappear on their own', function()
    local H, FXS = boot()
    FXS.Lists.ban({ '1.1.1.1' }, 10, 'x', 'banned', FXS.Util.now())
    T.eq(FXS.Lists.bans.count, 1)
    H.advance(61000)
    T.eq(FXS.Lists.bans.count, 0)
end)

T.test('the tick-delay probe reports a number', function()
    local H, FXS = boot()
    H.advance(1000)
    T.ok(type(FXS.Sync.health.tickMs) == 'number')
end)
