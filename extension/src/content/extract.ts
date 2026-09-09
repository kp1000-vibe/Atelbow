import type { PageContext, PageElement } from '../shared/types'

const MAX_ELEMENTS = 90
const MAX_TEXT = 140

/** Roles a walkthrough actually points at. These keep their slots when the cap bites. */
const INTERACTIVE_ROLES =
  /^(button|link|tab|combobox|listbox|menuitem|menuitemradio|switch|checkbox|radio|option|slider|spinbutton|input:|select|textarea)/i

/**
 * Containers this tall are page scaffolding, not choosable options. Without this the model
 * gets handed <main> and <body> as "options" and happily ranks them.
 */
const MAX_HEIGHT_FRACTION = 0.9

/** Chrome/Edge render these but they carry no user-facing meaning. */
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'PATH', 'META', 'LINK', 'HEAD'])

/**
 * Elements worth offering the model. Interactive things are obvious candidates; article/li/
 * card-ish containers matter because a "flight option" or "hotel result" is usually a div,
 * not a button.
 */
const CANDIDATE_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  '[role="button"]',
  '[role="link"]',
  '[role="option"]',
  '[role="radio"]',
  '[role="checkbox"]',
  '[role="tab"]',
  '[role="listitem"]',
  '[role="article"]',
  // Custom dropdowns and toggles. Without these, controls like Google Flights' round-trip /
  // one-way selector — a bare <div role="combobox"> — are invisible to the model, and it
  // correctly but unhelpfully reports that it can't find them.
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="menuitem"]',
  '[role="menuitemradio"]',
  '[role="switch"]',
  '[role="spinbutton"]',
  '[role="slider"]',
  '[aria-haspopup]',
  'li',
  'article',
  'tr',
  '[data-testid]'
].join(',')

/**
 * Strips a label that says the same thing twice.
 *
 * Components routinely render a visible label plus a screen-reader copy of it, and reading the
 * subtree returns both — "Report Builder Report Builder". The model then has to match a name
 * against something no user can see written that way.
 */
function dedupe(text: string): string {
  const mid = Math.floor(text.length / 2)
  const a = text.slice(0, mid).trim()
  const b = text.slice(mid).trim()
  if (a.length > 3 && a === b) return a
  return text
}

function collapse(text: string): string {
  // Masking here catches card and account numbers wherever they appear — rendered page text
  // as well as field values.
  const clean = redact(dedupe(text.replace(/\s+/g, ' ').trim()))
  return clean.length > MAX_TEXT ? `${clean.slice(0, MAX_TEXT - 1)}…` : clean
}

function isVisible(el: Element, rect: DOMRect): boolean {
  if (rect.width < 8 || rect.height < 8) return false
  const style = getComputedStyle(el)
  if (style.visibility === 'hidden' || style.display === 'none') return false
  if (Number(style.opacity) === 0) return false
  return true
}

/** Accessible name first — it's what the user effectively "sees" as the control's identity. */
function roleOf(el: Element): string {
  const explicit = el.getAttribute('role')
  if (explicit) return explicit
  const tag = el.tagName.toLowerCase()
  if (tag === 'a') return 'link'
  if (tag === 'input') return `input:${(el as HTMLInputElement).type || 'text'}`
  return tag
}

/** Field types and names whose contents must never leave the page. */
const SECRET_TYPES = new Set(['password', 'hidden', 'file'])
const SECRET_HINT = /pass|passwd|pwd|card|cc-|cvv|cvc|csc|ssn|sin|secret|token|otp|one-time|pin|account-?number|routing|iban|sort-?code/i

/**
 * True for fields whose *value* is sensitive. Note this is about the contents, not the label:
 * knowing a "Password" box exists is useful context; knowing what's typed in it never is.
 */
function isSecretField(el: Element): boolean {
  if (!(el instanceof HTMLInputElement)) return false
  if (SECRET_TYPES.has(el.type)) return true
  return SECRET_HINT.test(`${el.autocomplete} ${el.name} ${el.id}`)
}

/**
 * Strips structured personal identifiers from any text before it leaves the page.
 *
 * Deliberately limited to patterns that are unambiguous. Names, street addresses and free-text
 * medical notes cannot be matched reliably — "John Smith" is indistinguishable from a product
 * name — so redaction alone can never make a health or banking page safe to read. That is what
 * `pageLooksSensitive` below is for; the two work together.
 */
function redact(value: string): string {
  return (
    value
      // Card, account and other long digit runs
      .replace(/\b(?:\d[ -]?){12,19}\b/g, '[number hidden]')
      // Email addresses
      .replace(/\b[\w.%+-]+@[\w-]+\.[A-Za-z]{2,}\b/g, '[email hidden]')
      // US SSN / similar national IDs
      .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[id hidden]')
      // IBAN
      .replace(/\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g, '[account hidden]')
      // Phone numbers — separators required, so plain 10-digit IDs and prices survive.
      // The word-boundary sits inside the bare-digits branch: a leading \b would never match
      // before "(", so parenthesised area codes slipped through.
      .replace(/(?:\+\d{1,3}[ -]?)?(?:\(\d{3}\)|\b\d{3})[ .-]\d{3}[ .-]\d{4}\b/g, '[phone hidden]')
  )
}

/**
 * Pages where reading the content at all is the risk, not any particular field. Auto-reading
 * never runs here — the user has to ask deliberately.
 */
const SENSITIVE_HOST =
  /bank|credit|chase|wellsfargo|citibank|hsbc|barclays|paypal|venmo|coinbase|health|medical|patient|clinic|hospital|mychart|nhs\b|pharmac|insur|\.gov\b|irs\b|hmrc|tax|payroll|benefits/i

/**
 * Note what is deliberately absent: a bare "account".
 *
 * Enterprise CRMs put it in ordinary admin paths — Salesforce Object Manager sits under
 * /ObjectManager/Account/ — so matching it flagged every page of the product this is built
 * for, silently disabling auto-read across the target app. The genuinely financial cases are
 * already covered by billing/payment/checkout and by SENSITIVE_HOST, and real credential
 * screens are caught by the password-field check below, whatever the URL says.
 */
const SENSITIVE_PATH = /login|signin|sign-in|billing|payment|checkout|medical|health|\brecords?\b/i

export function pageLooksSensitive(): boolean {
  const host = location.hostname
  if (SENSITIVE_HOST.test(host)) return true
  if (SENSITIVE_PATH.test(location.pathname)) return true
  // A password box means a credential screen, whatever the domain is called.
  return document.querySelector('input[type="password"]') !== null
}

function textOf(el: Element): string {
  const aria = el.getAttribute('aria-label')
  if (aria) return collapse(aria)

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    // For a field, what matters is its label and current value, not its subtree.
    const label = el.labels?.[0]?.textContent ?? el.placeholder ?? el.name ?? ''

    // A password is rendered as dots on screen but readable in plain text through .value —
    // so sending it would leak something the user cannot even see themselves.
    if (isSecretField(el)) return collapse(label)

    const value = el.value ? ` = "${redact(el.value)}"` : ''
    return collapse(`${label}${value}`)
  }

  // innerText, not textContent: textContent concatenates child nodes with no separator, so a
  // button reading "New" inside a "Custom Field" row came through as "NewCustom Field" — a
  // label the model then can't match to anything the user sees. innerText respects layout.
  // Layout has already been forced by getBoundingClientRect in the same loop, so this reads
  // from a clean box tree rather than triggering a second reflow.
  const text = el instanceof HTMLElement ? el.innerText : el.textContent
  return collapse(text ?? '')
}

/**
 * Reads the page's choosable elements with exact geometry.
 *
 * Coordinates are returned in DOCUMENT space (rect + scroll offset), not viewport space, so
 * an overlay drawn from them stays glued to its target when the user scrolls — which is the
 * whole reason this belongs in the page rather than in a screenshot.
 */
/** Password and card fields are never fill targets, whatever the model proposes. */
const SENSITIVE_INPUT_TYPES = new Set(['password', 'hidden', 'file', 'credit-card'])

function isFillable(el: Element): boolean {
  if (el instanceof HTMLTextAreaElement) return !el.disabled && !el.readOnly
  if (el instanceof HTMLInputElement) {
    if (SENSITIVE_INPUT_TYPES.has(el.type)) return false
    if (el.autocomplete && /cc-|card|password/i.test(el.autocomplete)) return false
    return !el.disabled && !el.readOnly
  }
  return el.getAttribute('contenteditable') === 'true'
}

/**
 * Live DOM nodes from the last collection, keyed by the id handed to the model. Kept so an
 * approved fill writes to the exact element the user reviewed, instead of re-querying and
 * risking a different match.
 */
export const nodeRegistry = new Map<number, Element>()

export function collectPageContext(): PageContext {
  nodeRegistry.clear()
  // A hidden or not-yet-laid-out tab reports a zero viewport. Culling by it then rejects
  // every element and the page looks empty rather than unreadable, so skip the cull instead.
  const hasViewport = window.innerHeight > 0 && window.innerWidth > 0
  const maxHeight = hasViewport ? window.innerHeight * MAX_HEIGHT_FRACTION : Infinity
  const scrollX = window.scrollX
  const scrollY = window.scrollY

  const seen = new Set<string>()
  const elements: PageElement[] = []
  // `order` is carried rather than recovered with indexOf later: the cap splits this list in
  // two and re-merges it, and indexOf inside the comparator makes that an O(n²) scan.
  const candidates: { node: Element; interactive: boolean; order: number; element: PageElement }[] =
    []

  const scanned = Array.from(document.querySelectorAll(CANDIDATE_SELECTOR))
  for (const el of scanned) {
    if (SKIP_TAGS.has(el.tagName)) continue

    const rect = el.getBoundingClientRect()
    if (!isVisible(el, rect)) continue
    if (rect.height > maxHeight) continue

    // Only what's currently on screen: the model is answering about what the user can see,
    // and off-screen content would produce markers pointing into empty space.
    if (hasViewport) {
      if (rect.bottom < 0 || rect.top > window.innerHeight) continue
      if (rect.right < 0 || rect.left > window.innerWidth) continue
    }

    const text = textOf(el)
    if (!text) continue

    // Nested wrappers repeat their child's text at nearly the same spot; keep one.
    const key = `${text}|${Math.round(rect.x / 10)}|${Math.round(rect.y / 10)}`
    if (seen.has(key)) continue
    seen.add(key)

    const role = roleOf(el)
    candidates.push({
      node: el,
      interactive: INTERACTIVE_ROLES.test(role),
      order: candidates.length,
      element: {
        id: 0, // assigned after the cap, so ids stay in reading order
        text,
        role,
        x: Math.round(rect.x + scrollX),
        y: Math.round(rect.y + scrollY),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        fillable: isFillable(el) || undefined
      }
    })
  }

  // Interactive elements keep their places; list rows and text blocks fill what's left.
  // Both groups stay in document order, so the final list still reads top-to-bottom.
  const interactive = candidates.filter((c) => c.interactive)
  const rest = candidates.filter((c) => !c.interactive)
  const kept = [...interactive.slice(0, MAX_ELEMENTS), ...rest].slice(0, MAX_ELEMENTS)
  kept.sort((a, b) => a.order - b.order)

  for (const c of kept) {
    const id = elements.length + 1
    c.element.id = id
    nodeRegistry.set(id, c.node)
    elements.push(c.element)
  }

  return {
    url: location.href,
    title: document.title,
    elements,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    sensitive: pageLooksSensitive(),
    // Diagnostics only. `candidates` far exceeding `kept` is the signature of the cap
    // discarding controls; `kept` being tiny means the page barely extracted at all.
    stats: {
      candidates: candidates.length,
      kept: elements.length,
      interactive: interactive.length,
      scanned: scanned.length
    }
  }
}
