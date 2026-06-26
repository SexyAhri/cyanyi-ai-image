import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../../types'
import { createDefaultGeminiProfile, createDefaultOpenAIProfile, DEFAULT_SETTINGS } from '../../lib/api/apiProfiles'
import { callAgentConversationTitleApi, callAgentResponsesApi, callBatchImageSingle } from '../../lib/agent/agentApi'

describe('callAgentResponsesApi', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('streams Agent text and uses app function tools for image generation', async () => {
    const streamBody = [
      'data: {"type":"response.output_text.delta","delta":"Hel"}',
      '',
      'data: {"type":"response.output_text.delta","delta":"lo"}',
      '',
      'data: {"type":"response.completed","response":{"id":"resp_1","output":[{"type":"message","content":[{"type":"output_text","text":"Hello"}]},{"type":"image_generation_call","id":"ig_1","result":"ZmluYWw=","size":"1024x1024"}]}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(streamBody, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))
    const textDeltas: string[] = []
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
      streamImages: true,
      streamPartialImages: 2,
    })

    const result = await callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'prompt' }] }],
      onTextDelta: (delta) => textDeltas.push(delta),
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.stream).toBe(true)
    expect(body.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'function', name: 'generate_image' }),
      expect.objectContaining({ type: 'function', name: 'generate_image_batch' }),
    ]))
    expect(body.tools).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'image_generation' }),
    ]))
    expect(textDeltas).toEqual(['Hel', 'lo'])
    expect(result).toMatchObject({
      responseId: 'resp_1',
      text: 'Hello',
      images: [{ toolCallId: 'ig_1', dataUrl: 'data:image/jpeg;base64,ZmluYWw=' }],
    })
  })

  it('reports failed image output item without aborting the ongoing stream', async () => {
    const streamBody = [
      'data: {"type":"response.output_item.added","item":{"id":"ig_fail","type":"image_generation_call","status":"in_progress"},"output_index":0}',
      '',
      'data: {"type":"response.output_item.done","item":{"id":"ig_fail","type":"image_generation_call","status":"failed","error":{"message":"safety rejected"}},"output_index":0}',
      '',
      'data: {"type":"response.output_text.delta","delta":"已跳过失败图片"}',
      '',
      'data: {"type":"response.completed","response":{"id":"resp_1","output":[{"id":"ig_fail","type":"image_generation_call","status":"failed","error":{"message":"safety rejected"}},{"type":"message","content":[{"type":"output_text","text":"已跳过失败图片"}]}]}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(streamBody, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))
    const failures: Array<{ toolCallId: string; error: string }> = []
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
      streamImages: true,
    })

    const result = await callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'prompt' }] }],
      onImageToolFailed: (event) => {
        failures.push(event)
      },
    })

    expect(failures).toEqual([{ toolCallId: 'ig_fail', error: 'safety rejected' }])
    expect(result).toMatchObject({
      responseId: 'resp_1',
      text: '已跳过失败图片',
      images: [],
    })
    expect(result.rawResponsePayload).toContain('resp_1')
  })

  it('falls back to non-streaming Agent responses when streaming is temporarily unavailable', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        message: '服务繁忙，请稍后重试',
      }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'resp_fallback',
        output: [{
          type: 'message',
          content: [{ type: 'output_text', text: '可以正常对话' }],
        }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
      streamImages: true,
      model: 'gpt-5.5',
    })

    const result = await callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: '你好' }] }],
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const firstBody = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    const secondBody = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))
    expect(firstBody.stream).toBe(true)
    expect(secondBody.stream).toBeUndefined()
    expect(secondBody.tools).toBeDefined()
    expect(result.text).toBe('可以正常对话')
  })

  it('falls back to text-only chat when tool requests keep returning NewAPI upstream errors', async () => {
    const upstreamError = {
      error: {
        message: 'openai_error',
        type: 'bad_response_status_code',
        code: 'bad_response_status_code',
        param: '524',
      },
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(upstreamError), {
        status: 524,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify(upstreamError), {
        status: 524,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'resp_text_only',
        output: [{
          type: 'message',
          content: [{ type: 'output_text', text: '这里有几条提示词示例。' }],
        }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
      streamImages: true,
      model: 'gpt-5.5',
    })

    const result = await callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: '给点提示词看看' }] }],
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    const firstBody = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    const secondBody = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))
    const thirdBody = JSON.parse(String((fetchMock.mock.calls[2][1] as RequestInit).body))
    expect(firstBody.stream).toBe(true)
    expect(firstBody.tools).toBeDefined()
    expect(secondBody.stream).toBeUndefined()
    expect(secondBody.tools).toBeDefined()
    expect(thirdBody.stream).toBeUndefined()
    expect(thirdBody.tools).toBeUndefined()
    expect(result.text).toBe('这里有几条提示词示例。')
  })

  it('does not fall back to text-only chat when disabled for media requests', async () => {
    const upstreamError = {
      error: {
        message: 'Upstream service temporarily unavailable',
        type: 'upstream_error',
      },
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(upstreamError), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify(upstreamError), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      }))
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
      streamImages: true,
      model: 'gpt-5.5',
    })

    await expect(callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: '生成一张测试图片' }] }],
      allowTextOnlyFallback: false,
    })).rejects.toThrow(/temporarily unavailable/i)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const firstBody = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    const secondBody = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))
    expect(firstBody.tools).toBeDefined()
    expect(secondBody.tools).toBeDefined()
  })

  it('sends plain Agent chat without media tools when tools mode is none', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      id: 'resp_plain',
      output: [{
        type: 'message',
        content: [{ type: 'output_text', text: '你好，有什么可以帮你？' }],
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
      streamImages: true,
      model: 'gpt-5.5',
    })

    const result = await callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: '你好' }] }],
      toolsMode: 'none',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(body.stream).toBe(true)
    expect(body.tools).toBeUndefined()
    expect(result.text).toBe('你好，有什么可以帮你？')
  })

  it('does not send mask data through the Agent planning request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{
        type: 'message',
        content: [{ type: 'output_text', text: 'OK' }],
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
    })

    await callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'edit' }] }],
      maskDataUrl: 'data:image/png;base64,bWFzaw==',
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(JSON.stringify(body.tools)).not.toContain('input_image_mask')
    expect(body.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'function', name: 'generate_image' }),
    ]))
  })

  it('extracts image_generation results from base64 object fields', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{
        type: 'image_generation_call',
        id: 'ig_base64',
        result: { base64: 'ZmlsZQ==' },
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
    })

    const result = await callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'prompt' }] }],
    })

    expect(result.images).toEqual([{
      toolCallId: 'ig_base64',
      dataUrl: 'data:image/jpeg;base64,ZmlsZQ==',
      actualParams: {},
    }])
  })

  it('extracts image_generation results even when compatible providers keep status as generating', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      id: 'resp_with_generating_result',
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: '已生成一张测试图片。' }],
        },
        {
          type: 'image_generation_call',
          id: 'ig_generating',
          status: 'generating',
          result: 'ZmlsZQ==',
          output_format: 'png',
        },
      ],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
    })

    const result = await callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: '生成一张测试图片' }] }],
    })

    expect(result.images).toEqual([{
      toolCallId: 'ig_generating',
      dataUrl: 'data:image/png;base64,ZmlsZQ==',
      actualParams: { output_format: 'png' },
    }])
  })

  it('falls back to Agent conversation model when the selected profile model is image-only', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{
        type: 'message',
        content: [{ type: 'output_text', text: 'OK' }],
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
      model: 'gpt-image-2',
    })

    await callAgentResponsesApi({
      settings: { ...DEFAULT_SETTINGS, agentModel: 'gpt-5.5' },
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: '生成一张测试图片' }] }],
    })

    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(body.model).toBe('gpt-5.5')
  })

  it('uses the selected Agent profile model when it is text-capable', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{
        type: 'message',
        content: [{ type: 'output_text', text: 'OK' }],
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
      model: 'agent-model',
    })

    await callAgentResponsesApi({
      settings: { ...DEFAULT_SETTINGS, agentModel: 'fallback-agent-model' },
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: '你好' }] }],
    })

    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(body.model).toBe('agent-model')
  })

  it('stops reading a stream when the caller aborts after output starts', async () => {
    const streamBody = [
      'data: {"type":"response.output_text.delta","delta":"Hel"}',
      '',
      '',
    ].join('\n')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(streamBody))
        controller.close()
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))
    const textDeltas: string[] = []
    const abortController = new AbortController()
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
      streamImages: true,
    })

    await expect(callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'prompt' }] }],
      signal: abortController.signal,
      onTextDelta: (delta) => {
        textDeltas.push(delta)
        abortController.abort()
      },
    })).rejects.toMatchObject({ name: 'AbortError' })

    expect(textDeltas).toEqual(['Hel'])
  })

  it('generates a short conversation title without image tools', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{
        type: 'message',
        content: [{ type: 'output_text', text: '<title>生成猫咪头像</title>' }],
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
      streamImages: true,
    })

    const title = await callAgentConversationTitleApi({
      settings: DEFAULT_SETTINGS,
      profile,
      prompt: '帮我生成一张橘猫头像，要赛博朋克风格',
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.instructions).toContain('<title>short title</title>')
    expect(body.tools).toBeUndefined()
    expect(body.stream).toBeUndefined()
    expect(body.input[0].content[0].text).toContain('帮我生成一张橘猫头像，要赛博朋克风格')
    expect(title).toBe('生成猫咪头像')
  })

  it('requests web search and applies citations', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      id: 'resp_search',
      output: [
        {
          type: 'web_search_call',
          id: 'ws_1',
          status: 'completed',
          action: { type: 'search', query: 'OpenAI web search docs' },
        },
        {
          type: 'message',
          content: [{
            type: 'output_text',
            text: 'See OpenAI docs.',
            annotations: [{
              type: 'url_citation',
              start_index: 4,
              end_index: 15,
              url: 'https://platform.openai.com/docs',
              title: 'OpenAI Docs',
            }],
          }],
        },
      ],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
    })

    const result = await callAgentResponsesApi({
      settings: { ...DEFAULT_SETTINGS, agentWebSearch: true },
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'prompt' }] }],
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.tools).toEqual(expect.arrayContaining([{ type: 'web_search' }]))
    expect(result.text).toBe('See [OpenAI docs](https://platform.openai.com/docs).')
    expect(result.outputItems?.[0]).toMatchObject({ type: 'web_search_call', status: 'completed' })
  })

  it('injects configurable math formatting instructions', async () => {
    const createResponse = () => new Response(JSON.stringify({
      output: [{
        type: 'message',
        content: [{ type: 'output_text', text: 'OK' }],
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => createResponse())
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
    })

    await callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'prompt' }] }],
    })

    let body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(body.instructions).toContain('## Math formatting')
    expect(body.instructions).toContain('Use `$...$` for inline formulas.')

    await callAgentResponsesApi({
      settings: { ...DEFAULT_SETTINGS, agentMathFormattingPrompt: false },
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'prompt' }] }],
    })

    body = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))
    expect(body.instructions).not.toContain('## Math formatting')
  })

  it('uses app function tools when Agent image generation is routed to an external profile', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{
        type: 'message',
        content: [{ type: 'output_text', text: 'OK' }],
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    const agentProfile = createDefaultOpenAIProfile({
      id: 'agent-responses',
      apiKey: 'agent-key',
      apiMode: 'responses',
      model: 'agent-model',
    })
    const imageProfile = createDefaultGeminiProfile({
      id: 'banana-image',
      apiKey: 'banana-key',
      baseUrl: 'https://ai.example.com/pg',
      model: 'nano-banana-2',
    })

    await callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile: agentProfile,
      imageProfile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'draw one image' }] }],
    })

    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(body.model).toBe('agent-model')
    expect(body.model).not.toBe('nano-banana-2')
    expect(body.instructions).toContain('Use generate_image for a single requested image.')
    expect(body.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'function', name: 'generate_image' }),
      expect.objectContaining({ type: 'function', name: 'generate_image_batch' }),
    ]))
    expect(body.tools).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'image_generation' }),
    ]))
  })

  it('uses app function tools even when Agent image generation shares the same Responses profile', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{
        type: 'message',
        content: [{ type: 'output_text', text: 'OK' }],
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    const profile = createDefaultOpenAIProfile({
      id: 'shared-responses',
      apiKey: 'test-key',
      apiMode: 'responses',
      model: 'gpt-5.5',
    })

    await callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile,
      imageProfile: profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'draw one image' }] }],
    })

    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(body.instructions).toContain('Do not call the built-in image_generation tool')
    expect(body.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'function', name: 'generate_image' }),
    ]))
    expect(body.tools).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'image_generation' }),
    ]))
  })

  it('uses the image profile model for app-executed Responses image calls', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{
        type: 'image_generation_call',
        result: 'ZmluYWw=',
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    const imageProfile = createDefaultOpenAIProfile({
      id: 'agent-image-responses',
      apiKey: 'image-key',
      apiMode: 'responses',
      model: 'image2',
    })

    await callBatchImageSingle({
      settings: { ...DEFAULT_SETTINGS, agentModel: 'agent-brain-model' },
      profile: imageProfile,
      params: DEFAULT_PARAMS,
      batchItemId: 'image',
      prompt: 'draw one image',
      referenceImageDataUrls: [],
    })

    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(body.model).toBe('image2')
    expect(body.model).not.toBe('agent-brain-model')
  })

  it('uses the last streamed partial image for app-executed Responses image calls without a final result', async () => {
    const streamBody = [
      'data: {"type":"response.image_generation_call.partial_image","partial_image_index":0,"partial_image_b64":"cGFydGlhbA=="}',
      '',
      'data: [DONE]',
      '',
    ].join('\n')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(streamBody, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))
    const profile = createDefaultOpenAIProfile({
      apiKey: 'image-key',
      apiMode: 'responses',
      streamImages: true,
    })

    const result = await callBatchImageSingle({
      settings: DEFAULT_SETTINGS,
      profile,
      params: DEFAULT_PARAMS,
      batchItemId: 'image',
      prompt: 'draw one image',
      referenceImageDataUrls: [],
    })

    expect(result).toMatchObject({
      batchItemId: 'image',
      image: { dataUrl: 'data:image/jpeg;base64,cGFydGlhbA==' },
      error: null,
    })
  })

  it("does not duplicate the assistant message item when response.completed lacks an item id", async () => {
    // `response.completed` can repeat the streamed item without id; it should merge, not append.
    const itemId = "msg_abc123"
    const streamBody = [
      `data: {"type":"response.created","response":{"id":"resp_1","output":[]}}`,
      ``,
      `data: {"type":"response.output_item.added","item":{"id":"${itemId}","type":"message","status":"in_progress","content":[],"role":"assistant"}}`,
      ``,
      `data: {"type":"response.output_text.delta","delta":"hi","item_id":"${itemId}"}`,
      ``,
      `data: {"type":"response.output_text.delta","delta":"!","item_id":"${itemId}"}`,
      ``,
      `data: {"type":"response.output_item.done","item":{"id":"${itemId}","type":"message","status":"completed","content":[{"type":"output_text","text":"hi!"}],"role":"assistant"}}`,
      ``,
      `data: {"type":"response.completed","response":{"id":"resp_1","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"hi!"}]}]}}`,
      ``,
      `data: [DONE]`,
      ``,
    ].join("\n")
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(streamBody, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    }))
    const outputItemSnapshots: number[] = []
    const profile = createDefaultOpenAIProfile({
      apiKey: "test-key",
      apiMode: "responses",
      streamImages: true,
    })

    const result = await callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: "user", content: [{ type: "input_text", text: "hi" }] }],
      onOutputItems: (items) => outputItemSnapshots.push(items.length),
    })

    const messageItems = (result.outputItems ?? []).filter((item) => item.type === "message")
    expect(messageItems).toHaveLength(1)
    expect(result.text).toBe("hi!")
    expect(outputItemSnapshots[outputItemSnapshots.length - 1]).toBe(1)
  })
})
