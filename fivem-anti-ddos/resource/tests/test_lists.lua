local T, Harness = ...

local function lists()
    local env = Harness.new().env
    return env.FXS.Lists, env.FXS.Util
end

T.test('classify understands IPs, ranges and identifiers', function()
    local L = lists()
    local function c(v)
        local kind, value = L.classify(v)
        return kind and (kind .. '=' .. value) or nil
    end
    T.eq(c('1.2.3.4'), 'ip=1.2.3.4')
    T.eq(c('ip:1.2.3.4'), 'ip=1.2.3.4')
    T.eq(c('10.9.8.7/8'), 'cidr=10.0.0.0/8')
    T.eq(c('203.0.113.9/32'), 'ip=203.0.113.9')
    T.eq(c('License:ABC123'), 'identifier=license:abc123')
    T.eq(c('discord:99'), 'identifier=discord:99')
    T.eq(c('2001:DB8::1'), 'ip=2001:db8::1')
    for _, bad in ipairs({ '', 'hello', '1.2.3.4/7', 'foo:bar', 'tokens:abc' }) do T.eq(c(bad), nil, bad) end
    T.eq(c(nil), nil)
end)

T.test('snapshot: exact IPs, CIDR ranges, identifiers and expiry', function()
    local L = lists()
    local now = 1000
    L.applySnapshot({
        block = {
            { kind = 'ip', value = '1.2.3.4', reason = 'bot' },
            { kind = 'cidr', value = '203.0.113.0/24' },
            { kind = 'cidr', value = '198.51.0.0/16' },
            { kind = 'identifier', value = 'license:badbad', ttl = 60 },
            { kind = 'ip', value = '9.9.9.9', ttl = 0 }, -- already expired
        },
        allow = { { kind = 'identifier', value = 'discord:42' } },
    }, 7, now)

    T.eq(L.rev, 7)
    T.ok(L.isBlocked('1.2.3.4', {}, now))
    T.eq(L.isBlocked('1.2.3.4', {}, now).reason, 'bot')
    T.ok(L.isBlocked('203.0.113.200', {}, now), 'inside /24')
    T.notOk(L.isBlocked('203.0.114.1', {}, now), 'outside /24')
    T.ok(L.isBlocked('198.51.77.1', {}, now), 'inside /16')
    T.notOk(L.isBlocked('198.52.0.1', {}, now))
    T.ok(L.isBlocked('5.5.5.5', { 'license:badbad' }, now), 'by identifier')
    T.notOk(L.isBlocked('5.5.5.5', { 'license:badbad' }, now + 61), 'identifier ban expired')
    T.notOk(L.isBlocked('9.9.9.9', {}, now), 'expired entries are skipped')
    T.ok(L.isAllowed('5.5.5.5', { 'discord:42' }, now))
    T.notOk(L.isAllowed('5.5.5.5', { 'discord:43' }, now))
end)

T.test('the most specific CIDR prefix is found no matter how many ranges exist', function()
    local L = lists()
    local entries = {}
    for i = 1, 2000 do entries[#entries + 1] = { kind = 'cidr', value = ('10.%d.%d.0/24'):format(i // 256, i % 256) } end
    L.applySnapshot({ block = entries }, 1, 0)
    T.eq(L.remote.block.count, 2000)
    T.eq(#L.remote.block.prefixes, 1, 'lookups are per prefix length, not per entry')
    T.ok(L.isBlocked('10.3.232.55', {}, 0))
    T.notOk(L.isBlocked('11.0.0.1', {}, 0))
end)

T.test('invalid snapshot entries are ignored, not fatal', function()
    local L = lists()
    L.applySnapshot({ block = { 'junk', 5, { value = 5 }, { value = 'nonsense' }, { value = '4.4.4.4' } }, allow = 'nope' }, 1, 0)
    T.eq(L.remote.block.count, 1)
    T.eq(L.remote.allow.count, 0)
    L.applySnapshot(nil, nil, 0)
    T.eq(L.remote.block.count, 0)
end)

T.test('temporary bans: by IP and identifier, with expiry, custom message and unban', function()
    local L = lists()
    local added = L.ban({ '8.8.8.8', 'license:abc', 'garbage' }, 300, 'testing', 'rateLimited', 100)
    T.eq(added, 2)
    local e, source = L.isBlocked('8.8.8.8', {}, 200)
    T.eq(source, 'ban')
    T.eq(e.msg, 'rateLimited')
    T.eq(e.reason, 'testing')
    T.ok(L.isBlocked('1.1.1.1', { 'license:abc' }, 200))
    T.notOk(L.isBlocked('8.8.8.8', {}, 401), 'expired')

    T.ok(L.isBlocked('8.8.8.8', {}, 200))
    T.ok(L.unban('8.8.8.8'))
    T.notOk(L.isBlocked('8.8.8.8', {}, 200))
    T.notOk(L.unban('8.8.8.8'))
end)

T.test('a ban entry beats a blocklist entry in reporting (ban is checked first)', function()
    local L = lists()
    L.applySnapshot({ block = { { kind = 'ip', value = '7.7.7.7' } } }, 1, 0)
    L.ban({ '7.7.7.7' }, 60, 'x', 'rateLimited', 0)
    local _, source = L.isBlocked('7.7.7.7', {}, 1)
    T.eq(source, 'ban')
end)

T.test('local allowlist from config', function()
    local env = Harness.new().env
    local L = env.FXS.Lists
    L.setLocalAllowlist({ 'license:ME', '203.0.113.0/24', 'bogus-entry' })
    T.ok(L.isAllowed('1.1.1.1', { 'license:me' }, 0))
    T.ok(L.isAllowed('203.0.113.50', {}, 0))
    T.notOk(L.isAllowed('1.1.1.1', {}, 0))
end)

T.test('sweep drops expired entries', function()
    local L = lists()
    L.ban({ '1.1.1.1', '2.2.2.2' }, 10, 'x', 'banned', 0)
    L.ban({ '3.3.3.3' }, 1000, 'x', 'banned', 0)
    L.sweep(500)
    T.eq(L.bans.count, 1)
end)

T.test('exportSnapshot round-trips through the cache format', function()
    local L = lists()
    L.applySnapshot({ block = { { kind = 'ip', value = '1.2.3.4', reason = 'r', ttl = 100 }, { kind = 'cidr', value = '10.0.0.0/8' } } }, 3, 1000)
    local exported = L.exportSnapshot(1000)
    T.eq(#exported.block, 2)
    L.applySnapshot(exported, 3, 1050)
    T.ok(L.isBlocked('1.2.3.4', {}, 1050))
    T.notOk(L.isBlocked('1.2.3.4', {}, 1101), 'absolute expiry survives the round trip')
    T.ok(L.isBlocked('10.1.1.1', {}, 1050))
end)
