import { execFile } from 'child_process'
import { app } from 'electron'
import { join } from 'path'
import type { UiElement } from '../../shared/types'

/** Raw probe output — coordinates are virtual-desktop pixels, not screenshot pixels. */
interface ProbeWindow {
  x: number
  y: number
  w: number
  h: number
  title: string
}

interface ProbeElement {
  name: string
  role: string
  x: number
  y: number
  w: number
  h: number
  enabled: boolean
}

export interface ProbeResult {
  window: ProbeWindow | null
  elements: ProbeElement[]
}

const EMPTY: ProbeResult = { window: null, elements: [] }

/** A hung accessibility provider must never hold up the ask flow. */
const PROBE_TIMEOUT_MS = 2500

function probeScriptPath(): string {
  // Mirrors the tray-icon path convention in main/index.ts: resources/ sits next to out/.
  return app.isPackaged
    ? join(process.resourcesPath, 'uia-probe.ps1')
    : join(__dirname, '../../resources/uia-probe.ps1')
}

/**
 * Reads the foreground window's accessibility tree. Windows-only; every failure path
 * resolves to an empty result so callers degrade to vision-only rather than throwing.
 */
export async function probeForegroundWindow(): Promise<ProbeResult> {
  if (process.platform !== 'win32') return EMPTY

  return new Promise<ProbeResult>((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', probeScriptPath()],
      { timeout: PROBE_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (error, stdout) => {
        if (error) {
          console.warn('[uia] probe failed, continuing vision-only:', error.message)
          return resolve(EMPTY)
        }
        try {
          const parsed = JSON.parse(stdout) as ProbeResult
          resolve({ window: parsed.window ?? null, elements: parsed.elements ?? [] })
        } catch (err) {
          console.warn('[uia] unparseable probe output, continuing vision-only:', (err as Error).message)
          resolve(EMPTY)
        }
      }
    )
  })
}

/**
 * Rebases virtual-desktop element rects into the captured screenshot's pixel space, so the
 * model, the overlay and the screenshot all speak exactly one coordinate system.
 *
 * Elements outside the captured display are dropped: on a multi-monitor setup the foreground
 * window can sit on a different screen than the one in the image, and feeding the model
 * controls that aren't in the picture is worse than giving it none.
 */
export function toScreenshotSpace(
  elements: ProbeElement[],
  displayBounds: { x: number; y: number; width: number; height: number },
  imageWidth: number,
  imageHeight: number
): UiElement[] {
  const scaleX = imageWidth / displayBounds.width
  const scaleY = imageHeight / displayBounds.height

  const result: UiElement[] = []

  for (const el of elements) {
    // Rebase from virtual-desktop origin to this display's origin.
    const localX = el.x - displayBounds.x
    const localY = el.y - displayBounds.y

    // Discard anything not actually on this display (other monitor, fully off-edge).
    if (localX + el.w <= 0 || localY + el.h <= 0) continue
    if (localX >= displayBounds.width || localY >= displayBounds.height) continue

    // Maximized windows overhang the screen edge by a few pixels; clamp into the image.
    const x = Math.max(0, Math.round(localX * scaleX))
    const y = Math.max(0, Math.round(localY * scaleY))
    const w = Math.round(el.w * scaleX)
    const h = Math.round(el.h * scaleY)

    result.push({
      id: result.length + 1,
      name: el.name,
      role: el.role,
      x,
      y,
      width: Math.min(w, imageWidth - x),
      height: Math.min(h, imageHeight - y),
      enabled: el.enabled,
      screenRect: { x: el.x, y: el.y, w: el.w, h: el.h },
      editable: EDITABLE_ROLES.has(el.role) && el.enabled
    })
  }

  return result
}

/** Roles that accept typed input — the only ones a fill may ever target. */
const EDITABLE_ROLES = new Set(['Edit', 'ComboBox'])

function fillScriptPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'uia-fill.ps1')
    : join(__dirname, '../../resources/uia-fill.ps1')
}

/**
 * Types one approved value into one control. Deliberately never presses Enter or activates
 * any button — completing the form is always the user's own action.
 */
export async function fillElement(el: UiElement, value: string): Promise<{ ok: boolean; error: string | null }> {
  if (process.platform !== 'win32') return { ok: false, error: 'Assisted fill is Windows-only.' }
  if (!el.editable) return { ok: false, error: `"${el.name}" is not a text field.` }

  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fillScriptPath(),
        '-X', String(el.screenRect.x),
        '-Y', String(el.screenRect.y),
        '-W', String(el.screenRect.w),
        '-H', String(el.screenRect.h),
        '-Name', el.name,
        '-Value', value
      ],
      { timeout: 8000, windowsHide: true },
      (error, stdout) => {
        if (error) return resolve({ ok: false, error: error.message })
        try {
          const parsed = JSON.parse(stdout) as { ok: boolean; error: string | null }
          resolve(parsed)
        } catch {
          resolve({ ok: false, error: 'Fill helper returned an unreadable result.' })
        }
      }
    )
  })
}
