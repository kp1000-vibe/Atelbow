import { family } from './providers.ts'
import type { ProviderId } from './providers.ts'

export interface TokenCount {
  input: number
  output: number
}

/**
 * Passes an SSE body through untouched while reading the token counts out of it.
 *
 * Metering has to happen on the way past rather than by re-reading the response, because the
 * body is consumed once — by the extension. Anything this can't parse yields zeros, and the
 * caller decides what to do about that; a metering failure must never truncate someone's
 * answer.
 */
export function meterStream(
  provider: ProviderId,
  onDone: (tokens: TokenCount) => void | Promise<void>
): TransformStream<Uint8Array, Uint8Array> {
  const shape = family(provider)
  const decoder = new TextDecoder()
  const tokens: TokenCount = { input: 0, output: 0 }
  let buffer = ''

  return new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(chunk)

      buffer += decoder.decode(chunk, { stream: true })
      let idx: number
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim()
        buffer = buffer.slice(idx + 1)
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        try {
          absorb(shape, JSON.parse(payload), tokens)
        } catch {
          // Keep-alives and partial frames are expected; they are not metering failures.
        }
      }
    },

    async flush() {
      await onDone(tokens)
    }
  })
}

function absorb(shape: 'anthropic' | 'openai' | 'gemini', data: any, tokens: TokenCount): void {
  if (shape === 'anthropic') {
    // Input arrives once at message_start; output is restated cumulatively in message_delta,
    // so the last value wins rather than accumulating.
    const start = data?.message?.usage
    if (start?.input_tokens) tokens.input = start.input_tokens
    if (data?.usage?.output_tokens) tokens.output = data.usage.output_tokens
    return
  }

  if (shape === 'gemini') {
    const u = data?.usageMetadata
    if (u?.promptTokenCount) tokens.input = u.promptTokenCount
    if (u?.candidatesTokenCount) tokens.output = u.candidatesTokenCount
    return
  }

  // OpenAI-compatible: a single usage object on the final chunk, present only because the
  // proxy injects stream_options.include_usage.
  const u = data?.usage
  if (u?.prompt_tokens) tokens.input = u.prompt_tokens
  if (u?.completion_tokens) tokens.output = u.completion_tokens
}
