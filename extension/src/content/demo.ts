import { collectPageContext } from './extract'
import { renderAnnotations, setBadge } from './overlay'
import type { Annotation, PageElement } from '../shared/types'

/**
 * A no-key demonstration, drawn on whatever page the user happens to be on.
 *
 * It marks REAL elements rather than a mock, because the thing worth proving is precisely
 * that the marks land on the right controls and stay there when you scroll. A canned
 * screenshot would prove nothing.
 *
 * The labels say "example" plainly. Inventing a verdict about a page nobody has analysed
 * would be a lie, and the point of the demo is the mechanic, not the judgement.
 */
export function runDemo(): { ok: boolean; count: number; reason?: string } {
  const context = collectPageContext()
  const targets = pickTargets(context.elements)

  if (targets.length === 0) {
    return { ok: false, count: 0, reason: 'There is not much on this page to point at. Try a page with buttons or links.' }
  }

  const annotations: Annotation[] = targets.map((el, i) => {
    const [verdict, label] = DEMO_MARKS[i] ?? DEMO_MARKS[0]
    return { elementId: el.id, verdict, label, note: 'example' }
  })

  renderAnnotations(annotations, context.elements)
  setBadge('marked', annotations.length)
  return { ok: true, count: annotations.length }
}

/** Shows the colour language across three of the five verdicts. */
const DEMO_MARKS: [Annotation['verdict'], string][] = [
  ['best', 'Top pick'],
  ['value', 'Cheaper option'],
  ['caution', 'Watch out']
]

/**
 * Picks visually distinct targets, spread down the page so the marks don't overlap and the
 * user can see more than one at a time.
 */
function pickTargets(elements: PageElement[]): PageElement[] {
  const usable = elements.filter(
    (el) => el.width >= 60 && el.width <= 640 && el.height >= 20 && el.height <= 160 && el.text.length > 1
  )
  if (usable.length === 0) return []

  const chosen: PageElement[] = []
  for (const el of usable) {
    // Keep marks at least 70px apart vertically, so three chips never stack on each other.
    if (chosen.some((c) => Math.abs(c.y - el.y) < 70)) continue
    chosen.push(el)
    if (chosen.length === 3) break
  }
  return chosen
}
