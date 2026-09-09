import { ANNOTATE_TOOL_NAME, FILL_TOOL_NAME, TOOLS, toEvent } from './types'
import type { Provider, SendOptions, StreamEvent } from './types'
import { sseLines } from './openaiCompatible'

const BASE = 'https://api.anthropic.com/v1'
const MODEL = 'claude-sonnet-5'
const VERSION = '2023-06-01'

/**
 * Raw HTTP rather than the SDK: this extension speaks three API dialects, and bundling a
 * separate SDK per vendor into a service worker costs far more than the requests are worth.
 * The wire format is stable and small.
 */
export const anthropicProvider: Provider = {
  id: 'anthropic',

  async validateKey(apiKey) {
    try {
      const res = await fetch(`${BASE}/models?limit=1`, {
        headers: headers(apiKey)
      })
      if (res.ok) return { ok: true }
      if (res.status === 401 || res.status === 403) return { ok: false, error: 'That key was rejected.' }
      return { ok: false, error: `Anthropic returned ${res.status}.` }
    } catch {
      return { ok: false, error: "Couldn't reach Anthropic. Check your connection." }
    }
  },

  async *send(opts: SendOptions): AsyncIterable<StreamEvent> {
    const res = await fetch(`${BASE}/messages`, {
      method: 'POST',
      signal: opts.signal,
      headers: { ...headers(opts.apiKey), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4000,
        stream: true,
        system: opts.system,
        messages: [
          ...opts.history.map((m) => ({ role: m.role, content: m.text })),
          { role: 'user', content: opts.prompt }
        ],
        tools: Object.entries(TOOLS).map(([name, t]) => ({
          name,
          description: t.description,
          input_schema: t.parameters
        })),
        // No API-level tool forcing: obliging a tool call makes the model skip the written
        // steps, and for guidance the words matter as much as the marks. The system prompt
        // instructs it directly instead.
      })
    })

    if (!res.ok || !res.body) {
      if (res.status === 401 || res.status === 403) throw new Error('Your Anthropic key was rejected.')
      if (res.status === 429) throw new Error('Rate limited by Anthropic. Wait a moment and try again.')
      throw new Error(`Anthropic error ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
    }

    // Tool input streams as partial JSON fragments under the block that started it.
    let toolName = ''
    let toolJson = ''

    for await (const ev of sseLines(res.body)) {
      if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
        toolName = ev.content_block.name
        toolJson = ''
      } else if (ev.type === 'content_block_delta') {
        if (ev.delta?.type === 'text_delta') yield { type: 'text', text: ev.delta.text }
        else if (ev.delta?.type === 'input_json_delta') toolJson += ev.delta.partial_json ?? ''
      } else if (ev.type === 'content_block_stop' && toolName) {
        if (toolName === ANNOTATE_TOOL_NAME || toolName === FILL_TOOL_NAME) {
          try {
            const event = toEvent(toolName, JSON.parse(toolJson || '{}'))
            if (event) yield event
          } catch {
            // Malformed tool JSON — keep the text answer.
          }
        }
        toolName = ''
        toolJson = ''
      }
    }
  }
}

function headers(apiKey: string): Record<string, string> {
  return {
    'x-api-key': apiKey,
    'anthropic-version': VERSION,
    // Required for calls originating in a browser context, which a service worker is.
    'anthropic-dangerous-direct-browser-access': 'true'
  }
}
