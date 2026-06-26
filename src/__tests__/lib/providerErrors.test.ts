import { describe, expect, it } from 'vitest'
import { sanitizeProviderErrorMessage } from '../../lib/api/providerErrors'

describe('sanitizeProviderErrorMessage', () => {
  it('hides raw NewAPI channel circuit errors', () => {
    const message = '{"code":"fail_to_fetch_task","message":"{\\"error\\":{\\"code\\":\\"channel_circuit_open\\",\\"message\\":\\"All channels for model grok-imagine-video-1.5-preview under group default are temporarily suspended by circuit breaker\\"}}"}'

    expect(sanitizeProviderErrorMessage(message)).toBe('当前模型暂不可用，请稍后重试或切换模型。')
  })

  it('explains invalid video size errors', () => {
    expect(sanitizeProviderErrorMessage('{"code":"invalid_size","message":"sora-2 size is invalid"}'))
      .toBe('当前模型不支持所选尺寸或清晰度，请换成该模型支持的尺寸/清晰度，或切换其他模型。')
  })

  it('explains unsupported reference errors', () => {
    expect(sanitizeProviderErrorMessage('unsupported reference audio for this model'))
      .toBe('当前模型不支持所选参考素材，请移除参考图/视频/音频，或切换支持参考素材的模型。')
  })

  it('explains unsupported Agent tool errors separately from reference errors', () => {
    expect(sanitizeProviderErrorMessage('unsupported image_generation tool for this model'))
      .toBe('当前 Agent 对话模型不支持工具调用或图片生成工具，请把 Agent 默认配置切换为支持 Responses 工具调用的对话模型，生图模型请放在“Agent 生图配置”里。')
  })
})
