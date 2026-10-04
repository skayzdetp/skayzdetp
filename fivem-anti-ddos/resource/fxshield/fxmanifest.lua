fx_version 'cerulean'
game 'gta5'
lua54 'yes'

name 'fxshield'
author 'FX Shield'
description 'FX Shield – application-layer protection for FiveM servers, managed from a web dashboard'
version '1.0.0'

-- Pure server-side resource: nothing is sent to (or exposed to) clients.
server_only 'yes'

server_scripts {
    'config.lua',
    'generated/schema.lua', -- generated from the backend's protection catalog (do not edit)
    'server/util.lua',
    'server/ratelimit.lua',
    'server/lists.lua',
    'server/settings.lua',
    'server/stats.lua',
    'server/attack.lua',
    'server/known.lua',
    'server/players.lua',
    'server/cache.lua',
    'server/guard_connect.lua',
    'server/guard_events.lua',
    'server/sync.lua',
    'server/main.lua',
}
