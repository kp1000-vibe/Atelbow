import { useState } from 'react'
import type { FillProposal } from '../../shared/types'

interface Props {
  proposals: FillProposal[]
  onApprove: (approved: FillProposal[]) => void
  onCancel: () => void
  busy: boolean
}

/**
 * The consent gate for assisted fill. Every proposed value is shown verbatim and editable
 * before anything is typed, and the card is explicit that ScreenPilot will not submit the
 * form — the user always performs the final action themselves.
 */
export default function FillApprovalCard({ proposals, onApprove, onCancel, busy }: Props): JSX.Element {
  const [values, setValues] = useState<Record<number, string>>(
    Object.fromEntries(proposals.map((p) => [p.elementId, p.value]))
  )
  const [skipped, setSkipped] = useState<Set<number>>(new Set())

  function toggleSkip(id: number): void {
    setSkipped((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const included = proposals.filter((p) => !skipped.has(p.elementId))

  return (
    <div className="fill-card">
      <div className="fill-card-head">
        <span className="fill-badge">Suggested</span>
        <strong>Fill these fields for you?</strong>
      </div>

      <div className="fill-rows">
        {proposals.map((p) => {
          const isSkipped = skipped.has(p.elementId)
          return (
            <div key={p.elementId} className={`fill-row${isSkipped ? ' skipped' : ''}`}>
              <label className="fill-field">{p.fieldName}</label>
              <div className="fill-input-row">
                <input
                  type="text"
                  value={values[p.elementId] ?? ''}
                  disabled={isSkipped || busy}
                  onChange={(e) => setValues((v) => ({ ...v, [p.elementId]: e.target.value }))}
                />
                <button
                  className="fill-skip"
                  onClick={() => toggleSkip(p.elementId)}
                  disabled={busy}
                  title={isSkipped ? 'Include this field' : 'Skip this field'}
                >
                  {isSkipped ? 'Undo' : 'Skip'}
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <p className="fill-note">
        You can edit any value first. ScreenPilot types only — it won't submit the form or press
        any button.
      </p>

      <div className="fill-actions">
        <button className="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          className="primary"
          disabled={busy || included.length === 0}
          onClick={() =>
            onApprove(included.map((p) => ({ ...p, value: values[p.elementId] ?? p.value })))
          }
        >
          {busy ? 'Typing…' : `Fill ${included.length} field${included.length === 1 ? '' : 's'}`}
        </button>
      </div>
    </div>
  )
}
