import { useEffect, useRef, useState } from 'react'
import type { ChatMessage, FillProposal } from '../../shared/types'
import FillApprovalCard from './FillApprovalCard'

interface Props {
  providerName: string
  messages: ChatMessage[]
  streamingText: string
  isAsking: boolean
  error: string | null
  lastCaptureLabel: string | null
  onSend: (prompt: string) => void
  onOpenSettings: () => void
  onNewConversation: () => void
  fillProposals: FillProposal[] | null
  filling: boolean
  onApproveFill: (approved: FillProposal[]) => void
  onCancelFill: () => void
}

export default function ChatWindow({
  providerName,
  messages,
  streamingText,
  isAsking,
  error,
  lastCaptureLabel,
  onSend,
  onOpenSettings,
  onNewConversation,
  fillProposals,
  filling,
  onApproveFill,
  onCancelFill
}: Props): JSX.Element {
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, streamingText])

  function handleSend(): void {
    if (isAsking) return
    const prompt = input.trim() || 'What am I looking at? Describe the screen and anything notable.'
    onSend(prompt)
    setInput('')
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="chat-window">
      <header className="chat-header">
        <strong>ScreenPilot</strong>
        <div className="header-actions">
          <button
            className="text-button"
            onClick={() => window.screenpilot.clearOverlay()}
            title="Remove the highlights drawn on your screen"
          >
            Clear
          </button>
          <button
            className="text-button"
            onClick={onNewConversation}
            disabled={messages.length === 0 && !isAsking}
            title="Start a fresh conversation"
          >
            New chat
          </button>
          <button className="icon-button" onClick={onOpenSettings} title="Settings">
            ⚙
          </button>
        </div>
      </header>

      <div className="chat-scroll" ref={scrollRef}>
        {messages.length === 0 && !streamingText && (
          <div className="empty-hint">
            Press <kbd>Ctrl+Shift+Space</kbd> anytime to grab a fresh screenshot and ask about
            it, or just type a question below — Enter captures and sends.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`bubble ${m.role}`}>
            {m.text}
          </div>
        ))}
        {streamingText && <div className="bubble assistant">{streamingText}</div>}
        {isAsking && !streamingText && <div className="bubble assistant thinking">Looking at your screen…</div>}
        {error && <div className="bubble error">{error}</div>}
        {fillProposals && fillProposals.length > 0 && (
          <FillApprovalCard
            proposals={fillProposals}
            busy={filling}
            onApprove={onApproveFill}
            onCancel={onCancelFill}
          />
        )}
      </div>

      <div className="status-line">
        <span>{providerName}</span>
        {lastCaptureLabel && <span>Last look: {lastCaptureLabel}</span>}
      </div>

      <div className="chat-input-row">
        <textarea
          placeholder="Ask about your screen…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
        />
        <button className="primary" onClick={handleSend} disabled={isAsking}>
          Send
        </button>
      </div>
    </div>
  )
}
