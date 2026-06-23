import { afterEach, describe, expect, it, vi } from 'vitest'
import { createVideoGenerationTask, type VideoGenerationConfig } from './videoApi'

const config: VideoGenerationConfig = {
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'test-key',
  model: 'doubao-seedance-2.0-fast-1080p',
  size: '720x1280',
  resolution: '720p',
  seconds: '6',
}

describe('videoApi', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('retries with a simpler payload when video params are rejected', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'unsupported parameter: resolution_name' }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'video-task-1' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createVideoGenerationTask(config, '生成视频')).resolves.toEqual({
      id: 'video-task-1',
      model: 'doubao-seedance-2.0-fast-1080p',
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const firstBody = fetchMock.mock.calls[0][1].body as FormData
    const secondBody = fetchMock.mock.calls[1][1].body as FormData
    expect(firstBody.has('resolution_name')).toBe(true)
    expect(secondBody.has('resolution_name')).toBe(false)
    expect(secondBody.has('model')).toBe(true)
    expect(secondBody.has('prompt')).toBe(true)
  })

  it('normalizes unsupported sora-2 sizes before submitting', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'video-task-2' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createVideoGenerationTask({
      ...config,
      model: 'sora-2',
      size: '1024x1792',
    }, '生成视频')).resolves.toEqual({
      id: 'video-task-2',
      model: 'sora-2',
    })

    const body = fetchMock.mock.calls[0][1].body as FormData
    expect(body.get('size')).toBe('1280x720')
  })

  it('retries temporary load failures before failing the request', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'system under load' }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'video-task-3' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const promise = createVideoGenerationTask(config, '生成视频')
    await vi.advanceTimersByTimeAsync(1500)

    await expect(promise).resolves.toEqual({
      id: 'video-task-3',
      model: 'doubao-seedance-2.0-fast-1080p',
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
