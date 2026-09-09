import { ANNOTATE_TOOL_NAME, FILL_TOOL_NAME, TOOLS, toEvent } from './types'
import type { Provider, SendOptions, StreamEvent } from './types'

const BASE = 'https://generativelanguage.googleapis.com/v1beta'

/**
 * Must stay in step with the `model` in providers/index.ts — that entry is what the setup
 * screen shows, this is what actually gets called, and when they drifted apart the UI
 * advertised a model the request never used.
 *
 * Google retired gemini-2.5-flash for new API keys, so every fresh install 404'd on its first
 * question. Model ids expire: when a provider returns 404 naming a replacement, that message
 * is the authority, not any value hardcoded here.
 */
const MODEL = 'gemini-3.6-flash'

/**
 * Gemini is the odd one out: system text goes in `systemInstruction`, turns are `contents`
 * with `parts`, tools are `functionDeclarations`, and the stream is a JSON array rather than
 * server-sent events. Hence its own adapter rather than sharing the OpenAI-compatible one.
 */
export const geminiProvider: Provider = {
  id: 'gemini',

  async validateKey(apiKey) {
    try {
      const res = await fetch(`${BASE}/models?key=${encodeURIComponent(apiKey)}&pageSize=1`)
      if (res.ok) return { ok: true }
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        return { ok: false, error: 'That key was rejected.' }
      }
      return { ok: false, error: `Google returned ${res.status}.` }
    } catch {
      return { ok: false, error: "Couldn't reach Google. Check your connection." }
    }
  },

  async *send(opts: SendOptions): AsyncIterable<StreamEvent> {
    const url =
      `${BASE}/models/${MODEL}:streamGenerateContent` +
      `?alt=sse&key=${encodeURIComponent(opts.apiKey)}`

    const body = (thinking: boolean): string =>
      JSON.stringify({
        systemInstruction: { parts: [{ text: opts.system }] },
        contents: [
          ...opts.history.map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.text }]
          })),
          { role: 'user', parts: [{ text: opts.prompt }] }
        ],
        tools: [
          {
            functionDeclarations: Object.entries(TOOLS).map(([name, t]) => ({
              name,
              description: t.description,
              parameters: t.parameters
            }))
          }
        ],
        // No API-level tool forcing: obliging a tool call makes the model skip the written
        // steps, and for guidance the words matter as much as the marks. The system prompt
        // instructs it directly instead.
        // Thinking tokens count against this budget on Gemini 3.x, and the tool call is
        // emitted last — so a long answer plus a long think ran the budget out before
        // annotate_page was ever reached, which showed up as "wrote a good answer, marked
        // nothing". Headroom is cheaper than a walkthrough that silently loses its marks.
        generationConfig: {
          maxOutputTokens: 8192,
          // 3.6-flash thinks at "medium" by default, which measured at 18-25s per turn —
          // far too slow for someone waiting mid-task. "low" keeps enough reasoning to pick
          // the right control out of ~80 candidates. Thinking cannot be switched off on this
          // model, only turned down.
          ...(thinking ? { thinkingLevel: 'low' } : {})
        }
      })

    let res = await fetch(url, {
      method: 'POST',
      signal: opts.signal,
      headers: { 'Content-Type': 'application/json' },
      body: body(true)
    })

    // Retry without the thinking hint if this model or API version rejects the field. Being
    // slow is a complaint; every request failing because of an unrecognised config key is an
    // outage, and it would land on the default provider.
    if (res.status === 400) {
      const detail = await res.clone().text().catch(() => '')
      if (/thinkingLevel|thinking_level|Unknown name/i.test(detail)) {
        res = await fetch(url, {
          method: 'POST',
          signal: opts.signal,
          headers: { 'Content-Type': 'application/json' },
          body: body(false)
        })
      }
    }

    if (!res.ok || !res.body) {
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        throw new Error('Your Google API key was rejected.')
      }
      if (res.status === 429) throw new Error('Rate limited by Google. Wait a moment and try again.')
      throw new Error(`Google error ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
    }

    for await (const chunk of sse(res.body)) {
      for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
        if (part.text) yield { type: 'text', text: part.text }
        if (part.functionCall) {
          const { name, args } = part.functionCall
          if (name === ANNOTATE_TOOL_NAME || name === FILL_TOOL_NAME) {
            // Gemini returns tool args already parsed, unlike the other two.
            const event = toEvent(name, args)
            if (event) yield event
          }
        }
      }
    }
  }
}

async function* sse(body: ReadableStream<Uint8Array>): AsyncIterable<any> {
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
      if (!payload) continue
      try {
        yield JSON.parse(payload)
      } catch {
        // Keep-alive or partial frame.
      }
    }
  }
}
