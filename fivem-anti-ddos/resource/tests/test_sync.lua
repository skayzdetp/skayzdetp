local T, Harness = ...
local json = Harness.json

local CONVARS = { fxshield_url = 'https://shield.test', fxshield_key = 'fxs_testkey' }

local function boot(opts)
    opts = opts or {}
    opts.convars = opts.convars or {}
    for k, v in pairs(CONVARS) do
        if opts.convars[k] == nil then opts.convars[k] = v end
    end
    local H = Harness.new(opts)
    return H, H.env.FXS
end

--- A successful backend answer.
local function okBody(extra)
    local body = { ok = true, protocol = 1, serverTime = 1, pollIntervalSec = 10, ackSeq = 0, configRev = 0, listsRev = 0 }
    for k, v in pairs(extra or {}) do body[k] = v end
    return json.encode(body)
end

local function answer(req, status, body)
    req.cb(status, body or '', {})
end

local function lastRequest(H)
    return H.requests[#H.requests]
end

-- ─── basics ─────────────────────────────────────────────────────────────────

T.test('without URL / key nothing is ever sent and the console explains what to do', function()
    local H = Harness.new()
    H.advance(60000)
    T.eq(#H.requests, 0)
    T.contains(H.log(), 'no backend configured')
    T.contains(H.log(), 'fxshield_key')
end)

T.test('the first sync carries protocol, identity, server info and the startup event', function()
    local H = boot({ convars = { sv_maxclients = '64', sv_projectName = 'My RP', sv_hostname = 'ignored', onesync = 'on', version = 'FXServer-test v1' } })
    H.playerEnters({ src = 1, ip = '198.51.100.1', license = 'aaa' })
    H.advance(2000)
    T.eq(#H.requests, 1)
    local req = H.requests[1]
    T.eq(req.url, 'https://shield.test/api/agent/v1/sync')
    T.eq(req.method, 'POST')
    T.eq(req.headers['Authorization'], 'Bearer fxs_testkey')
    T.eq(req.headers['Content-Type'], 'application/json')

    local p = req.json
    T.eq(p.protocol, 1)
    T.eq(p.resource.version, '1.0.0')
    T.eq(#p.resource.session >= 8, true)
    T.eq(p.resource.seq, 1)
    T.eq(p.state.configRev, 0)
    T.eq(p.state.listsRev, 0)
    T.eq(p.state.attack, false)
    T.eq(p.server.name, 'My RP')
    T.eq(p.server.players, 1)
    T.eq(p.server.maxPlayers, 64)
    T.eq(p.server.onesync, 'on')
    T.eq(p.server.build, 'FXServer-test v1')
    T.eq(p.server.endpointPrivacy, false)
    T.eq(p.stats.attempts, 1)
    T.eq(p.stats.allowed, 1)
    local types = {}
    for _, e in ipairs(p.events) do types[e.type] = true end
    T.ok(types.resource_started)
end)

T.test('the URL is normalised (whitespace, trailing slashes)', function()
    local H = boot({ convars = { fxshield_url = ' https://shield.test/// ' } })
    H.advance(2000)
    T.eq(H.requests[1].url, 'https://shield.test/api/agent/v1/sync')
end)

T.test('URL checks: plain http to a public host warns, localhost does not, other schemes are errors', function()
    T.contains(boot({ convars = { fxshield_url = 'http://shield.example.com' } }).log(), 'unencrypted')
    T.notContains(boot({ convars = { fxshield_url = 'http://localhost:8080' } }).log(), 'unencrypted')
    T.notContains(boot({ convars = { fxshield_url = 'http://192.168.1.5:8080' } }).log(), 'unencrypted')
    T.contains(boot({ convars = { fxshield_url = 'ftp://x' } }).log(), 'must start with')
end)

-- ─── applying what the backend sends ────────────────────────────────────────

T.test('a successful answer applies config and lists, persists them and reports the revisions next time', function()
    local H, FXS = boot()
    H.advance(2000)
    answer(H.requests[1], 200, okBody({
        ackSeq = 1,
        configRev = 7,
        config = { protections = { connectionFlood = { maxAttemptsPerIp = 2 } } },
        listsRev = 4,
        lists = { block = { { kind = 'ip', value = '1.2.3.4', reason = 'bot' }, { kind = 'cidr', value = '203.0.113.0/24', ttl = 3600 } }, allow = { { kind = 'identifier', value = 'license:me' } } },
    }))

    T.eq(FXS.Settings.rev, 7)
    T.eq(FXS.Settings.get('connectionFlood').maxAttemptsPerIp, 2)
    T.eq(FXS.Lists.rev, 4)
    T.eq(FXS.Lists.remote.block.count, 2)
    T.ok(FXS.Lists.isBlocked('203.0.113.9', {}, FXS.Util.now()))
    T.ok(FXS.Lists.isAllowed('9.9.9.9', { 'license:me' }, FXS.Util.now()))
    T.contains(H.log(), 'configuration updated (revision 7)')
    T.contains(H.log(), 'connected to the backend')

    local cached = json.decode(H.files['cache.json'])
    T.eq(cached.configRev, 7)
    T.eq(cached.config.protections.connectionFlood.maxAttemptsPerIp, 2)
    T.eq(#cached.lists.block, 2)

    H.advance(10500)
    T.eq(#H.requests, 2)
    local p = H.requests[2].json
    T.eq(p.state.configRev, 7)
    T.eq(p.state.listsRev, 4)
    T.eq(p.resource.seq, 0, 'the first batch was acknowledged, nothing new to report')
end)

T.test('after applying something new a confirmation sync follows within seconds (not a full interval)', function()
    local H = boot()
    H.advance(2000)
    answer(H.requests[1], 200, okBody({ configRev = 2, config = { protections = {} } }))
    local appliedAt = H.nowMs
    H.advance(2500)
    T.eq(#H.requests, 2, 'confirmation sync')
    T.near(H.requests[2].at - appliedAt, 1000, 1100)
    T.eq(H.requests[2].json.state.configRev, 2, 'it reports the revision that is now active')

    -- nothing new this time: back to the normal interval
    answer(H.requests[2], 200, okBody({ configRev = 2 }))
    H.advance(5000)
    T.eq(#H.requests, 2)
    H.advance(6000)
    T.eq(#H.requests, 3)
end)

T.test('the dashboard poll interval is honoured', function()
    local H = boot()
    H.advance(2000)
    answer(H.requests[1], 200, okBody({ pollIntervalSec = 5 }))
    local t0 = H.nowMs
    H.advance(6500)
    T.eq(#H.requests, 2)
    T.near(H.requests[2].at - t0, 5000, 1100)
end)

T.test('config received from the backend is validated, not trusted', function()
    local H, FXS = boot()
    H.advance(2000)
    answer(H.requests[1], 200, okBody({
        configRev = 3,
        config = { protections = { connectionFlood = { maxAttemptsPerIp = 99999999, mode = 'rm -rf', windowSec = 'x' } }, evil = true },
    }))
    local cf = FXS.Settings.get('connectionFlood')
    T.eq(cf.maxAttemptsPerIp, 200)
    T.eq(cf.mode, 'enforce')
    T.eq(cf.windowSec, 30)
end)

T.test('new data after an acknowledged batch goes out as the next batch (seq + 1)', function()
    local H, FXS = boot()
    H.advance(2000)
    answer(H.requests[1], 200, okBody())
    H.connect({ src = 1, ip = '198.51.100.9', license = 'x' })
    H.advance(10500)
    local p = H.requests[2].json
    T.eq(p.resource.seq, 2)
    T.eq(p.stats.attempts, 1)
    local _ = FXS
end)

T.test('the attack flag is reported', function()
    local H, FXS = boot()
    FXS.Settings.apply({ protections = { attackMode = { mode = 'on' } } }, 1)
    H.advance(2500)
    T.eq(H.requests[1].json.state.attack, true)
end)

-- ─── failures and retries ───────────────────────────────────────────────────

T.test('a failed sync keeps the batch and re-sends it with the SAME sequence number', function()
    local H, FXS = boot()
    H.advance(2000)
    local first = H.requests[1].json
    T.eq(first.resource.seq, 1)
    answer(H.requests[1], 0, '') -- backend unreachable

    -- new things happen while the backend is down
    H.connect({ src = 1, ip = '198.51.100.9', license = 'x' })

    H.advance(11000)
    T.eq(#H.requests, 2)
    local retry = H.requests[2].json
    T.eq(retry.resource.seq, 1, 'same sequence → the backend can de-duplicate')
    T.eq(retry.resource.session, first.resource.session)
    T.deepEq(retry.events, first.events)
    T.eq(retry.stats.attempts, first.stats.attempts, 'the retried batch does not contain the new attempt')

    answer(H.requests[2], 200, okBody({ ackSeq = 1 }))
    H.advance(10500)
    local next = H.requests[3].json
    T.eq(next.resource.seq, 2)
    T.eq(next.stats.attempts, 1, 'the attempt made during the outage arrives with the next batch')
    local _ = FXS
end)

T.test('protection keeps working while the backend is down', function()
    local H = boot()
    H.advance(2000)
    answer(H.requests[1], 0, '')
    for i = 1, 10 do H.connect({ src = i, ip = '203.0.113.5', license = 'f' .. i }) end -- default limit: 10 per IP
    T.ok(H.connect({ src = 99, ip = '203.0.113.5', license = 'z' }).rejected)
end)

T.test('retry delays grow 10 s → 20 s → 40 s and are capped at 60 s', function()
    local H = boot()
    H.advance(2000)
    local delays = {}
    for i = 1, 5 do
        local req = lastRequest(H)
        local answeredAt = H.nowMs
        answer(req, 500, '')
        local nxt
        for _ = 1, 90 do -- wait second by second for the retry
            H.advance(1000)
            if lastRequest(H) ~= req then nxt = lastRequest(H); break end
        end
        T.ok(nxt, 'a retry was sent after failure ' .. i)
        delays[#delays + 1] = nxt.at - answeredAt
    end
    T.near(delays[1], 10000, 1100)
    T.near(delays[2], 20000, 1100)
    T.near(delays[3], 40000, 1100)
    T.near(delays[4], 60000, 1100)
    T.near(delays[5], 60000, 1100)
end)

T.test('a rejected request (HTTP 400) drops the batch so one bad batch can never block syncing forever', function()
    local H = boot()
    H.advance(2000)
    T.eq(H.requests[1].json.resource.seq, 1)
    answer(H.requests[1], 400, '{"error":"invalid_payload"}')
    T.contains(H.log(), 'dropped the pending batch')
    H.connect({ src = 1, ip = '198.51.100.9', license = 'x' })
    H.advance(11000)
    local p = H.requests[2].json
    T.eq(p.resource.seq, 2, 'a fresh batch')
    T.eq(p.stats.attempts, 1)
end)

T.test('HTTP 401 / 403 / 426 explain the problem and retry only once a minute', function()
    local cases = {
        { status = 401, text = 'rejected the API key' },
        { status = 403, text = 'disabled in the dashboard' },
        { status = 426, text = 'newer version' },
    }
    for _, c in ipairs(cases) do
        local H = boot()
        H.advance(2000)
        answer(H.requests[1], c.status, '{}')
        T.contains(H.log(), c.text, 'HTTP ' .. c.status)
        H.advance(50000)
        T.eq(#H.requests, 1, 'no retry within 50 s')
        H.advance(12000)
        T.eq(#H.requests, 2, 'retry after about a minute')
    end
end)

T.test('an invalid answer counts as a failure, the batch is kept', function()
    local H = boot()
    H.advance(2000)
    answer(H.requests[1], 200, 'this is not json')
    T.contains(H.log(), 'invalid response')
    H.advance(11000)
    T.eq(H.requests[2].json.resource.seq, 1)
end)

T.test('a request that is never answered is abandoned after 30 s and a late answer is ignored', function()
    local H, FXS = boot()
    H.advance(2000)
    local stale = H.requests[1]
    H.advance(33000)
    T.eq(#H.requests, 2, 'a new request was sent')
    answer(stale, 200, okBody({ configRev = 99, config = { protections = { connectionFlood = { maxAttemptsPerIp = 1 } } } }))
    T.eq(FXS.Settings.rev, 0, 'the stale answer was ignored')
end)

T.test('losing and regaining the connection is logged once each', function()
    local H = boot()
    H.advance(2000)
    answer(H.requests[1], 200, okBody())
    H.advance(10500)
    answer(H.requests[2], 500, '')
    T.contains(H.log(), 'lost connection')
    H.advance(11000)
    answer(H.requests[3], 200, okBody())
    local connected = select(2, H.log():gsub('connected to the backend', ''))
    T.eq(connected, 2)
end)

T.test('strange player names can never poison the sync payload (always valid UTF-8 JSON)', function()
    local H = boot()
    -- rejected by the name check; the name still ends up in an event
    H.connect({ src = 1, ip = '198.51.100.1', license = 'a', name = 'Evil\xFF\xFE\0Name\n' .. ('z'):rep(200) })
    H.advance(2000)
    T.eq(#H.requests, 1, 'the request could be encoded')
    local found
    for _, e in ipairs(H.requests[1].json.events) do if e.type == 'connection_blocked' then found = e end end
    T.ok(found)
    T.ok(utf8.len(found.name) ~= nil)
    T.ok(#found.name <= 64)
end)

-- ─── persistence ────────────────────────────────────────────────────────────

T.test('after a restart the cached config and lists are active before the first sync', function()
    local H = boot()
    H.advance(2000)
    answer(H.requests[1], 200, okBody({
        configRev = 7,
        config = { protections = { connectionFlood = { maxAttemptsPerIp = 2 } } },
        listsRev = 4,
        lists = { block = { { kind = 'ip', value = '1.2.3.4' } } },
    }))

    local H2, FXS2 = boot({ files = H.files })
    T.eq(FXS2.Settings.rev, 7)
    T.eq(FXS2.Settings.get('connectionFlood').maxAttemptsPerIp, 2)
    T.ok(FXS2.Lists.isBlocked('1.2.3.4', {}, FXS2.Util.now()))
    T.eq(#H2.requests, 0, 'no network needed')
    T.contains(H2.log(), 'restored cached configuration')
    T.ok(H2.connect({ src = 1, ip = '1.2.3.4', license = 'a' }).rejected)
end)

T.test('a corrupt cache file is ignored', function()
    local H = boot({ files = { ['cache.json'] = '{"config": [oops', ['known.json'] = 'garbage' } })
    T.eq(H.env.FXS.Settings.rev, 0)
    T.contains(H.log(), 'ignoring unreadable')
end)

T.test('returning players survive a restart (saved when the resource stops)', function()
    local H = boot()
    H.playerEnters({ src = 1, ip = '198.51.100.1', license = 'regular' })
    H.fire('onResourceStop', nil, 'fxshield')
    T.ok(H.files['known.json'])

    local _, FXS2 = boot({ files = H.files })
    T.ok(FXS2.Known.has('license:regular'))
    T.notOk(FXS2.Known.has('license:stranger'))
end)

T.test('only the resource stop of THIS resource triggers the save', function()
    local H = boot()
    H.playerEnters({ src = 1, ip = '198.51.100.1', license = 'regular' })
    H.fire('onResourceStop', nil, 'some-other-resource')
    T.eq(H.files['known.json'], nil)
end)
