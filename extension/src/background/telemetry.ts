/**
 * Anonymous product metrics — installs, active days, feature counts.
 *
 * The hard rule from the data policy applies here too: this sends COUNTERS ONLY. No page
 * content, no URLs, no prompts, no answers, no API keys, no name or email. Everything it can
 * send is enumerated in the `Ping` type below; if a field isn't there, it isn't collected.
 *
 * Until ENDPOINT is set this is entirely inert — nothing is sent anywhere.
 */

/**
 * Your collector URL, once you have one. Empty means telemetry is entirely off: nothing is
 * counted, nothing is stored, nothing is sent.
 *
 * Turning it on also needs "alarms" back in manifest.json permissions — it was removed
 * because an extension that declares a permission it never exercises gets flagged in Web
 * Store review.
 */
const ENDPOINT = ''

/** Batched rather than per-event: one request a day, not one per click. */
const FLUSH_ALARM = 'vc-telemetry-flush'

export interface Ping {
  /** Random per install. Not derived from anything identifying, and never reversible. */
  installId: string
  version: string
  /** Local date, so the collector can compute DAU/MAU without timestamps per action. */
  day: string
  /** Which model vendor is configured — the label only, never the key. */
  provider: string
  counts: {
    asks: number
    autoReads: number
    annotations: number
    fillsProposed: number
    fillsApproved: number
    /** Walkthroughs served from memory instead of the model — the cache hit rate. */
    recallHits: number
  }
}

type Counters = Ping['counts']

const EMPTY: Counters = {
  asks: 0,
  autoReads: 0,
  annotations: 0,
  fillsProposed: 0,
  fillsApproved: 0,
  recallHits: 0
}

async function isEnabled(): Promise<boolean> {
  if (!ENDPOINT) return false
  const { telemetry } = await chrome.storage.local.get('telemetry')
  return telemetry !== false // on by default, with an opt-out in settings
}

/** Stable random id, generated once and never tied to the user's identity. */
async function installId(): Promise<string> {
  const { installId } = await chrome.storage.local.get('installId')
  if (typeof installId === 'string') return installId
  const fresh = crypto.randomUUID()
  await chrome.storage.local.set({ installId: fresh })
  return fresh
}

function today(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export async function count(event: keyof Counters, by = 1): Promise<void> {
  if (!(await isEnabled())) return
  const { pending } = await chrome.storage.local.get('pending')
  const current = { ...EMPTY, ...((pending ?? {}) as Partial<Counters>) }
  current[event] += by
  await chrome.storage.local.set({ pending: current })
}

/**
 * Sends the day's counters, then clears them. Failure is silent and non-destructive: the
 * counters stay put and roll into the next attempt rather than being lost.
 */
export async function flush(): Promise<void> {
  if (!(await isEnabled())) return

  const { pending, telemetryProvider } = await chrome.storage.local.get([
    'pending',
    'telemetryProvider'
  ])
  const counts = { ...EMPTY, ...((pending ?? {}) as Partial<Counters>) }
  if (Object.values(counts).every((n) => n === 0)) return

  const ping: Ping = {
    installId: await installId(),
    version: chrome.runtime.getManifest().version,
    day: today(),
    provider: typeof telemetryProvider === 'string' ? telemetryProvider : 'unknown',
    counts
  }

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ping)
    })
    if (res.ok) await chrome.storage.local.set({ pending: EMPTY })
  } catch {
    // Offline or collector down — keep the counters and try again tomorrow.
  }
}

export function scheduleFlush(): void {
  if (!ENDPOINT) return
  chrome.alarms.create(FLUSH_ALARM, { periodInMinutes: 60 * 6 })
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === FLUSH_ALARM) void flush()
  })
}
