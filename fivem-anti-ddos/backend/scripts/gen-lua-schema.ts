/**
 * Generates resource/fxshield/generated/schema.lua from the protection catalog.
 *   npm run gen:lua-schema           write the file
 *   npm run gen:lua-schema -- --check  exit 1 if the file is out of date (CI)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderLuaSchema } from '../src/lua-schema.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const target = path.resolve(here, '../../resource/fxshield/generated/schema.lua')
const next = renderLuaSchema()

if (process.argv.includes('--check')) {
  const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : ''
  if (current !== next) {
    console.error('resource/fxshield/generated/schema.lua is out of date. Run: npm run gen:lua-schema')
    process.exit(1)
  }
  console.log('schema.lua is up to date')
} else {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, next)
  console.log(`wrote ${path.relative(process.cwd(), target)}`)
}
