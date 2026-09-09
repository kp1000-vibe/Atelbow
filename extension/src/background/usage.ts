import type { UsageSummary } from '../shared/types'

/**
 * Per-model pricing in USD per million tokens. Kept here so a model swap can't silently
 * invalidate every cost figure the product reports.
 */
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-opus-5': { input: 5, output: 25 }
}

/** Cache reads bill at ~10% of input; cache writes at ~125%. */
const CACHE_READ_MULTIPLIER = 0.1
const CACHE_WRITE_MULTIPLIER = 1.25

/**
 * 0 means unlimited.
 *
 * PROTOTYPE SETTING — deliberately off so testing isn't cut short. The measured free-tier
 * figure was ~6/day on Haiku (~3/day on Sonnet 5) to stay under 75c per user per month.
 * Restore a real cap before any tier goes live, and enforce it server-side: this counter
 * lives in chrome.storage on the user's own machine and can simply be cleared.
 */
export const DEFAULT_DAILY_LIMIT = 0

interface DayRecord {
  requests: number
  inputTokens: number
  outputTokens: number
  costUsd: number
}

type UsageStore = Record<string, DayRecord>

const STORE_KEY = 'usage'
/** Enough history to see a month's trend without growing forever. */
const RETAIN_DAYS = 35

/** Local calendar date — a "daily limit" should reset on the user's midnight, not UTC. */
export function today(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

async function readStore(): Promise<UsageStore> {
  const stored = await chrome.storage.local.get(STORE_KEY)
  return (stored[STORE_KEY] as UsageStore | undefined) ?? {}
}

export interface TokenUsage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
}

export function costOf(model: string, usage: TokenUsage): number {
  const price = PRICING[model]
  // An unknown model is reported as zero rather than guessed — a wrong number here would
  // quietly corrupt the very budget this exists to measure.
  if (!price) return 0

  const input = usage.input_tokens ?? 0
  const output = usage.output_tokens ?? 0
  const cacheRead = usage.cache_read_input_tokens ?? 0
  const cacheWrite = usage.cache_creation_input_tokens ?? 0

  return (
    (input * price.input +
      cacheRead * price.input * CACHE_READ_MULTIPLIER +
      cacheWrite * price.input * CACHE_WRITE_MULTIPLIER +
      output * price.output) /
    1_000_000
  )
}

/**
 * Records one completed call against today's tally.
 *
 * Counts requests rather than tokens now that six providers are supported: each reports usage
 * in a different shape (or not at all mid-stream), so a request count is the one figure that
 * means the same thing everywhere. Users pay their own provider directly, so the number that
 * matters to them is "how much have I used it", not a dollar estimate we'd have to fake.
 */
export async function recordRequest(_providerId: string): Promise<void> {
  const store = await readStore()
  const key = today()
  const day = store[key] ?? { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }

  day.requests += 1
  store[key] = day

  // Prune by date string; ISO-style keys sort lexicographically, so this is a plain slice.
  const keys = Object.keys(store).sort()
  for (const stale of keys.slice(0, Math.max(0, keys.length - RETAIN_DAYS))) delete store[stale]

  await chrome.storage.local.set({ [STORE_KEY]: store })
}

export async function getDailyLimit(): Promise<number> {
  const { dailyLimit } = await chrome.storage.local.get('dailyLimit')
  return typeof dailyLimit === 'number' && dailyLimit >= 0 ? dailyLimit : DEFAULT_DAILY_LIMIT
}

export async function summary(): Promise<UsageSummary> {
  const store = await readStore()
  const key = today()
  const day = store[key] ?? { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }

  const month = key.slice(0, 7)
  let monthCost = 0
  let monthRequests = 0
  for (const [date, rec] of Object.entries(store)) {
    if (!date.startsWith(month)) continue
    monthCost += rec.costUsd
    monthRequests += rec.requests
  }

  return {
    todayRequests: day.requests,
    todayCostUsd: day.costUsd,
    monthRequests,
    monthCostUsd: monthCost,
    dailyLimit: await getDailyLimit(),
    avgCostUsd: monthRequests > 0 ? monthCost / monthRequests : 0
  }
}

/** True when today's allowance is already spent. A limit of 0 means no cap. */
export async function isOverLimit(): Promise<boolean> {
  const s = await summary()
  return s.dailyLimit > 0 && s.todayRequests >= s.dailyLimit
}
