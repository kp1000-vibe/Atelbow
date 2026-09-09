import { nodeRegistry } from './extract'
import type { FillOutcome, FillProposal } from '../shared/types'

/**
 * React (and Vue, and most modern frameworks) track input values through a property setter
 * they install on the element instance. Assigning `el.value = x` writes straight past that
 * tracker, so the framework never notices and the UI silently reverts on the next render.
 *
 * Calling the *native prototype* setter and then dispatching a bubbling `input` event is what
 * makes the change look like real typing to the framework. This is the difference between a
 * fill that sticks and one that vanishes when the user clicks away.
 */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  if (setter) setter.call(el, value)
  else el.value = value
}

function fillOne(el: Element, value: string): void {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.focus()
    setNativeValue(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return
  }

  if (el.getAttribute('contenteditable') === 'true') {
    ;(el as HTMLElement).focus()
    el.textContent = value
    el.dispatchEvent(new InputEvent('input', { bubbles: true }))
    return
  }

  throw new Error('not a text field')
}

function currentValue(el: Element): string {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value
  return el.textContent ?? ''
}

/**
 * Applies fills the user has explicitly approved.
 *
 * Deliberately does not submit anything: no Enter key, no clicking search or submit. Typing
 * into a booking form is recoverable; submitting one is not, so the final action stays with
 * the person.
 */
/** Long enough for a framework re-render to revert a value it didn't accept. */
const SETTLE_MS = 350

export async function applyFills(fills: FillProposal[]): Promise<FillOutcome[]> {
  const attempted: { fill: FillProposal; el: Element | null; error: string | null }[] = []

  for (const fill of fills) {
    const el = nodeRegistry.get(fill.elementId) ?? null
    if (!el || !el.isConnected) {
      attempted.push({ fill, el: null, error: 'That field is no longer on the page.' })
      continue
    }
    try {
      fillOne(el, fill.value)
      attempted.push({ fill, el, error: null })
    } catch (err) {
      attempted.push({ fill, el, error: (err as Error).message })
    }
  }

  // Let the page react before judging the result. Components with their own state — date
  // pickers, autocompletes — accept the keystrokes and then silently reset the field on
  // their next render, so reporting success at write time tells the user something untrue.
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))

  return attempted.map(({ fill, el, error }) => {
    if (error || !el) return { fieldName: fill.fieldName, ok: false, error }

    const now = currentValue(el).trim()
    if (now === '') {
      return {
        fieldName: fill.fieldName,
        ok: false,
        error: 'the field cleared itself — it likely needs its own picker rather than typed text'
      }
    }
    if (!now.toLowerCase().includes(fill.value.trim().toLowerCase().slice(0, 12))) {
      // Autocompletes often rewrite what you typed ("JFK" -> "New York JFK"), which is a
      // success; a wholly unrelated value is not.
      return { fieldName: fill.fieldName, ok: true, error: `now reads "${now}"` }
    }
    return { fieldName: fill.fieldName, ok: true, error: null }
  })
}
