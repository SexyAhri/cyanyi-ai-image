import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseModelList, testOpenAICompatibleConnection } from '../../lib/api/apiConnection'

describe('apiConnection', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('parses model ids and supported endpoint types from /models responses', () => {
    expect(parseModelList({
      data: [
        {
          id: 'gpt-image-2-4k',
          supported_endpoint_types: ['openai'],
        },
        {
          id: 'gpt-image-2',
          supported_endpoint_types: ['openai-response'],
        },
        {
          id: 'gpt-image-2',
          supported_endpoint_types: ['openai-response'],
        },
        {
          id: '',
          supported_endpoint_types: ['openai'],
        },
      ],
      object: 'list',
      success: true,
    })).toEqual([
      {
        id: 'gpt-image-2-4k',
        supportedEndpointTypes: ['openai'],
      },
      {
        id: 'gpt-image-2',
        supportedEndpointTypes: ['openai-response'],
      },
    ])
  })

  it('tests a minimal Responses text request for Responses API profiles', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ id: 'gpt-5.5', supported_endpoint_types: ['openai-response'] }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))

    await expect(testOpenAICompatibleConnection({
      baseUrl: 'https://ai.example.com/v1',
      apiKey: 'test-key',
      apiMode: 'responses',
      model: 'gpt-5.5',
    })).resolves.toEqual({
      models: [{ id: 'gpt-5.5', supportedEndpointTypes: ['openai-response'] }],
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toBe('https://ai.example.com/v1/models')
    expect(fetchMock.mock.calls[1][0]).toBe('https://ai.example.com/v1/responses')
    const body = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))
    expect(body).toMatchObject({
      model: 'gpt-5.5',
      max_output_tokens: 16,
    })
  })
})
