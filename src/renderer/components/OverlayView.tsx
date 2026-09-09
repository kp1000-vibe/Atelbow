import { useEffect, useState } from 'react'
import type { OverlayPayload, ScreenPointer } from '../../shared/types'

// Matches --accent in styles.css. Kept as a literal because the overlay renders into SVG
// attributes on a transparent window, where CSS custom properties aren't available.
const ACCENT = '#5b4bdb'
const MAX_LABEL_CHARS = 24

function markerCenter(p: ScreenPointer): { cx: number; cy: number } {
  if (p.shape === 'box') {
    return { cx: p.x + (p.width ?? 0) / 2, cy: p.y + (p.height ?? 0) / 2 }
  }
  return { cx: p.x, cy: p.y }
}

function truncate(label: string): string {
  return label.length > MAX_LABEL_CHARS ? `${label.slice(0, MAX_LABEL_CHARS - 1)}…` : label
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export default function OverlayView(): JSX.Element | null {
  const [payload, setPayload] = useState<OverlayPayload | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const offShow = window.screenpilot.onOverlayShow((p) => {
      setPayload(p)
      // Two-step so the browser actually applies the opacity transition instead of skipping it.
      requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)))
    })
    const offClear = window.screenpilot.onOverlayClear(() => {
      setVisible(false)
      setTimeout(() => setPayload(null), 250)
    })
    return () => {
      offShow()
      offClear()
    }
  }, [])

  if (!payload || payload.pointers.length === 0) return null

  const { pointers, imageWidth, imageHeight, screenWidth } = payload

  // Pointer coordinates are in screenshot-pixel space, which on a hi-DPI display can be 1-3x
  // the overlay window's own (logical) pixel space. Every size below is defined as a real
  // on-screen pixel target, then converted into viewBox units via this ratio — so text and
  // markers read as a consistent, legible size regardless of capture resolution.
  const pxToViewBox = imageWidth / screenWidth

  const stroke = 3 * pxToViewBox
  const badgeRadius = 12 * pxToViewBox
  const badgeFontSize = 13 * pxToViewBox
  const labelFontSize = 12 * pxToViewBox
  const labelGap = 7 * pxToViewBox
  const labelPadX = 7 * pxToViewBox
  const labelPadY = 5 * pxToViewBox
  const cornerRadius = 6 * pxToViewBox

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        opacity: visible ? 1 : 0,
        transition: 'opacity 250ms ease'
      }}
    >
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${imageWidth} ${imageHeight}`}
        preserveAspectRatio="none"
        style={{ display: 'block' }}
      >
        <defs>
          {/* A soft dark drop shadow is what keeps a thin accent outline from dissolving into
              a busy photographic background — the marker gets its own edge to sit against. */}
          <filter id="marker-shadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow
              dx="0"
              dy={1 * pxToViewBox}
              stdDeviation={2.5 * pxToViewBox}
              floodColor="#000"
              floodOpacity="0.55"
            />
          </filter>
          <filter id="chip-shadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow
              dx="0"
              dy={1 * pxToViewBox}
              stdDeviation={2 * pxToViewBox}
              floodColor="#000"
              floodOpacity="0.45"
            />
          </filter>
        </defs>

        {pointers.map((p, i) => {
          const { cx, cy } = markerCenter(p)
          const halfWidth = p.shape === 'circle' ? (p.radius ?? 20 * pxToViewBox) : (p.width ?? 60 * pxToViewBox) / 2
          const halfHeight = p.shape === 'circle' ? (p.radius ?? 20 * pxToViewBox) : (p.height ?? 24 * pxToViewBox) / 2

          // Badge sits on the marker's top-left shoulder, overlapping the outline slightly, so
          // it reads as attached to that specific element instead of floating in the gap above
          // it — which is what made adjacent markers ambiguous when several sit in one row.
          const badgeCx = clamp(cx - halfWidth, badgeRadius, imageWidth - badgeRadius)
          const badgeCy = clamp(cy - halfHeight, badgeRadius, imageHeight - badgeRadius)

          // Label hangs off the badge. Flip to the left near the right edge so it never runs
          // off-screen.
          const label = p.label ? truncate(p.label) : null
          const estTextWidth = label ? label.length * labelFontSize * 0.58 : 0
          const chipWidth = estTextWidth + labelPadX * 2
          const flipLeft = badgeCx + badgeRadius + labelGap + chipWidth > imageWidth
          const chipX = flipLeft ? badgeCx - badgeRadius - labelGap - chipWidth : badgeCx + badgeRadius + labelGap

          // Drawn twice: a wider white halo underneath, then the accent stroke on top. Against
          // a dark UI the halo reads as the edge; against a bright photo the accent does. One
          // stroke alone disappears into one or the other.
          const shapeProps =
            p.shape === 'circle'
              ? { cx: p.x, cy: p.y, r: p.radius ?? 20 * pxToViewBox }
              : {
                  x: p.x,
                  y: p.y,
                  width: p.width ?? 60 * pxToViewBox,
                  height: p.height ?? 24 * pxToViewBox,
                  rx: cornerRadius
                }
          const Shape = p.shape === 'circle' ? 'circle' : 'rect'

          return (
            <g key={i}>
              <Shape
                {...(shapeProps as object)}
                fill="none"
                stroke="#ffffff"
                strokeOpacity={0.9}
                strokeWidth={stroke * 2.2}
                filter="url(#marker-shadow)"
              />
              <Shape
                {...(shapeProps as object)}
                fill={ACCENT}
                fillOpacity={0.14}
                stroke={ACCENT}
                strokeWidth={stroke}
              />

              {p.step != null && (
                <>
                  <circle
                    cx={badgeCx}
                    cy={badgeCy}
                    r={badgeRadius}
                    fill={ACCENT}
                    stroke="#ffffff"
                    strokeWidth={2 * pxToViewBox}
                    filter="url(#marker-shadow)"
                  />
                  <text
                    x={badgeCx}
                    y={badgeCy}
                    fill="white"
                    fontSize={badgeFontSize}
                    fontWeight={700}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontFamily="-apple-system, Segoe UI, sans-serif"
                  >
                    {p.step}
                  </text>
                </>
              )}

              {label && (
                <g>
                  <rect
                    x={chipX}
                    y={badgeCy - labelFontSize / 2 - labelPadY}
                    width={chipWidth}
                    height={labelFontSize + labelPadY * 2}
                    rx={cornerRadius}
                    fill="rgba(17,17,24,0.92)"
                    filter="url(#chip-shadow)"
                  />
                  <text
                    x={chipX + labelPadX}
                    y={badgeCy}
                    fill="white"
                    fontSize={labelFontSize}
                    fontWeight={500}
                    textAnchor="start"
                    dominantBaseline="central"
                    fontFamily="-apple-system, Segoe UI, sans-serif"
                  >
                    {label}
                  </text>
                </g>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
