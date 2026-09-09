// The panel is white, so the mark can carry the deep brand violet here. The in-page badge
// uses a lighter tint of the same hue because it sits on green — see overlay.ts.
const VIOLET = '#5A208C'
// Gold is a gradient now, defined inline below — no flat value left to reference.

/** Framed to the glyph's exact bounds — matches VIEWBOX in content/overlay.ts. */
const VIEWBOX = '19 3 72 96'
const ASPECT = 72 / 96

interface Props {
  /** Rendered height in px; width follows the mark's own proportions. */
  size?: number
}

/**
 * The VC mark. Same geometry as the packaged icons and the in-page badge, so the three
 * renderings can't drift apart.
 *
 * The viewBox is framed tightly to the artwork (x 20-90, y 4-98) rather than the nominal
 * 0-100 square. A square frame around a tall, narrow glyph scales it to fit the width and
 * leaves dead space above and below.
 */
export default function Logo({ size = 24 }: Props): JSX.Element {
  return (
    <svg
      viewBox={VIEWBOX}
      height={size}
      width={Math.round(size * ASPECT)}
      role="img"
      aria-label="atElbow"
    >
      {/* broad shallow C */}
      <path d="M76.5 72 A17.5 17.5 0 0 1 41.5 72" fill="none" stroke={VIOLET} strokeWidth="12.5" />
      {/* its detached upper terminal */}
      <polygon points="62,36 77,33 79,46 65,49" fill={VIOLET} />
      {/* the long diagonal continuing past the V's vertex */}
      <polygon points="39,74 48,63 20,98" fill={VIOLET} />
      {/* gold check-V, on a polished-metal ramp rather than a flat fill */}
      <defs>
        <linearGradient id="vc-gold-panel" x1="0" y1="0" x2="0.85" y2="1">
          <stop offset="0%" stopColor="#FBEEB8" />
          <stop offset="18%" stopColor="#E2B845" />
          <stop offset="38%" stopColor="#A9781A" />
          <stop offset="55%" stopColor="#F6DC8E" />
          <stop offset="74%" stopColor="#C99226" />
          <stop offset="100%" stopColor="#8C6210" />
        </linearGradient>
      </defs>
      <polygon points="23,31 40,73 90,4 46,51 35,31" fill="url(#vc-gold-panel)" />
    </svg>
  )
}
