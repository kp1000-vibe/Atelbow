import { safeStorage } from 'electron'
import Store from 'electron-store'
import type { ProviderId, SettingsState } from '../shared/types'

/**
 * Bumped whenever ScreenPilot starts collecting materially more than the user previously
 * agreed to, so old consent cannot silently cover new data access. v2 added reading the
 * accessibility tree (control names and text), which is broader than pixels alone.
 */
const CURRENT_CONSENT_VERSION = 2

interface StoreSchema {
  providerId: ProviderId
  /** Consent version the user last accepted; 0 means never asked. */
  consentVersion: number
  useAccessibilityTree: boolean
  /** Base64 of safeStorage.encryptString() output; never plaintext. */
  anthropicKeyEnc?: string
  openAIKeyEnc?: string
}

const store = new Store<StoreSchema>({
  name: 'screenpilot-settings',
  defaults: {
    providerId: 'anthropic',
    consentVersion: 0,
    useAccessibilityTree: true
  }
})

function encrypt(plain: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS-level secret encryption is not available on this machine.')
  }
  return safeStorage.encryptString(plain).toString('base64')
}

function decrypt(encB64: string | undefined): string {
  if (!encB64) return ''
  if (!safeStorage.isEncryptionAvailable()) return ''
  try {
    return safeStorage.decryptString(Buffer.from(encB64, 'base64'))
  } catch {
    return ''
  }
}

export function getProviderId(): ProviderId {
  return store.get('providerId')
}

export function setProviderId(id: ProviderId): void {
  store.set('providerId', id)
}

export function getConsentGiven(): boolean {
  return store.get('consentVersion') >= CURRENT_CONSENT_VERSION
}

export function setConsentGiven(value: boolean): void {
  store.set('consentVersion', value ? CURRENT_CONSENT_VERSION : 0)
}

export function getUseAccessibilityTree(): boolean {
  return store.get('useAccessibilityTree')
}

export function setUseAccessibilityTree(value: boolean): void {
  store.set('useAccessibilityTree', value)
}

export function getApiKey(providerId: ProviderId): string {
  const key = providerId === 'anthropic' ? 'anthropicKeyEnc' : 'openAIKeyEnc'
  return decrypt(store.get(key))
}

export function setApiKey(providerId: ProviderId, plainKey: string): void {
  const key = providerId === 'anthropic' ? 'anthropicKeyEnc' : 'openAIKeyEnc'
  if (!plainKey) {
    store.delete(key)
    return
  }
  store.set(key, encrypt(plainKey))
}

export function getSettingsState(): SettingsState {
  return {
    providerId: getProviderId(),
    hasAnthropicKey: Boolean(store.get('anthropicKeyEnc')),
    hasOpenAIKey: Boolean(store.get('openAIKeyEnc')),
    consentGiven: getConsentGiven(),
    useAccessibilityTree: getUseAccessibilityTree()
  }
}
