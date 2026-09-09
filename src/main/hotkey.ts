import { globalShortcut } from 'electron'

const DEFAULT_ACCELERATOR = 'CommandOrControl+Shift+Space'

export function registerHotkey(onTrigger: () => void): void {
  const ok = globalShortcut.register(DEFAULT_ACCELERATOR, onTrigger)
  if (!ok) {
    console.error(`Failed to register global hotkey ${DEFAULT_ACCELERATOR} — it may be in use by another app.`)
  }
}

export function unregisterHotkey(): void {
  globalShortcut.unregisterAll()
}
