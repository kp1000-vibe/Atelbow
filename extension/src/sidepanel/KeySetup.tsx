import { useEffect, useState } from 'react'
import type { ProviderId, ProviderInfo } from '../shared/types'
import Logo from './Logo'

interface Props {
  onSaved: () => void
}

/**
 * Setup gate. Nothing works until a key is entered AND verified against the provider — a
 * mistyped key would otherwise surface much later as a confusing failure mid-answer.
 */
export default function KeySetup({ onSaved }: Props): JSX.Element {
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [selected, setSelected] = useState<ProviderId>('gemini')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [key, setKey] = useState('')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [demo, setDemo] = useState<'idle' | 'running' | 'done' | 'failed'>('idle')
  const [demoError, setDemoError] = useState<string | null>(null)

  async function tryDemo(): Promise<void> {
    setDemo('running')
    setDemoError(null)
    const res = await chrome.runtime.sendMessage({ type: 'run-demo' })
    if (res?.ok) {
      setDemo('done')
    } else {
      setDemo('failed')
      setDemoError(res?.error ?? "Couldn't mark this page.")
    }
  }

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'list-providers' }).then((list: ProviderInfo[]) => {
      setProviders(list ?? [])
    })
  }, [])

  const info = providers.find((p) => p.id === selected)

  async function save(): Promise<void> {
    if (!key.trim()) return
    setChecking(true)
    setError(null)

    const result = await chrome.runtime.sendMessage({
      type: 'validate-key',
      providerId: selected,
      apiKey: key.trim()
    })

    if (!result?.ok) {
      setChecking(false)
      setError(result?.error ?? "That key didn't work.")
      return
    }

    // Kept on this machine. There's no server to send it to, and there won't be one until
    // the privacy policy says so.
    await chrome.storage.local.set({ profile: { name: name.trim(), email: email.trim() } })
    setChecking(false)
    onSaved()
  }

  return (
    <div className="setup">
      <div className="setup-hero">
        <div className="wordmark">
          <Logo size={40} />
          <div>
            <h1>atElbow</h1>
            <p className="tagline">Chat tells. Cowork shows.</p>
          </div>
        </div>
        <p>
          Ask about any page and get the answer drawn onto it — the best option boxed in green,
          the cheapest in amber, the catch in red.
        </p>
      </div>

      <div className="demo-block">
        {demo !== 'done' ? (
          <>
            <button className="demo-btn" onClick={tryDemo} disabled={demo === 'running'}>
              {demo === 'running' ? 'Marking this page…' : '✨  See it work — no key needed'}
            </button>
            <p className="demo-hint">
              Marks a few things on the page behind this panel, so you can see what it does
              before setting anything up.
            </p>
            {demoError && <div className="setup-caution">{demoError}</div>}
          </>
        ) : (
          <div className="demo-done">
            <strong>Look at the page behind this panel.</strong>
            <p>
              Those marks are on real buttons — scroll and they follow. They're examples, so
              the labels are made up. Add a key below and the labels come from actually
              reading the page.
            </p>
            <button className="demo-again" onClick={tryDemo}>
              Show me again
            </button>
          </div>
        )}
      </div>

      <section className="setup-step">
        <div className="step-head">
          <span className="step-num">1</span>
          <h2>Choose your AI</h2>
        </div>
        <div className="provider-grid">
          {providers.map((p) => (
            <button
              key={p.id}
              className={`provider${selected === p.id ? ' on' : ''}`}
              onClick={() => {
                setSelected(p.id)
                setError(null)
              }}
            >
              <span className="provider-name">{p.label}</span>
              <span className="provider-cost">{p.free ? 'Free' : p.cost.split('—')[0].trim()}</span>
            </button>
          ))}
        </div>
        {info?.caution && <div className="setup-caution">{info.caution}</div>}
      </section>

      <section className="setup-step">
        <div className="step-head">
          <span className="step-num">2</span>
          <h2>
            About you <em>optional</em>
          </h2>
        </div>
        <div className="field-row">
          <input
            type="text"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <p className="hint-text">Stored on this device only — we have no server to send it to.</p>
      </section>

      <section className="setup-step">
        <div className="step-head">
          <span className="step-num">3</span>
          <h2>{info ? `${info.label} API key` : 'API key'}</h2>
        </div>
        <input
          id="key"
          type="password"
          placeholder={info ? `${info.keyPrefix}…` : 'Paste your key'}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
        {info && (
          <>
            <details className="howto">
              <summary>How do I get a {info.label} API key?</summary>
              <ol>
                {info.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <p className="hint-text">
                Their site may look slightly different — the wording moves around, but the
                path is the same.
              </p>
            </details>
            <p className="hint-text">
              You pay your provider directly — nothing runs through us.
            </p>
          </>
        )}
        {error && <div className="setup-error">{error}</div>}
      </section>

      <button className="primary setup-cta" disabled={checking || !key.trim()} onClick={save}>
        {checking ? 'Checking your key…' : 'Verify key and start'}
      </button>

      <div className="privacy-card">
        <h3>What atElbow never does</h3>
        <ul>
          <li>Save page content — not here, not on any server</li>
          <li>Read passwords, even when they're filled in</li>
          <li>Send card, account, phone or email details</li>
          <li>Read banking or health pages unless you ask</li>
        </ul>
      </div>
    </div>
  )
}
