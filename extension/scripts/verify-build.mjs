import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Pre-ship checks on dist/.
 *
 * Each of these has already been a real bug on this project, which is why they are a script
 * rather than a habit:
 *  - a dev-only network client surviving into a shipped build (Web Store rejection, and worse)
 *  - content.js emitting an import Chrome cannot resolve, breaking every page silently
 *  - source maps shipping the original source alongside the bundle
 */

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist')

const files = []
;(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full)
    else files.push(full)
  }
})(DIST)

const read = (f) => readFileSync(f, 'utf8')
const rel = (f) => f.slice(DIST.length + 1).replace(/\\/g, '/')
const failures = []
const pass = []

function check(name, ok, detail) {
  if (ok) pass.push(name)
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}

// 1. No development reload client.
const devMarkers = ['127.0.0.1:5199', 'hot reload armed', 'startHotReload']
const leaked = files.filter((f) => {
  if (!/\.(js|html|css)$/.test(f)) return false
  const body = read(f)
  return devMarkers.some((m) => body.includes(m))
})
check('no dev reload client', leaked.length === 0, leaked.map(rel).join(', '))

// 2. Content script must be self-contained — Chrome cannot resolve imports for one.
const content = files.find((f) => rel(f) === 'content.js')
check('content.js present', Boolean(content))
if (content) {
  const body = read(content)
  check(
    'content.js is self-contained',
    !/(^|\n)\s*import\s|require\(/.test(body),
    'found a module import'
  )
}

// 3. No source maps.
const maps = files.filter((f) => f.endsWith('.map'))
check('no source maps', maps.length === 0, maps.map(rel).join(', '))

// 4. Manifest sanity — the name is the thing most often left behind by a rename.
const manifestFile = files.find((f) => rel(f) === 'manifest.json')
check('manifest present', Boolean(manifestFile))
if (manifestFile) {
  const manifest = JSON.parse(read(manifestFile))
  const name = manifest.name
  const stale = files.filter(
    (f) => /\.(js|html)$/.test(f) && /Visual Cowork|ScreenPilot|AI Coach/.test(read(f))
  )
  check('no superseded product names', stale.length === 0, stale.map(rel).join(', '))
  check('manifest declares a name', Boolean(name), '')
  for (const key of ['service-worker.js', 'content.js']) {
    check(`${key} emitted`, files.some((f) => rel(f) === key))
  }
}

for (const p of pass) console.log(`  ok    ${p}`)
for (const f of failures) console.error(`  FAIL  ${f}`)

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed — do not ship this build.`)
  process.exit(1)
}
console.log(`\nAll ${pass.length} checks passed.`)
