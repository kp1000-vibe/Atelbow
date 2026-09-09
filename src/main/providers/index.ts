import type { ProviderId } from '../../shared/types'
import type { VisionProvider } from './types'
import { anthropicProvider } from './anthropic'
import { openAIProvider } from './openai'

const registry: Record<ProviderId, VisionProvider> = {
  anthropic: anthropicProvider,
  openai: openAIProvider
}

export function getProvider(id: ProviderId): VisionProvider {
  return registry[id]
}

export function allProviders(): VisionProvider[] {
  return Object.values(registry)
}
