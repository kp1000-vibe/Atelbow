import type { ProviderId } from '../../shared/types'
import { ANNOTATE_TOOL_NAME, FILL_TOOL_NAME, TOOLS, toEvent } from './types'
import type { Provider, SendOptions, StreamEvent } from './types'

/**
 * OpenAI, Grok (xAI), DeepSeek and Kimi (Moonshot) all expose the same `/chat/completions`
 * protocol, so they differ only by base URL and model name. One implementation, four vendors.
 */
export function createOpenAICompatible(config: {
  id: ProviderId
  baseUrl: string
  model: string
}): Provider {
  const { id, baseUrl, model } = config

  return {
    id,

    async validateKey(apiKey) {
      try {
        const res = await fetch(`${baseUrl}/models`, {
          headers: { Authorization: `Bearer ${apiKey}` }
        })
        if (res.ok) return { ok: true }
        if (res.status === 401 || res.status === 403) return { ok: false, error: 'That key was rejected.' }
        return { ok: false, error: `Provider returned ${res.status}.` }
      } catch {
        return { ok: false, error: "Couldn't reach the provider. Check your connection." }
      }
    },

    async *send(opts: SendOptions): AsyncIterable<StreamEvent> {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        signal: opts.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.apiKey}` },
        body: JSON.stringify({
          model,
          max_tokens: 4000,
          stream: true,
          messages: [
            { role: 'system', content: opts.system },
            ...opts.history.map((m) => ({ role: m.role, content: m.text })),
            { role: 'user', content: opts.prompt }
          ],
          tools: Object.entries(TOOLS).map(([name, t]) => ({
            type: 'function',
            function: { name, description: t.description, parameters: t.parameters }
          })),
        // No API-level tool forcing: obliging a tool call makes the model skip the written
        // steps, and for guidance the words matter as much as the marks. The system prompt
        // instructs it directly instead.
        })
      })

      if (!res.ok || !res.body) {
        throw new Error(await describeFailure(res))
      }

      // Tool arguments arrive as string fragments split across chunks and keyed by index;
      // only the first fragment for an index carries the function name.
      const pending = new Map<number, { name: string; args: string }>()

      for await (const data of sseLines(res.body)) {
        const delta = data.choices?.[0]?.delta
        if (delta?.content) yield { type: 'text', text: delta.content }

        for (const call of delta?.tool_calls ?? []) {
          const entry = pending.get(call.index) ?? { name: '', args: '' }
          if (call.function?.name) entry.name = call.function.name
          if (call.function?.arguments) entry.args += call.function.arguments
          pending.set(call.index, entry)
        }
      }

      for (const { name, args } of pending.values()) {
        if (name !== ANNOTATE_TOOL_NAME && name !== FILL_TOOL_NAME) continue
        try {
          const event = toEvent(name, JSON.parse(args))
          if (event) yield event
        } catch {
          // Malformed tool JSON — drop that action, keep the text answer.
        }
      }
    }
  }
}

async function describeFailure(res: Response): Promise<string> {
  if (res.status === 401 || res.status === 403) return 'Your API key was rejected.'
  if (res.status === 429) return 'Rate limited by the provider. Wait a moment and try again.'
  const body = await res.text().catch(() => '')
  const detail = body.slice(0, 200)
  return `Provider error ${res.status}${detail ? `: ${detail}` : ''}`
}

/**
 * Server-sent events split on blank lines, and a single network chunk may contain a partial
 * event — so the tail has to be carried across reads rather than parsed per chunk.
 */
export async function* sseLines(body: ReadableStream<Uint8Array>): AsyncIterable<any> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let idx: number
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx + 1)
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      try {
        yield JSON.parse(payload)
      } catch {
        // Ignore keep-alives and any non-JSON frames.
      }
    }
  }
}
