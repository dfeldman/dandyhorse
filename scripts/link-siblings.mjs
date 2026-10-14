/**
 * Make a sibling repo importable by package name, from an environment variable, without a path in package.json.
 *
 *   node link-siblings.mjs <name>=<ENV_VAR>[/<subdir>]:<default path>  …
 *
 * For each argument: the repo is at $ENV_VAR (plus /<subdir> when given), or at <default path> relative to this
 * package when the variable is unset; `node_modules/<name>` is pointed at it (what npm itself does for a `file:`
 * dependency, but the location comes from the environment). Run as `postinstall`, so `npm install` / `npm ci`
 * always leave it in place. node_modules is never committed, so nothing linked here is ever in git.
 *
 * Fails, saying which variable to set, when a sibling is missing.
 */
import { existsSync, lstatSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const here = process.cwd()
let missing = 0
for (const spec of process.argv.slice(2)) {
  const m = /^([^=]+)=([A-Z_][A-Z0-9_]*)(\/[^:]+)?:(.+)$/.exec(spec)
  if (!m) { console.error(`link-siblings: cannot read "${spec}" (want name=ENV_VAR[/subdir]:default)`); process.exit(2) }
  const [, name, env, sub, fallback] = m
  const target = process.env[env] ? resolve(process.env[env] + (sub ?? '')) : resolve(here, fallback)
  if (!existsSync(resolve(target, 'package.json'))) {
    console.error(`link-siblings: ${name} not found at ${target}: check it out there, or set ${env}`)
    missing++
    continue
  }
  const link = resolve(here, 'node_modules', name)
  mkdirSync(dirname(link), { recursive: true })
  try { lstatSync(link); rmSync(link, { recursive: true, force: true }) } catch { /* nothing there yet */ }
  symlinkSync(target, link, 'junction')
  console.log(`link-siblings: ${name} -> ${target}`)
}
process.exit(missing ? 1 : 0)
