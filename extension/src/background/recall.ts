import type { Annotation, PageElement, Verdict } from '../shared/types'

/**
 * Remembers walkthroughs that worked, so doing the same thing twice is instant.
 *
 * This is a cache, not a memory of the page. It stores the *identity of controls* — the role
 * and the visible label, which are product chrome — plus the words that explained them. It
 * never stores the page, the URL beyond a hostname, or anything the user typed.
 *
 * The rule that keeps it honest: a remembered step is only ever shown after it has been
 * re-found on the live page in this very turn. If the vendor moves the control, the entry
 * fails to resolve and the model runs as normal. The cache can make things faster; it can
 * never make them stale.
 */

export interface CachedStep {
  /** Visible label of the control, as extracted. */
  text: string
  role: string
  /** What the walkthrough said about it. */
  label: string
  note?: string
  verdict: Verdict
}

export interface Entry {
  steps: CachedStep[]
  /** The prose that accompanied the marks, replayed verbatim on a hit. */
  answer: string
  /** Times the user clicked the control we marked — evidence the step is right. */
  wins: number
  /** Times they moved on without clicking it — evidence it is wrong. */
  losses: number
  usedAt: number
}

const KEY = 'recall'
/** Comfortably under the storage quota, and far more tasks than one person repeats. */
const MAX_ENTRIES = 200
/** Two consecutive misses is enough: a confidently wrong mark is worse than a slow one. */
const LOSS_LIMIT = 2

/**
 * Questions are keyed loosely on purpose — "how do I add a user" and "How do I add a user?"
 * are the same task, and someone repeating a task rarely repeats their exact phrasing.
 */
function normalise(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(the|a|an|to|in|on|for|my|please|do|i|how|can|you|me)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function keyFor(host: string, question: string): string {
  return `${host}::${normalise(question)}`
}

type Store = Record<string, Entry>

async function load(): Promise<Store> {
  const { [KEY]: raw } = await chrome.storage.local.get(KEY)
  return raw && typeof raw === 'object' ? (raw as Store) : {}
}

async function save(store: Store): Promise<void> {
  const keys = Object.keys(store)
  if (keys.length > MAX_ENTRIES) {
    // Least recently used goes first — a task you haven't repeated in weeks is the one least
    // likely to be worth a slot.
    keys
      .sort((a, b) => store[a].usedAt - store[b].usedAt)
      .slice(0, keys.length - MAX_ENTRIES)
      .forEach((k) => delete store[k])
  }
  await chrome.storage.local.set({ [KEY]: store })
}

function tidy(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Finds each remembered step among the elements actually on screen right now.
 *
 * Exact label match first, then a contained match, because products pad labels with counts and
 * state ("Users", "Users (24)"). Returns null unless every step is found: a partially resolved
 * walkthrough would silently skip a step, which is worse than not using the cache.
 */
export function resolve(entry: Entry, elements: PageElement[]): Annotation[] | null {
  const used = new Set<number>()
  const out: Annotation[] = []

  for (const step of entry.steps) {
    const want = tidy(step.text)
    if (!want) return null

    const exact = elements.find(
      (el) => !used.has(el.id) && el.role === step.role && tidy(el.text) === want
    )
    const loose =
      exact ??
      elements.find(
        (el) =>
          !used.has(el.id) &&
          el.role === step.role &&
          (tidy(el.text).startsWith(want) || want.startsWith(tidy(el.text)))
      )

    if (!loose) return null
    used.add(loose.id)
    out.push({
      elementId: loose.id,
      verdict: step.verdict,
      label: step.label,
      note: step.note
    })
  }

  return out.length > 0 ? out : null
}

export async function lookup(
  host: string,
  question: string,
  elements: PageElement[]
): Promise<{ key: string; entry: Entry; annotations: Annotation[] } | null> {
  const store = await load()
  const key = keyFor(host, question)
  const entry = store[key]
  if (!entry) return null

  const annotations = resolve(entry, elements)
  if (!annotations) return null

  entry.usedAt = Date.now()
  await save(store)
  return { key, entry, annotations }
}

export async function remember(
  host: string,
  question: string,
  answer: string,
  annotations: Annotation[],
  elements: PageElement[]
): Promise<string | null> {
  if (annotations.length === 0) return null
  const byId = new Map(elements.map((el) => [el.id, el]))

  const steps: CachedStep[] = []
  for (const a of annotations) {
    const el = byId.get(a.elementId)
    // A step whose control has no stable label can't be re-found later, so the whole entry is
    // worthless — better to store nothing than something that will fail to resolve.
    if (!el || !el.text.trim()) return null
    steps.push({
      text: el.text,
      role: el.role,
      label: a.label,
      note: a.note,
      verdict: a.verdict
    })
  }

  const store = await load()
  const key = keyFor(host, question)
  const prev = store[key]
  store[key] = {
    steps,
    answer,
    wins: prev?.wins ?? 0,
    losses: prev?.losses ?? 0,
    usedAt: Date.now()
  }
  await save(store)
  return key
}

/**
 * Records whether the user actually did the step we pointed at.
 *
 * This is the whole learning signal, and it costs nothing to collect: clicking the marked
 * control is already how the walkthrough advances.
 */
export async function score(key: string, clicked: boolean): Promise<void> {
  const store = await load()
  const entry = store[key]
  if (!entry) return

  if (clicked) entry.wins += 1
  else entry.losses += 1

  // Drop an entry the user keeps ignoring. Falling back to the model is the safe direction.
  if (entry.losses >= LOSS_LIMIT && entry.losses > entry.wins) delete store[key]
  await save(store)
}

export async function forget(): Promise<void> {
  await chrome.storage.local.set({ [KEY]: {} })
}
