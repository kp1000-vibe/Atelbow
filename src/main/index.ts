import { app, BrowserWindow, Menu, Tray, nativeImage, shell } from 'electron'
import { join } from 'path'
import { registerHotkey, unregisterHotkey } from './hotkey'
import { registerIpcHandlers } from './ipc'
import { createOverlayWindow } from './overlay'
import { IPC } from '../shared/types'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 420,
    height: 600,
    show: false,
    resizable: true,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    title: 'ScreenPilot AI',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      win.hide()
    }
  })

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

function showAndFocus(triggeredByHotkey: boolean): void {
  if (!mainWindow) return
  mainWindow.show()
  mainWindow.focus()
  if (triggeredByHotkey) {
    mainWindow.webContents.send(IPC.hotkeyTriggered)
  }
}

function createTray(): void {
  const icon = nativeImage.createFromPath(join(__dirname, '../../resources/tray-icon.png'))
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  tray.setToolTip('ScreenPilot AI — Ctrl+Shift+Space to ask about your screen')

  const menu = Menu.buildFromTemplate([
    { label: 'Ask about my screen', click: () => showAndFocus(true) },
    { label: 'Open ScreenPilot', click: () => showAndFocus(false) },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])
  tray.setContextMenu(menu)
  tray.on('click', () => showAndFocus(false))
}

app.whenReady().then(() => {
  mainWindow = createWindow()
  createOverlayWindow()
  createTray()
  registerIpcHandlers(() => mainWindow)
  registerHotkey(() => showAndFocus(true))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
    } else {
      showAndFocus(false)
    }
  })
})

app.on('second-instance', () => showAndFocus(false))

app.on('will-quit', () => {
  unregisterHotkey()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
