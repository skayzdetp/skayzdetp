local T, Harness = ...

local function util()
    return Harness.new().env.FXS.Util
end

T.test('parseIpv4 accepts dotted quads only', function()
    local U = util()
    T.eq(U.parseIpv4('1.2.3.4'), 16909060)
    T.eq(U.parseIpv4('255.255.255.255'), 0xFFFFFFFF)
    for _, bad in ipairs({ '256.1.1.1', '1.2.3', '1.2.3.4.5', 'a.b.c.d', '', '1.2.3.4/24', ' 1.2.3.4' }) do
        T.eq(U.parseIpv4(bad), nil, bad)
    end
    T.eq(U.parseIpv4(nil), nil)
    T.eq(U.ipv4ToString(16909060), '1.2.3.4')
end)

T.test('normalizeIp handles ports, privacy placeholders and IPv6', function()
    local U = util()
    T.eq(U.normalizeIp('203.0.113.7'), '203.0.113.7')
    T.eq(U.normalizeIp('203.0.113.7:30120'), '203.0.113.7')
    T.eq(U.normalizeIp('  203.0.113.7  '), '203.0.113.7')
    T.eq(U.normalizeIp('0.0.0.0'), nil, 'endpoint privacy placeholder')
    T.eq(U.normalizeIp(''), nil)
    T.eq(U.normalizeIp(nil), nil)
    T.eq(U.normalizeIp('hello'), nil)
    T.eq(U.normalizeIp('::ffff:1.2.3.4'), '1.2.3.4')
    T.eq(U.normalizeIp('[2001:DB8::1]:30120'), '2001:db8::1')
    T.eq(U.normalizeIp('2001:db8::1'), '2001:db8::1')
    T.eq(U.normalizeIp('::'), nil)
end)

T.test('parseCidr validates and masks', function()
    local U = util()
    local net, plen = U.parseCidr('203.0.113.0/24')
    T.eq(U.ipv4ToString(net), '203.0.113.0')
    T.eq(plen, 24)
    local net2 = U.parseCidr('203.0.113.77/24')
    T.eq(U.ipv4ToString(net2), '203.0.113.0', 'host bits are cleared')
    for _, bad in ipairs({ '1.2.3.4/7', '1.2.3.4/33', '1.2.3.4', '1.2.3.4/x', '300.1.1.1/24', 'fe80::/10' }) do
        T.eq(U.parseCidr(bad), nil, bad)
    end
end)

T.test('safeText always returns valid, bounded, control-free UTF-8', function()
    local U = util()
    T.eq(U.safeText('  hello\nworld\t! ', 100), 'hello world !')
    T.eq(U.safeText('a\0b', 100), 'a b')
    T.eq(U.safeText(nil, 10), '')
    local bad = U.safeText('abc\xFF\xFEdef', 100)
    T.ok(utf8.len(bad) ~= nil, 'invalid bytes are replaced')
    T.eq(bad, 'abc??def')
    -- truncation must not cut a multi-byte character in half
    local cut = U.safeText('aé' .. 'é' .. 'é', 4) -- a(1) é(2) é(2) -> 4 bytes would split the 2nd é
    T.ok(utf8.len(cut) ~= nil, 'cut result is valid UTF-8')
    T.ok(#cut <= 4)
    T.eq(U.safeText(('x'):rep(500), 300):len(), 300)
end)

T.test('identifiers: stable types only, lowercase, ip extracted separately', function()
    local H = Harness.new()
    H.player({ src = 5, ip = '203.0.113.9', license = 'ABCDEF', ids = { 'discord:123', 'steam:11000010ABCDEF', 'live:777', 'tokens:zzz' } })
    local ids = H.env.FXS.Util.identifiers(5)
    T.eq(ids.byType.license, 'license:abcdef')
    T.eq(ids.byType.discord, 'discord:123')
    T.eq(ids.byType.steam, 'steam:11000010abcdef')
    T.eq(ids.byType.tokens, nil, 'unknown types are ignored')
    T.eq(ids.ip, '203.0.113.9')
    T.eq(#ids.list, 4)
    T.eq(H.env.FXS.Util.licenseOf(ids), 'license:abcdef')
    T.eq(#H.env.FXS.Util.identifiers(999).list, 0, 'unknown player')
end)

T.test('logThrottled prints once per interval', function()
    local H = Harness.new()
    local U = H.env.FXS.Util
    T.ok(U.logThrottled('k', 60, 'log', 'first'))
    T.notOk(U.logThrottled('k', 60, 'log', 'second'))
    H.seconds(61)
    T.ok(U.logThrottled('k', 60, 'log', 'third'))
end)
