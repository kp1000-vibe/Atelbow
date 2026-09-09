import type { Annotation, PageContext, ProviderId } from '../../shared/types'

/** What every adapter yields, whatever the wire format underneath. */
export type StreamEvent =
  | { type: 'text'; text: string }
  | { type: 'annotations'; annotations: Annotation[] }
  | { type: 'fills'; fills: { elementId: number; value: string }[] }

export interface SendOptions {
  apiKey: string
  system: string
  history: { role: 'user' | 'assistant'; text: string }[]
  prompt: string
  /**
   * The user asked for something to be done, so the model must call a tool rather than
   * reply with prose alone. It still chooses WHICH tool — pinning it to one made the
   * walkthrough impossible to produce in the same turn.
   */
  requireAction: boolean
  signal?: AbortSignal
}

/**
 * One adapter per API *shape*, not per vendor — Grok, DeepSeek, Kimi and OpenAI all speak the
 * same protocol, so they share an implementation and differ only by base URL and model.
 */
export interface Provider {
  id: ProviderId
  send(opts: SendOptions): AsyncIterable<StreamEvent>
  /** Cheap, free check that a pasted key actually works before we let the user past setup. */
  validateKey(apiKey: string): Promise<{ ok: boolean; error?: string }>
}

export const ANNOTATE_TOOL_NAME = 'annotate_page'
export const FILL_TOOL_NAME = 'propose_fill'

/** Neutral tool descriptions; each adapter translates these into its own schema dialect. */
export const TOOLS = {
  [ANNOTATE_TOOL_NAME]: {
    description:
      'Draw the steps onto the page. This is how you teach: showing where to click beats ' +
      'describing it. Make ONE call containing EVERY step whose control appears in the page ' +
      'element list, in the order the user should do them — not just the first one. If your ' +
      'answer has five steps and three of those controls are on this page, pass three ' +
      'annotations. Marking only the first step when others are visible wastes the walkthrough. ' +
      'Call it last, after your written answer.',
    parameters: {
      type: 'object',
      properties: {
        annotations: {
          type: 'array',
          description:
            'One entry per step, in the order the user should perform them. Include every ' +
            'step whose control is on this page — typically two to five, rarely just one.',
          items: {
            type: 'object',
            properties: {
              elementId: { type: 'integer', description: 'The #id of an element from the page list.' },
              verdict: {
                type: 'string',
                enum: ['best', 'value', 'flexible', 'caution', 'info'],
                description:
                  'info = an ordinary step, and the right choice for almost every one; ' +
                  'best = the single main action of the task; caution = something they could ' +
                  'get wrong or should not undo later. value and flexible are legacy and ' +
                  'should not be used for walkthrough steps.'
              },
              label: {
                type: 'string',
                description:
                  'The step, imperative, 2-5 words, naming the control as it is written on ' +
                  'screen: "Open Object Manager", "Click New", "Pick the object".'
              },
              note: {
                type: 'string',
                description:
                  'Optional. Why this step, or what to watch for — under ~10 words. ' +
                  '"Not Home — Object Manager is the second tab."'
              }
            },
            required: ['elementId', 'verdict', 'label']
          }
        }
      },
      required: ['annotations']
    }
  },
  [FILL_TOOL_NAME]: {
    description:
      'Propose values to type into text fields. This only PROPOSES — the user reviews and edits ' +
      'every value before anything is typed, and nothing is ever submitted. Only target fields ' +
      'marked [fillable]. Never propose passwords or card numbers, and never invent personal ' +
      'details the user has not given you.',
    parameters: {
      type: 'object',
      properties: {
        fills: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              elementId: { type: 'integer', description: 'The #id of a [fillable] field.' },
              value: { type: 'string', description: 'The exact text to type.' }
            },
            required: ['elementId', 'value']
          }
        }
      },
      required: ['fills']
    }
  }
} as const

/** Narrows raw tool output into the events the rest of the app understands. */
export function toEvent(name: string, input: unknown): StreamEvent | null {
  const obj = (input ?? {}) as Record<string, unknown>
  if (name === ANNOTATE_TOOL_NAME) {
    const annotations = obj.annotations as Annotation[] | undefined
    return annotations?.length ? { type: 'annotations', annotations } : null
  }
  if (name === FILL_TOOL_NAME) {
    const fills = obj.fills as { elementId: number; value: string }[] | undefined
    return fills?.length ? { type: 'fills', fills } : null
  }
  return null
}

export type { PageContext }
