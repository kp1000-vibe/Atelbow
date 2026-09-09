# ScreenPilot AI — MVP

An on-demand desktop copilot: press a hotkey, it screenshots your screen, and asks an AI
vision model (Anthropic Claude or OpenAI) what's there — answers stream into a small chat
window. This is the first slice of a larger "visual AI copilot" vision (continuous capture,
OCR, accessibility-tree awareness, overlays, automation) — see `docs/roadmap.md`.

## Setup

```bash
npm install
npm run dev
```

The app runs from the system tray (no window on launch). Press **Ctrl+Shift+Space**
anywhere to open the chat window, or click the tray icon.

On first run, open Settings (gear icon, or it opens automatically) and paste an API key for
Anthropic and/or OpenAI. Keys are encrypted at rest via the OS keychain (Electron
`safeStorage`) — never stored in plaintext, never sent anywhere but the provider you chose.

## How it works

- `src/main` — Electron main process: hotkey registration, screen capture
  (`desktopCapturer`), encrypted settings storage, and the AI provider adapters.
- `src/preload` — a narrow `contextBridge` API exposed to the renderer (no direct Node/Electron
  access from UI code).
- `src/renderer` — the chat UI (React).
- `src/shared` — types shared between main and renderer (message shapes, IPC channel names).

Providers implement a common `VisionProvider` interface
(`src/main/providers/types.ts`) so adding another backend (Gemini, OpenRouter, a local
Ollama model, etc.) means writing one new adapter file and registering it — no changes to
capture, IPC, or UI code.

## Privacy

- Screenshots are captured only when you press the hotkey or hit Send — never on a timer,
  never in the background.
- Nothing is written to disk; the image lives in memory only for the duration of one API call.
- A one-time consent dialog explains this before the first capture.
