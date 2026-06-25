import { describe, expect, it } from 'vitest'
import { DEFAULT_VIDEO_MODEL, getVideoModelPreset, VIDEO_MODEL_OPTIONS } from '../../lib/video/videoModels'

describe('video model presets', () => {
  it('uses the supported default video model list', () => {
    expect(DEFAULT_VIDEO_MODEL).toBe('doubao-seedance-2.0-fast-1080p')
    expect(VIDEO_MODEL_OPTIONS).toEqual([
      'doubao-seedance-2.0-fast-1080p',
      'doubao-seedance-2.0-fast-480p',
      'doubao-seedance-2.0-fast-720p',
      'grok-imagine-video',
      'sora-2',
      'sora-2-12s',
      'sora-2-8s',
      'veo_3_1',
      'veo_3_1-fast',
    ])
  })

  it('detects fixed resolution and duration from model names', () => {
    expect(getVideoModelPreset('doubao-seedance-2.0-fast-1080p')).toMatchObject({
      resolution: '1080p',
      hasFixedResolution: true,
      hasFixedSeconds: false,
    })
    expect(getVideoModelPreset('sora-2-12s')).toMatchObject({
      seconds: '12',
      hasFixedResolution: false,
      hasFixedSeconds: true,
    })
  })
})
