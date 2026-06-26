import type { ApiProfile } from '../../types'
import {
  appendStreamingFormatHint,
  blobToDataUrl,
  createStreamAwareTimeoutController,
  fetchImageUrlAsDataUrl,
  getStreamIdleTimeoutMs,
  isHttpUrl,
} from '../api/imageApiShared'
import { parseModelList, type ApiConnectionTestResult } from '../api/apiConnection'
import { sanitizeProviderErrorMessage } from '../api/providerErrors'
import { getVideoModelPreset, normalizeVideoSecondsForPreset, normalizeVideoSizeForModel, supportsVideoReferenceImages } from './videoModels'

export type VideoGenerationConfig = {
  baseUrl: string
  apiKey: string
  model: string
  size: string
  resolution: string
  seconds: string
  timeout: number
  stream: boolean
}

export type GeneratedVideoAsset = {
  url: string
  dataUrl?: string
  mimeType: string
  bytes: number
}

export type VideoGenerationTask = {
  id: string
  model: string
  completedVideo?: GeneratedVideoAsset
}

export type VideoRequestOptions = {
  signal?: AbortSignal
}

export type VideoGenerationState =
  | { status: 'pending'; retryAfterMs?: number; progress?: number }
  | { status: 'completed'; video: GeneratedVideoAsset }
  | { status: 'failed'; error: string }

type VideoSubmitAttempt = {
  contentType: 'form' | 'json'
  body: BodyInit
}

const LOAD_RETRY_DELAYS_MS = [1500, 3000, 5000]

export function createVideoConfigFromProfile(profile: ApiProfile, patch: Partial<VideoGenerationConfig> = {}): VideoGenerationConfig {
  return {
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
    model: profile.model,
    size: '1280x720',
    resolution: '720p',
    seconds: '6',
    timeout: profile.timeout,
    stream: profile.streamImages ?? true,
    ...patch,
  }
}

export function buildVideoApiUrl(baseUrl: string, path: string) {
  const normalizedBase = (baseUrl.trim() || 'https://ai.cyanyi.com/v1').replace(/\/+$/, '')
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${normalizedBase}${normalizedPath}`
}

export async function createVideoGenerationTask(
  config: VideoGenerationConfig,
  prompt: string,
  references: string[] = [],
  options: VideoRequestOptions = {},
): Promise<VideoGenerationTask> {
  assertVideoConfig(config)
  const attempts = await buildVideoSubmitAttempts(config, prompt, references)
  let lastError = '视频任务创建失败'

  for (const attempt of attempts) {
    const headers: HeadersInit = {
      Authorization: `Bearer ${config.apiKey.trim()}`,
    }
    if (attempt.contentType === 'json') headers['Content-Type'] = 'application/json'

    const response = await fetchVideoWithLoadRetry(config, attempt, headers, options)
    if (response.ok) {
      if (isEventStreamResponse(response)) {
        const state = await parseVideoStreamResponse(response, config, options.signal)
        if (state.status === 'completed') {
          return {
            id: `stream-${Date.now().toString(36)}`,
            model: config.model.trim(),
            completedVideo: state.video,
          }
        }
        if (state.status === 'failed') throw new Error(state.error)
      }

      const payload = await response.json()
      const directVideo = await createVideoAssetFromPayload(payload, config, options.signal)
      if (directVideo) {
        return {
          id: getStringByKeys(payload, ['id', 'task_id', 'taskId']) || `direct-${Date.now().toString(36)}`,
          model: config.model.trim(),
          completedVideo: directVideo,
        }
      }

      const data = unwrapEnvelope<Record<string, unknown>>(payload, '视频接口没有返回任务 ID')
      const id = typeof data.id === 'string' ? data.id : ''
      if (!id) throw new Error('视频接口没有返回任务 ID')
      return { id, model: config.model.trim() }
    }

    lastError = await readApiError(response, '视频任务创建失败')
    if (!shouldRetryWithSimplerVideoPayload(lastError)) break
  }

  throw new Error(lastError)
}

async function fetchVideoWithLoadRetry(config: VideoGenerationConfig, attempt: VideoSubmitAttempt, headers: HeadersInit, options: VideoRequestOptions) {
  let response = await submitVideoRequest(config, attempt, headers, options)
  for (let retryIndex = 0; retryIndex < LOAD_RETRY_DELAYS_MS.length && shouldRetryVideoLoadResponse(response); retryIndex += 1) {
    await delay(LOAD_RETRY_DELAYS_MS[retryIndex], options.signal)
    response = await submitVideoRequest(config, attempt, headers, options)
  }
  return response
}

function submitVideoRequest(config: VideoGenerationConfig, attempt: VideoSubmitAttempt, headers: HeadersInit, options: VideoRequestOptions) {
  return fetchWithConfiguredTimeout(buildVideoApiUrl(config.baseUrl, '/videos'), {
    method: 'POST',
    headers,
    body: attempt.body,
  }, config, options)
}

function shouldRetryVideoLoadResponse(response: Response) {
  return response.status === 429 || response.status === 502 || response.status === 503 || response.status === 504
}

async function fetchWithConfiguredTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  config: Pick<VideoGenerationConfig, 'timeout'>,
  options: VideoRequestOptions,
) {
  const timeout = createStreamAwareTimeoutController(config.timeout)
  const abortFromCaller = () => timeout.abort(options.signal?.reason)
  if (options.signal?.aborted) timeout.abort(options.signal.reason)
  options.signal?.addEventListener('abort', abortFromCaller, { once: true })

  try {
    const response = await fetch(input, {
      ...init,
      signal: timeout.signal,
    })
    return response
  } finally {
    timeout.clear()
    options.signal?.removeEventListener('abort', abortFromCaller)
  }
}

function isEventStreamResponse(response: Response) {
  return response.headers.get('Content-Type')?.toLowerCase().includes('text/event-stream') ?? false
}

export async function pollVideoGenerationTask(config: VideoGenerationConfig, task: VideoGenerationTask, options: VideoRequestOptions = {}): Promise<VideoGenerationState> {
  if (task.completedVideo) return { status: 'completed', video: task.completedVideo }
  assertVideoConfig({ ...config, model: task.model || config.model })
  const response = await fetchWithConfiguredTimeout(buildVideoApiUrl(config.baseUrl, `/videos/${encodeURIComponent(task.id)}`), {
    headers: {
      Authorization: `Bearer ${config.apiKey.trim()}`,
    },
    cache: 'no-store',
  }, config, options)
  if (!response.ok) throw new Error(await readApiError(response, '视频任务查询失败'))
  if (isEventStreamResponse(response)) return parseVideoStreamResponse(response, config, options.signal)
  const payload = await response.json()
  const data = unwrapEnvelope<Record<string, unknown>>(payload, '视频接口没有返回任务状态')
  const status = typeof data.status === 'string' ? data.status.toLowerCase() : ''
  if (status === 'failed' || status === 'cancelled') {
    const error = data.error && typeof data.error === 'object'
      ? (data.error as Record<string, unknown>).message
      : undefined
    const message = typeof error === 'string' && error.trim() ? error : '视频生成失败'
    return { status: 'failed', error: sanitizeProviderErrorMessage(message) }
  }
  if (status !== 'completed') return { status: 'pending', retryAfterMs: getRetryAfterMs(data), progress: getProgress(data) }

  const directVideo = await createVideoAssetFromPayload(data, config, options.signal)
  if (directVideo) return { status: 'completed', video: directVideo }

  const contentResponse = await fetchWithConfiguredTimeout(buildVideoApiUrl(config.baseUrl, `/videos/${encodeURIComponent(task.id)}/content`), {
    headers: {
      Authorization: `Bearer ${config.apiKey.trim()}`,
    },
    cache: 'no-store',
  }, config, options)
  if (!contentResponse.ok) throw new Error(await readApiError(contentResponse, '视频下载失败'))
  const blob = await contentResponse.blob()
  await assertVideoBlob(blob)
  return {
    status: 'completed',
    video: {
      url: URL.createObjectURL(blob),
      dataUrl: await blobToDataUrl(blob, blob.type || 'video/mp4'),
      mimeType: blob.type || 'video/mp4',
      bytes: blob.size,
    },
  }
}

async function buildVideoSubmitAttempts(
  config: VideoGenerationConfig,
  prompt: string,
  references: string[],
): Promise<VideoSubmitAttempt[]> {
  const model = config.model.trim()
  const normalizedPrompt = prompt.trim()
  const size = normalizeVideoSizeForModel(config.model, config.size)
  const resolution = normalizeVideoResolutionForModel(config.model, config.resolution)
  const seconds = normalizeVideoSecondsForModel(config.model, config.seconds)
  const usableReferences = supportsVideoReferenceImages(config.model) ? references : []
  const files = await Promise.all(usableReferences.slice(0, 7).map((dataUrl, index) => dataUrlToFile(dataUrl, `reference-${index + 1}.png`)))
  const attempts: VideoSubmitAttempt[] = []

  if (config.stream) {
    attempts.push({
      contentType: 'form',
      body: buildFormBody([
        ['model', model],
        ['prompt', normalizedPrompt],
        ['seconds', seconds],
        ['duration', seconds],
        ['size', size],
        ['resolution', resolution],
        ['resolution_name', resolution],
        ['preset', 'normal'],
        ['stream', 'true'],
      ], files),
    })
    attempts.push({
      contentType: 'form',
      body: buildFormBody([
        ['model', model],
        ['prompt', normalizedPrompt],
        ['seconds', seconds],
        ['size', size],
        ['stream', 'true'],
      ], files),
    })
    attempts.push({
      contentType: 'form',
      body: buildFormBody([
        ['model', model],
        ['prompt', normalizedPrompt],
        ['stream', 'true'],
      ], files),
    })
  }

  attempts.push({
    contentType: 'form',
    body: buildFormBody([
      ['model', model],
      ['prompt', normalizedPrompt],
      ['seconds', seconds],
      ['duration', seconds],
      ['size', size],
      ['resolution', resolution],
      ['resolution_name', resolution],
      ['preset', 'normal'],
    ], files),
  })

  attempts.push({
    contentType: 'form',
    body: buildFormBody([
      ['model', model],
      ['prompt', normalizedPrompt],
      ['seconds', seconds],
      ['size', size],
    ], files),
  })

  attempts.push({
    contentType: 'form',
    body: buildFormBody([
      ['model', model],
      ['prompt', normalizedPrompt],
    ], files),
  })

  if (!files.length) {
    if (config.stream) {
      attempts.push({
        contentType: 'json',
        body: JSON.stringify({
          model,
          prompt: normalizedPrompt,
          seconds,
          size,
          resolution,
          stream: true,
        }),
      })
    }
    attempts.push({
      contentType: 'json',
      body: JSON.stringify({
        model,
        prompt: normalizedPrompt,
        seconds,
        size,
        resolution,
      }),
    })
    attempts.push({
      contentType: 'json',
      body: JSON.stringify({
        model,
        prompt: normalizedPrompt,
      }),
    })
  }

  return attempts
}

function buildFormBody(entries: Array<[string, string]>, files: File[]) {
  const body = new FormData()
  for (const [key, value] of entries) body.append(key, value)
  for (const file of files) {
    body.append('input_reference[]', file)
    body.append('image[]', file)
  }
  return body
}

async function parseVideoStreamResponse(
  response: Response,
  config: VideoGenerationConfig,
  signal?: AbortSignal,
): Promise<VideoGenerationState> {
  if (!response.body) throw new Error('视频接口未返回可读取的流式响应')
  const timeout = createStreamAwareTimeoutController(config.timeout)
  timeout.useIdleTimeout(getStreamIdleTimeoutMs(config.timeout))
  const abortFromCaller = () => timeout.abort(signal?.reason)
  if (signal?.aborted) timeout.abort(signal.reason)
  signal?.addEventListener('abort', abortFromCaller, { once: true })

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let sawData = false
  let lastVideo: GeneratedVideoAsset | null = null
  let failure: string | null = null
  const cancelReader = () => {
    void reader.cancel().catch(() => undefined)
  }
  timeout.signal.addEventListener('abort', cancelReader, { once: true })

  const processBlock = async (block: string) => {
    const data = parseServerSentEventBlock(block)
    if (!data) return
    sawData = true

    let event: unknown
    try {
      event = JSON.parse(data)
    } catch {
      const markdownVideo = extractVideoUrlFromText(data)
      if (markdownVideo) lastVideo = await createVideoAssetFromUrl(markdownVideo, signal)
      else throw new Error(appendStreamingFormatHint(data))
      return
    }

    const error = getStreamErrorMessage(event)
    if (error) {
      failure = error
      return
    }

    const video = await createVideoAssetFromPayload(event, config, signal)
    if (video) lastVideo = video
  }

  try {
    while (true) {
      if (timeout.signal.aborted) throwAbortReason(timeout.signal)
      const { value, done } = await reader.read()
      if (timeout.signal.aborted) throwAbortReason(timeout.signal)
      if (done) break
      timeout.refresh()
      buffer += decoder.decode(value, { stream: true })

      let separatorIndex = buffer.search(/\r?\n\r?\n/)
      while (separatorIndex >= 0) {
        const block = buffer.slice(0, separatorIndex)
        const separator = buffer.match(/\r?\n\r?\n/)?.[0] ?? '\n\n'
        buffer = buffer.slice(separatorIndex + separator.length)
        await processBlock(block)
        separatorIndex = buffer.search(/\r?\n\r?\n/)
      }
    }

    buffer += decoder.decode()
    if (buffer.trim()) await processBlock(buffer)
  } finally {
    timeout.clear()
    signal?.removeEventListener('abort', abortFromCaller)
    timeout.signal.removeEventListener('abort', cancelReader)
  }

  if (lastVideo) return { status: 'completed', video: lastVideo }
  if (failure) return { status: 'failed', error: sanitizeProviderErrorMessage(failure) }
  if (!sawData) throw new Error(appendStreamingFormatHint('未从视频流式响应中解析到有效 data 事件'))
  return { status: 'pending' }
}

function parseServerSentEventBlock(block: string): string | null {
  const dataLines: string[] = []
  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue
    if (!line.startsWith('data:')) continue
    dataLines.push(line.slice(5).replace(/^ /, ''))
  }
  const data = dataLines.join('\n').trim()
  if (!data || data === '[DONE]') return null
  return data
}

async function createVideoAssetFromPayload(
  payload: unknown,
  config: Pick<VideoGenerationConfig, 'baseUrl' | 'apiKey'>,
  signal?: AbortSignal,
): Promise<GeneratedVideoAsset | null> {
  const videoUrl = findVideoUrl(payload)
  if (videoUrl) return createVideoAssetFromUrl(resolveVideoUrl(config.baseUrl, videoUrl), signal, config.apiKey)

  const output = getStringByKeys(payload, ['output', 'content', 'text'])
  const markdownVideo = output ? extractVideoUrlFromText(output) : ''
  if (markdownVideo) return createVideoAssetFromUrl(resolveVideoUrl(config.baseUrl, markdownVideo), signal, config.apiKey)

  const b64 = getStringByKeys(payload, ['b64_json', 'base64', 'video_base64', 'video_b64', 'data'])
  if (b64 && !/^https?:\/\//i.test(b64) && !b64.startsWith('data:')) {
    return {
      url: '',
      dataUrl: `data:video/mp4;base64,${b64}`,
      mimeType: 'video/mp4',
      bytes: estimateBase64Bytes(b64),
    }
  }

  return null
}

async function createVideoAssetFromUrl(url: string, signal?: AbortSignal, apiKey?: string): Promise<GeneratedVideoAsset> {
  try {
    const response = await fetch(url, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey.trim()}` } : undefined,
      cache: 'no-store',
      signal,
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const blob = await response.blob()
    await assertVideoBlob(blob)
    return {
      url,
      dataUrl: await blobToDataUrl(blob, blob.type || 'video/mp4'),
      mimeType: blob.type || 'video/mp4',
      bytes: blob.size,
    }
  } catch {
    return {
      url,
      mimeType: guessVideoMime(url),
      bytes: 0,
    }
  }
}

function findVideoUrl(value: unknown): string {
  if (!value) return ''
  if (typeof value === 'string') {
    if (isLikelyVideoUrl(value)) return value
    return extractVideoUrlFromText(value)
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findVideoUrl(item)
      if (found) return found
    }
    return ''
  }
  if (typeof value !== 'object') return ''

  const record = value as Record<string, unknown>
  for (const key of ['video_url', 'videoUrl', 'url', 'download_url', 'downloadUrl', 'file_url', 'fileUrl']) {
    const found = findVideoUrl(record[key])
    if (found) return found
  }
  for (const key of ['data', 'result', 'output', 'video', 'videos', 'content', 'choices', 'message', 'delta']) {
    const found = findVideoUrl(record[key])
    if (found) return found
  }
  return ''
}

function getStringByKeys(value: unknown, keys: string[]) {
  if (!value || typeof value !== 'object') return ''
  const record = value as Record<string, unknown>
  for (const key of keys) {
    const item = record[key]
    if (typeof item === 'string' && item.trim()) return item.trim()
  }
  return ''
}

function getRetryAfterMs(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  for (const key of ['retry_after_ms', 'retryAfterMs', 'poll_after_ms', 'pollAfterMs']) {
    const raw = record[key]
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return Math.min(raw, 60_000)
    if (typeof raw === 'string') {
      const parsed = Number(raw)
      if (Number.isFinite(parsed) && parsed > 0) return Math.min(parsed, 60_000)
    }
  }
  for (const key of ['retry_after', 'retryAfter', 'poll_after', 'pollAfter']) {
    const raw = record[key]
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return Math.min(raw * 1000, 60_000)
    if (typeof raw === 'string') {
      const parsed = Number(raw)
      if (Number.isFinite(parsed) && parsed > 0) return Math.min(parsed * 1000, 60_000)
    }
  }
  return undefined
}

function getProgress(value: unknown): number | undefined {
  if (!value) return undefined
  if (Array.isArray(value)) {
    for (const item of value) {
      const progress = getProgress(item)
      if (progress != null) return progress
    }
    return undefined
  }
  if (typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  for (const key of ['progress', 'percent', 'percentage', 'progress_percent', 'progressPercent']) {
    const raw = record[key]
    if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, Math.min(100, Math.round(raw)))
    if (typeof raw === 'string') {
      const parsed = Number(raw.replace('%', '').trim())
      if (Number.isFinite(parsed)) return Math.max(0, Math.min(100, Math.round(parsed)))
    }
  }
  for (const key of ['data', 'result', 'task', 'output']) {
    const progress = getProgress(record[key])
    if (progress != null) return progress
  }
  return undefined
}

function extractVideoUrlFromText(text: string) {
  const markdown = text.match(/!?\[[^\]]*]\((https?:\/\/[^)\s]+\.(?:mp4|webm|mov|m4v)(?:\?[^)\s]*)?)\)/i)
  if (markdown?.[1]) return markdown[1]
  const direct = text.match(/https?:\/\/[^\s"'<>)]*\.(?:mp4|webm|mov|m4v)(?:\?[^\s"'<>)]*)?/i)
  return direct?.[0] ?? ''
}

function isLikelyVideoUrl(value: string) {
  return /^https?:\/\//i.test(value) && /\.(?:mp4|webm|mov|m4v)(?:\?|$)/i.test(value)
}

function resolveVideoUrl(baseUrl: string, url: string) {
  if (/^https?:\/\//i.test(url)) return url
  return buildVideoApiUrl(baseUrl, url)
}

function guessVideoMime(url: string) {
  if (/\.webm(?:\?|$)/i.test(url)) return 'video/webm'
  if (/\.mov(?:\?|$)/i.test(url)) return 'video/quicktime'
  if (/\.m4v(?:\?|$)/i.test(url)) return 'video/x-m4v'
  return 'video/mp4'
}

function estimateBase64Bytes(value: string) {
  const payload = value.includes(',') ? value.slice(value.indexOf(',') + 1) : value
  const normalized = payload.replace(/\s/g, '')
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding)
}

function getStreamErrorMessage(value: unknown) {
  if (!value || typeof value !== 'object') return ''
  const record = value as Record<string, unknown>
  const error = record.error
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const message = (error as Record<string, unknown>).message
    if (typeof message === 'string') return message
  }
  const type = typeof record.type === 'string' ? record.type : ''
  if (type.endsWith('.failed')) return getStringByKeys(record, ['message']) || '视频流式请求失败'
  return ''
}

function throwAbortReason(signal: AbortSignal): never {
  throw signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError')
}

function shouldRetryWithSimplerVideoPayload(message: string) {
  const lower = message.toLowerCase()
  return /param|parameter|unsupported|invalid|unknown|format|field|resolution|duration|seconds|size|preset|content-type|multipart|json/.test(lower) ||
    /参数|字段|格式|不支持|无效|未知|分辨率|秒数|尺寸/.test(message)
}

function assertVideoConfig(config: VideoGenerationConfig) {
  if (!config.baseUrl.trim()) throw new Error('请先填写 Base URL')
  if (!config.apiKey.trim()) throw new Error('请先填写 API Key')
  if (!config.model.trim()) throw new Error('请先填写视频模型')
}

function normalizeVideoSecondsForModel(model: string, value: string) {
  const preset = getVideoModelPreset(model)
  if (preset.seconds) return preset.seconds
  return normalizeVideoSecondsForPreset(model, value)
}

function normalizeVideoResolutionForModel(model: string, value: string) {
  const preset = getVideoModelPreset(model)
  if (preset.resolution) return preset.resolution
  if (value === '480' || value === '480p' || value === 'low') return '480p'
  if (value === '1080' || value === '1080p') return '1080p'
  return '720p'
}

function unwrapEnvelope<T>(payload: unknown, emptyMessage: string): T {
  if (!payload || typeof payload !== 'object') throw new Error(emptyMessage)
  const record = payload as Record<string, unknown>
  if (typeof record.code === 'number') {
    if (record.code !== 0) throw new Error(sanitizeProviderErrorMessage(typeof record.msg === 'string' ? record.msg : '请求失败'))
    if (!record.data) throw new Error(emptyMessage)
    return record.data as T
  }
  return payload as T
}

async function readApiError(response: Response, fallback: string) {
  try {
    const payload = await response.json() as { error?: { message?: string }; msg?: string; message?: string }
    return sanitizeProviderErrorMessage(payload.msg || payload.message || payload.error?.message || statusMessage(response.status, fallback))
  } catch {
    return sanitizeProviderErrorMessage(statusMessage(response.status, fallback))
  }
}

function statusMessage(status: number, fallback: string) {
  if (status === 401 || status === 403) return '鉴权失败，请检查 API Key、套餐权限或模型权限'
  if (status === 429) return '请求被限流或额度不足，请稍后重试'
  return `${fallback}（${status}）`
}

async function assertVideoBlob(blob: Blob) {
  if (!blob.type.includes('json')) return
  try {
    const payload = JSON.parse(await blob.text()) as { code?: number; msg?: string; error?: { message?: string } }
    if (typeof payload.code === 'number' && payload.code !== 0) throw new Error(sanitizeProviderErrorMessage(payload.msg || '视频下载失败'))
    if (payload.error?.message) throw new Error(sanitizeProviderErrorMessage(payload.error.message))
  } catch (error) {
    if (error instanceof Error) throw error
  }
}

async function dataUrlToFile(dataUrl: string, filename: string) {
  const response = await fetch(dataUrl)
  const blob = await response.blob()
  const mime = blob.type || dataUrl.match(/^data:([^;,]+)/)?.[1] || 'image/png'
  return new File([blob], filename, { type: mime })
}

export async function testVideoApiConnection(config: Pick<VideoGenerationConfig, 'baseUrl' | 'apiKey'>, options: VideoRequestOptions = {}): Promise<ApiConnectionTestResult> {
  if (!config.baseUrl.trim()) throw new Error('请先填写 Base URL')
  if (!config.apiKey.trim()) throw new Error('请先填写 API Key')
  const response = await fetch(buildVideoApiUrl(config.baseUrl, '/models'), {
    headers: {
      Authorization: `Bearer ${config.apiKey.trim()}`,
    },
    cache: 'no-store',
    signal: options.signal,
  })
  if (!response.ok) throw new Error(await readApiError(response, '连接测试失败'))
  return {
    models: parseModelList(await response.json().catch(() => null)),
  }
}

function delay(ms: number, signal?: AbortSignal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    }, { once: true })
  })
}
