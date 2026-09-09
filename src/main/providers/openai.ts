import OpenAI from 'openai'
import type { AnalyzeFrameInput, StreamEvent, VisionProvider } from './types'
import {
  FILL_TOOL_DESCRIPTION,
  FILL_TOOL_NAME,
  FILL_TOOL_PARAMETERS,
  HIGHLIGHT_TOOL_NAME,
  HIGHLIGHT_TOOL_DESCRIPTION,
  HIGHLIGHT_TOOL_PARAMETERS,
  ProviderError
} from './types'
import { buildSystemPrompt } from './prompt'
import type { ScreenPointer } from '../../shared/types'

const MODEL = 'gpt-4o'

export const openAIProvider: VisionProvider = {
  id: 'openai',
  displayName: 'OpenAI',

  async analyzeFrame(input: AnalyzeFrameInput, apiKey: string) {
    if (!apiKey) throw new ProviderError('No OpenAI API key configured.')

    const client = new OpenAI({ apiKey })

    const historyMessages = input.history.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.text
    }))

    async function createStream() {
      return client.chat.completions.create({
        model: MODEL,
        max_tokens: 2048,
        stream: true,
        tools: [
          {
            type: 'function',
            function: {
              name: HIGHLIGHT_TOOL_NAME,
              description: HIGHLIGHT_TOOL_DESCRIPTION,
              parameters: HIGHLIGHT_TOOL_PARAMETERS
            }
          },
          {
            type: 'function',
            function: {
              name: FILL_TOOL_NAME,
              description: FILL_TOOL_DESCRIPTION,
              parameters: FILL_TOOL_PARAMETERS
            }
          }
        ],
        messages: [
          { role: 'system', content: buildSystemPrompt(input.imageWidth, input.imageHeight, input.elements) },
          ...historyMessages,
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:image/png;base64,${input.imagePngBase64}` } },
              { type: 'text', text: input.prompt }
            ]
          }
        ]
      })
    }

    let stream: Awaited<ReturnType<typeof createStream>>
    try {
      stream = await createStream()
    } catch (err) {
      throw new ProviderError(`OpenAI request failed: ${(err as Error).message}`)
    }

    return (async function* (): AsyncIterable<StreamEvent> {
      // Tool-call argument fragments arrive across many chunks, keyed by index; only the
      // first chunk for a given index carries the function name.
      const toolCallArgs = new Map<number, { name: string; args: string }>()

      try {
        for await (const chunk of stream) {
          const delta = chunk.choices?.[0]?.delta
          if (delta?.content) {
            yield { type: 'text', text: delta.content }
          }
          for (const toolCall of delta?.tool_calls ?? []) {
            const existing = toolCallArgs.get(toolCall.index) ?? { name: '', args: '' }
            if (toolCall.function?.name) existing.name = toolCall.function.name
            if (toolCall.function?.arguments) existing.args += toolCall.function.arguments
            toolCallArgs.set(toolCall.index, existing)
          }
        }

        for (const { name, args } of toolCallArgs.values()) {
          try {
            if (name === HIGHLIGHT_TOOL_NAME) {
              const parsed = JSON.parse(args) as { pointers?: ScreenPointer[] }
              if (parsed.pointers?.length) yield { type: 'pointers', pointers: parsed.pointers }
            } else if (name === FILL_TOOL_NAME) {
              const parsed = JSON.parse(args) as { fills?: { elementId: number; value: string }[] }
              if (parsed.fills?.length) yield { type: 'fills', fills: parsed.fills }
            }
          } catch {
            // Malformed tool JSON — drop that action, keep the text answer.
          }
        }
      } catch (err) {
        throw new ProviderError(`OpenAI stream error: ${(err as Error).message}`)
      }
    })()
  }
}
