import type { ApiProfile } from '../types'
import { blobToDataUrl } from './imageApiShared'
import { sanitizeProviderErrorMessage } from './providerErrors'
import { getVideoModelPreset, normalizeVideoSecondsForPreset, normalizeVideoSizeForModel, supportsVideoReferenceImages } from './videoModels'

export type VideoGenerationConfig = {
  baseUrl: string
  apiKey: string
  model: string
  size: string
  resolution: string
  seconds: string
}

export type VideoGenerationTask = {
  id: string
  model: string
}

export type VideoRequestOptions = {
  signal?: AbortSignal
}

export type VideoGenerationState =
  | { status: 'pending' }
  | { status: 'completed'; video: { url: string; dataUrl?: string; mimeType: string; bytes: number } }
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
      const payload = await response.json()
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
  return fetch(buildVideoApiUrl(config.baseUrl, '/videos'), {
    method: 'POST',
    headers,
    body: attempt.body,
    signal: options.signal,
  })
}

function shouldRetryVideoLoadResponse(response: Response) {
  return response.status === 429 || response.status === 502 || response.status === 503 || response.status === 504
}

export async function pollVideoGenerationTask(config: VideoGenerationConfig, task: VideoGenerationTask, options: VideoRequestOptions = {}): Promise<VideoGenerationState> {
  assertVideoConfig({ ...config, model: task.model || config.model })
  const response = await fetch(buildVideoApiUrl(config.baseUrl, `/videos/${encodeURIComponent(task.id)}`), {
    headers: {
      Authorization: `Bearer ${config.apiKey.trim()}`,
    },
    cache: 'no-store',
    signal: options.signal,
  })
  if (!response.ok) throw new Error(await readApiError(response, '视频任务查询失败'))
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
  if (status !== 'completed') return { status: 'pending' }

  const contentResponse = await fetch(buildVideoApiUrl(config.baseUrl, `/videos/${encodeURIComponent(task.id)}/content`), {
    headers: {
      Authorization: `Bearer ${config.apiKey.trim()}`,
    },
    cache: 'no-store',
    signal: options.signal,
  })
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

export async function testVideoApiConnection(config: Pick<VideoGenerationConfig, 'baseUrl' | 'apiKey'>, options: VideoRequestOptions = {}) {
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
  return true
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
