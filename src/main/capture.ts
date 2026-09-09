import { desktopCapturer, screen, type Display } from 'electron'
import type { CaptureResult } from '../shared/types'

// Vision models ground spatial answers more reliably on moderately-sized images than on raw
// 4K/5K captures (large images commonly get resized internally before the model "sees" them,
// at which point its coordinates are relative to a resolution we're never told). Capping the
// long edge here means the dimensions we tell the model, send it, and render the overlay
// against are always the exact same image — no hidden resize anywhere in the pipeline.
const MAX_DIMENSION = 1536

/**
 * Grabs a screenshot of one display, downscaled to a bounded resolution for reliable AI
 * coordinate grounding. Nothing is written to disk — the PNG stays in memory as base64 for
 * the lifetime of one provider call.
 *
 * Takes an explicit display because on a multi-monitor setup the user's active window is
 * frequently not on the primary screen, and capturing the wrong one means answering about a
 * screen the user isn't even looking at.
 */
export async function captureDisplay(display: Display): Promise<CaptureResult> {
  const scaleFactor = display.scaleFactor || 1

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.round(display.size.width * scaleFactor),
      height: Math.round(display.size.height * scaleFactor)
    }
  })

  const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]

  if (!source) {
    throw new Error('No screen source available to capture.')
  }

  let image = source.thumbnail
  const { width: rawWidth, height: rawHeight } = image.getSize()
  const longEdge = Math.max(rawWidth, rawHeight)

  if (longEdge > MAX_DIMENSION) {
    const scale = MAX_DIMENSION / longEdge
    image = image.resize({
      width: Math.round(rawWidth * scale),
      height: Math.round(rawHeight * scale),
      quality: 'better'
    })
  }

  const { width, height } = image.getSize()

  return {
    imagePngBase64: image.toPNG().toString('base64'),
    displayLabel: source.name || 'Display',
    width,
    height
  }
}

/** Fallback when we have no better signal for which screen the user means. */
export function displayUnderCursor(): Display {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
}

/** The display containing the centre of a virtual-desktop rect. */
export function displayForRect(rect: { x: number; y: number; w: number; h: number }): Display {
  return screen.getDisplayNearestPoint({
    x: Math.round(rect.x + rect.w / 2),
    y: Math.round(rect.y + rect.h / 2)
  })
}
