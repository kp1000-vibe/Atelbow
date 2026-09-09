import { app, BrowserWindow, screen, type Display } from 'electron'
import { join } from 'path'
import { IPC, type OverlayPayload, type ScreenPointer } from '../shared/types'

const AUTO_HIDE_MS = 60_000

let overlayWindow: BrowserWindow | null = null
let hideTimer: ReturnType<typeof setTimeout> | null = null

export function createOverlayWindow(): BrowserWindow {
  const bounds = screen.getPrimaryDisplay().bounds

  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.setIgnoreMouseEvents(true, { forward: true })
  win.setAlwaysOnTop(true, 'screen-saver')

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}#overlay`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'overlay' })
  }

  overlayWindow = win
  return win
}

function clearHideTimer(): void {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
}

export function showPointers(
  pointers: ScreenPointer[],
  imageWidth: number,
  imageHeight: number,
  display: Display
): void {
  if (!overlayWindow || pointers.length === 0) return

  // Markers describe the display that was captured, so the overlay has to be on that same
  // screen — otherwise on a multi-monitor setup we'd draw the right shapes on the wrong
  // monitor.
  const { x, y, width, height } = display.bounds
  overlayWindow.setBounds({ x, y, width, height })

  // The overlay window is sized in logical (CSS) screen pixels, but pointer coordinates are in
  // the captured screenshot's physical pixel space, which can be 1x-3x larger on hi-DPI
  // displays. The renderer needs this ratio to size markers/text in real on-screen pixels
  // instead of scaling off the (possibly much larger) screenshot resolution.
  const { width: screenWidth, height: screenHeight } = display.size

  const payload: OverlayPayload = { pointers, imageWidth, imageHeight, screenWidth, screenHeight }
  overlayWindow.showInactive()
  overlayWindow.webContents.send(IPC.overlayShow, payload)

  clearHideTimer()
  hideTimer = setTimeout(() => clearPointers(), AUTO_HIDE_MS)
}

export function clearPointers(): void {
  clearHideTimer()
  if (!overlayWindow) return
  overlayWindow.webContents.send(IPC.overlayClear)
  overlayWindow.hide()
}
