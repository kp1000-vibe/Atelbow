import { nodeRegistry } from './extract'
import {
  VERDICT_STYLE,
  type Annotation,
  type BadgeState,
  type DrawTrace,
  type PageElement
} from '../shared/types'

const HOST_ID = '__atelbow_overlay_host'

let host: HTMLDivElement | null = null
let shadow: ShadowRoot | null = null

/**
 * The overlay lives in a Shadow DOM root so the host page's stylesheets cannot reach it —
 * without this, sites with aggressive global CSS (`* { box-sizing }`, `div { margin }`,
 * high-specificity resets) visibly wreck the markers.
 */
function ensureHost(): ShadowRoot {
  if (shadow && host?.isConnected) return shadow

  host = document.createElement('div')
  host.id = HOST_ID
  // Anchored to the document, not the viewport, so markers scroll with their targets.
  host.style.cssText = [
    'position:absolute',
    'top:0',
    'left:0',
    'width:0',
    'height:0',
    'margin:0',
    'padding:0',
    'border:0',
    'z-index:2147483647',
    'pointer-events:none'
  ].join(';')

  shadow = host.attachShadow({ mode: 'open' })

  // Built node by node rather than with innerHTML. Sites that enforce Trusted Types
  // (Google properties among them) throw on any innerHTML assignment, which would take the
  // whole overlay down on exactly the pages this is most useful.
  const styleEl = document.createElement('style')
  styleEl.textContent = `
      :host { all: initial; }
      .marker {
        position: absolute;
        border-radius: 8px;
        pointer-events: none;
        box-sizing: border-box;
        /* Fade in once, then breathe. The box itself never disappears — see sp-glow. */
        animation:
          sp-in 220ms ease-out both,
          sp-glow 2.2s cubic-bezier(.4,0,.6,1) 220ms infinite;
      }

      /*
       * A pulsing halo rather than a blinking box.
       *
       * Toggling the marker's own visibility would hide the thing the user is trying to look
       * at half the time, and rapid flashing is a genuine accessibility hazard (WCAG caps
       * flashes at 3/sec for photosensitivity). An expanding ring reads as "alive" and draws
       * the eye just as well, while the target stays continuously visible.
       */
      @keyframes sp-glow {
        0%   { box-shadow: 0 0 0 0   var(--glow),     0 2px 10px rgba(0,0,0,.15); }
        70%  { box-shadow: 0 0 0 12px var(--glow-out), 0 2px 10px rgba(0,0,0,.15); }
        100% { box-shadow: 0 0 0 0   var(--glow-out), 0 2px 10px rgba(0,0,0,.15); }
      }

      /* Chips stay perfectly still — moving text is hard to read. */
      .chip { animation: sp-in 220ms ease-out both; }

      @media (prefers-reduced-motion: reduce) {
        .marker { animation: sp-in 220ms ease-out both; box-shadow: 0 0 0 3px var(--glow); }
        #badge.working .dot { animation: none; }
        #badge .live { animation: none; }
      }
      .chip {
        position: absolute;
        display: inline-flex;
        align-items: baseline;
        gap: 6px;
        max-width: 280px;
        padding: 4px 8px;
        border-radius: 6px;
        color: #fff;
        font: 500 12px/1.35 -apple-system, 'Segoe UI', Roboto, sans-serif;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        box-shadow: 0 2px 8px rgba(0,0,0,.28);
        pointer-events: none;
      }
      .chip small { font-weight: 400; opacity: .85; }
      @keyframes sp-in {
        from { opacity: 0; transform: translateY(-3px); }
        to   { opacity: 1; transform: translateY(0); }
      }

      /* Badge is fixed to the viewport, unlike the markers, so it stays reachable. */
      #badge {
        position: fixed;
        /* Mid-edge, not top-right: that corner is where nearly every web app puts Share,
           account and overflow menus, so a badge there sits on top of real controls. */
        top: 50%;
        transform: translateY(-50%);
        right: 0;
        display: none;
        align-items: center;
        gap: 12px;
        height: 62px;
        padding: 0 22px 0 20px;
        border-radius: 10px 0 0 10px;
        /* The sage ground from the logo artwork. Being light, it needs dark text and a
           neutral shadow — a coloured glow reads as grubby against it. */
        background: #c8d4c1;
        color: #23301f;
        font: 600 21px/1 -apple-system, 'Segoe UI', Roboto, sans-serif;
        box-shadow: 0 3px 16px rgba(35,48,31,.28);
        /* The one interactive piece of the overlay — markers stay click-through. */
        pointer-events: auto;
        cursor: pointer;
        user-select: none;
        transition: transform 140ms ease, box-shadow 140ms ease, background 140ms ease;
        z-index: 2147483647;
      }
      #badge.on { display: inline-flex; animation: sp-slide 260ms ease-out both; }
      /* Every transform here must re-state the -50% or the badge jumps to the top on hover. */
      #badge:hover { transform: translate(-3px, -50%); box-shadow: 0 5px 22px rgba(35,48,31,.38); }
      #badge:active { transform: translate(-1px, -50%) scale(.98); }
      /* Idle collapses to a bare monogram — a permanent label on every page you visit is
         clutter, and the mark alone is enough once you know what it is. */
      /* Equal padding both sides when there's no label, so the mark sits dead centre. */
      #badge.idle { gap: 0; padding: 0 16px; }
      #badge.idle #badge-text { display: none; }
      /* No disc — the mark sits directly on the pill. */
      #badge .dot {
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      #badge .dot svg { display: block; }
      /* States shift the sage's depth rather than its hue, so the pill still reads as one
         object across all three. */
      #badge.working { background: #b7c8ae; }
      #badge.working .dot { animation: sp-pulse 1s ease-in-out infinite; }
      #badge.marked { background: #bfd6b6; }

      /*
       * Live indicator, in the spirit of a recording light: it says atElbow is active
       * on this page. A smooth 1.6s fade rather than a hard on/off — a genuinely flashing
       * element sitting on every page you browse is an accessibility problem (WCAG caps
       * flashing at 3/sec), and reads as cheap besides.
       */
      #badge .live {
        position: absolute;
        /* Straddling the pill's outer corner, the way a notification dot does — inset, it
           just looked like part of the artwork. */
        top: -5px;
        left: -5px;
        width: 13px;
        height: 13px;
        border-radius: 50%;
        background: #ef4444;
        box-shadow: 0 0 0 2px rgba(255,255,255,.85), 0 0 6px rgba(239,68,68,.9);
        animation: sp-live 1.6s ease-in-out infinite;
      }
      @keyframes sp-live {
        0%, 100% { opacity: 1; transform: scale(1); }
        50%      { opacity: .3; transform: scale(.82); }
      }
      @keyframes sp-slide {
        from { opacity: 0; transform: translate(10px, -50%); }
        to   { opacity: 1; transform: translate(0, -50%); }
      }
      @keyframes sp-pulse {
        0%,100% { opacity: .35; }
        50%     { opacity: 1; }
      }

      /*
       * Spotlight. The dimming is one huge spread shadow around the cut-out rather than a
       * full-screen scrim, so there is no element covering the page and the user can still
       * click the very control being pointed at.
       */
      .spotlight {
        position: absolute;
        border-radius: 10px;
        pointer-events: none;
        box-sizing: border-box;
        border: 3px solid var(--ring);
        box-shadow:
          0 0 0 9999px rgba(12, 14, 20, .55),
          0 0 0 6px var(--ring-soft);
        animation: sp-in 200ms ease-out both;
      }

      .callout {
        position: absolute;
        width: 268px;
        max-width: calc(100vw - 24px);
        background: #fff;
        color: #18181b;
        border-radius: 12px;
        padding: 14px 16px;
        box-shadow: 0 10px 34px rgba(0,0,0,.34);
        font: 400 13px/1.5 -apple-system, 'Segoe UI', Roboto, sans-serif;
        /* The only interactive part of the overlay. */
        pointer-events: auto;
        animation: sp-in 200ms ease-out both;
        transition: opacity 140ms ease;
      }
      /*
       * Hover to peek at what's underneath. The surface and text fade, but the buttons stay
       * solid. Fading the whole card via the opacity property would take Next and Back with
       * it, so the control you were reaching for would vanish as you approached it.
       */
      .callout:hover {
        background: rgba(255,255,255,.12);
        box-shadow: none;
        backdrop-filter: none;
      }
      .callout { cursor: grab; }
      .callout.dragging { cursor: grabbing; }
      /* While dragging, keep it readable — the peek fade would hide what you're positioning. */
      .callout.dragging .callout-head,
      .callout.dragging .callout-note,
      .callout.dragging .callout-progress { opacity: 1 !important; }
      .callout.dragging { background: #fff; }

      .callout:hover .callout-head,
      .callout:hover .callout-note,
      .callout:hover .callout-progress { opacity: .12; }
      .callout-head, .callout-note, .callout-progress { transition: opacity 140ms ease; }

      .callout-head { display: flex; align-items: center; gap: 9px; }
      .callout-num {
        width: 24px; height: 24px; flex: none;
        border-radius: 50%;
        color: #fff;
        font: 700 12px/1 -apple-system, 'Segoe UI', sans-serif;
        display: inline-flex; align-items: center; justify-content: center;
      }
      .callout-head strong { font-size: 14px; font-weight: 600; }
      .callout-note { margin: 8px 0 0; color: #52525b; font-size: 12.5px; }

      .callout-nav {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 12px;
      }
      .callout-progress {
        margin-right: auto;
        font-size: 11px;
        color: #8a8a94;
        font-variant-numeric: tabular-nums;
      }
      .callout-btn {
        font: 600 12px/1 -apple-system, 'Segoe UI', sans-serif;
        padding: 8px 13px;
        border-radius: 7px;
        border: 1px solid #d4d4d8;
        background: #fff;
        color: #3f3f46;
        cursor: pointer;
      }
      .callout-btn.primary {
        background: #5b4bdb;
        border-color: #5b4bdb;
        color: #fff;
      }
      .callout-btn:hover { filter: brightness(.97); }

      @media (prefers-reduced-motion: reduce) {
        .spotlight, .callout { animation: none; }
      }
  `

  const layer = document.createElement('div')
  layer.id = 'layer'

  const badge = document.createElement('div')
  badge.id = 'badge'
  badge.setAttribute('role', 'button')
  badge.setAttribute('tabindex', '0')
  badge.title = 'atElbow is active on this page — click to open'

  // The badge's own `position: fixed` is what the absolutely-positioned dot anchors to.
  const live = document.createElement('span')
  live.className = 'live'
  live.setAttribute('aria-hidden', 'true')

  const dot = document.createElement('span')
  dot.className = 'dot'
  dot.appendChild(buildMark(52))

  const badgeText = document.createElement('span')
  badgeText.id = 'badge-text'

  badge.append(live, dot, badgeText)

  // A content script can't open the side panel itself — chrome.sidePanel.open() only exists
  // in an extension context and must follow a user gesture. Forwarding the click to the
  // service worker preserves that gesture, so it can open the panel on our behalf.
  badge.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'open-panel' }).catch(() => {
      // Extension was reloaded out from under this page; the toolbar icon still works.
    })
  })

  shadow.append(styleEl, layer, badge)
  document.body.appendChild(host)
  return shadow
}

const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * The badge now uses the logo's own sage ground, which is light — so the mark wears its true
 * brand colours here, exactly as in the logo artwork. No more lightened tint.
 */
export const MARK_VIOLET = '#5A208C'
export const MARK_GOLD = '#D6A32A'

/**
 * Framed to the glyph's exact bounds (x 20-90, y 4-98) plus a single unit of margin, so the
 * mark bleeds to the edges of its tile the way the logo artwork does.
 */
export const VIEWBOX = '19 3 72 96'
export const MARK_ASPECT = 72 / 96

/**
 * Polished-gold ramp. Light, dark, light again — the alternation is what reads as metal;
 * a single hue reads as flat yellow no matter how bright it is.
 */
export const GOLD_STOPS: ReadonlyArray<readonly [string, string]> = [
  ['0%', '#FBEEB8'],
  ['18%', '#E2B845'],
  ['38%', '#A9781A'],
  ['55%', '#F6DC8E'],
  ['74%', '#C99226'],
  ['100%', '#8C6210']
]
export const GOLD_GRADIENT_ID = 'vc-gold'

/**
 * The VC mark, inline. Not a packaged icon file because a content script would need
 * web_accessible_resources to load one, and an SVG stays crisp at any size.
 */
function buildMark(height = 22): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  // Framed tightly to the artwork (x 20-90, y 4-98) rather than the nominal square. A square
  // viewBox around a tall, narrow glyph scales it down to fit the width and leaves dead space
  // above and below — which is what made the mark look small in the pill.
  svg.setAttribute('viewBox', VIEWBOX)
  svg.setAttribute('height', String(height))
  svg.setAttribute('width', String(Math.round(height * MARK_ASPECT)))
  svg.setAttribute('aria-hidden', 'true')

  const arc = (d: string): SVGPathElement => {
    const p = document.createElementNS(SVG_NS, 'path')
    p.setAttribute('d', d)
    p.setAttribute('fill', 'none')
    p.setAttribute('stroke', MARK_VIOLET)
    p.setAttribute('stroke-width', '12.5')
    return p
  }
  const poly = (points: string, fill: string): SVGPolygonElement => {
    const p = document.createElementNS(SVG_NS, 'polygon')
    p.setAttribute('points', points)
    p.setAttribute('fill', fill)
    return p
  }

  // Metallic gold: alternating light and dark bands across the stroke are what read as a
  // polished surface. A single mid-tone, however bright, just looks like flat yellow.
  const defs = document.createElementNS(SVG_NS, 'defs')
  const grad = document.createElementNS(SVG_NS, 'linearGradient')
  grad.setAttribute('id', GOLD_GRADIENT_ID)
  grad.setAttribute('x1', '0')
  grad.setAttribute('y1', '0')
  grad.setAttribute('x2', '0.85')
  grad.setAttribute('y2', '1')
  for (const [offset, color] of GOLD_STOPS) {
    const stop = document.createElementNS(SVG_NS, 'stop')
    stop.setAttribute('offset', offset)
    stop.setAttribute('stop-color', color)
    grad.appendChild(stop)
  }
  defs.appendChild(grad)

  svg.append(
    defs,
    arc('M76.5 72 A17.5 17.5 0 0 1 41.5 72'), // broad shallow C
    poly('62,36 77,33 79,46 65,49', MARK_VIOLET), // detached upper terminal
    poly('39,74 48,63 20,98', MARK_VIOLET), // diagonal continuing past the vertex
    poly('23,31 40,73 90,4 46,51 35,31', `url(#${GOLD_GRADIENT_ID})`) // gold check-V
  )
  return svg
}

export function clearAnnotations(): void {
  const layer = shadow?.getElementById('layer')
  // replaceChildren rather than innerHTML: Trusted Types rejects innerHTML assignment even
  // for an empty string on strict-CSP sites.
  layer?.replaceChildren()
  detachStepWatcher?.()
  detachStepWatcher = null
  detachReflow?.()
  detachReflow = null
  detachKeys?.()
  detachKeys = null
  currentSpot = null
  currentCallout = null
  calloutMoved = false
  steps = []
  stepIndex = 0
  walkthroughActive = false
  setBadge('idle')
}

/** The always-visible "I'm active on this page" pill, in the spirit of Rakuten's. */
let collapseTimer: ReturnType<typeof setTimeout> | null = null

export function setBadge(state: BadgeState, count?: number): void {
  const root = ensureHost()
  const badge = root.getElementById('badge')
  const text = root.getElementById('badge-text')
  if (!badge || !text) return

  if (collapseTimer) {
    clearTimeout(collapseTimer)
    collapseTimer = null
  }

  badge.className = `on ${state}`

  if (state === 'working') text.textContent = 'Reading…'
  else if (state === 'marked') text.textContent = `${count ?? 0} marked`
  else text.textContent = ''

  if (state === 'marked') {
    // Shrink back to the bare mark once the count has been read. The label is news, not
    // status — leaving it expanded means permanently covering a strip of the page.
    collapseTimer = setTimeout(() => {
      badge.className = 'on marked idle'
      text.textContent = ''
      collapseTimer = null
    }, 4000)
  }
}

/** Steps for the walkthrough currently on screen. */
type Step = { annotation: Annotation; element: PageElement; node: Element | null }
let steps: Step[] = []
let stepIndex = 0
/** Removes the listener watching for the current step being performed. */
let detachStepWatcher: (() => void) | null = null

/** Live handles for the step on screen, so it can be re-placed without a full redraw. */
let currentSpot: HTMLElement | null = null
let currentCallout: HTMLElement | null = null
/** Once the user drags the callout, stop moving it for them. */
let calloutMoved = false
let detachReflow: (() => void) | null = null

/**
 * Where the target actually is *now*.
 *
 * Stored geometry is captured once, when the page is read. By step three the user has opened
 * menus, loaded content and shifted the layout — so drawing from that snapshot spotlights
 * whatever has since moved into the old coordinates. Re-measuring the live node is what keeps
 * the ring on the control instead of near it.
 */
function liveRect(step: Step): { x: number; y: number; width: number; height: number } {
  const node = step.node
  if (node?.isConnected) {
    const r = node.getBoundingClientRect()
    // A zero box means the node is hidden right now (a collapsed menu, say); the snapshot is
    // the better guess in that case.
    if (r.width > 0 && r.height > 0) {
      return {
        x: r.x + window.scrollX,
        y: r.y + window.scrollY,
        width: r.width,
        height: r.height
      }
    }
  }
  return step.element
}

/** True while a walkthrough is on screen — the user is mid-task and actively waiting. */
let walkthroughActive = false
export function isWalkthroughActive(): boolean {
  return walkthroughActive
}

/** Long enough for the page's own handler to open its menu before the next step appears. */
const ADVANCE_DELAY_MS = 400

/**
 * Tells the worker whether the user actually did the step that was marked.
 *
 * This is the only correctness signal the product gets for free: clicking the highlighted
 * control is already how the walkthrough advances, so noticing it costs nothing and says
 * plainly whether the mark was right.
 */
function reportStep(clicked: boolean): void {
  chrome.runtime.sendMessage({ type: 'step-signal', clicked }).catch(() => {
    // Worker asleep or extension reloaded — a lost signal is not worth surfacing.
  })
}

/**
 * Advances the walkthrough when the user actually does the step, instead of making them
 * confirm it with Next as well. Doing the thing IS the confirmation — asking for both is
 * exactly the busywork a guided flow should remove.
 */
function watchForStepDone(el: Element | undefined, onDone: () => void): void {
  detachStepWatcher?.()
  detachStepWatcher = null
  if (!el || !el.isConnected) return

  let fired = false
  const advance = (): void => {
    if (fired) return
    fired = true
    reportStep(true)
    // Let the page react first — clicking a date field opens a calendar, and the next step
    // usually refers to what that click revealed.
    setTimeout(onDone, ADVANCE_DELAY_MS)
  }

  // Only completion keys count. Advancing on any keydown would jump to the next step on the
  // first letter someone typed into a field they had not finished filling.
  const onKey = (e: Event): void => {
    const key = (e as KeyboardEvent).key
    if (key === 'Enter' || key === 'Tab') advance()
  }

  // Capture phase, so a page that stops propagation in its own handlers can't hide the
  // interaction from us.
  el.addEventListener('click', advance, { capture: true })
  el.addEventListener('keydown', onKey, { capture: true })

  detachStepWatcher = () => {
    el.removeEventListener('click', advance, { capture: true })
    el.removeEventListener('keydown', onKey, { capture: true })
  }
}

/**
 * Renders guidance as a Tango-style walkthrough: the page dims, one target is spotlit at a
 * time, and a numbered callout explains it.
 *
 * Sequential rather than all-at-once because the audience is someone seeing this interface
 * for the first time. Three simultaneous marks make them choose where to look, which is the
 * exact problem they already have.
 */
export function renderAnnotations(
  annotations: Annotation[],
  elements: PageElement[]
): { drawn: number; traces: DrawTrace[] } {
  const byId = new Map(elements.map((el) => [el.id, el]))
  const traces: DrawTrace[] = []

  steps = annotations
    .map((annotation) => {
      const element = byId.get(annotation.elementId)
      if (!element) {
        // An id the model invented. Recorded rather than silently dropped — this is the
        // difference between "the overlay is broken" and "the model made the id up".
        traces.push({ id: annotation.elementId, resolved: false, control: '' })
        return null
      }
      // Resolve the live node NOW. Element ids are reassigned on every page collection, so
      // looking this up later could bind the watcher to an unrelated element.
      const node = nodeRegistry.get(element.id) ?? null
      const step = { annotation, element, node }
      traces.push({
        id: element.id,
        resolved: true,
        control: element.text,
        storedY: element.y,
        liveY: Math.round(liveRect(step).y)
      })
      return step
    })
    .filter((s): s is Step => Boolean(s))

  if (steps.length === 0) return { drawn: 0, traces }

  stepIndex = 0
  walkthroughActive = true
  drawStep()
  // The first target is often below the fold. Without this the user gets a dimmed page and no
  // visible spotlight, which reads as the product having done nothing at all.
  scrollStepIntoView()
  watchReflow()
  watchKeys()
  return { drawn: steps.length, traces }
}

/**
 * Re-places the marks when the page moves under them.
 *
 * Document-space coordinates already survive scrolling, so scroll isn't watched — only the
 * things that genuinely move a target: viewport resize, and layout shifts from content
 * loading or menus opening. The poll is cheap (one rect read) and catches the second kind,
 * which no single event reliably signals.
 */
function watchReflow(): void {
  detachReflow?.()

  let frame = 0
  const onResize = (): void => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(reposition)
  }

  let last = ''
  const poll = setInterval(() => {
    const step = steps[stepIndex]
    if (!step) return
    const r = liveRect(step)
    const key = `${r.x}|${r.y}|${r.width}|${r.height}`
    if (key !== last) {
      last = key
      reposition()
    }
  }, 500)

  window.addEventListener('resize', onResize, { passive: true })

  detachReflow = () => {
    cancelAnimationFrame(frame)
    clearInterval(poll)
    window.removeEventListener('resize', onResize)
  }
}

/** Removes the walkthrough's keyboard shortcuts. */
let detachKeys: (() => void) | null = null

/**
 * Keyboard control, because a walkthrough you can only drive with a mouse excludes exactly
 * the users most likely to need it. Escape leaves; the arrows step through.
 */
function watchKeys(): void {
  detachKeys?.()

  const onKey = (e: KeyboardEvent): void => {
    if (!walkthroughActive) return

    if (e.key === 'Escape') {
      clearAnnotations()
      return
    }

    // Arrows belong to whatever the user is typing in — stealing them would break the very
    // field the current step is telling them to fill.
    const t = e.target as HTMLElement | null
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return

    if (e.key === 'ArrowRight' && stepIndex < steps.length - 1) {
      e.preventDefault()
      go(stepIndex + 1)
    } else if (e.key === 'ArrowLeft' && stepIndex > 0) {
      e.preventDefault()
      go(stepIndex - 1)
    }
  }

  window.addEventListener('keydown', onKey, { capture: true })
  detachKeys = () => window.removeEventListener('keydown', onKey, { capture: true })
}

/** Brings the current target on screen, but only when it isn't already. */
function scrollStepIntoView(): void {
  const step = steps[stepIndex]
  if (!step) return
  const rect = liveRect(step)
  const top = rect.y - window.scrollY
  const bottom = top + rect.height
  // A target comfortably in view is left where it is — scrolling under someone who can
  // already see the thing is disorienting.
  if (top >= 60 && bottom <= window.innerHeight - 60) return
  window.scrollTo({ top: Math.max(0, rect.y - window.innerHeight / 2), behavior: 'smooth' })
}

function drawStep(): void {
  const root = ensureHost()
  const layer = root.getElementById('layer')!
  layer.replaceChildren()

  const step = steps[stepIndex]
  if (!step) return

  const { annotation, node } = step
  const style = VERDICT_STYLE[annotation.verdict] ?? VERDICT_STYLE.info
  const pad = 6
  const rect = liveRect(step)

  // The dimming is a single enormous spread shadow around the cut-out, so there is no
  // separate scrim element that could swallow clicks on the thing being pointed at.
  const spot = document.createElement('div')
  spot.className = 'spotlight'
  spot.style.left = `${rect.x - pad}px`
  spot.style.top = `${rect.y - pad}px`
  spot.style.width = `${rect.width + pad * 2}px`
  spot.style.height = `${rect.height + pad * 2}px`
  spot.style.setProperty('--ring', style.ring)
  // Precomputed rather than color-mix(), which would fail silently on older Chrome.
  spot.style.setProperty('--ring-soft', `${style.ring}66`)
  layer.appendChild(spot)

  const callout = document.createElement('div')
  callout.className = 'callout'
  // A walkthrough that a screen reader can't see is one an enterprise can't buy. The dialog
  // role plus a live region means each step is announced as it appears.
  callout.setAttribute('role', 'dialog')
  callout.setAttribute('aria-live', 'polite')
  callout.setAttribute(
    'aria-label',
    `Step ${stepIndex + 1} of ${steps.length}: ${annotation.label}`
  )

  const head = document.createElement('div')
  head.className = 'callout-head'
  const num = document.createElement('span')
  num.className = 'callout-num'
  num.style.background = style.color
  num.textContent = String(stepIndex + 1)
  const label = document.createElement('strong')
  label.textContent = annotation.label
  head.append(num, label)
  callout.appendChild(head)

  if (annotation.note) {
    const note = document.createElement('p')
    note.className = 'callout-note'
    note.textContent = annotation.note
    callout.appendChild(note)
  }

  const nav = document.createElement('div')
  nav.className = 'callout-nav'
  const progress = document.createElement('span')
  progress.className = 'callout-progress'
  progress.textContent = `${stepIndex + 1} of ${steps.length}`
  nav.appendChild(progress)

  if (stepIndex > 0) {
    nav.appendChild(navButton('Back', () => go(stepIndex - 1)))
  }
  nav.appendChild(
    navButton(
      stepIndex === steps.length - 1 ? 'Done' : 'Next',
      () => {
        // Reaching for Next instead of the thing being pointed at is the clearest evidence
        // the mark was on the wrong control.
        reportStep(false)
        if (stepIndex === steps.length - 1) clearAnnotations()
        else go(stepIndex + 1)
      },
      true
    )
  )
  callout.appendChild(nav)

  // Inserted invisibly first so its real height can be measured. The previous constant was a
  // guess, and a two-line note makes the card noticeably taller than 150px — which is how a
  // callout ends up hanging off the bottom of the page.
  callout.style.visibility = 'hidden'
  layer.appendChild(callout)
  makeDraggable(callout)

  currentSpot = spot
  currentCallout = callout
  calloutMoved = false
  placeCallout()
  callout.style.visibility = ''

  // Watch the real control: doing the step moves the walkthrough on by itself.
  watchForStepDone(node ?? undefined, () => {
    if (stepIndex === steps.length - 1) clearAnnotations()
    else go(stepIndex + 1)
  })
}

const CALLOUT_W = 268
const GAP = 14

/**
 * Places the callout beside the target, then below, then above.
 *
 * "Below" is the obvious choice and the wrong default — it is precisely where menus and
 * dropdowns open, so a callout there buries the options the step is telling you to pick from.
 * Beside keeps both visible.
 */
function placeCallout(): void {
  const step = steps[stepIndex]
  if (!step || !currentCallout || calloutMoved) return

  const rect = liveRect(step)
  const height = currentCallout.offsetHeight || 150
  const docW = document.documentElement.scrollWidth
  const pad = 6

  const roomRight = docW - (rect.x + rect.width + GAP) >= CALLOUT_W + 8
  const roomLeft = rect.x - GAP - CALLOUT_W >= 8

  let left: number
  let top: number

  if (roomRight) {
    left = rect.x + rect.width + GAP
    top = Math.max(8, rect.y - 8)
  } else if (roomLeft) {
    left = rect.x - GAP - CALLOUT_W
    top = Math.max(8, rect.y - 8)
  } else {
    left = Math.max(8, Math.min(rect.x - pad, docW - CALLOUT_W - 8))
    const below = rect.y + rect.height + GAP
    const roomBelow = document.documentElement.scrollHeight - below >= height
    top = roomBelow || rect.y < height + 20 ? below : rect.y - height - GAP
  }

  currentCallout.style.left = `${left}px`
  currentCallout.style.top = `${top}px`
}

/**
 * Keeps the ring on the target as the page moves under it.
 *
 * Pages are not static while a walkthrough runs: menus open, images finish loading, banners
 * collapse. Without this the spotlight silently drifts off the control it is naming — which
 * looks like the product simply got the answer wrong.
 */
function reposition(): void {
  const step = steps[stepIndex]
  if (!step || !currentSpot) return
  const rect = liveRect(step)
  const pad = 6
  currentSpot.style.left = `${rect.x - pad}px`
  currentSpot.style.top = `${rect.y - pad}px`
  currentSpot.style.width = `${rect.width + pad * 2}px`
  currentSpot.style.height = `${rect.height + pad * 2}px`
  placeCallout()
}

/**
 * Lets the user drag the callout out of the way.
 *
 * Placement can dodge the target, but not a menu the target opens — a date picker several
 * hundred pixels wide covers every candidate position. Rather than pretend a heuristic can
 * always win, give them one gesture that always does.
 */
function makeDraggable(el: HTMLElement): void {
  el.addEventListener('pointerdown', (e) => {
    // Never start a drag from the controls; Next and Back must stay clickable.
    if ((e.target as HTMLElement).closest('.callout-btn')) return
    e.preventDefault()

    const startX = e.clientX
    const startY = e.clientY
    const originLeft = parseFloat(el.style.left) || 0
    const originTop = parseFloat(el.style.top) || 0
    el.setPointerCapture(e.pointerId)
    el.classList.add('dragging')
    // Once it's been put somewhere deliberately, automatic placement stops fighting the user.
    calloutMoved = true

    const move = (ev: PointerEvent): void => {
      el.style.left = `${originLeft + (ev.clientX - startX)}px`
      el.style.top = `${originTop + (ev.clientY - startY)}px`
    }
    const up = (): void => {
      el.classList.remove('dragging')
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  })
}

function navButton(text: string, onClick: () => void, primary = false): HTMLButtonElement {
  const b = document.createElement('button')
  b.className = primary ? 'callout-btn primary' : 'callout-btn'
  b.textContent = text
  b.addEventListener('click', (e) => {
    e.stopPropagation()
    onClick()
  })
  return b
}

function go(index: number): void {
  stepIndex = Math.max(0, Math.min(steps.length - 1, index))
  drawStep()
  scrollStepIntoView()
}
