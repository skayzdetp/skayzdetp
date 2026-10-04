import { CONFIG_VERSION, GENERAL_FIELDS, MESSAGE_FIELDS, PROTECTIONS, type Field } from './catalog.js'

const luaString = (s: string) =>
  "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r') + "'"

function luaField(f: Field): string {
  switch (f.type) {
    case 'int':
      return `{ type = 'int', min = ${f.min}, max = ${f.max}, default = ${f.default} }`
    case 'bool':
      return `{ type = 'bool', default = ${f.default} }`
    case 'select':
      return `{ type = 'select', options = { ${f.options.map((o) => luaString(o.value)).join(', ')} }, default = ${luaString(f.default)} }`
    case 'text':
      return `{ type = 'text', maxLength = ${f.maxLength}, default = ${luaString(f.default)} }`
  }
}

/** Render `resource/fxshield/shared/schema.lua` from the protection catalog. */
export function renderLuaSchema(): string {
  const out: string[] = []
  out.push('-- ─────────────────────────────────────────────────────────────────────────')
  out.push('-- AUTO-GENERATED from backend/src/catalog.ts  (npm run gen:lua-schema)')
  out.push('-- Do not edit by hand – changes will be overwritten.')
  out.push('-- It describes every setting the dashboard can change (type, limits, default),')
  out.push('-- so the resource can validate whatever it receives from the backend.')
  out.push('-- ─────────────────────────────────────────────────────────────────────────')
  out.push('')
  out.push('FXS = FXS or {}')
  out.push(`FXS.CONFIG_VERSION = ${CONFIG_VERSION}`)
  out.push('')
  out.push('FXS.Schema = {')

  out.push('    general = {')
  for (const f of GENERAL_FIELDS) out.push(`        ${f.key} = ${luaField(f)},`)
  out.push('    },')
  out.push('')

  out.push('    protections = {')
  for (const p of PROTECTIONS) {
    out.push(`        ${p.id} = {`)
    out.push(`            modes = { ${p.modes.map((m) => luaString(m.value)).join(', ')} },`)
    out.push(`            default = ${luaString(p.defaultMode)},`)
    out.push('            fields = {')
    for (const f of p.fields) out.push(`                ${f.key} = ${luaField(f)},`)
    out.push('            },')
    out.push('        },')
  }
  out.push('    },')
  out.push('')

  out.push('    messages = {')
  for (const f of MESSAGE_FIELDS) out.push(`        ${f.key} = ${luaField(f)},`)
  out.push('    },')
  out.push('}')
  out.push('')
  return out.join('\n')
}
