import type { AppSettings } from '../../types'

export const DEFAULT_PROMPT_STYLE_LOCK_TEXT = [
  'Use a consistent visual system across all generated images in this project.',
  'Keep the subject complete and clearly readable, with coherent composition, stable camera angle, unified lighting, unified color grading, and polished commercial illustration/product-visual quality.',
  'Avoid random style drift, inconsistent materials, mismatched proportions, cluttered backgrounds, distorted anatomy, blurry details, watermarks, logos, and unnecessary text.',
].join('\n')

export function getPromptStyleLockText(settings: Pick<AppSettings, 'promptStyleLockEnabled' | 'promptStyleLockText'>) {
  if (!settings.promptStyleLockEnabled) return ''
  return settings.promptStyleLockText.trim()
}

export function applyPromptStyleLock(prompt: string, settings: Pick<AppSettings, 'promptStyleLockEnabled' | 'promptStyleLockText'>) {
  const trimmedPrompt = prompt.trim()
  const styleLock = getPromptStyleLockText(settings)
  if (!styleLock) return trimmedPrompt

  return [
    trimmedPrompt,
    'Global consistency requirements:',
    styleLock,
  ].filter(Boolean).join('\n\n')
}

export function createAgentPromptStyleLockInstruction(settings: Pick<AppSettings, 'promptStyleLockEnabled' | 'promptStyleLockText'>) {
  const styleLock = getPromptStyleLockText(settings)
  if (!styleLock) return ''

  return [
    '## Global image consistency requirements',
    'When generating or editing images, treat the following requirements as mandatory and include them in every image prompt while preserving the user request:',
    styleLock,
  ].join('\n')
}
