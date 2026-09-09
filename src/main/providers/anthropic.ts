import Anthropic from '@anthropic-ai/sdk'
import type { AnalyzeFrameInput, StreamEvent, VisionProvider } from './types'
import {
  FILL_TOOL_DESCRIPTION,
  FILL_TOOL_NAME,
  FILL_TOOL_PARAMETERS,
  HIGHLIGHT_TOOL_DESCRIPTION,
  HIGHLIGHT_TOOL_NAME,
  HIGHLIGHT_TOOL_PARAMETERS,
  ProviderError
} from './types'
import { buildSystemPrompt } from './prompt'
import type { ScreenPointer } from '../../shared/types'

const MODEL = 'claude-opus-5'

export const anthropicProvider: VisionProvider = {
  id: 'anthropic',
  displayName: 'Anthropic (Claude)',

  async analyzeFrame(input: AnalyzeFrameInput, apiKey: string) {
    if (!apiKey) throw new ProviderError('No Anthropic API key configured.')

    const client = new Anthropic({ apiKey })

    const historyBlocks = input.history.map((m) => ({
      role: m.role,
      content: m.text
    }))

    let stream: ReturnType<Anthropic['messages']['stream']>
    try {
      stream = client.messages.stream({
        model: MODEL,
        max_tokens: 2048,
        system: buildSystemPrompt(input.imageWidth, input.imageHeight, input.elements),
        tools: [
          {
            name: HIGHLIGHT_TOOL_NAME,
            description: HIGHLIGHT_TOOL_DESCRIPTION,
            input_schema: HIGHLIGHT_TOOL_PARAMETERS as unknown as Anthropic.Tool['input_schema']
          },
          {
            name: FILL_TOOL_NAME,
            description: FILL_TOOL_DESCRIPTION,
            input_schema: FILL_TOOL_PARAMETERS as unknown as Anthropic.Tool['input_schema']
          }
        ],
        messages: [
          ...historyBlocks,
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: 'image/png', data: input.imagePngBase64 }
              },
              { type: 'text', text: input.prompt }
            ]
          }
        ]
      })
    } catch (err) {
      throw new ProviderError(`Anthropic request failed: ${(err as Error).message}`)
    }

    return (async function* (): AsyncIterable<StreamEvent> {
      try {
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            yield { type: 'text', text: event.delta.text }
          }
        }

        const final = await stream.finalMessage()
        const toolUses = final.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
        )

        for (const toolUse of toolUses) {
          if (toolUse.name === HIGHLIGHT_TOOL_NAME) {
            const pointers = (toolUse.input as { pointers?: ScreenPointer[] }).pointers
            if (pointers?.length) yield { type: 'pointers', pointers }
          } else if (toolUse.name === FILL_TOOL_NAME) {
            const fills = (toolUse.input as { fills?: { elementId: number; value: string }[] }).fills
            if (fills?.length) yield { type: 'fills', fills }
          }
        }
      } catch (err) {
        throw new ProviderError(`Anthropic stream error: ${(err as Error).message}`)
      }
    })()
  }
}
