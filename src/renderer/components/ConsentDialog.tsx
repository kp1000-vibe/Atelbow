interface Props {
  onAllow: () => void
  onDeny: () => void
}

export default function ConsentDialog({ onAllow, onDeny }: Props): JSX.Element {
  return (
    <div className="overlay">
      <div className="dialog">
        <h2>Allow ScreenPilot to read your screen?</h2>
        <p>
          When you press the hotkey or hit Send — and only then — ScreenPilot reads two things
          from the window you're working in:
        </p>
        <ul className="consent-list">
          <li>
            <strong>A screenshot</strong> of the display that window is on.
          </li>
          <li>
            <strong>The names and text of on-screen controls</strong>, via Windows
            accessibility. This is what lets it point at the right button instead of guessing.
          </li>
        </ul>
        <p>
          Both are sent to the AI provider you configured in Settings, and neither is saved to
          disk. Nothing is captured in the background, on a timer, or from other windows. You
          can turn the accessibility part off in Settings at any time.
        </p>
        <div className="dialog-actions">
          <button className="secondary" onClick={onDeny}>
            Not now
          </button>
          <button className="primary" onClick={onAllow}>
            Allow
          </button>
        </div>
      </div>
    </div>
  )
}
