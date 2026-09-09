import { useEffect, useState } from 'react'
import { callFunction } from './supabase'

const PROVIDERS = [
  { id: 'gemini', label: 'Gemini', note: 'Has a genuine free tier' },
  { id: 'anthropic', label: 'Claude', note: 'Best step accuracy in testing' },
  { id: 'openai', label: 'OpenAI', note: '' },
  { id: 'deepseek', label: 'DeepSeek', note: 'Cheapest paid option' },
  { id: 'grok', label: 'Grok', note: 'Prompts may be used for training' },
  { id: 'kimi', label: 'Kimi', note: '' }
] as const

interface KeyRow {
  provider: string
  hint: string
  updated_at: string
}

export default function Keys(): JSX.Element {
  const [keys, setKeys] = useState<KeyRow[] | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load(): Promise<void> {
    const { ok, body } = await callFunction('admin-key')
    if (ok) setKeys(body.keys ?? [])
    else setError(body.error ?? 'Could not load keys.')
  }

  useEffect(() => {
    void load()
  }, [])

  async function save(provider: string): Promise<void> {
    const apiKey = (drafts[provider] ?? '').trim()
    if (!apiKey) return
    setBusy(provider)
    setError(null)
    const { ok, body } = await callFunction('admin-key', {
      method: 'POST',
      body: JSON.stringify({ provider, apiKey })
    })
    setBusy(null)
    if (!ok) return setError(body.error ?? 'Could not save the key.')
    setDrafts((d) => ({ ...d, [provider]: '' }))
    void load()
  }

  async function remove(provider: string): Promise<void> {
    setBusy(provider)
    await callFunction('admin-key', { method: 'DELETE', body: JSON.stringify({ provider }) })
    setBusy(null)
    void load()
  }

  const installed = new Map((keys ?? []).map((k) => [k.provider, k]))

  return (
    <section className="stack">
      <div className="head">
        <h1>API keys</h1>
        <p className="muted">
          One key per provider, for the whole organisation. Keys are encrypted before they're
          stored and are never sent to the browser — not even back to this page. To check which
          key is installed, compare the last four characters.
        </p>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="keys">
        {PROVIDERS.map((p) => {
          const have = installed.get(p.id)
          return (
            <div className="card key" key={p.id}>
              <div className="keyhead">
                <div>
                  <strong>{p.label}</strong>
                  {p.note && <span className="sub">{p.note}</span>}
                </div>
                {have ? (
                  <span className="pill on">···{have.hint}</span>
                ) : (
                  <span className="pill">Not set</span>
                )}
              </div>

              <div className="keyrow">
                <input
                  type="password"
                  autoComplete="off"
                  placeholder={have ? 'Paste a new key to replace' : 'Paste the API key'}
                  value={drafts[p.id] ?? ''}
                  onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                />
                <button
                  className="primary small"
                  disabled={busy === p.id || !(drafts[p.id] ?? '').trim()}
                  onClick={() => save(p.id)}
                >
                  {busy === p.id ? 'Saving…' : have ? 'Replace' : 'Save'}
                </button>
                {have && (
                  <button className="ghost small" disabled={busy === p.id} onClick={() => remove(p.id)}>
                    Remove
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
