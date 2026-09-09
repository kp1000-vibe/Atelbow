import type { ProviderId, ProviderInfo } from '../../shared/types'
import type { Provider } from './types'
import { anthropicProvider } from './anthropic'
import { geminiProvider } from './gemini'
import { createOpenAICompatible } from './openaiCompatible'

/**
 * Vendor metadata for the settings UI. `keyPrefix` is only a hint shown in the placeholder —
 * validation is done by calling the provider, never by pattern-matching the key.
 */
/**
 * Ordered by the quality of the walkthrough they produce, not by how easy they are to start.
 *
 * Claude leads because it is the only one measured marking every step visible on a page;
 * Gemini marked one per screen on the same pages, which turns a walkthrough into a single
 * hint. Gemini stays second as the free way in — the trade is stated on its card rather than
 * hidden by putting it first.
 */
export const PROVIDERS: ProviderInfo[] = [
  {
    id: 'anthropic',
    label: 'Claude',
    console: 'console.anthropic.com',
    keyPrefix: 'sk-ant-',
    model: 'claude-sonnet-5',
    cost: 'Paid — buy credits first',
    steps: [
      'Open console.anthropic.com and create an account',
      'Go to Billing and buy credits (about $5 minimum)',
      'Go to "API keys" and click "Create Key"',
      'Copy the key — it starts with sk-ant-'
    ]
  },
  {
    id: 'gemini',
    label: 'Gemini',
    console: 'aistudio.google.com',
    keyPrefix: 'AIza',
    // Google retired gemini-2.5-flash for new API keys; anyone signing up now gets a 404 on
    // it, which meant every fresh install failed on its first question.
    model: 'gemini-3.6-flash',
    cost: 'Free to start — no card',
    free: true,
    caution:
      "Google's free tier uses your prompts to improve its products, and in testing it marked " +
      'one step per screen where Claude marked all of them. Good for trying atElbow; switch to ' +
      'Claude for confidential work or the full walkthrough.',
    steps: [
      'Open aistudio.google.com and sign in with a Google account',
      'Click "Get API key" in the left sidebar',
      'Choose "Create API key"',
      'Copy the key — it starts with AIza',
      'No card and no billing setup required'
    ]
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    console: 'platform.deepseek.com',
    keyPrefix: 'sk-',
    model: 'deepseek-chat',
    cost: 'Free tokens on signup, then very cheap',
    steps: [
      'Open platform.deepseek.com and create an account',
      'Go to "API keys" in the sidebar',
      'Click "Create new API key" and name it',
      'Copy it straight away — it is shown only once'
    ]
  },
  {
    id: 'openai',
    label: 'OpenAI',
    console: 'platform.openai.com',
    keyPrefix: 'sk-',
    model: 'gpt-4o',
    cost: 'Paid — card required',
    steps: [
      'Open platform.openai.com and create an account',
      'Go to Settings → Billing and add a payment method',
      'Go to "API keys" → "Create new secret key"',
      'Copy it straight away — it is shown only once'
    ]
  },
  {
    id: 'grok',
    label: 'Grok',
    console: 'console.x.ai',
    keyPrefix: 'xai-',
    model: 'grok-2-latest',
    cost: 'Signup credits',
    caution:
      "xAI's larger free credits require joining their data-sharing programme, which trains on your prompts and can't be switched off. Don't opt in if you use this on anything private.",
    steps: [
      'Open console.x.ai and sign in with your X account',
      'Create a team if you are prompted to',
      'Go to "API keys" and create one',
      'Copy the key — it starts with xai-',
      'Skip the data-sharing offer unless you accept training on your prompts'
    ]
  },
  {
    id: 'kimi',
    label: 'Kimi',
    console: 'platform.moonshot.ai',
    keyPrefix: 'sk-',
    model: 'kimi-k2-0711-preview',
    cost: 'Paid API',
    steps: [
      'Open platform.moonshot.ai and create an account',
      'Add billing — the API is paid even though the chat app is free',
      'Go to "API keys" and create one',
      'Copy the key'
    ]
  }
]

const REGISTRY: Record<ProviderId, Provider> = {
  anthropic: anthropicProvider,
  gemini: geminiProvider,
  // Four vendors, one protocol — see openaiCompatible.ts.
  openai: createOpenAICompatible({ id: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' }),
  grok: createOpenAICompatible({ id: 'grok', baseUrl: 'https://api.x.ai/v1', model: 'grok-2-latest' }),
  deepseek: createOpenAICompatible({
    id: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat'
  }),
  kimi: createOpenAICompatible({
    id: 'kimi',
    baseUrl: 'https://api.moonshot.ai/v1',
    model: 'kimi-k2-0711-preview'
  })
}

export function getProvider(id: ProviderId): Provider {
  return REGISTRY[id] ?? REGISTRY.anthropic
}

export function providerInfo(id: ProviderId): ProviderInfo {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0]
}
