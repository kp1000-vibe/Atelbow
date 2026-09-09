import { useEffect, useState } from 'react'
import { supabase, money, callFunction } from './supabase'

interface Row {
  user_id: string
  email: string
  role: 'admin' | 'member'
  disabled: boolean
  daily_limit_usd: number | null
  monthly_limit_usd: number | null
  spend_today_usd: number
  spend_month_usd: number
  requests_month: number
  last_seen: string | null
}

export default function Members({ orgId }: { orgId: string }): JSX.Element {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)

  async function load(): Promise<void> {
    const { data, error } = await supabase
      .from('admin_member_summary')
      .select('*')
      .eq('org_id', orgId)
      .order('spend_month_usd', { ascending: false })
    if (error) setError(error.message)
    else setRows((data ?? []) as Row[])
  }

  useEffect(() => {
    void load()
  }, [orgId])

  async function patch(userId: string, changes: Partial<Row>): Promise<void> {
    setSaving(userId)
    const { error } = await supabase
      .from('org_members')
      .update(changes)
      .eq('org_id', orgId)
      .eq('user_id', userId)
    setSaving(null)
    if (error) setError(error.message)
    else void load()
  }

  if (error) return <p className="error">{error}</p>
  if (!rows) return <p className="muted">Loading people…</p>

  return (
    <section className="stack">
      <div className="head">
        <h1>People</h1>
        <p className="muted">
          Limits are enforced on the server before each request, so they hold even if someone
          edits the extension. Leave a limit blank for no cap; set it to 0 to block access
          without removing the person.
        </p>
      </div>

      <AddPerson onAdded={load} />

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Person</th>
              <th>Role</th>
              <th className="num">Today</th>
              <th className="num">This month</th>
              <th className="num">Daily cap</th>
              <th className="num">Monthly cap</th>
              <th>Access</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const overDay = r.daily_limit_usd != null && r.spend_today_usd >= r.daily_limit_usd
              const overMonth =
                r.monthly_limit_usd != null && r.spend_month_usd >= r.monthly_limit_usd
              return (
                <tr key={r.user_id} className={r.disabled ? 'off' : undefined}>
                  <td>
                    <div className="who">
                      <strong>{r.email}</strong>
                      <span className="sub">
                        {r.requests_month} request{r.requests_month === 1 ? '' : 's'} ·{' '}
                        {r.last_seen ? new Date(r.last_seen).toLocaleDateString() : 'never used'}
                      </span>
                    </div>
                  </td>
                  <td>
                    <select
                      value={r.role}
                      disabled={saving === r.user_id}
                      onChange={(e) => patch(r.user_id, { role: e.target.value as Row['role'] })}
                    >
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                  <td className={overDay ? 'num over' : 'num'}>{money(r.spend_today_usd)}</td>
                  <td className={overMonth ? 'num over' : 'num'}>{money(r.spend_month_usd)}</td>
                  <td className="num">
                    <LimitInput
                      value={r.daily_limit_usd}
                      onCommit={(v) => patch(r.user_id, { daily_limit_usd: v })}
                    />
                  </td>
                  <td className="num">
                    <LimitInput
                      value={r.monthly_limit_usd}
                      onCommit={(v) => patch(r.user_id, { monthly_limit_usd: v })}
                    />
                  </td>
                  <td>
                    <button
                      className="ghost small"
                      disabled={saving === r.user_id}
                      onClick={() => patch(r.user_id, { disabled: !r.disabled })}
                    >
                      {r.disabled ? 'Restore' : 'Turn off'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/**
 * Adds someone by email. If they have no account yet the backend sends them an invitation and
 * creates the membership anyway, so an admin can set a team up in one sitting rather than
 * waiting on everyone to sign up first.
 */
function AddPerson({ onAdded }: { onAdded: () => void }): JSX.Element {
  const [email, setEmail] = useState('')
  const [limit, setLimit] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  async function add(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setBusy(true)
    setNote(null)
    const { ok, body } = await callFunction('admin-member', {
      method: 'POST',
      body: JSON.stringify({
        email,
        dailyLimitUsd: limit.trim() === '' ? null : Number(limit)
      })
    })
    setBusy(false)
    setFailed(!ok)
    if (ok) {
      setNote(`${email} can now sign in and use atElbow.`)
      setEmail('')
      setLimit('')
      onAdded()
    } else {
      setNote(body.error ?? 'Could not add them.')
    }
  }

  return (
    <form className="card addperson" onSubmit={add}>
      <input
        type="email"
        required
        placeholder="colleague@company.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        className="limit"
        inputMode="decimal"
        placeholder="daily $"
        value={limit}
        onChange={(e) => setLimit(e.target.value)}
      />
      <button className="primary small" disabled={busy || !email}>
        {busy ? 'Adding…' : 'Add person'}
      </button>
      {note && <span className={failed ? 'error' : 'sub'}>{note}</span>}
    </form>
  )
}

/**
 * Commits on blur or Enter rather than on every keystroke — a limit that saved as you typed
 * would briefly be "1" on the way to "10", and the proxy would enforce that.
 */
function LimitInput({
  value,
  onCommit
}: {
  value: number | null
  onCommit: (v: number | null) => void
}): JSX.Element {
  const [draft, setDraft] = useState(value == null ? '' : String(value))

  useEffect(() => {
    setDraft(value == null ? '' : String(value))
  }, [value])

  function commit(): void {
    const trimmed = draft.trim()
    if (trimmed === '') return onCommit(null)
    const n = Number(trimmed)
    if (!Number.isFinite(n) || n < 0) return setDraft(value == null ? '' : String(value))
    if (n !== value) onCommit(n)
  }

  return (
    <input
      className="limit"
      inputMode="decimal"
      placeholder="none"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}
