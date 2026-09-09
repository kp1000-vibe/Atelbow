import { useState } from 'react'
import type { FillProposal } from '../shared/types'

interface Props {
  proposals: FillProposal[]
  busy: boolean
  onApprove: (approved: FillProposal[]) => void
  onCancel: () => void
}

/**
 * The consent gate for assisted fill. Every value is shown verbatim and stays editable, and
 * the card is explicit that nothing gets submitted — the user presses the real button.
 */
export default function FillCard({ proposals, busy, onApprove, onCancel }: Props): JSX.Element {
  const [values, setValues] = useState<Record<number, string>>(
    Object.fromEntries(proposals.map((p) => [p.elementId, p.value]))
  )
  const [skipped, setSkipped] = useState<Set<number>>(new Set())

  const included = proposals.filter((p) => !skipped.has(p.elementId))

  return (
    <div className="fill-card">
      <div className="fill-head">
        <span className="fill-badge">Suggested</span>
        <strong>Fill these in for you?</strong>
      </div>

      {proposals.map((p) => {
        const off = skipped.has(p.elementId)
        return (
          <div key={p.elementId} className={`fill-row${off ? ' off' : ''}`}>
            <label>{p.fieldName}</label>
            <div className="fill-input">
              <input
                type="text"
                value={values[p.elementId] ?? ''}
                disabled={off || busy}
                onChange={(e) => setValues((v) => ({ ...v, [p.elementId]: e.target.value }))}
              />
              <button
                className="fill-skip"
                disabled={busy}
                onClick={() =>
                  setSkipped((prev) => {
                    const next = new Set(prev)
                    if (next.has(p.elementId)) next.delete(p.elementId)
                    else next.add(p.elementId)
                    return next
                  })
                }
              >
                {off ? 'Undo' : 'Skip'}
              </button>
            </div>
          </div>
        )
      })}

      <p className="fill-note">
        Edit anything before accepting. atElbow types only — it won't submit the form or
        press any button.
      </p>

      <div className="fill-actions">
        <button className="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        {included.length === 0 ? (
          // Nothing left to fill — offer the way out rather than a dead button.
          <button className="primary" onClick={onCancel} disabled={busy}>
            Close
          </button>
        ) : (
          <button
            className="primary"
            disabled={busy}
            onClick={() => onApprove(included.map((p) => ({ ...p, value: values[p.elementId] ?? p.value })))}
          >
            {busy ? 'Filling…' : `Fill ${included.length} field${included.length === 1 ? '' : 's'}`}
          </button>
        )}
      </div>
    </div>
  )
}
