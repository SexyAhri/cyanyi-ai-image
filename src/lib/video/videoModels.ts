export const VIDEO_MODEL_OPTIONS = [
  'doubao-seedance-2.0-fast-1080p',
  'doubao-seedance-2.0-fast-480p',
  'doubao-seedance-2.0-fast-720p',
  'grok-imagine-video',
  'sora-2',
  'sora-2-12s',
  'sora-2-8s',
  'veo_3_1',
  'veo_3_1-fast',
] as const

export const DEFAULT_VIDEO_MODEL = VIDEO_MODEL_OPTIONS[0]

const SORA_2_SIZES = ['1280x720', '720x1280'] as const
const SORA_2_PRO_SIZES = ['1280x720', '720x1280', '1920x1080', '1080x1920'] as const
const COMMON_VIDEO_SIZES = ['1280x720', '720x1280', '1024x1024', '1792x1024', '1024x1792'] as const
const DOUBAO_SECONDS = ['5', '10'] as const
const SORA_SECONDS = ['8', '12'] as const
const GROK_SECONDS = ['6', '10'] as const
const VEO_SECONDS = ['8'] as const

export function getVideoModelPreset(model: string) {
  const normalized = model.trim().toLowerCase()
  const resolution = normalized.match(/(?:^|-)(480p|720p|1080p)(?:$|-)/)?.[1]
  const seconds = normalized.match(/(?:^|-)(\d+)s(?:$|-)/)?.[1]
  const supportedSizes = getSupportedVideoSizes(normalized)

  return {
    resolution,
    seconds,
    supportedSizes,
    supportedSeconds: getSupportedVideoSeconds(normalized),
    supportsReferenceImages: supportsVideoReferenceImages(normalized),
    supportsReferenceVideo: supportsVideoReferenceVideo(normalized),
    supportsReferenceAudio: supportsVideoReferenceAudio(normalized),
    defaultSize: supportedSizes?.[0],
    hasFixedResolution: Boolean(resolution),
    hasFixedSeconds: Boolean(seconds),
  }
}

export function getSupportedVideoSizes(model: string): readonly string[] | undefined {
  const normalized = model.trim().toLowerCase()
  if (/^sora-2-pro(?:$|-)/.test(normalized)) return SORA_2_PRO_SIZES
  if (/^sora-2(?:$|-)/.test(normalized)) return SORA_2_SIZES
  return COMMON_VIDEO_SIZES
}

export function normalizeVideoSizeForModel(model: string, size: string) {
  const supportedSizes = getSupportedVideoSizes(model)
  const normalizedSize = normalizeGenericVideoSize(size)
  if (supportedSizes?.length && !supportedSizes.includes(normalizedSize)) return supportedSizes[0]
  return normalizedSize
}

export function getSupportedVideoSeconds(model: string): readonly string[] {
  const normalized = model.trim().toLowerCase()
  if (/^doubao-seedance/.test(normalized)) return DOUBAO_SECONDS
  if (/^sora-2/.test(normalized)) return SORA_SECONDS
  if (/^grok-imagine-video/.test(normalized)) return GROK_SECONDS
  if (/^veo_3_1/.test(normalized)) return VEO_SECONDS
  return ['6', '10', '12', '16', '20']
}

export function normalizeVideoSecondsForPreset(model: string, value: string) {
  const preset = getVideoModelPreset(model)
  if (preset.seconds) return preset.seconds
  const supported = preset.supportedSeconds
  return supported.includes(value) ? value : supported[0] ?? '6'
}

export function supportsVideoReferenceImages(model: string) {
  const normalized = model.trim().toLowerCase()
  return !/^sora-2/.test(normalized)
}

export function supportsVideoReferenceVideo(model: string) {
  const normalized = model.trim().toLowerCase()
  return /^veo_3_1/.test(normalized)
}

export function supportsVideoReferenceAudio(model: string) {
  const normalized = model.trim().toLowerCase()
  return /^veo_3_1/.test(normalized)
}

function normalizeGenericVideoSize(value: string) {
  const size = value.trim() || '1280x720'
  if (size === 'auto') return '1280x720'
  if (/^\d+x\d+$/.test(size)) return size
  if (['9:16', '2:3', '3:4'].includes(size)) return '720x1280'
  return '1280x720'
}
