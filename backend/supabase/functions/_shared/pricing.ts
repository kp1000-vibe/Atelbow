/**
 * USD per million tokens, by model.
 *
 * Prices move, and a stale table silently under-bills every limit in the system — so an
 * unknown model is charged at FALLBACK rather than at zero. Over-charging shows up as an
 * admin complaint; under-charging shows up as a surprise invoice.
 */
const RATES: Record<string, { in: number; out: number }> = {
  'claude-sonnet-5': { in: 3, out: 15 },
  'claude-opus-5': { in: 15, out: 75 },
  // Promotional rate through 31 Dec 2026; rises to 1.50 / 7.50 on 1 Jan 2027.
  'gemini-3.6-flash': { in: 0.75, out: 3.75 },
  'gpt-4o': { in: 2.5, out: 10 },
  'grok-2-latest': { in: 2, out: 10 },
  'deepseek-chat': { in: 0.27, out: 1.1 },
  'kimi-k2-0711-preview': { in: 0.6, out: 2.5 }
}

const FALLBACK = { in: 5, out: 20 }

export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const rate = RATES[model] ?? FALLBACK
  const usd = (inputTokens * rate.in + outputTokens * rate.out) / 1_000_000
  // Six decimal places matches usage_events.cost_usd; rounding here keeps the number the
  // proxy enforces against identical to the number the database stores.
  return Math.round(usd * 1e6) / 1e6
}

export function knownModel(model: string): boolean {
  return model in RATES
}
