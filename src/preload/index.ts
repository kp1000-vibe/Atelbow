import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type AskRequest,
  type FillOutcome,
  type FillProposal,
  type OverlayPayload,
  type ProviderId
} from '../shared/types'

const api = {
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  setProvider: (providerId: ProviderId) => ipcRenderer.invoke(IPC.setProvider, providerId),
  setApiKey: (providerId: ProviderId, apiKey: string) =>
    ipcRenderer.invoke(IPC.setApiKey, { providerId, apiKey }),
  giveConsent: (granted: boolean) => ipcRenderer.invoke(IPC.consentResponse, granted),
  setUseAccessibilityTree: (enabled: boolean) => ipcRenderer.invoke(IPC.setUseAccessibilityTree, enabled),
  captureNow: () => ipcRenderer.invoke(IPC.captureNow),
  clearOverlay: () => ipcRenderer.invoke(IPC.clearOverlay),

  ask: (request: AskRequest) => ipcRenderer.send(IPC.ask, request),
  onAskStreamChunk: (cb: (chunk: string) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, chunk: string) => cb(chunk)
    ipcRenderer.on(IPC.askStreamChunk, listener)
    return () => ipcRenderer.removeListener(IPC.askStreamChunk, listener)
  },
  onAskStreamDone: (cb: () => void) => {
    const listener = () => cb()
    ipcRenderer.on(IPC.askStreamDone, listener)
    return () => ipcRenderer.removeListener(IPC.askStreamDone, listener)
  },
  onAskStreamError: (cb: (message: string) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, message: string) => cb(message)
    ipcRenderer.on(IPC.askStreamError, listener)
    return () => ipcRenderer.removeListener(IPC.askStreamError, listener)
  },
  onHotkeyTriggered: (cb: () => void) => {
    const listener = () => cb()
    ipcRenderer.on(IPC.hotkeyTriggered, listener)
    return () => ipcRenderer.removeListener(IPC.hotkeyTriggered, listener)
  },
  onOverlayShow: (cb: (payload: OverlayPayload) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: OverlayPayload) => cb(payload)
    ipcRenderer.on(IPC.overlayShow, listener)
    return () => ipcRenderer.removeListener(IPC.overlayShow, listener)
  },
  approveFill: (approved: FillProposal[]): Promise<FillOutcome[]> =>
    ipcRenderer.invoke(IPC.approveFill, approved),
  onFillProposed: (cb: (proposals: FillProposal[]) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, proposals: FillProposal[]) => cb(proposals)
    ipcRenderer.on(IPC.fillProposed, listener)
    return () => ipcRenderer.removeListener(IPC.fillProposed, listener)
  },
  onOverlayClear: (cb: () => void) => {
    const listener = () => cb()
    ipcRenderer.on(IPC.overlayClear, listener)
    return () => ipcRenderer.removeListener(IPC.overlayClear, listener)
  }
}

contextBridge.exposeInMainWorld('screenpilot', api)

export type ScreenPilotApi = typeof api
