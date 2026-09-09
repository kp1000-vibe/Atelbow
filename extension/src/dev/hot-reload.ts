/**
 * Development-only auto-reload.
 *
 * Chrome has no hot reload for extensions, so every change costs a trip to
 * chrome://extensions. This polls a tiny local server for a build id and calls
 * chrome.runtime.reload() when it changes.
 *
 * Deliberately a poll for a *number*, not a socket that receives commands. A dev channel that
 * can tell the extension what to do is remote-code-execution surface, and shipping one would
 * fail Web Store review. The worst this can do is reload.
 *
 * `__DEV__` is replaced with a literal at build time, so the production bundle drops this
 * module entirely — see vite.config.ts and the `npm run verify` check.
 */

const ENDPOINT = 'http://127.0.0.1:5199/build-id'
const EVERY_MS = 1000

export function startHotReload(): void {
  let known: string | null = null

  const tick = async (): Promise<void> => {
    try {
      const res = await fetch(ENDPOINT, { cache: 'no-store' })
      if (!res.ok) return
      const id = (await res.text()).trim()
      if (!id) return

      if (known === null) {
        known = id
        console.info('[atelbow] hot reload armed')
        return
      }
      if (id !== known) {
        console.info('[atelbow] new build — reloading')
        chrome.runtime.reload()
      }
    } catch {
      // The dev server isn't running. That's the normal case when someone loads a dev build
      // without `npm run dev`, so it stays silent rather than logging once a second.
    }
  }

  void tick()
  setInterval(() => void tick(), EVERY_MS)
}
