/**
 * A local flight recorder for one turn at a time.
 *
 * "It didn't annotate" has cost this project several rounds of guessing, because the three
 * causes look identical from the outside: the control was never extracted, the model cited an
 * id that doesn't exist, or the geometry was stale and the mark landed off screen. This
 * records which one it was.
 *
 * Off by default, kept in local storage, never sent anywhere. Copying it is a deliberate act.
 */

export interface StepTrace {
  /** The id the model asked for. */
  id: number
  /** False when that id wasn't in the element list — an invented id marks nothing. */
  resolved: boolean
  /** The control's own text, so a wrong pick is obvious at a glance. */
  control: string
  /** Document-space Y when the page was read, and again at draw time. */
  storedY?: number
  liveY?: number
  /** How far the target moved between being read and being marked. */
  driftY?: number
}

export interface TurnRecord {
  at: string
  host: string
  provider: string
  prompt: string
  kind: 'ask' | 'auto' | 'continuation'
  page: {
    kept: number
    interactive: number
    candidates: number
    /** Raw DOM matches before visibility/text filtering — the extraction loss ratio. */
    scanned: number
    sensitive: boolean
  }
  /** Characters of prose produced. A long answer with no tool call is a budget problem. */
  textChars: number
  requested: { id: number; label: string }[]
  drawn: number
  steps: StepTrace[]
  ms: { read?: number; model?: number; draw?: number }
  error?: string
}

const KEY = 'diagnostics'
const ENABLED_KEY = 'diagnosticsOn'
/** Enough to cover a full eval run; small enough to stay well inside the storage quota. */
const MAX_TURNS = 25

export async function isOn(): Promise<boolean> {
  const { [ENABLED_KEY]: on } = await chrome.storage.local.get(ENABLED_KEY)
  return on === true
}

export async function setOn(on: boolean): Promise<void> {
  await chrome.storage.local.set({ [ENABLED_KEY]: on })
  // Starting a fresh recording beats appending to a session the user has stopped thinking
  // about — a log spanning two debugging sessions is worse than no log.
  if (on) await chrome.storage.local.set({ [KEY]: [] })
}

export async function record(turn: TurnRecord): Promise<void> {
  if (!(await isOn())) return
  const { [KEY]: existing } = await chrome.storage.local.get(KEY)
  const list = Array.isArray(existing) ? (existing as TurnRecord[]) : []
  list.push(turn)
  await chrome.storage.local.set({ [KEY]: list.slice(-MAX_TURNS) })
}

export async function readAll(): Promise<TurnRecord[]> {
  const { [KEY]: existing } = await chrome.storage.local.get(KEY)
  return Array.isArray(existing) ? (existing as TurnRecord[]) : []
}

export async function clear(): Promise<void> {
  await chrome.storage.local.set({ [KEY]: [] })
}

/**
 * Formats the log for pasting into a conversation.
 *
 * Plain text rather than JSON: it has to survive being read by a person, and the diagnosis is
 * usually visible in one line — an unresolved id, or a drift of several hundred pixels.
 */
export function format(turns: TurnRecord[]): string {
  if (turns.length === 0) {
    return 'No turns recorded. Turn on "Record diagnostics", ask something, then copy again.'
  }

  const out: string[] = [`atElbow diagnostics — ${turns.length} turn(s)`, '']

  turns.forEach((t, i) => {
    out.push(`#${i + 1} [${t.kind}] ${t.host} · ${t.provider} · ${t.at.slice(11, 19)}`)
    out.push(`  asked: "${t.prompt.slice(0, 90)}"`)
    out.push(
      `  page: ${t.page.kept} kept · ${t.page.candidates} passed filters · ` +
        `${t.page.scanned} scanned in DOM (${t.page.interactive} interactive)` +
        `${t.page.sensitive ? ' [sensitive]' : ''}`
    )
    out.push(`  wrote: ${t.textChars} chars`)

    if (t.error) out.push(`  ERROR: ${t.error}`)

    if (t.requested.length === 0) {
      out.push(
        '  annotate_page: NOT CALLED' +
          (t.ms.model !== undefined ? ` (model ran ${t.ms.model}ms)` : '')
      )
    } else {
      out.push(`  annotate_page: asked for ${t.requested.length}, drew ${t.drawn}`)
      t.steps.forEach((s, n) => {
        if (!s.resolved) {
          out.push(`    ${n + 1}. #${s.id} UNRESOLVED — that id was not in the element list`)
          return
        }
        const drift =
          s.driftY === undefined
            ? ''
            : Math.abs(s.driftY) > 24
              ? `  DRIFT ${s.driftY > 0 ? '+' : ''}${s.driftY}px`
              : ''
        out.push(`    ${n + 1}. #${s.id} "${s.control.slice(0, 46)}"${drift}`)
      })
    }

    const ms = [
      t.ms.read !== undefined ? `read ${t.ms.read}ms` : null,
      t.ms.model !== undefined ? `model ${t.ms.model}ms` : null,
      t.ms.draw !== undefined ? `draw ${t.ms.draw}ms` : null
    ].filter(Boolean)
    if (ms.length) out.push(`  timing: ${ms.join(' · ')}`)
    out.push('')
  })

  return out.join('\n')
}
