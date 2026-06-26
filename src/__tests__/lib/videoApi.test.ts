import { afterEach, describe, expect, it, vi } from 'vitest'
import { createVideoGenerationTask, pollVideoGenerationTask, type VideoGenerationConfig } from '../../lib/video/videoApi'

const config: VideoGenerationConfig = {
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'test-key',
  model: 'doubao-seedance-2.0-fast-1080p',
  size: '720x1280',
  resolution: '720p',
  seconds: '6',
  timeout: 900,
  stream: true,
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

  it('requests video streams and resolves streamed video links directly', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response([
        'data: {"status":"completed","video_url":"https://cdn.example.com/result.mp4"}',
        '',
        'data: [DONE]',
        '',
      ].join('\n'), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }))
      .mockResolvedValueOnce(new Response(new Blob([Uint8Array.from([1, 2, 3])], { type: 'video/mp4' }), {
        status: 200,
        headers: { 'Content-Type': 'video/mp4' },
      }))
    vi.stubGlobal('fetch', fetchMock)

    const task = await createVideoGenerationTask(config, '生成视频')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect((fetchMock.mock.calls[0][1].body as FormData).get('stream')).toBe('true')
    expect(task.completedVideo).toMatchObject({
      url: 'https://cdn.example.com/result.mp4',
      dataUrl: 'data:video/mp4;base64,AQID',
      mimeType: 'video/mp4',
      bytes: 3,
    })
  })

  it('uses direct completed poll video URLs before falling back to content download', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'completed',
        video_url: 'https://cdn.example.com/result.mp4',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(new Blob([Uint8Array.from([4, 5])], { type: 'video/mp4' }), {
        status: 200,
        headers: { 'Content-Type': 'video/mp4' },
      }))
    vi.stubGlobal('fetch', fetchMock)

    const state = await pollVideoGenerationTask(config, {
      id: 'video-task-4',
      model: config.model,
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.com/v1/videos/video-task-4')
    expect(fetchMock.mock.calls[1][0]).toBe('https://cdn.example.com/result.mp4')
    expect(state).toMatchObject({
      status: 'completed',
      video: {
        url: 'https://cdn.example.com/result.mp4',
        dataUrl: 'data:video/mp4;base64,BAU=',
        bytes: 2,
      },
    })
  })

  it('returns JSON polling retry hints when the video task is still pending', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'processing',
        retry_after: 7,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(pollVideoGenerationTask(config, {
      id: 'video-task-5',
      model: config.model,
    })).resolves.toEqual({
      status: 'pending',
      retryAfterMs: 7000,
    })
  })

  it('returns JSON polling progress when the video task is still running', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'queued',
        progress: 75,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(pollVideoGenerationTask(config, {
      id: 'video-task-6',
      model: config.model,
    })).resolves.toEqual({
      status: 'pending',
      progress: 75,
    })
  })
})
