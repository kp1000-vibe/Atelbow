import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import Members from './Members'
import Keys from './Keys'
import Usage from './Usage'

type Tab = 'members' | 'usage' | 'keys'

interface Membership {
  org_id: string
  role: 'admin' | 'member'
  orgName: string
}

export default function App(): JSX.Element {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [membership, setMembership] = useState<Membership | null>(null)
  const [tab, setTab] = useState<Tab>('members')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) {
      setMembership(null)
      return
    }
    // RLS means this returns the caller's own membership and nothing else, so no filter on
    // user_id is needed — and none would help if the policy were wrong.
    void supabase
      .from('org_members')
      .select('org_id, role, orgs(name)')
      .eq('user_id', session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return setMembership(null)
        const orgs = data.orgs as unknown as { name: string } | null
        setMembership({
          org_id: data.org_id,
          role: data.role,
          orgName: orgs?.name ?? 'Your organisation'
        })
      })
  }, [session])

  if (loading) return <div className="center muted">Loading…</div>
  if (!session) return <SignIn />

  if (!membership) {
    return (
      <div className="center">
        <div className="card narrow">
          <h2>No organisation yet</h2>
          <p className="muted">
            This account isn't a member of an organisation. Ask an admin to invite you, or
            create one from the Supabase dashboard to get started.
          </p>
          <button className="ghost" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
      </div>
    )
  }

  if (membership.role !== 'admin') {
    // The console shows money on nearly every screen, so a member has no reason to be here.
    return (
      <div className="center">
        <div className="card narrow">
          <h2>Admins only</h2>
          <p className="muted">
            You're signed in as a member of {membership.orgName}. The extension works with this
            account — the admin console doesn't.
          </p>
          <button className="ghost" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <Mark />
          <div>
            <strong>atElbow</strong>
            <span className="org">{membership.orgName}</span>
          </div>
        </div>
        <nav className="tabs">
          {(['members', 'usage', 'keys'] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? 'tab on' : 'tab'} onClick={() => setTab(t)}>
              {t === 'members' ? 'People' : t === 'usage' ? 'Usage' : 'API keys'}
            </button>
          ))}
        </nav>
        <button className="ghost" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </header>

      <main className="content">
        {tab === 'members' && <Members orgId={membership.org_id} />}
        {tab === 'usage' && <Usage orgId={membership.org_id} />}
        {tab === 'keys' && <Keys />}
      </main>
    </div>
  )
}

function SignIn(): JSX.Element {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function send(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin }
    })
    setBusy(false)
    if (error) setError(error.message)
    else setSent(true)
  }

  return (
    <div className="center">
      <div className="card narrow">
        <Mark />
        <h2>Admin console</h2>
        {sent ? (
          <p className="muted">
            Check <strong>{email}</strong> for a sign-in link.
          </p>
        ) : (
          <form onSubmit={send} className="stack">
            <p className="muted">
              We'll email you a sign-in link. No password to remember or rotate.
            </p>
            <input
              type="email"
              required
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button className="primary" disabled={busy || !email}>
              {busy ? 'Sending…' : 'Email me a link'}
            </button>
            {error && <p className="error">{error}</p>}
          </form>
        )}
      </div>
    </div>
  )
}

/** The E-mark: violet arc as the elbow, gold cursor running through it. */
function Mark(): JSX.Element {
  return (
    <svg viewBox="0 0 100 100" width="30" height="30" role="img" aria-label="atElbow">
      <mask id="cut" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
        <rect width="100" height="100" fill="#fff" />
        <g stroke="#000" fill="#000" strokeWidth="27" strokeLinejoin="round" strokeLinecap="round">
          <line x1="32" y1="72" x2="66" y2="38" />
          <polygon points="80,24 56.2,32.2 71.8,47.8" />
        </g>
      </mask>
      <g mask="url(#cut)" fill="#4A1772">
        <rect x="18" y="12" width="64" height="20" />
        <rect x="18" y="12" width="22" height="76" />
        <rect x="18" y="41" width="48" height="18" />
        <rect x="18" y="68" width="64" height="20" />
      </g>
      <g fill="#D6A32A" stroke="#D6A32A">
        <line x1="32" y1="72" x2="66" y2="38" strokeWidth="13" strokeLinecap="round" />
        <polygon points="80,24 56.2,32.2 71.8,47.8" />
      </g>
    </svg>
  )
}
