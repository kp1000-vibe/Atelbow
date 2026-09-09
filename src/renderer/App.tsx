import { useEffect, useState } from 'react'
import type { ChatMessage, FillProposal, SettingsState } from '../shared/types'
import ChatWindow from './components/ChatWindow'
import SettingsPanel from './components/SettingsPanel'
import ConsentDialog from './components/ConsentDialog'

export default function App(): JSX.Element {
  const [settings, setSettings] = useState<SettingsState | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showConsent, setShowConsent] = useState(false)
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null)

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streamingText, setStreamingText] = useState('')
  const [isAsking, setIsAsking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastCaptureLabel, setLastCaptureLabel] = useState<string | null>(null)
  const [fillProposals, setFillProposals] = useState<FillProposal[] | null>(null)
  const [filling, setFilling] = useState(false)

  useEffect(() => {
    window.screenpilot.getSettings().then((s) => {
      setSettings(s)
      if (!s.hasAnthropicKey && !s.hasOpenAIKey) setShowSettings(true)
    })

    const offHotkey = window.screenpilot.onHotkeyTriggered(() => {
      // Window is already shown/focused by the main process; nothing else to do
      // until the user actually sends a question, which triggers a fresh capture.
    })
    const offChunk = window.screenpilot.onAskStreamChunk((chunk) => {
      setStreamingText((prev) => prev + chunk)
    })
    const offDone = window.screenpilot.onAskStreamDone(() => {
      setStreamingText((current) => {
        if (current) {
          setMessages((prev) => [...prev, { role: 'assistant', text: current }])
        }
        return ''
      })
      setIsAsking(false)
    })
    const offFill = window.screenpilot.onFillProposed((proposals) => {
      setFillProposals(proposals)
    })
    const offError = window.screenpilot.onAskStreamError((message) => {
      setError(message)
      setIsAsking(false)
      setStreamingText('')
    })

    return () => {
      offHotkey()
      offChunk()
      offDone()
      offFill()
      offError()
    }
  }, [])

  async function handleApproveFill(approved: FillProposal[]): Promise<void> {
    setFilling(true)
    try {
      const outcomes = await window.screenpilot.approveFill(approved)
      const failed = outcomes.filter((o) => !o.ok)
      const filled = outcomes.filter((o) => o.ok)

      const parts: string[] = []
      if (filled.length > 0) parts.push(`Filled ${filled.map((o) => `"${o.fieldName}"`).join(', ')}.`)
      for (const f of failed) parts.push(`Couldn't fill "${f.fieldName}": ${f.error ?? 'unknown error'}`)
      parts.push('Review the values, then submit the form yourself when you\'re ready.')

      setMessages((prev) => [...prev, { role: 'assistant', text: parts.join(' ') }])
    } finally {
      setFilling(false)
      setFillProposals(null)
    }
  }

  function startAsk(prompt: string): void {
    setError(null)
    setStreamingText('')
    setIsAsking(true)
    setMessages((prev) => [...prev, { role: 'user', text: prompt }])
    setLastCaptureLabel(new Date().toLocaleTimeString())
    window.screenpilot.ask({ prompt, history: messages })
  }

  function handleSend(prompt: string): void {
    if (!settings) return
    if (!settings.hasAnthropicKey && !settings.hasOpenAIKey) {
      setShowSettings(true)
      return
    }
    if (!settings.consentGiven) {
      setPendingPrompt(prompt)
      setShowConsent(true)
      return
    }
    startAsk(prompt)
  }

  async function handleConsentAllow(): Promise<void> {
    const updated = await window.screenpilot.giveConsent(true)
    setSettings(updated)
    setShowConsent(false)
    if (pendingPrompt) {
      startAsk(pendingPrompt)
      setPendingPrompt(null)
    }
  }

  function handleConsentDeny(): void {
    setShowConsent(false)
    setPendingPrompt(null)
  }

  function handleNewConversation(): void {
    // Markers and pending proposals belong to the answer that produced them.
    window.screenpilot.clearOverlay()
    setMessages([])
    setStreamingText('')
    setError(null)
    setLastCaptureLabel(null)
    setFillProposals(null)
  }

  if (!settings) return <div className="chat-window loading">Loading…</div>

  const providerName = settings.providerId === 'anthropic' ? 'Anthropic (Claude)' : 'OpenAI'

  return (
    <>
      <ChatWindow
        providerName={providerName}
        messages={messages}
        streamingText={streamingText}
        isAsking={isAsking}
        error={error}
        lastCaptureLabel={lastCaptureLabel}
        onSend={handleSend}
        onOpenSettings={() => setShowSettings(true)}
        onNewConversation={handleNewConversation}
        fillProposals={fillProposals}
        filling={filling}
        onApproveFill={handleApproveFill}
        onCancelFill={() => setFillProposals(null)}
      />
      {showSettings && (
        <SettingsPanel
          settings={settings}
          onClose={() => setShowSettings(false)}
          onChanged={(s) => setSettings(s)}
        />
      )}
      {showConsent && <ConsentDialog onAllow={handleConsentAllow} onDeny={handleConsentDeny} />}
    </>
  )
}
