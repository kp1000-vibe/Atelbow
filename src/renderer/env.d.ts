/// <reference types="vite/client" />

import type { ScreenPilotApi } from '../preload/index'

declare global {
  interface Window {
    screenpilot: ScreenPilotApi
  }
}

export {}
