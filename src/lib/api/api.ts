import { getActiveApiProfile, getCustomProviderDefinition } from './apiProfiles'
import { callGeminiImageApi } from './geminiImageApi'
import { callOpenAICompatibleImageApi } from './openaiCompatibleImageApi'
import type { CallApiOptions, CallApiResult } from './imageApiShared'

export type { CallApiOptions, CallApiResult } from './imageApiShared'
export { normalizeBaseUrl } from './devProxy'

function isGeminiFamilyModel(model: string): boolean {
  const normalized = model.trim().toLowerCase()
  return normalized === 'nano-banana'
    || normalized === 'nano-banana-2'
    || normalized === 'nano-banana-pro'
    || normalized.startsWith('gemini-')
}

function isGrokFamilyModel(model: string): boolean {
  return model.trim().toLowerCase().startsWith('grok')
}

export async function callImageApi(opts: CallApiOptions): Promise<CallApiResult> {
  const profile = getActiveApiProfile(opts.settings)
  if (profile.provider === 'gemini' && isGeminiFamilyModel(profile.model)) {
    return callGeminiImageApi(opts, profile)
  }

  if (profile.provider === 'grok' && isGrokFamilyModel(profile.model)) {
    return callGeminiImageApi(opts, profile)
  }

  return callOpenAICompatibleImageApi(opts, profile, getCustomProviderDefinition(opts.settings, profile.provider))
}
