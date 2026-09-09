/** One candidate element scraped from the live DOM, with exact geometry. */
export type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'grok' | 'deepseek' | 'kimi'

export interface ProviderInfo {
  id: ProviderId
  label: string
  /** Where the user gets a key. */
  console: string
  keyPrefix: string
  model: string
  /** Short note on cost to get started — shown in the picker. */
  cost: string
  /** True for an ongoing free tier, not just trial credits. */
  free?: boolean
  /** Shown as a warning before the user commits to this provider. */
  caution?: string
  /** Concrete steps to obtain a key, shown in the setup screen. */
  steps: string[]
}

export interface PageElement {
  /** 1-based id the model cites to target this element exactly. */
  id: number
  /** Visible text, collapsed and truncated. */
  text: string
  /** Semantic role: the ARIA role, or the tag name as a fallback. */
  role: string
  /** Page coordinates (document space, not viewport) so overlays survive scrolling. */
  x: number
  y: number
  width: number
  height: number
  /** True for text inputs / textareas / contenteditable — the only fill targets. */
  fillable?: boolean
}

export interface PageContext {
  url: string
  title: string
  elements: PageElement[]
  viewportWidth: number
  viewportHeight: number
  /** Banking / health / credential pages — never read automatically, only on request. */
  sensitive: boolean
  /** Extraction counts, for diagnostics only — never shown to the model. */
  stats?: { candidates: number; kept: number; interactive: number; scanned: number }
}

/** What actually happened to one requested annotation, for the diagnostics log. */
export interface DrawTrace {
  id: number
  resolved: boolean
  control: string
  storedY?: number
  liveY?: number
}

/**
 * The verdict vocabulary is deliberately small and fixed. A closed set is what lets the
 * overlay assign stable colours and the user learn them at a glance — an open-ended label
 * from the model would make every page look different.
 */
export type Verdict = 'best' | 'value' | 'flexible' | 'caution' | 'info'

export interface Annotation {
  elementId: number
  verdict: Verdict
  /** Short chip text, e.g. "Best overall". */
  label: string
  /** One-line reason shown under the label. Optional. */
  note?: string
}

export const VERDICT_STYLE: Record<Verdict, { color: string; ring: string; name: string }> = {
  best: { color: '#15803d', ring: '#22c55e', name: 'Best overall' },
  value: { color: '#a16207', ring: '#eab308', name: 'Best value' },
  flexible: { color: '#1d4ed8', ring: '#3b82f6', name: 'Most flexible' },
  caution: { color: '#b91c1c', ring: '#ef4444', name: 'Watch out' },
  info: { color: '#4338ca', ring: '#6366f1', name: 'Note' }
}

/* ---- messaging ---- */

export type BadgeState = 'idle' | 'working' | 'marked'

export type ContentRequest =
  | { type: 'collect-context' }
  | { type: 'render-annotations'; annotations: Annotation[] }
  | { type: 'clear-annotations' }
  | { type: 'set-badge'; state: BadgeState; count?: number }
  | { type: 'apply-fills'; fills: FillProposal[] }
  | { type: 'run-demo' }

/** One field the AI proposes to fill. Nothing is typed until the user approves it. */
export interface FillProposal {
  elementId: number
  fieldName: string
  value: string
}

export interface FillOutcome {
  fieldName: string
  ok: boolean
  error: string | null
}

export type ContentResponse =
  | {
      ok: true
      context?: PageContext
      outcomes?: FillOutcome[]
      drawn?: number
      traces?: DrawTrace[]
    }
  | { ok: false; error: string }

export type PanelRequest =
  | { type: 'ask'; prompt: string; history: ChatMessage[] }
  | { type: 'clear-annotations' }
  | { type: 'approve-fill'; approved: FillProposal[] }
  | { type: 'set-auto'; enabled: boolean }
  | { type: 'get-usage' }
  | { type: 'set-daily-limit'; limit: number }
  /** Abandon whatever is in flight — its results must not land in the next conversation. */
  | { type: 'reset' }

/** Measured consumption, so the free-tier budget rests on real numbers rather than estimates. */
export interface UsageSummary {
  todayRequests: number
  todayCostUsd: number
  monthRequests: number
  monthCostUsd: number
  dailyLimit: number
  /** Real average cost per request — the number that validates any tier pricing. */
  avgCostUsd: number
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
}

export type PanelEvent =
  | { type: 'chunk'; text: string }
  | { type: 'annotated'; count: number }
  /** Progress for the panel, so a slow model turn never looks like a hang. */
  | { type: 'status'; stage: 'reading' | 'thinking' | 'writing' | 'marking' }
  /** A one-line note about the page itself, e.g. that it's a sensitive site. */
  | { type: 'page-note'; text: string }
  /** Values the AI wants to type, awaiting the user's explicit approval. */
  | { type: 'fill-proposed'; proposals: FillProposal[] }
  | { type: 'filled'; outcomes: FillOutcome[] }
  | { type: 'usage'; summary: UsageSummary }
  | { type: 'done' }
  | { type: 'error'; message: string }
