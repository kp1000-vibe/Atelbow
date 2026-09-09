import type { ChatMessage, ScreenPointer, UiElement } from '../../shared/types'

export interface AnalyzeFrameInput {
  /** Raw base64-encoded PNG, no data: URL prefix. */
  imagePngBase64: string
  /** Exact pixel dimensions of that PNG — told to the model so its coordinates target a known space. */
  imageWidth: number
  imageHeight: number
  /** Ground-truth controls from the OS accessibility tree; empty when unavailable/disabled. */
  elements: UiElement[]
  prompt: string
  history: ChatMessage[]
}

export type StreamEvent =
  | { type: 'text'; text: string }
  | { type: 'pointers'; pointers: ScreenPointer[] }
  | { type: 'fills'; fills: { elementId: number; value: string }[] }

/**
 * Common interface every AI backend adapter implements. `analyzeFrame` yields a mix of text
 * chunks (as the model streams its reply) and at most one trailing `pointers` event if the
 * model chose to call the highlight tool — folding what the spec calls `stream()` into one
 * return type rather than a separate method. Automation-mode `toolCalls()` hooks are
 * deliberately left off this interface until that phase defines what a tool call needs to carry.
 */
export interface VisionProvider {
  id: 'anthropic' | 'openai'
  displayName: string
  analyzeFrame(input: AnalyzeFrameInput, apiKey: string): Promise<AsyncIterable<StreamEvent>>
}

export class ProviderError extends Error {}

export const HIGHLIGHT_TOOL_NAME = 'highlight_screen_locations'

export const HIGHLIGHT_TOOL_DESCRIPTION =
  'Call this when your answer points at one or more specific, concrete elements on the screen ' +
  '(a button, menu item, field, icon, etc). Give precise pixel coordinates in the exact same ' +
  'coordinate space as the screenshot you were shown (top-left is 0,0). ' +
  'IMPORTANT — the "label" is optional and should usually be OMITTED. The marker is drawn on ' +
  'top of the live screen, so the element\'s own visible text is already there: never restate ' +
  'it. If the element already shows a clear caption or placeholder (a field reading "Search ' +
  'destinations", a tab reading "Experiences", a button reading "Save"), omit the label ' +
  'entirely and let the numbered marker speak for itself. Add a label ONLY when the target is ' +
  'genuinely unlabeled or ambiguous on screen — a bare icon, an unnamed control — and then keep ' +
  'it to 2-3 words describing what it DOES (e.g. "Opens filters", "Clears search"), never a ' +
  'full sentence. Skip this tool entirely for purely conversational answers that do not ' +
  'reference a specific location.'

export const FILL_TOOL_NAME = 'propose_form_fill'

export const FILL_TOOL_DESCRIPTION =
  'Propose values to type into text fields on screen, when the user has asked you to fill ' +
  'something in for them. This only PROPOSES: the user sees every value and must approve ' +
  'before anything is typed, and nothing is ever submitted — they press the final button ' +
  'themselves. Only target text fields from the on-screen controls list. Never propose values ' +
  'for passwords, card numbers, or other credentials, and never invent personal details the ' +
  'user has not given you — ask instead. Still write your normal text answer explaining what ' +
  'you are filling and why.'

export const FILL_TOOL_PARAMETERS = {
  type: 'object',
  properties: {
    fills: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          elementId: { type: 'integer', description: 'The #id of a text field from the on-screen controls list.' },
          value: { type: 'string', description: 'The exact text to type into that field.' }
        },
        required: ['elementId', 'value']
      }
    }
  },
  required: ['fills']
} as const

/** JSON-schema-shaped description of the pointer list, reused by both provider adapters. */
export const HIGHLIGHT_TOOL_PARAMETERS = {
  type: 'object',
  properties: {
    pointers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          step: { type: 'integer', description: 'Order in a multi-step sequence, starting at 1. Omit for a single pointer.' },
          elementId: {
            type: 'integer',
            description:
              'STRONGLY PREFERRED. The "#N" id of a control from the on-screen controls list. ' +
              'When set, the exact OS-reported bounds are used and x/y/shape are ignored, so the ' +
              'marker lands perfectly. Only fall back to raw coordinates if the target is genuinely ' +
              'not in that list.'
          },
          shape: { type: 'string', enum: ['circle', 'box'] },
          x: { type: 'number', description: 'Pixel x-coordinate, same space as the screenshot.' },
          y: { type: 'number', description: 'Pixel y-coordinate, same space as the screenshot.' },
          radius: { type: 'number', description: 'Circle radius in pixels (for shape "circle").' },
          width: { type: 'number', description: 'Box width in pixels (for shape "box").' },
          height: { type: 'number', description: 'Box height in pixels (for shape "box").' },
          label: {
            type: 'string',
            description:
              'OPTIONAL and usually omitted. Only for targets with no clear visible text of their own ' +
              '(a bare icon, an unnamed control). 2-3 words describing what it does. Never restate ' +
              'text already visible on the element, and never a full sentence.'
          }
        },
        // Nothing is strictly required: a pointer is valid either as an elementId reference
        // or as a raw shape+coordinate. The main process validates and resolves the two forms.
        required: []
      }
    }
  },
  required: ['pointers']
} as const
