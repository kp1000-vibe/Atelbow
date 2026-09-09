import { useEffect, useRef, useState } from 'react'
import type {
  ChatMessage,
  FillProposal,
  PanelEvent,
  PanelRequest,
  UsageSummary
} from '../shared/types'
import FillCard from './FillCard'
import KeySetup from './KeySetup'
import Faq from './Faq'
import Logo from './Logo'

/**
 * Display names for the header's "powered by" line. Duplicated from the provider registry
 * rather than imported: that module pulls in all six adapters, and none of them belong in the
 * panel bundle just to render one word.
 */
const PROVIDER_LABEL: Record<string, string> = {
  gemini: 'Gemini',
  anthropic: 'Claude',
  openai: 'OpenAI',
  grok: 'Grok',
  deepseek: 'DeepSeek',
  kimi: 'Kimi'
}

// Phrased as a learner would, not a shopper — these set the expectation for what to ask.
const SUGGESTIONS = ['What am I looking at?', 'How do I get started here?', 'Walk me through this']

/**
 * The model ends replies with `NEXT: a | b`. Splitting on it rather than waiting for the
 * stream to finish means the marker never flashes up in the visible text mid-stream.
 */
const NEXT_MARKER = /\n*NEXT:/i

/**
 * A half-streamed marker ("...\n\nNEX") would otherwise flash up for a frame before the
 * colon arrives. Requiring a preceding newline keeps this from eating a real trailing
 * letter — prose doesn't end a line with a lone "N".
 */
const PARTIAL_MARKER = /\n+N(E(X(T:?)?)?)?$/i

function visibleText(raw: string): string {
  return raw.split(NEXT_MARKER)[0].replace(PARTIAL_MARKER, '').trimEnd()
}

/**
 * Renders the **bold** the model uses to name controls. Deliberately builds elements rather
 * than setting HTML: this is model output, and it must never be able to inject markup.
 */
function renderRich(text: string): (string | JSX.Element)[] {
  return text.split(/(\*\*[^*\n]+\*\*)/g).map((part, i) =>
    part.length > 4 && part.startsWith('**') && part.endsWith('**') ? (
      <strong key={i} className="ref">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    )
  )
}

function parseFollowUps(raw: string): string[] {
  const tail = raw.split(NEXT_MARKER)[1]
  if (!tail) return []
  return tail
    .split('\n')[0]
    .split('|')
    .map((s) => s.trim())
    .filter((s) => s.length > 1 && s.length < 60)
    .slice(0, 2)
}

export default function Panel(): JSX.Element {
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streaming, setStreaming] = useState('')
  const [busy, setBusyState] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [marked, setMarked] = useState<number | null>(null)
  const [stage, setStage] = useState<string | null>(null)
  const [fills, setFills] = useState<FillProposal[] | null>(null)
  const [filling, setFilling] = useState(false)
  const [auto, setAuto] = useState(true)
  const [usage, setUsage] = useState<UsageSummary | null>(null)
  const [followUps, setFollowUps] = useState<string[]>([])
  const [pageNote, setPageNote] = useState<string | null>(null)
  const [showFaq, setShowFaq] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [recording, setRecording] = useState(false)
  const [speak, setSpeak] = useState(false)
  const [providerLabel, setProviderLabel] = useState<string | null>(null)
  const [input, setInput] = useState('')

  const portRef = useRef<chrome.runtime.Port | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  // Mirrors `busy` so the port's onDisconnect callback — which fires outside React's render
  // cycle — can read the current value without closing over a stale one.
  const busyRef = useRef(false)
  // Streaming text is accumulated in a ref as well, so the 'done' handler can commit the
  // final value without depending on a stale closure over state.
  const streamedRef = useRef('')

  useEffect(() => {
    chrome.storage.local
      .get(['apiKeys', 'providerId', 'autoAnnotate', 'speakSteps'])
      .then(({ apiKeys, providerId, autoAnnotate, speakSteps }) => {
        setSpeak(speakSteps === true)
        const keys = (apiKeys ?? {}) as Record<string, string>
        const active = (providerId ?? 'gemini') as string
        setHasKey(Boolean(keys[active]))
        setProviderLabel(PROVIDER_LABEL[active] ?? null)
        setAuto(autoAnnotate !== false)
      })
    // Opening the panel is a connect, which is what fetches the initial usage numbers.
    post({ type: 'get-usage' })
    void chrome.runtime
      .sendMessage({ type: 'get-diagnostics' })
      .then((r) => setRecording(r?.on === true))
      .catch(() => {})
  }, [])

  /**
   * Copies the diagnostics log.
   *
   * Fetched fresh rather than mirrored in the panel: the log lives in the service worker,
   * which MV3 restarts freely, so any copy held here would go stale without warning.
   */
  async function copyDiagnostics(): Promise<void> {
    try {
      const r = await chrome.runtime.sendMessage({ type: 'get-diagnostics' })
      const text = r?.text ?? 'Nothing recorded yet.'
      await navigator.clipboard.writeText(text)
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: 'Diagnostics copied. Paste them into your bug report.' }
      ])
    } catch {
      setError("Couldn't copy the diagnostics log.")
    }
  }

  /** Keeps the ref and the rendered state in lockstep — never set one without the other. */
  function setBusy(value: boolean): void {
    busyRef.current = value
    setBusyState(value)
  }

  function handleEvent(event: PanelEvent): void {
    if (event.type === 'chunk') {
      streamedRef.current += event.text
      setStreaming(streamedRef.current)
    } else if (event.type === 'annotated') {
      setMarked(event.count)
    } else if (event.type === 'status') {
      setStage(
        {
          reading: 'Reading the page…',
          thinking: 'Thinking it through…',
          writing: 'Writing…',
          marking: 'Marking the page…'
        }[event.stage]
      )
    } else if (event.type === 'page-note') {
      setPageNote(event.text)
    } else if (event.type === 'usage') {
      setUsage(event.summary)
    } else if (event.type === 'fill-proposed') {
      setFills(event.proposals)
    } else if (event.type === 'filled') {
      setFilling(false)
      setFills(null)
      const ok = event.outcomes.filter((o) => o.ok)
      const bad = event.outcomes.filter((o) => !o.ok)
      const parts: string[] = []
      if (ok.length) {
        // `error` on a successful outcome carries a note, e.g. an autocomplete rewriting
        // "JFK" to "New York JFK" — worth surfacing so the user can spot a wrong match.
        parts.push(
          `Filled ${ok.map((o) => `"${o.fieldName}"${o.error ? ` (${o.error})` : ''}`).join(', ')}.`
        )
      }
      for (const f of bad) parts.push(`Couldn't fill "${f.fieldName}" — ${f.error ?? 'unknown error'}.`)
      if (ok.length) parts.push("Check the values, then submit the form yourself when you're ready.")
      setMessages((prev) => [...prev, { role: 'assistant', text: parts.join(' ') }])
    } else if (event.type === 'error') {
      setError(event.message)
      setBusy(false)
      setStage(null)
      streamedRef.current = ''
      setStreaming('')
    } else if (event.type === 'done') {
      const raw = streamedRef.current
      const text = visibleText(raw)
      if (text.trim()) setMessages((prev) => [...prev, { role: 'assistant', text }])
      setFollowUps(parseFollowUps(raw))
      streamedRef.current = ''
      setStreaming('')
      setStage(null)
      setBusy(false)
    }
  }

  /**
   * Connects on demand rather than holding one long-lived port.
   *
   * MV3 terminates idle service workers (and reloading the extension kills them outright),
   * which disconnects the port while this page keeps running. A cached port reference then
   * throws "Attempting to use a disconnected port object" on the next send — after busy was
   * already set — leaving the panel stuck forever. Reconnecting per send, plus an
   * onDisconnect that unsticks the UI, makes that unrecoverable state impossible.
   */
  function connect(): chrome.runtime.Port {
    const port = chrome.runtime.connect({ name: 'atelbow' })
    port.onMessage.addListener(handleEvent)
    // Ask for the running totals as soon as we have a channel to receive them on.
    try {
      port.postMessage({ type: 'get-usage' })
    } catch {
      /* handled by the reconnect path on the next send */
    }
    port.onDisconnect.addListener(() => {
      // Reading lastError marks it handled; a disconnect is expected here, not exceptional.
      void chrome.runtime.lastError
      portRef.current = null
      if (busyRef.current) {
        setError('Lost the connection to the extension mid-answer. Ask again — it should reconnect.')
        setStage(null)
        streamedRef.current = ''
        setStreaming('')
        setBusy(false)
      }
    })
    portRef.current = port
    return port
  }

  function post(message: PanelRequest): boolean {
    for (let attempt = 0; attempt < 2; attempt++) {
      const port = portRef.current ?? connect()
      try {
        port.postMessage(message)
        return true
      } catch {
        // Stale port — drop it and let the next pass make a fresh one.
        portRef.current = null
      }
    }
    return false
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, streaming])

  function send(prompt: string): void {
    if (busy || !prompt.trim()) return
    setError(null)
    setMarked(null)
    setFills(null)
    setFollowUps([])
    setPageNote(null)
    setMessages((prev) => [...prev, { role: 'user', text: prompt }])
    setInput('')

    // Only enter the busy state once the message is actually on its way — setting it before
    // a send that can throw is what produced the permanent "Reading the page…" spinner.
    if (!post({ type: 'ask', prompt, history: messages })) {
      setError("Couldn't reach the extension's background worker. Reload the page and try again.")
      return
    }
    setBusy(true)
    setStage('Reading the page…')
  }

  function clearMarks(): void {
    setMarked(null)
    post({ type: 'clear-annotations' })
  }


  /**
   * Starts over completely.
   *
   * The 'reset' tells the worker to abandon anything in flight — without it, an answer that
   * was already streaming lands in the fresh conversation a moment later, which reads as the
   * new chat mysteriously filling up with the previous page.
   */
  function newChat(): void {
    post({ type: 'reset' })

    streamedRef.current = ''
    setMessages([])
    setStreaming('')
    setStage(null)
    setError(null)
    setMarked(null)
    setFills(null)
    setFilling(false)
    setFollowUps([])
    setPageNote(null)
    setInput('')
    setBusy(false)
  }

  if (hasKey === null) return <div className="panel loading">Loading…</div>
  if (!hasKey) return <KeySetup onSaved={() => setHasKey(true)} />
  if (showFaq) {
    return (
      <Faq
        onClose={() => setShowFaq(false)}
        onSwitch={() => {
          // Keys are kept — this is "pick a different one", not "forget me".
          setShowFaq(false)
          setHasKey(false)
        }}
        onSignOut={async () => {
          await chrome.storage.local.remove(['apiKeys', 'providerId', 'profile'])
          newChat()
          setShowFaq(false)
          setHasKey(false)
        }}
      />
    )
  }

  return (
    <div className="panel">
      <header className="panel-header">
        <div className="brand">
          <Logo size={26} />
          <div className="brand-text">
            <strong>atElbow</strong>
            {providerLabel && <span>powered by {providerLabel}</span>}
          </div>
        </div>
        <div className="header-actions">
          <button
            className="text-button"
            disabled={messages.length === 0 && !busy}
            title="Clear this conversation and start fresh"
            onClick={newChat}
          >
            New chat
          </button>

          <div className="menu-wrap">
            <button
              className="icon-button"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              title="More options"
              onClick={() => setMenuOpen((v) => !v)}
            >
              ⋮
            </button>

            {menuOpen && (
              <>
                {/* Click-away closes the menu; without it the only way out is the button. */}
                <div className="menu-scrim" onClick={() => setMenuOpen(false)} />
                <div className="menu" role="menu">
                  <button
                    role="menuitem"
                    onClick={() => {
                      const next = !auto
                      setAuto(next)
                      post({ type: 'set-auto', enabled: next })
                      setMenuOpen(false)
                    }}
                  >
                    <span className="menu-label">
                      Auto-read <em>{auto ? 'on' : 'off'}</em>
                    </span>
                    <span className="menu-desc">
                      {auto
                        ? 'Reads each page you open. Uses a request every time.'
                        : 'Only reads a page when you ask.'}
                    </span>
                  </button>

                  <button
                    role="menuitem"
                    onClick={() => {
                      const next = !speak
                      setSpeak(next)
                      // The content script watches storage directly, so no message needed.
                      void chrome.storage.local.set({ speakSteps: next })
                      setMenuOpen(false)
                    }}
                  >
                    <span className="menu-label">
                      Read steps aloud <em>{speak ? 'on' : 'off'}</em>
                    </span>
                    <span className="menu-desc">
                      {speak
                        ? 'Each step is spoken as it is highlighted.'
                        : 'Hear each step while you look at the screen. Your device speaks it — nothing is sent anywhere.'}
                    </span>
                  </button>

                  <button
                    role="menuitem"
                    onClick={() => {
                      clearMarks()
                      setMenuOpen(false)
                    }}
                  >
                    <span className="menu-label">Clear marks</span>
                    <span className="menu-desc">Removes the highlights from the page.</span>
                  </button>

                  <button
                    role="menuitem"
                    onClick={() => {
                      const next = !recording
                      setRecording(next)
                      void chrome.runtime.sendMessage({ type: 'set-diagnostics', enabled: next })
                      setMenuOpen(false)
                    }}
                  >
                    <span className="menu-label">
                      Record diagnostics <em>{recording ? 'on' : 'off'}</em>
                    </span>
                    <span className="menu-desc">
                      {recording
                        ? 'Logging what each answer targeted. Copy it below.'
                        : 'Logs why a step did or did not get marked. Stays on this device.'}
                    </span>
                  </button>

                  {recording && (
                    <button
                      role="menuitem"
                      onClick={() => {
                        void copyDiagnostics()
                        setMenuOpen(false)
                      }}
                    >
                      <span className="menu-label">Copy diagnostics</span>
                      <span className="menu-desc">
                        Puts the log on your clipboard, ready to paste into a bug report.
                      </span>
                    </button>
                  )}

                  <button
                    role="menuitem"
                    onClick={() => {
                      void chrome.runtime.sendMessage({ type: 'forget-recall' })
                      setMenuOpen(false)
                      setMessages((prev) => [
                        ...prev,
                        {
                          role: 'assistant',
                          text: 'Forgotten. The next question will be worked out fresh.'
                        }
                      ])
                    }}
                  >
                    <span className="menu-label">Forget remembered steps</span>
                    <span className="menu-desc">
                      Clears the saved walkthroughs so answers are worked out from scratch.
                    </span>
                  </button>

                  <button
                    role="menuitem"
                    onClick={() => {
                      setShowFaq(true)
                      setMenuOpen(false)
                    }}
                  >
                    <span className="menu-label">Help &amp; settings</span>
                    <span className="menu-desc">Questions, switch AI, or sign out.</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="scroll" ref={scrollRef}>
        {messages.length === 0 && !streaming && (
          <div className="empty">
            <p>Ask about whatever page you're on — I'll answer by marking it up directly.</p>
            <div className="suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="suggestion" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`bubble ${m.role}`}>
            {m.role === 'assistant' ? renderRich(m.text) : m.text}
          </div>
        ))}
        {streaming && visibleText(streaming) && (
          <div className="bubble assistant">{renderRich(visibleText(streaming))}</div>
        )}
        {busy && !streaming && (
          <div className="bubble assistant thinking">{stage ?? 'Reading the page…'}</div>
        )}
        {marked !== null && (
          <div className="marked-note">
            Marked {marked} {marked === 1 ? 'item' : 'items'} on the page.
          </div>
        )}
        {fills && fills.length > 0 && (
          <FillCard
            proposals={fills}
            busy={filling}
            onApprove={(approved) => {
              setFilling(true)
              if (!post({ type: 'approve-fill', approved })) {
                setFilling(false)
                setError('Lost the connection. Ask again and re-approve.')
              }
            }}
            onCancel={() => setFills(null)}
          />
        )}
        {pageNote && <div className="page-note">{pageNote}</div>}
        {error && <div className="bubble error">{error}</div>}

        {/* Offered only once the turn is finished, so they don't shift under the cursor. */}
        {!busy && followUps.length > 0 && (
          <div className="followups">
            {/* After a walkthrough the useful offer is the next thing to do, not a topic
                change — so it gets a heading that says so. */}
            {marked !== null && <span className="followup-label">What next</span>}
            {followUps.map((q) => (
              <button key={q} className="suggestion" onClick={() => send(q)}>
                {q}
              </button>
            ))}
          </div>
        )}
      </div>

      {usage && (
        <div className="usage-bar" title="Measured from real API token counts, not estimates">
          {usage.dailyLimit > 0 ? (
            <>
              <div className="usage-track">
                <div
                  className="usage-fill"
                  style={{
                    width: `${Math.min(100, (usage.todayRequests / usage.dailyLimit) * 100)}%`,
                    background: usage.todayRequests >= usage.dailyLimit ? '#b91c1c' : 'var(--accent)'
                  }}
                />
              </div>
              <span>
                {usage.todayRequests}/{usage.dailyLimit} today
              </span>
            </>
          ) : (
            <span>{usage.todayRequests} today</span>
          )}
          <span className="usage-cost">
            {usage.monthCostUsd < 0.01 && usage.monthCostUsd > 0
              ? '<1¢'
              : `${(usage.monthCostUsd * 100).toFixed(1)}¢`}{' '}
            this month
            {usage.avgCostUsd > 0 && ` · ${(usage.avgCostUsd * 100).toFixed(2)}¢/ask`}
          </span>
        </div>
      )}

      <div className="composer">
        <textarea
          rows={2}
          placeholder="Ask about this page…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send(input)
            }
          }}
        />
        <button className="primary" disabled={busy} onClick={() => send(input)}>
          Ask
        </button>
      </div>
    </div>
  )
}
