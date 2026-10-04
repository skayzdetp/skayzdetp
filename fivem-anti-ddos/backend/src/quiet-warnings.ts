// `node:sqlite` still prints "ExperimentalWarning: SQLite is an experimental feature" on every start.
// It is stable enough for this project, so hide that single warning (all others stay visible).
// This module must be imported before anything that loads `node:sqlite`.
const original = process.emitWarning.bind(process)
process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
  const text = typeof warning === 'string' ? warning : warning.message
  if (/SQLite is an experimental feature/i.test(text)) return
  return (original as (...a: unknown[]) => void)(warning, ...args)
}) as typeof process.emitWarning
