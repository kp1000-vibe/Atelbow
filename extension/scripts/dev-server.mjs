import { createServer } from 'node:http'
import { watch } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Serves a build id that changes whenever Vite rewrites the bundle, so the extension can
 * notice and reload itself.
 *
 * Deliberately tiny and dependency-free: it answers one route with one string. Anything more
 * would be a second thing to keep secure on a port bound to localhost.
 */

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const PORT = 5199

let buildId = String(Date.now())
let settle

// Vite writes several files per build; debouncing means one reload per build rather than one
// per file, which would restart the extension mid-write.
watch(DIST, { recursive: true }, (_event, file) => {
  if (!file || !/\.(js|css|html|json)$/.test(file)) return
  clearTimeout(settle)
  settle = setTimeout(() => {
    buildId = String(Date.now())
    console.log(`[dev] rebuilt → extension will reload (${new Date().toLocaleTimeString()})`)
  }, 250)
})

createServer((req, res) => {
  // Only the extension needs this, and only from this machine.
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Cache-Control', 'no-store')
  if (req.url === '/build-id') {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end(buildId)
    return
  }
  res.writeHead(404)
  res.end()
}).listen(PORT, '127.0.0.1', () => {
  console.log(`[dev] reload server on http://127.0.0.1:${PORT} — watching ${DIST}`)
  console.log('[dev] load the extension once from chrome://extensions; it reloads itself after that')
  console.log('[dev] note: content scripts still need a page refresh (Chrome cannot re-inject)')
})
