import { ipcMain, type BrowserWindow, type Display } from 'electron'
import {
  IPC,
  type AskRequest,
  type FillOutcome,
  type FillProposal,
  type ProviderId,
  type ScreenPointer,
  type UiElement
} from '../shared/types'
import { captureDisplay, displayForRect, displayUnderCursor } from './capture'
import * as overlay from './overlay'
import { getProvider } from './providers'
import { ProviderError } from './providers/types'
import * as settings from './settings'
import { fillElement, probeForegroundWindow, toScreenshotSpace } from './uia'

/** Frames the compositor needs to actually stop painting a window we just hid. */
const COMPOSITOR_SETTLE_MS = 180

interface ScreenContext {
  imagePngBase64: string
  width: number
  height: number
  elements: UiElement[]
  display: Display
}

/**
 * Captures what the *user* is looking at, not what ScreenPilot is drawing over it, together
 * with the ground-truth control list for that same view.
 *
 * Both of our own windows are always-on-top, so without hiding them they land in the
 * screenshot the model is asked to analyse: the chat panel occludes real content, and stale
 * overlay markers from the previous answer get read back as if they were part of the app.
 * Hiding them first also makes GetForegroundWindow() resolve to the user's actual app.
 */
async function captureScreenContext(win: BrowserWindow | null): Promise<ScreenContext> {
  const restoreChatWindow = win?.isVisible() ?? false

  overlay.clearPointers()
  if (restoreChatWindow) win?.hide()
  await new Promise((resolve) => setTimeout(resolve, COMPOSITOR_SETTLE_MS))

  try {
    const useUia = settings.getUseAccessibilityTree()
    const probe = useUia ? await probeForegroundWindow() : { window: null, elements: [] }

    // Capture the display the user's active window is actually on. On a multi-monitor setup
    // the foreground window is often not on the primary screen, and capturing the wrong one
    // means answering about a screen the user isn't looking at.
    const display: Display = probe.window ? displayForRect(probe.window) : displayUnderCursor()

    const capture = await captureDisplay(display)
    const elements = toScreenshotSpace(probe.elements, display.bounds, capture.width, capture.height)

    return {
      imagePngBase64: capture.imagePngBase64,
      width: capture.width,
      height: capture.height,
      elements,
      display
    }
  } finally {
    if (restoreChatWindow) win?.show()
  }
}

/**
 * Turns model output into drawable markers. An `elementId` reference wins: it resolves to the
 * OS-reported bounds, which are exact. Raw coordinates remain supported for targets the
 * accessibility tree cannot see (canvas, video, custom-drawn UI).
 */
function resolvePointers(pointers: ScreenPointer[], elements: UiElement[]): ScreenPointer[] {
  const byId = new Map(elements.map((el) => [el.id, el]))

  return pointers.flatMap((pointer) => {
    if (pointer.elementId == null) {
      // Guard against a tool call that supplied neither an id nor usable coordinates.
      return Number.isFinite(pointer.x) && Number.isFinite(pointer.y) ? [pointer] : []
    }

    const el = byId.get(pointer.elementId)
    if (!el) {
      // Hallucinated id — fall back to coordinates if it gave any, otherwise drop it rather
      // than draw a marker somewhere arbitrary.
      return Number.isFinite(pointer.x) && Number.isFinite(pointer.y) ? [pointer] : []
    }

    return [
      {
        ...pointer,
        shape: 'box' as const,
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height
      }
    ]
  })
}

/**
 * Elements from the most recent answer, kept so an approved fill targets exactly what the
 * user was shown. Cleared once used.
 */
let pendingFillElements: UiElement[] = []

/** Maps model-proposed fills onto real editable controls, dropping anything unsafe. */
function toFillProposals(
  fills: { elementId: number; value: string }[],
  elements: UiElement[]
): FillProposal[] {
  const byId = new Map(elements.map((el) => [el.id, el]))

  return fills.flatMap((fill) => {
    const el = byId.get(fill.elementId)
    // Only ever type into a real, enabled text field the user could see in the list.
    if (!el || !el.editable) return []
    if (typeof fill.value !== 'string' || fill.value.length === 0) return []
    return [{ elementId: el.id, fieldName: el.name, value: fill.value }]
  })
}

export function registerIpcHandlers(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IPC.getSettings, () => settings.getSettingsState())

  ipcMain.handle(IPC.setProvider, (_e, providerId: ProviderId) => {
    settings.setProviderId(providerId)
    return settings.getSettingsState()
  })

  ipcMain.handle(IPC.setApiKey, (_e, { providerId, apiKey }: { providerId: ProviderId; apiKey: string }) => {
    settings.setApiKey(providerId, apiKey)
    return settings.getSettingsState()
  })

  ipcMain.handle(IPC.consentResponse, (_e, granted: boolean) => {
    settings.setConsentGiven(granted)
    return settings.getSettingsState()
  })

  ipcMain.handle(IPC.setUseAccessibilityTree, (_e, enabled: boolean) => {
    settings.setUseAccessibilityTree(enabled)
    return settings.getSettingsState()
  })

  ipcMain.handle(IPC.captureNow, async () => {
    return captureDisplay(displayUnderCursor())
  })

  ipcMain.handle(IPC.clearOverlay, () => {
    overlay.clearPointers()
  })

  /**
   * Runs a fill the user explicitly approved in the UI. This is the only path that types
   * anything, and it exists solely behind that approval — the model can never reach it.
   */
  ipcMain.handle(IPC.approveFill, async (_e, approved: FillProposal[]): Promise<FillOutcome[]> => {
    const byId = new Map(pendingFillElements.map((el) => [el.id, el]))
    pendingFillElements = []

    const win = getWindow()
    const wasVisible = win?.isVisible() ?? false

    // Typing goes to the focused window, so ScreenPilot must get out of the way first or the
    // keystrokes land in our own chat box instead of the user's form.
    overlay.clearPointers()
    if (wasVisible) win?.hide()
    await new Promise((resolve) => setTimeout(resolve, COMPOSITOR_SETTLE_MS))

    const outcomes: FillOutcome[] = []
    try {
      for (const proposal of approved) {
        const el = byId.get(proposal.elementId)
        if (!el) {
          outcomes.push({ fieldName: proposal.fieldName, ok: false, error: 'Field is no longer available.' })
          continue
        }
        const res = await fillElement(el, proposal.value)
        outcomes.push({ fieldName: proposal.fieldName, ok: res.ok, error: res.error })
      }
    } finally {
      if (wasVisible) win?.show()
    }

    return outcomes
  })

  ipcMain.on(IPC.ask, async (_event, request: AskRequest) => {
    const win = getWindow()
    const providerId = settings.getProviderId()
    const apiKey = settings.getApiKey(providerId)

    try {
      const context = await captureScreenContext(win)
      const provider = getProvider(providerId)
      const stream = await provider.analyzeFrame(
        {
          imagePngBase64: context.imagePngBase64,
          imageWidth: context.width,
          imageHeight: context.height,
          elements: context.elements,
          prompt: request.prompt,
          history: request.history
        },
        apiKey
      )

      let sawText = false
      let markerCount = 0

      for await (const streamEvent of stream) {
        if (streamEvent.type === 'text') {
          if (streamEvent.text.trim()) sawText = true
          win?.webContents.send(IPC.askStreamChunk, streamEvent.text)
        } else if (streamEvent.type === 'pointers') {
          const resolved = resolvePointers(streamEvent.pointers, context.elements)
          markerCount = resolved.length
          overlay.showPointers(resolved, context.width, context.height, context.display)
        } else {
          // Proposals only — these are shown for approval and typed nothing yet.
          const proposals = toFillProposals(streamEvent.fills, context.elements)
          if (proposals.length > 0) {
            pendingFillElements = context.elements
            win?.webContents.send(IPC.fillProposed, proposals)
          }
        }
      }

      // A model that answers purely with a tool call would otherwise leave the chat blank.
      if (!sawText && markerCount > 0) {
        win?.webContents.send(
          IPC.askStreamChunk,
          markerCount === 1
            ? "I've highlighted it on your screen."
            : `I've highlighted ${markerCount} spots on your screen, in order.`
        )
      }

      win?.webContents.send(IPC.askStreamDone)
    } catch (err) {
      const message = err instanceof ProviderError ? err.message : `Unexpected error: ${(err as Error).message}`
      win?.webContents.send(IPC.askStreamError, message)
    }
  })
}
