import { useEffect, useState } from 'react'
import type { ProviderInfo } from '../shared/types'

interface Props {
  onClose: () => void
  /** Back to setup, keys intact, so another provider can be picked. */
  onSwitch: () => void
  /** Clears every stored key and profile detail. */
  onSignOut: () => void
}

const QUESTIONS: { q: string; a: string }[] = [
  {
    q: 'What does atElbow actually do?',
    a: 'It reads the page you\'re on and answers by drawing on it — boxing the best option in green, the cheapest in amber, and anything to watch out for in red. It reads the page structure directly, not a screenshot, so it knows exactly where every button and price is.'
  },
  {
    q: 'Why do I need my own API key?',
    a: "Because we don't run the AI — you do. Your key talks straight to the provider you chose, so you pay them directly, at cost, and nothing routes through us. It also means we never see what you ask."
  },
  {
    q: 'What does it cost to run?',
    a: 'Gemini has a free tier with no card required, which is enough for normal use. The other providers charge per request, usually a fraction of a cent. The bar at the bottom of the panel shows how many times you\'ve used it today.'
  },
  {
    q: 'Is my browsing stored anywhere?',
    a: 'No. Page content is never saved — not in the extension, and not on any server, because there is no server. Your chat disappears when you close the panel.'
  },
  {
    q: 'What about passwords and card numbers?',
    a: 'Password fields are never read at all, even when filled in. Card numbers, account numbers, phone numbers and email addresses are stripped out of everything before it leaves the page.'
  },
  {
    q: 'Does it read my bank or health records?',
    a: 'Not on its own. Banking, health, insurance and login pages are never read automatically. If you ask it something directly on one of those pages it will help — you asked — and it tells you it\'s doing so.'
  },
  {
    q: 'Can it fill forms for me?',
    a: 'It can propose values. You see every one, can edit or skip any of them, and nothing is typed until you press Fill. It never submits a form — pressing the final button is always yours.'
  },
  {
    q: "Why didn't it fill the date field?",
    a: 'Calendar pickers usually aren\'t real text boxes, so typing into them does nothing — the widget resets the value. atElbow tells you when a field rejected what it typed rather than pretending it worked.'
  },
  {
    q: 'How do I stop it reading every page?',
    a: 'Click "Auto on" in the panel header to switch it off. It then only reads a page when you ask a question.'
  },
  {
    q: 'How do I switch AI provider or change my key?',
    a: 'Use "Switch AI" at the top of this page. Your other keys are kept, so you can move between providers without setting them up again.'
  },
  {
    q: "Why doesn't it work on this page?",
    a: 'Chrome blocks extensions on its own pages (chrome://, the Web Store) and on PDFs. On a normal site, reload the tab — content scripts only load on page load.'
  }
]

export default function Faq({ onClose, onSwitch, onSignOut }: Props): JSX.Element {
  const [provider, setProvider] = useState<string>('')
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    void (async () => {
      const { providerId } = await chrome.storage.local.get('providerId')
      const list: ProviderInfo[] = await chrome.runtime.sendMessage({ type: 'list-providers' })
      setProvider(list?.find((p) => p.id === (providerId ?? 'gemini'))?.label ?? '')
    })()
  }, [])

  return (
    <div className="panel">
      <header className="panel-header">
        <strong className="faq-title">Help &amp; settings</strong>
        <button className="text-button" onClick={onClose}>
          Back
        </button>
      </header>

      <div className="scroll faq-list">
        <div className="account-card">
          <div className="account-row">
            <span className="account-label">Signed in with</span>
            <strong>{provider || '—'}</strong>
          </div>
          {!confirming ? (
            <div className="account-actions">
              <button className="secondary" onClick={onSwitch}>
                Switch AI
              </button>
              <button className="danger-link" onClick={() => setConfirming(true)}>
                Sign out
              </button>
            </div>
          ) : (
            <div className="account-confirm">
              <p>Sign out and delete every saved key from this browser?</p>
              <div className="account-actions">
                <button className="secondary" onClick={() => setConfirming(false)}>
                  Cancel
                </button>
                <button className="danger-btn" onClick={onSignOut}>
                  Yes, sign out
                </button>
              </div>
            </div>
          )}
        </div>

        {QUESTIONS.map(({ q, a }) => (
          <details key={q} className="faq-item">
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </div>
    </div>
  )
}
