import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  PRESETS,
  PROTECTIONS,
  catalogForClient,
  defaultConfig,
  mergeConfig,
  normalizeConfig,
  presetConfig,
} from '../src/catalog.js'
import { renderLuaSchema } from '../src/lua-schema.js'
import { parseListValue, splitListInput } from '../src/validate.js'

describe('catalog / config normalisation', () => {
  it('produces a complete default config', () => {
    const cfg = defaultConfig()
    expect(cfg.v).toBe(1)
    for (const p of PROTECTIONS) {
      expect(cfg.protections[p.id]?.mode).toBe(p.defaultMode)
      for (const f of p.fields) expect(cfg.protections[p.id]).toHaveProperty(f.key)
    }
    expect(cfg.general.pollIntervalSec).toBe(10)
  })

  it('is idempotent', () => {
    const once = normalizeConfig({ protections: { connectionFlood: { maxAttemptsPerIp: 999 } } })
    expect(normalizeConfig(once)).toEqual(once)
  })

  it('clamps numbers and rounds floats', () => {
    const cfg = normalizeConfig({
      protections: { connectionFlood: { maxAttemptsPerIp: 100000, windowSec: -5, banSec: 12.6, maxAttemptsPerLicense: '7' } },
    })
    const cf = cfg.protections.connectionFlood!
    expect(cf.maxAttemptsPerIp).toBe(200)
    expect(cf.windowSec).toBe(5)
    expect(cf.banSec).toBe(13)
    expect(cf.maxAttemptsPerLicense).toBe(7)
  })

  it('falls back to defaults for wrong types, unknown modes and unknown options', () => {
    const cfg = normalizeConfig({
      general: { pollIntervalSec: 'fast' },
      protections: {
        connectionFlood: { mode: 'destroy-everything', windowSec: null },
        identityCheck: { requireLicense: 'yes' },
        gameEventFlood: { action: 'nuke' },
        doesNotExist: { mode: 'enforce' },
      },
    })
    expect(cfg.general.pollIntervalSec).toBe(10)
    expect(cfg.protections.connectionFlood!.mode).toBe('enforce')
    expect(cfg.protections.connectionFlood!.windowSec).toBe(30)
    expect(cfg.protections.identityCheck!.requireLicense).toBe(true)
    expect(cfg.protections.gameEventFlood!.action).toBe('cancel')
    expect(cfg.protections).not.toHaveProperty('doesNotExist')
  })

  it('survives garbage input', () => {
    for (const junk of [null, undefined, 5, 'x', [], [1, 2], { protections: 'no' }, { protections: [] }]) {
      expect(normalizeConfig(junk)).toEqual(defaultConfig())
    }
  })

  it('cleans message texts', () => {
    const cfg = normalizeConfig({ messages: { banned: '  Hi\u0000there\n  ', kicked: '', blocked: 'x'.repeat(5000) } })
    expect(cfg.messages.banned).toBe('Hi there')
    expect(cfg.messages.kicked).toBe(defaultConfig().messages.kicked)
    expect(String(cfg.messages.blocked).length).toBe(200)
  })

  it('merges partial patches without touching other settings', () => {
    const base = normalizeConfig({ protections: { connectionFlood: { maxAttemptsPerIp: 3 } } })
    const next = mergeConfig(base, { protections: { attackMode: { mode: 'on' } } })
    expect(next.protections.attackMode!.mode).toBe('on')
    expect(next.protections.connectionFlood!.maxAttemptsPerIp).toBe(3)
  })

  it('has valid presets', () => {
    for (const p of PRESETS) {
      const cfg = presetConfig(p.id)!
      expect(normalizeConfig(cfg)).toEqual(cfg)
    }
    const monitor = presetConfig('monitor')!
    for (const p of PROTECTIONS) {
      if (p.id === 'entityLockdown') continue
      expect(monitor.protections[p.id]!.mode).toBe('monitor')
    }
    expect(presetConfig('nope')).toBeNull()
  })

  it('exposes a JSON-serialisable client catalog', () => {
    const cat = JSON.parse(JSON.stringify(catalogForClient()))
    expect(cat.protections.length).toBe(PROTECTIONS.length)
    expect(cat.presets.map((p: { id: string }) => p.id)).toContain('balanced')
  })
})

describe('resource schema', () => {
  it('generated/schema.lua is in sync with the catalog (run `npm run gen:lua-schema`)', () => {
    const here = path.dirname(fileURLToPath(import.meta.url))
    const file = path.resolve(here, '../../resource/fxshield/generated/schema.lua')
    expect(fs.readFileSync(file, 'utf8')).toBe(renderLuaSchema())
  })
})

describe('list value parsing', () => {
  it('classifies and normalises values', () => {
    expect(parseListValue('1.2.3.4')).toEqual({ kind: 'ip', value: '1.2.3.4' })
    expect(parseListValue('ip:1.2.3.4')).toEqual({ kind: 'ip', value: '1.2.3.4' })
    expect(parseListValue('10.1.2.3/8')).toEqual({ kind: 'cidr', value: '10.0.0.0/8' })
    expect(parseListValue('203.0.113.77/24')).toEqual({ kind: 'cidr', value: '203.0.113.0/24' })
    expect(parseListValue('203.0.113.77/32')).toEqual({ kind: 'ip', value: '203.0.113.77' })
    expect(parseListValue('::1')).toEqual({ kind: 'ip', value: '::1' })
    expect(parseListValue('License:ABCDEF0123')).toEqual({ kind: 'identifier', value: 'license:abcdef0123' })
    expect(parseListValue('discord:123456789012345678')).toEqual({ kind: 'identifier', value: 'discord:123456789012345678' })
  })

  it('rejects invalid input, huge ranges and IPv6 ranges', () => {
    for (const bad of ['', 'hello', '999.1.1.1', '1.2.3.4/7', '1.2.3.4/33', '1.2.3.4/x', 'fe80::/10', 'foo:bar', '1.2.3.4/8/8']) {
      expect(parseListValue(bad)).toHaveProperty('error')
    }
  })

  it('splits pasted text', () => {
    expect(splitListInput('1.1.1.1, 2.2.2.2\n3.3.3.3;1.1.1.1')).toEqual(['1.1.1.1', '2.2.2.2', '3.3.3.3'])
  })
})
