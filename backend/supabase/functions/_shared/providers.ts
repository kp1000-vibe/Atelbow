/**
 * Where each provider lives and how it wants to be authenticated.
 *
 * The proxy forwards the extension's request body untouched apart from auth and metering, so
 * the three request shapes stay defined in one place — the extension — rather than being
 * reimplemented here and drifting.
 */
export type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'grok' | 'deepseek' | 'kimi'

export const PROVIDERS: Record<
  ProviderId,
  { url: (model: string) => string; headers: (key: string) => Record<string, string> }
> = {
  anthropic: {
    url: () => 'https://api.anthropic.com/v1/messages',
    headers: (key) => ({
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    })
  },
  openai: {
    url: () => 'https://api.openai.com/v1/chat/completions',
    headers: bearer
  },
  grok: {
    url: () => 'https://api.x.ai/v1/chat/completions',
    headers: bearer
  },
  deepseek: {
    url: () => 'https://api.deepseek.com/v1/chat/completions',
    headers: bearer
  },
  kimi: {
    url: () => 'https://api.moonshot.ai/v1/chat/completions',
    headers: bearer
  },
  gemini: {
    url: (model) =>
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`,
    headers: (key) => ({ 'x-goog-api-key': key, 'content-type': 'application/json' })
  }
}

function bearer(key: string): Record<string, string> {
  return { Authorization: `Bearer ${key}`, 'content-type': 'application/json' }
}

export function isProvider(v: unknown): v is ProviderId {
  return typeof v === 'string' && v in PROVIDERS
}

/** The OpenAI-compatible four share a family, and the metering differs by family, not vendor. */
export function family(id: ProviderId): 'anthropic' | 'openai' | 'gemini' {
  if (id === 'anthropic' || id === 'gemini') return id
  return 'openai'
}
