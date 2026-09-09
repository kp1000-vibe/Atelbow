import { useEffect, useState } from 'react'
import { supabase, money } from './supabase'

interface Event {
  id: number
  email: string
  created_at: string
  provider: string
  model: string
  input_tokens: number
  output_tokens: number
  cost_usd: number
  app_host: string | null
  ok: boolean
}

export default function Usage({ orgId }: { orgId: string }): JSX.Element {
  const [events, setEvents] = useState<Event[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void supabase
      .from('admin_usage')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(300)
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else setEvents((data ?? []) as Event[])
      })
  }, [orgId])

  if (error) return <p className="error">{error}</p>
  if (!events) return <p className="muted">Loading usage…</p>

  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)
  const thisMonth = events.filter((e) => new Date(e.created_at) >= monthStart)

  const spend = thisMonth.reduce((sum, e) => sum + Number(e.cost_usd), 0)
  const failures = thisMonth.filter((e) => !e.ok).length
  const people = new Set(thisMonth.map((e) => e.email)).size

  // Which tools people actually struggle with — the one question this data answers that
  // nothing else can.
  const byApp = new Map<string, number>()
  for (const e of thisMonth) {
    const host = e.app_host ?? 'unknown'
    byApp.set(host, (byApp.get(host) ?? 0) + 1)
  }
  const topApps = [...byApp.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  const busiest = topApps[0]?.[1] ?? 1

  return (
    <section className="stack">
      <div className="head">
        <h1>Usage</h1>
        <p className="muted">
          Cost, volume and which apps people are asking about. No page content is recorded —
          only the hostname, so this can tell you <em>where</em> people struggle but never what
          they were looking at.
        </p>
      </div>

      <div className="stats">
        <Stat label="Spend this month" value={money(spend)} />
        <Stat label="Requests" value={String(thisMonth.length)} />
        <Stat label="People active" value={String(people)} />
        <Stat label="Failed calls" value={String(failures)} tone={failures ? 'warn' : undefined} />
      </div>

      {topApps.length > 0 && (
        <div className="card">
          <h2>Where people need help</h2>
          <div className="bars">
            {topApps.map(([host, n]) => (
              <div className="bar" key={host}>
                <span className="barlabel">{host}</span>
                <div className="track">
                  <div className="fill" style={{ width: `${Math.round((n / busiest) * 100)}%` }} />
                </div>
                <span className="barnum">{n}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Person</th>
              <th>App</th>
              <th>Model</th>
              <th className="num">Tokens</th>
              <th className="num">Cost</th>
            </tr>
          </thead>
          <tbody>
            {events.slice(0, 100).map((e) => (
              <tr key={e.id} className={e.ok ? undefined : 'off'}>
                <td className="sub">{new Date(e.created_at).toLocaleString()}</td>
                <td>{e.email}</td>
                <td>{e.app_host ?? '—'}</td>
                <td className="sub">{e.model}</td>
                <td className="num sub">
                  {e.input_tokens + e.output_tokens ? e.input_tokens + e.output_tokens : '—'}
                </td>
                <td className="num">{e.ok ? money(e.cost_usd) : 'failed'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Stat({
  label,
  value,
  tone
}: {
  label: string
  value: string
  tone?: 'warn'
}): JSX.Element {
  return (
    <div className={tone === 'warn' ? 'stat warn' : 'stat'}>
      <span className="statlabel">{label}</span>
      <strong className="statvalue">{value}</strong>
    </div>
  )
}
