export type ProviderId = 'anthropic' | 'openai'

export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
}

export interface SettingsState {
  providerId: ProviderId
  hasAnthropicKey: boolean
  hasOpenAIKey: boolean
  consentGiven: boolean
  /** Whether the OS accessibility tree may be read for ground-truth element data. */
  useAccessibilityTree: boolean
}

/**
 * A real on-screen control reported by the OS accessibility tree, with coordinates already
 * rebased into the captured screenshot's pixel space.
 */
export interface UiElement {
  /** 1-based index the model cites to target this element exactly. */
  id: number
  name: string
  role: string
  x: number
  y: number
  width: number
  height: number
  enabled: boolean
  /**
   * Original virtual-desktop rect. Kept alongside the screenshot-space values because
   * automation has to address the real control, not the scaled-down image of it. Never
   * shown to the model — main-process use only.
   */
  screenRect: { x: number; y: number; w: number; h: number }
  /** Whether this control can receive typed input (drives fill proposals). */
  editable: boolean
}

/** One field the AI proposes to fill, pending explicit user approval. */
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

export interface AskRequest {
  prompt: string
  history: ChatMessage[]
}

export interface CaptureResult {
  imagePngBase64: string
  displayLabel: string
  width: number
  height: number
}

export type PointerShape = 'circle' | 'box'

export interface ScreenPointer {
  /** Presence implies this is part of a numbered sequence, connected by arrows in order. */
  step?: number
  /**
   * Preferred targeting: the id of a UiElement from the accessibility tree. When set, the
   * exact OS-reported bounds are used and x/y/shape below are ignored — no pixel guessing.
   */
  elementId?: number
  shape: PointerShape
  /** Pixel coordinates in the same space as the screenshot that produced them. */
  x: number
  y: number
  radius?: number // for 'circle'
  width?: number // for 'box'
  height?: number // for 'box'
  label?: string
}

/** What the overlay window needs to scale pointer pixel-coords to its own viewport. */
export interface OverlayPayload {
  pointers: ScreenPointer[]
  /** Pixel dimensions of the screenshot the coordinates were computed against. */
  imageWidth: number
  imageHeight: number
  /** Logical (CSS) dimensions of the overlay window itself — differs from image* on hi-DPI. */
  screenWidth: number
  screenHeight: number
}

/** Channel names shared between preload and renderer to avoid string-literal drift. */
export const IPC = {
  hotkeyTriggered: 'hotkey-triggered',
  requestConsent: 'request-consent',
  consentResponse: 'consent-response',
  getSettings: 'get-settings',
  setProvider: 'set-provider',
  setApiKey: 'set-api-key',
  ask: 'ask',
  askStreamChunk: 'ask-stream-chunk',
  askStreamDone: 'ask-stream-done',
  askStreamError: 'ask-stream-error',
  captureNow: 'capture-now',
  setUseAccessibilityTree: 'set-use-accessibility-tree',
  clearOverlay: 'clear-overlay',
  fillProposed: 'fill-proposed',
  approveFill: 'approve-fill',
  overlayShow: 'overlay-show',
  overlayClear: 'overlay-clear'
} as const
