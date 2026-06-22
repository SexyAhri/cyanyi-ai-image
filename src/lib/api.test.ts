import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type ApiProfile, type AppSettings } from '../types'
import { DEFAULT_SETTINGS } from './apiProfiles'
import { callImageApi } from './api'

function withOpenAIProfile(profileOverrides: Partial<ApiProfile>, settingsOverrides: Partial<AppSettings> = {}): AppSettings {
  const activeProfileId = DEFAULT_SETTINGS.activeProfileId
  const profiles = DEFAULT_SETTINGS.profiles.map((profile) =>
    profile.id === activeProfileId ? { ...profile, ...profileOverrides } : profile,
  )
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId)
  if (!activeProfile) throw new Error('Missing default API profile')

  return {
    ...DEFAULT_SETTINGS,
    ...settingsOverrides,
    baseUrl: activeProfile.baseUrl,
    apiKey: activeProfile.apiKey,
    model: activeProfile.model,
    timeout: activeProfile.timeout,
    apiMode: activeProfile.apiMode,
    codexCli: activeProfile.codexCli,
    apiProxy: activeProfile.apiProxy,
    streamImages: activeProfile.streamImages,
    streamPartialImages: activeProfile.streamPartialImages,
    profiles,
    activeProfileId,
  }
}

describe('callImageApi', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  it.each([false, true])(
    'adds the prompt rewrite guard on Responses API when Codex CLI mode is %s',
    async (codexCli) => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
        output: [{
          type: 'image_generation_call',
          result: 'aW1hZ2U=',
        }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))

      await callImageApi({
        settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', apiMode: 'responses', codexCli },
        prompt: 'prompt',
        params: { ...DEFAULT_PARAMS },
        inputImageDataUrls: [],
      })

      const [, init] = fetchMock.mock.calls[0]
      const body = JSON.parse(String((init as RequestInit).body))
      expect(body.input).toBe('Use the following text as the complete prompt. Do not rewrite it:\nprompt')
    },
  )

  it('records actual params returned on Images API responses in Codex CLI mode', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output_format: 'png',
      quality: 'medium',
      size: '1033x1522',
      data: [{
        b64_json: 'aW1hZ2U=',
        revised_prompt: '移除靴子',
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const result = await callImageApi({
      settings: withOpenAIProfile({
        apiKey: 'test-key',
        apiMode: 'images',
        codexCli: true,
      }),
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.actualParams).toEqual({
      output_format: 'png',
      quality: 'medium',
      size: '1033x1522',
    })
    expect(result.actualParamsList).toEqual([{
      output_format: 'png',
      quality: 'medium',
      size: '1033x1522',
    }])
    expect(result.revisedPrompts).toEqual(['移除靴子'])
  })

  it('calls Gemini generateContent for nano-banana-2 image models', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{
            inlineData: {
              mimeType: 'image/png',
              data: 'aW1hZ2U=',
            },
          }],
        },
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const result = await callImageApi({
      settings: withOpenAIProfile({
        provider: 'gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: 'gemini-key',
        model: 'nano-banana-2',
        apiMode: 'images',
        apiProxy: false,
      }),
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent')
    expect((init as RequestInit).headers).toMatchObject({
      'x-goog-api-key': 'gemini-key',
      'Content-Type': 'application/json',
    })
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({
      contents: [{
        role: 'user',
        parts: [{ text: 'prompt' }],
      }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
      },
    })
    expect(result.images).toEqual(['data:image/png;base64,aW1hZ2U='])
  })

  it('calls NewAPI chat completions for non-Google Gemini-compatible image models', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response([
        'data: {"choices":[{"delta":{"content":"[progress: 1%]\\n"}}]}',
        '',
        'data: {"choices":[{"delta":{"content":"![image](https://oss.example.com/result.png)\\n"}}]}',
        '',
        'data: [DONE]',
        '',
      ].join('\n'), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }))
      .mockResolvedValueOnce(new Response(new Blob([Uint8Array.from([105, 109, 97, 103, 101])], { type: 'image/png' }), {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      }))

    const result = await callImageApi({
      settings: withOpenAIProfile({
        provider: 'gemini',
        baseUrl: 'https://ai.cyanyi.com/v1',
        apiKey: 'newapi-key',
        model: 'nano-banana-2',
        apiMode: 'images',
        apiProxy: false,
      }),
      prompt: '生成一张测试图片',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://ai.cyanyi.com/v1/chat/completions')
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer newapi-key',
      'Content-Type': 'application/json',
    })
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({
      model: 'nano-banana-2',
      messages: [{
        role: 'user',
        content: '生成一张测试图片',
      }],
      stream: true,
    })
    expect(fetchMock.mock.calls[1][0]).toBe('https://oss.example.com/result.png')
    expect(result.images).toEqual(['data:image/png;base64,aW1hZ2U='])
    expect(result.rawImageUrls).toEqual(['https://oss.example.com/result.png'])
  })

  it('calls NewAPI chat completions for Grok through the standard API key endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response([
        'data: {"choices":[{"delta":{"reasoning_content":"图片正在生成 50% (0/1)\\n","role":"assistant"}}]}',
        '',
        'data: {"choices":[{"delta":{"content":"![image](https://grok.cnmz.de/v1/files/image?id=955ffaa3-dfa7-4814-8b3f-536fb18b7248)","role":"assistant"}}]}',
        '',
        'data: [DONE]',
        '',
      ].join('\n'), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }))
      .mockResolvedValueOnce(new Response(new Blob([Uint8Array.from([105, 109, 97, 103, 101])], { type: 'image/png' }), {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      }))

    const result = await callImageApi({
      settings: withOpenAIProfile({
        provider: 'grok',
        baseUrl: 'https://ai.cyanyi.com/v1',
        apiKey: 'newapi-key',
        model: 'grok-image',
        apiMode: 'images',
        apiProxy: false,
      }),
      prompt: '生成一张测试图片',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://ai.cyanyi.com/v1/chat/completions')
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body).toMatchObject({
      model: 'grok-image',
      messages: [{
        role: 'user',
        content: '生成一张测试图片',
      }],
      stream: true,
    })
    expect(body).not.toHaveProperty('group')
    expect(fetchMock.mock.calls[1][0]).toBe('https://grok.cnmz.de/v1/files/image?id=955ffaa3-dfa7-4814-8b3f-536fb18b7248')
    expect(result.images).toEqual(['data:image/png;base64,aW1hZ2U='])
    expect(result.rawImageUrls).toEqual(['https://grok.cnmz.de/v1/files/image?id=955ffaa3-dfa7-4814-8b3f-536fb18b7248'])
  })

  it('keeps Grok image URLs when browser download is blocked by CORS', async () => {
    const imageUrl = 'https://grok.cnmz.de/v1/files/image?id=blocked-by-cors'
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response([
        `data: {"choices":[{"delta":{"content":"![image](${imageUrl})","role":"assistant"}}]}`,
        '',
        'data: [DONE]',
        '',
      ].join('\n'), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))

    const result = await callImageApi({
      settings: withOpenAIProfile({
        provider: 'grok',
        baseUrl: 'https://ai.cyanyi.com/v1',
        apiKey: 'newapi-key',
        model: 'grok-image',
        apiMode: 'images',
        apiProxy: false,
      }),
      prompt: '生成一张测试图片',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.images).toEqual([imageUrl])
    expect(result.rawImageUrls).toEqual([imageUrl])
  })

  it('retries empty NewAPI chat completion streams before reporting failure', async () => {
    const imageUrl = 'https://grok.cnmz.de/v1/files/image?id=retry-success'
    const emptyStream = [
      'data: {"id":"","object":"","created":0,"model":"","system_fingerprint":null,"choices":null,"usage":null}',
      '',
      'data: {"id":"","object":"chat.completion.chunk","created":0,"model":"","system_fingerprint":"","choices":[],"usage":{"prompt_tokens":141,"completion_tokens":0,"total_tokens":141}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n')
    const successStream = [
      `data: {"choices":[{"delta":{"content":"![image](${imageUrl})","role":"assistant"}}]}`,
      '',
      'data: [DONE]',
      '',
    ].join('\n')
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(emptyStream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }))
      .mockResolvedValueOnce(new Response(successStream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }))
      .mockResolvedValueOnce(new Response(new Blob([Uint8Array.from([105, 109, 97, 103, 101])], { type: 'image/png' }), {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      }))

    const result = await callImageApi({
      settings: withOpenAIProfile({
        provider: 'grok',
        baseUrl: 'https://ai.cyanyi.com/v1',
        apiKey: 'newapi-key',
        model: 'grok-image',
        apiMode: 'images',
        apiProxy: false,
      }),
      prompt: '生成一张测试图片',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[0][0]).toBe('https://ai.cyanyi.com/v1/chat/completions')
    expect(fetchMock.mock.calls[1][0]).toBe('https://ai.cyanyi.com/v1/chat/completions')
    expect(result.rawImageUrls).toEqual([imageUrl])
  })

  it('reports a clear error after retrying repeated empty NewAPI chat completion streams', async () => {
    const emptyStream = [
      'data: {"id":"","object":"","created":0,"model":"","system_fingerprint":null,"choices":null,"usage":null}',
      '',
      'data: {"id":"","object":"chat.completion.chunk","created":0,"model":"","system_fingerprint":"","choices":[],"usage":{"prompt_tokens":141,"completion_tokens":0,"total_tokens":141}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n')
    const createEmptyResponse = () => new Response(emptyStream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(createEmptyResponse())
      .mockResolvedValueOnce(createEmptyResponse())

    await expect(callImageApi({
      settings: withOpenAIProfile({
        provider: 'grok',
        baseUrl: 'https://ai.cyanyi.com/v1',
        apiKey: 'newapi-key',
        model: 'grok-image',
        apiMode: 'images',
        apiProxy: false,
      }),
      prompt: '生成一张测试图片',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })).rejects.toMatchObject({
      message: 'Grok 兼容接口连续返回空响应，已自动重试但仍未拿到图片，请稍后再试。',
      rawResponsePayload: expect.stringContaining('"choices": []'),
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('reports Grok-compatible empty image responses with raw payload', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response([
      'data: {"choices":[{"delta":{"reasoning_content":"图片正在生成 100% (1/1)\\n","role":"assistant"}}]}',
      '',
      'data: {"choices":[{"delta":{"content":"","role":"assistant"},"finish_reason":"stop"}]}',
      '',
      'data: [DONE]',
      '',
    ].join('\n'), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))

    await expect(callImageApi({
      settings: withOpenAIProfile({
        provider: 'grok',
        baseUrl: 'https://ai.cyanyi.com/v1',
        apiKey: 'newapi-key',
        model: 'grok-image',
        apiMode: 'images',
        apiProxy: false,
      }),
      prompt: '生成一张测试图片',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })).rejects.toMatchObject({
      message: 'Grok 兼容接口没有返回图片链接，请确认模型会输出 Markdown 图片链接。',
      rawResponsePayload: expect.stringContaining('reasoning_content'),
    })
  })

  it('reports NewAPI business errors even when HTTP status is 200', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      message: '无权进行此操作，access token 无效',
      success: false,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await expect(callImageApi({
      settings: withOpenAIProfile({
        provider: 'grok',
        baseUrl: 'https://ai.cyanyi.com/v1',
        apiKey: 'bad-token',
        model: 'grok-image',
        apiMode: 'images',
        apiProxy: false,
      }),
      prompt: '生成一张测试图片',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })).rejects.toMatchObject({
      message: '无权进行此操作，access token 无效',
      rawResponsePayload: expect.stringContaining('"success": false'),
    })
  })

  it('parses non-stream NewAPI chat completion image links for Gemini-compatible models', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{
          message: {
            content: '绘图已完成：https://oss.example.com/non-stream.webp',
          },
        }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(new Blob([Uint8Array.from([105, 109, 97, 103, 101])], { type: 'image/webp' }), {
        status: 200,
        headers: { 'Content-Type': 'image/webp' },
      }))

    const result = await callImageApi({
      settings: withOpenAIProfile({
        provider: 'gemini',
        baseUrl: 'https://ai.cyanyi.com/v1',
        apiKey: 'newapi-key',
        model: 'nano-banana-2',
        apiMode: 'images',
        apiProxy: false,
      }),
      prompt: '生成一张测试图片',
      params: { ...DEFAULT_PARAMS, output_format: 'webp' },
      inputImageDataUrls: [],
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.images).toEqual(['data:image/webp;base64,aW1hZ2U='])
    expect(result.rawImageUrls).toEqual(['https://oss.example.com/non-stream.webp'])
  })

  it('does not synthesize actual quality in Codex CLI mode when the API omits it', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output_format: 'png',
      size: '1033x1522',
      data: [{ b64_json: 'aW1hZ2U=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const result = await callImageApi({
      settings: withOpenAIProfile({
        apiKey: 'test-key',
        apiMode: 'images',
        codexCli: true,
      }),
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(result.actualParams).toEqual({
      output_format: 'png',
      size: '1033x1522',
    })
    expect(result.actualParams?.quality).toBeUndefined()
    expect(result.actualParamsList).toEqual([{
      output_format: 'png',
      size: '1033x1522',
    }])
  })

  it('streams Images API partial images and resolves the final completed image', async () => {
    const streamBody = [
      'data: {"type":"image_generation.partial_image","partial_image_index":0,"b64_json":"cGFydGlhbA=="}',
      '',
      'data: {"type":"image_generation.completed","b64_json":"ZmluYWw=","size":"1024x1024","quality":"high","output_format":"png"}',
      '',
      'data: [DONE]',
      '',
    ].join('\n')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(streamBody, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))
    const partialImages: string[] = []

    const result = await callImageApi({
      settings: withOpenAIProfile({
        apiKey: 'test-key',
        apiMode: 'images',
        streamImages: true,
        streamPartialImages: 3,
      }),
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
      onPartialImage: (partial: { image: string }) => partialImages.push(partial.image),
    } as any)

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body).toMatchObject({
      stream: true,
      partial_images: 3,
    })
    expect(partialImages).toEqual(['data:image/jpeg;base64,cGFydGlhbA=='])
    expect(result).toMatchObject({
      images: ['data:image/png;base64,ZmluYWw='],
      actualParams: {
        output_format: 'png',
        quality: 'high',
        size: '1024x1024',
      },
      actualParamsList: [{
        output_format: 'png',
        quality: 'high',
        size: '1024x1024',
      }],
    })
  })

  it('suggests disabling streaming when a streaming request fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('invalid character \':\' looking for beginning of value', {
      status: 400,
      headers: { 'Content-Type': 'text/plain' },
    }))

    await expect(callImageApi({
      settings: withOpenAIProfile({
        apiKey: 'test-key',
        apiMode: 'images',
        streamImages: true,
      }),
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    } as any)).rejects.toThrow('invalid character \':\' looking for beginning of value\n提示：当前使用的 API 可能不支持流式传输，请尝试关闭「流式传输」功能。')
  })

  it('preserves malformed stream event text when suggesting disabling streaming', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('data: invalid character \':\' looking for beginning of value\n\n', {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))

    await expect(callImageApi({
      settings: withOpenAIProfile({
        apiKey: 'test-key',
        apiMode: 'images',
        streamImages: true,
      }),
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    } as any)).rejects.toThrow('invalid character \':\' looking for beginning of value\n提示：API 返回了无法解析的流式数据格式，请尝试关闭「流式传输」功能。')
  })

  it('reports malformed event-stream responses without data events', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('invalid character \':\' looking for beginning of value\n\n', {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))

    await expect(callImageApi({
      settings: withOpenAIProfile({
        apiKey: 'test-key',
        apiMode: 'images',
        streamImages: true,
      }),
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    } as any)).rejects.toThrow('未从流式响应中解析到有效的 data 事件\n提示：API 返回了无法解析的流式数据格式，请尝试关闭「流式传输」功能。')
  })

  it('does not expect revised prompts on official Images API stream completed events', async () => {
    const streamBody = [
      'data: {"created_at":1779112721,"type":"image_generation.completed","b64_json":"ZmluYWw=","background":"opaque","output_format":"jpeg","quality":"medium","sequence_number":0,"size":"1448x1086","usage":{"total_tokens":1569}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(streamBody, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))

    const result = await callImageApi({
      settings: withOpenAIProfile({
        apiKey: 'test-key',
        apiMode: 'images',
        streamImages: true,
      }),
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    } as any)

    expect(result).toMatchObject({
      images: ['data:image/jpeg;base64,ZmluYWw='],
      actualParams: {
        output_format: 'jpeg',
        quality: 'medium',
        size: '1448x1086',
      },
      revisedPrompts: [undefined],
    })
  })

  it('parses Images API stream result events with data b64_json', async () => {
    const streamBody = [
      'data: {"object":"image.generation.chunk","created":1779551054,"model":"gpt-image-2"}',
      '',
      'data: {"object":"image.generation.result","created":1779551140,"model":"gpt-image-2","data":[{"b64_json":"ZmluYWw=","revised_prompt":"rewritten"}],"size":"1024x1536","quality":"medium","output_format":"png"}',
      '',
      'data: [DONE]',
      '',
    ].join('\n')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(streamBody, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))

    const result = await callImageApi({
      settings: withOpenAIProfile({
        apiKey: 'test-key',
        apiMode: 'images',
        streamImages: true,
      }),
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    } as any)

    expect(result).toMatchObject({
      images: ['data:image/png;base64,ZmluYWw='],
      actualParams: {
        output_format: 'png',
        quality: 'medium',
        size: '1024x1536',
      },
      actualParamsList: [{
        output_format: 'png',
        quality: 'medium',
        size: '1024x1536',
      }],
      revisedPrompts: ['rewritten'],
    })
  })

  it('splits Images API streaming into concurrent single-image requests when n is greater than 1', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const streamBody = [
        'data: {"type":"image_generation.partial_image","partial_image_index":0,"b64_json":"cGFydGlhbA=="}',
        '',
        'data: {"type":"image_generation.completed","b64_json":"ZmluYWw=","size":"1024x1024","quality":"high","output_format":"png"}',
        '',
        'data: [DONE]',
        '',
      ].join('\n')
      return new Response(streamBody, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    })
    const partials: Array<{ image: string; requestIndex?: number }> = []

    const result = await callImageApi({
      settings: withOpenAIProfile({
        apiKey: 'test-key',
        apiMode: 'images',
        streamImages: true,
        streamPartialImages: 1,
      }),
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, n: 2 },
      inputImageDataUrls: [],
      onPartialImage: (partial: { image: string; requestIndex?: number }) => partials.push(partial),
    } as any)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const [, init] of fetchMock.mock.calls) {
      const body = JSON.parse(String((init as RequestInit).body))
      expect(body.n).toBeUndefined()
      expect(body.stream).toBe(true)
      expect(body.partial_images).toBe(1)
    }
    expect(result.images).toHaveLength(2)
    expect(result.images).toEqual([
      'data:image/png;base64,ZmluYWw=',
      'data:image/png;base64,ZmluYWw=',
    ])
    expect(partials.map((partial) => partial.requestIndex).sort()).toEqual([0, 1])
    expect(partials.map((partial) => partial.image)).toEqual([
      'data:image/jpeg;base64,cGFydGlhbA==',
      'data:image/jpeg;base64,cGFydGlhbA==',
    ])
  })

  it('keeps successful Images API concurrent results when one request fails', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const callIndex = fetchMock.mock.calls.length
      if (callIndex === 2) throw new TypeError('Failed to fetch')
      return new Response(JSON.stringify({
        data: [{ b64_json: `aW1hZ2Ut${callIndex}` }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const result = await callImageApi({
      settings: withOpenAIProfile({
        apiKey: 'test-key',
        apiMode: 'images',
        codexCli: true,
      }),
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, n: 3 },
      inputImageDataUrls: [],
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(result.images).toEqual([
      'data:image/jpeg;base64,aW1hZ2Ut1',
      'data:image/jpeg;base64,aW1hZ2Ut3',
    ])
    expect(result.failedRequests).toEqual([{ requestIndex: 1, error: 'Failed to fetch' }])
    expect(result.actualParams).toMatchObject({ n: 2 })
  })

  it('streams Responses API partial images and resolves the completed response image', async () => {
    const streamBody = [
      'data: {"type":"response.image_generation_call.partial_image","partial_image_index":0,"partial_image_b64":"cGFydGlhbA=="}',
      '',
      'data: {"type":"response.completed","response":{"output":[{"type":"image_generation_call","result":"ZmluYWw=","revised_prompt":"rewritten","size":"1024x1024"}]}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(streamBody, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))
    const partialImages: string[] = []

    const result = await callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        apiMode: 'responses',
        streamImages: true,
        streamPartialImages: 1,
        profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({
          ...profile,
          apiKey: 'test-key',
          apiMode: 'responses',
          streamImages: true,
          streamPartialImages: 1,
        })),
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
      onPartialImage: (partial: { image: string }) => partialImages.push(partial.image),
    } as any)

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.stream).toBe(true)
    expect(body.tools[0].partial_images).toBe(1)
    expect(partialImages).toEqual(['data:image/jpeg;base64,cGFydGlhbA=='])
    expect(result).toMatchObject({
      images: ['data:image/jpeg;base64,ZmluYWw='],
      actualParams: { size: '1024x1024' },
      actualParamsList: [{ size: '1024x1024' }],
      revisedPrompts: ['rewritten'],
    })
  })

  it('keeps successful Responses API concurrent results when one request fails', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const callIndex = fetchMock.mock.calls.length
      if (callIndex === 3) throw new TypeError('Failed to fetch')
      return new Response(JSON.stringify({
        output: [{ type: 'image_generation_call', result: `aW1hZ2Ut${callIndex}` }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const result = await callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', apiMode: 'responses' },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, n: 3 },
      inputImageDataUrls: [],
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(result.images).toEqual([
      'data:image/jpeg;base64,aW1hZ2Ut1',
      'data:image/jpeg;base64,aW1hZ2Ut2',
    ])
    expect(result.failedRequests).toEqual([{ requestIndex: 2, error: 'Failed to fetch' }])
    expect(result.actualParams).toMatchObject({ n: 2 })
  })

  it('parses Responses API image result objects in gallery mode', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{
        type: 'image_generation_call',
        result: { b64_json: 'ZmluYWw=' },
        size: '1024x1024',
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const result = await callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', apiMode: 'responses' },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(result).toMatchObject({
      images: ['data:image/jpeg;base64,ZmluYWw='],
      actualParams: { size: '1024x1024' },
      actualParamsList: [{ size: '1024x1024' }],
    })
  })

  it('keeps Responses API stream output item images when completed response omits result', async () => {
    const streamBody = [
      'data: {"type":"response.output_item.done","item":{"id":"img-call-1","type":"image_generation_call","status":"generating","action":"generate","result":"ZmluYWw=","size":"1024x1024"},"output_index":0}',
      '',
      'data: {"type":"response.completed","response":{"output":[{"type":"image_generation_call","status":"completed","result":""}]}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(streamBody, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))

    const result = await callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        apiMode: 'responses',
        streamImages: true,
        profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({
          ...profile,
          apiKey: 'test-key',
          apiMode: 'responses',
          streamImages: true,
        })),
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    } as any)

    expect(result).toMatchObject({
      images: ['data:image/jpeg;base64,ZmluYWw='],
      actualParams: { size: '1024x1024' },
      actualParamsList: [{ size: '1024x1024' }],
    })
  })

  it('uses the same-origin API proxy path when API proxy is enabled', async () => {
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'true')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: 'aW1hZ2U=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await callImageApi({
      settings: withOpenAIProfile({
        apiKey: 'test-key',
        apiMode: 'images',
        apiProxy: true,
        baseUrl: 'http://api.example.com/v1',
      }),
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api-proxy/images/generations',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('uses the same-origin API proxy path when API proxy is enabled and base URL is empty', async () => {
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'true')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: 'aW1hZ2U=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await callImageApi({
      settings: withOpenAIProfile({
        apiKey: 'test-key',
        apiMode: 'images',
        apiProxy: true,
        baseUrl: '',
      }),
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api-proxy/images/generations',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('uses the same-origin API proxy path for sync custom providers', async () => {
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'true')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: 'aW1hZ2U=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        baseUrl: '',
        apiKey: 'test-key',
        apiProxy: true,
        customProviders: [{
          id: 'custom-sync',
          name: 'Custom Sync',
          template: 'http-image',
          submit: {
            path: 'custom/images',
            method: 'POST',
            contentType: 'json',
            body: { model: '$profile.model', prompt: '$prompt' },
            result: { b64JsonPaths: ['data.*.b64_json'] },
          },
        }],
        profiles: [{
          ...DEFAULT_SETTINGS.profiles[0],
          id: 'profile-custom-sync',
          provider: 'custom-sync',
          baseUrl: '',
          apiKey: 'test-key',
          model: 'model',
          apiProxy: true,
        }],
        activeProfileId: 'profile-custom-sync',
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api-proxy/custom/images',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('rejects API proxy for async custom providers', async () => {
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'true')
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    await expect(callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        baseUrl: '',
        apiKey: 'test-key',
        apiProxy: true,
        customProviders: [{
          id: 'custom-async-proxy',
          name: 'Custom Async Proxy',
          template: 'http-image',
          submit: {
            path: 'images/generations',
            method: 'POST',
            contentType: 'json',
            body: { model: '$profile.model', prompt: '$prompt' },
            taskIdPath: 'task_id',
          },
          poll: {
            path: 'images/tasks/{task_id}',
            method: 'GET',
            intervalSeconds: 1,
            statusPath: 'status',
            successValues: ['done'],
            failureValues: ['failed'],
            result: { b64JsonPaths: ['data.*.b64_json'] },
          },
        }],
        profiles: [{
          ...DEFAULT_SETTINGS.profiles[0],
          id: 'profile-custom-async-proxy',
          provider: 'custom-async-proxy',
          baseUrl: '',
          apiKey: 'test-key',
          model: 'model',
          apiProxy: true,
        }],
        activeProfileId: 'profile-custom-async-proxy',
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })).rejects.toThrow('异步任务的自定义服务商')

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses the same-origin API proxy path when API proxy is locked', async () => {
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'true')
    vi.stubEnv('VITE_API_PROXY_LOCKED', 'true')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: 'aW1hZ2U=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await callImageApi({
      settings: withOpenAIProfile({
        apiKey: 'test-key',
        apiMode: 'images',
        apiProxy: false,
        baseUrl: 'http://api.example.com/v1',
      }),
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api-proxy/images/generations',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('does not add cache request headers that require extra CORS allow-list entries', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: 'aW1hZ2U=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await callImageApi({
      settings: withOpenAIProfile({
        apiKey: 'test-key',
        apiMode: 'images',
      }),
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    const [, init] = fetchMock.mock.calls[0]
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers).not.toHaveProperty('Pragma')
    expect(headers).not.toHaveProperty('Cache-Control')
    expect((init as RequestInit).cache).toBe('no-store')
  })

  it('ignores stored API proxy settings when the current deployment has no proxy', async () => {
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'false')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: 'aW1hZ2U=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await callImageApi({
      settings: withOpenAIProfile({
        apiKey: 'test-key',
        apiMode: 'images',
        apiProxy: true,
        baseUrl: 'http://api.example.com/v1',
      }),
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.example.com/v1/images/generations',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('polls custom async tasks immediately and keeps polling after transient network errors', async () => {
    vi.useFakeTimers()
    const onCustomTaskEnqueued = vi.fn()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ task_id: 'task-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          status: 'SUCCESS',
          data: {
            data: [{ b64_json: 'aW1hZ2U=' }],
          },
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))

    const promise = callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        baseUrl: 'https://api.example.com/v1',
        customProviders: [{
          id: 'custom-async',
          name: 'Custom Async',
          template: 'http-image',
          submit: {
            path: 'images/generations',
            method: 'POST',
            contentType: 'json',
            query: { async: 'true' },
            body: { model: '$profile.model', prompt: '$prompt' },
            taskIdPath: 'task_id',
          },
          poll: {
            path: 'images/tasks/{task_id}',
            method: 'GET',
            intervalSeconds: 1,
            statusPath: 'data.status',
            successValues: ['SUCCESS'],
            failureValues: ['FAILURE'],
            errorPath: 'data.fail_reason',
            result: {
              imageUrlPaths: ['data.data.data.*.url'],
              b64JsonPaths: ['data.data.data.*.b64_json'],
            },
          },
        }],
        profiles: [{
          ...DEFAULT_SETTINGS.profiles[0],
          id: 'profile-custom',
          provider: 'custom-async',
          baseUrl: 'https://api.example.com/v1',
          apiKey: 'test-key',
          model: 'model',
          timeout: 60,
        }],
        activeProfileId: 'profile-custom',
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
      onCustomTaskEnqueued,
    })

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(onCustomTaskEnqueued).toHaveBeenCalledWith({ taskId: 'task-1' })
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.example.com/v1/images/tasks/task-1')
    await vi.advanceTimersByTimeAsync(1000)

    await expect(promise).resolves.toEqual({
      images: ['data:image/jpeg;base64,aW1hZ2U='],
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('does not apply submit timeout to custom async polling after receiving a task id', async () => {
    vi.useFakeTimers()
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ task_id: 'task-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { status: 'IN_PROGRESS' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          status: 'SUCCESS',
          data: {
            data: [{ b64_json: 'aW1hZ2U=' }],
          },
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))

    const promise = callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        baseUrl: 'https://api.example.com/v1',
        customProviders: [{
          id: 'custom-async',
          name: 'Custom Async',
          template: 'http-image',
          submit: {
            path: 'images/generations',
            method: 'POST',
            contentType: 'json',
            query: { async: 'true' },
            body: { model: '$profile.model', prompt: '$prompt' },
            taskIdPath: 'task_id',
          },
          poll: {
            path: 'images/tasks/{task_id}',
            method: 'GET',
            intervalSeconds: 5,
            statusPath: 'data.status',
            successValues: ['SUCCESS'],
            failureValues: ['FAILURE'],
            result: {
              b64JsonPaths: ['data.data.data.*.b64_json'],
            },
          },
        }],
        profiles: [{
          ...DEFAULT_SETTINGS.profiles[0],
          id: 'profile-custom',
          provider: 'custom-async',
          baseUrl: 'https://api.example.com/v1',
          apiKey: 'test-key',
          model: 'model',
          timeout: 1,
        }],
        activeProfileId: 'profile-custom',
        timeout: 1,
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    await vi.advanceTimersByTimeAsync(6000)

    await expect(promise).resolves.toEqual({
      images: ['data:image/jpeg;base64,aW1hZ2U='],
    })
  })
})
