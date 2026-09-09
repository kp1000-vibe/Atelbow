import { useState } from 'react'
import type { ProviderId, SettingsState } from '../../shared/types'

interface Props {
  settings: SettingsState
  onClose: () => void
  onChanged: (settings: SettingsState) => void
}

export default function SettingsPanel({ settings, onClose, onChanged }: Props): JSX.Element {
  const [provider, setProvider] = useState<ProviderId>(settings.providerId)
  const [anthropicKey, setAnthropicKey] = useState('')
  const [openAIKey, setOpenAIKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)

  async function handleSave(): Promise<void> {
    setSaving(true)
    setSavedMsg(null)
    try {
      let latest = await window.screenpilot.setProvider(provider)
      if (anthropicKey.trim()) {
        latest = await window.screenpilot.setApiKey('anthropic', anthropicKey.trim())
      }
      if (openAIKey.trim()) {
        latest = await window.screenpilot.setApiKey('openai', openAIKey.trim())
      }
      onChanged(latest)
      setAnthropicKey('')
      setOpenAIKey('')
      setSavedMsg('Saved.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="overlay">
      <div className="dialog settings">
        <h2>Settings</h2>

        <label className="field-label">AI Provider</label>
        <div className="radio-row">
          <label>
            <input
              type="radio"
              name="provider"
              checked={provider === 'anthropic'}
              onChange={() => setProvider('anthropic')}
            />
            Anthropic (Claude) {settings.hasAnthropicKey && provider === 'anthropic' ? '— key saved' : ''}
          </label>
          <label>
            <input
              type="radio"
              name="provider"
              checked={provider === 'openai'}
              onChange={() => setProvider('openai')}
            />
            OpenAI {settings.hasOpenAIKey && provider === 'openai' ? '— key saved' : ''}
          </label>
        </div>

        <label className="field-label" htmlFor="anthropic-key">
          Anthropic API key {settings.hasAnthropicKey && '(saved — leave blank to keep)'}
        </label>
        <input
          id="anthropic-key"
          type="password"
          placeholder="sk-ant-..."
          value={anthropicKey}
          onChange={(e) => setAnthropicKey(e.target.value)}
        />

        <label className="field-label" htmlFor="openai-key">
          OpenAI API key {settings.hasOpenAIKey && '(saved — leave blank to keep)'}
        </label>
        <input
          id="openai-key"
          type="password"
          placeholder="sk-..."
          value={openAIKey}
          onChange={(e) => setOpenAIKey(e.target.value)}
        />

        <label className="field-label">Accuracy</label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settings.useAccessibilityTree}
            onChange={async (e) => onChanged(await window.screenpilot.setUseAccessibilityTree(e.target.checked))}
          />
          <span>
            Use Windows accessibility data
            <small>
              Reads exact control names and positions from the active window so markers land
              precisely. Turn off to rely on the screenshot alone.
            </small>
          </span>
        </label>

        {savedMsg && <div className="hint">{savedMsg}</div>}

        <div className="dialog-actions">
          <button className="secondary" onClick={onClose}>
            Close
          </button>
          <button className="primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
