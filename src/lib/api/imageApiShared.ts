import type { AppSettings, TaskParams } from '../../types'

export const MIME_MAP: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}

export const MAX_MASK_EDIT_FILE_BYTES = 50 * 1024 * 1024
export const MAX_IMAGE_INPUT_PAYLOAD_BYTES = 512 * 1024 * 1024

export interface CallApiOptions {
  settings: AppSettings
  prompt: string
  params: TaskParams
  /** 输入图片的 data URL 列表 */
  inputImageDataUrls: string[]
  maskDataUrl?: string
  onCustomTaskEnqueued?: (task: { taskId: string }) => void
  onPartialImage?: (partial: { image: string; partialImageIndex?: number; requestIndex?: number }) => void
}

export interface CallApiResult {
  /** base64 data URL 列表 */
  images: string[]
  /** API 返回的实际生效参数 */
  actualParams?: Partial<TaskParams>
  /** 每张图片对应的实际生效参数 */
  actualParamsList?: Array<Partial<TaskParams> | undefined>
  /** 每张图片对应的 API 改写提示词 */
  revisedPrompts?: Array<string | undefined>
  /** API 返回的原始图片 HTTP URL（非 base64 时记录） */
  rawImageUrls?: string[]
  /** 并发多图请求中失败的单张请求 */
  failedRequests?: Array<{ requestIndex: number; error: string }>
  /** 流缺少最终结果、用最后一张中间图兜底返回时为 true */
  partialFallback?: boolean
}

/** 流式空闲超时下限：20 分钟内只要还在收到数据就不判超时 */
export const MIN_STREAM_IDLE_TIMEOUT_MS = 1_200_000

/**
 * 把 profile.timeout（秒）换算为「空闲超时」毫秒数。
 * 与旧的「整段请求总超时」语义不同：这里是连续无数据的最长容忍时长，
 * 因此取 profile.timeout 与下限 1200 秒中的较大者，避免长图被误杀。
 */
export function getStreamIdleTimeoutMs(timeoutSeconds: number): number {
  const fromProfile = Math.max(0, timeoutSeconds) * 1000
  return Math.max(MIN_STREAM_IDLE_TIMEOUT_MS, fromProfile)
}

export interface IdleTimeoutController {
  signal: AbortSignal
  /** 收到新数据时调用，重置空闲计时器 */
  refresh: () => void
  /** 请求结束时调用，清除计时器 */
  clear: () => void
  /** 外部信号（用户停止等）需要中断时转发调用 */
  abort: (reason?: unknown) => void
}

/**
 * 创建「空闲超时」控制器：距上次 refresh 超过 idleMs 仍无新数据才 abort。
 * 流式读取每收到一个 chunk 就调用 refresh()，使活跃的流不会被墙钟超时误杀。
 */
export function createIdleTimeoutController(
  idleMs: number,
): IdleTimeoutController {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | null = null

  const arm = () => {
    timer = setTimeout(() => {
      timer = null
      controller.abort(
        new DOMException(
          `请求空闲超时：超过 ${Math.round(idleMs / 1000)} 秒未收到任何数据。`,
          'TimeoutError',
        ),
      )
    }, idleMs)
  }

  const clear = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  arm()

  return {
    signal: controller.signal,
    refresh: () => {
      if (controller.signal.aborted) return
      clear()
      arm()
    },
    clear,
    abort: (reason?: unknown) => {
      clear()
      controller.abort(reason)
    },
  }
}

export interface StreamAwareTimeoutController {
  signal: AbortSignal
  useIdleTimeout: (idleMs: number) => void
  refresh: () => void
  clear: () => void
  abort: (reason?: unknown) => void
}

export function createStreamAwareTimeoutController(
  timeoutSeconds: number,
): StreamAwareTimeoutController {
  const controller = new AbortController()
  const timeoutMs = Math.max(0, timeoutSeconds) * 1000
  let timeoutTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    timeoutTimer = null
    controller.abort(new DOMException(`Request timed out after ${timeoutSeconds} seconds.`, 'TimeoutError'))
  }, timeoutMs)
  let idle: IdleTimeoutController | null = null
  let forwardIdleAbort: (() => void) | null = null

  const clearTimeoutTimer = () => {
    if (!timeoutTimer) return
    clearTimeout(timeoutTimer)
    timeoutTimer = null
  }

  const clearIdle = () => {
    if (idle && forwardIdleAbort) {
      idle.signal.removeEventListener('abort', forwardIdleAbort)
    }
    idle?.clear()
    idle = null
    forwardIdleAbort = null
  }

  const clear = () => {
    clearTimeoutTimer()
    clearIdle()
  }

  return {
    signal: controller.signal,
    useIdleTimeout: (idleMs: number) => {
      if (controller.signal.aborted) return
      clearTimeoutTimer()
      clearIdle()
      idle = createIdleTimeoutController(idleMs)
      forwardIdleAbort = () => controller.abort(idle?.signal.reason)
      idle.signal.addEventListener('abort', forwardIdleAbort, { once: true })
    },
    refresh: () => idle?.refresh(),
    clear,
    abort: (reason?: unknown) => {
      controller.abort(reason)
      clear()
    },
  }
}

export function isHttpUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value)
}

export function isDataUrl(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('data:')
}

export function normalizeBase64Image(value: string, fallbackMime: string): string {
  return value.startsWith('data:') ? value : `data:${fallbackMime};base64,${value}`
}

export function getMimeForActualParams(
  source: Pick<Partial<TaskParams>, 'output_format'> | undefined,
  fallbackMime: string,
): string {
  const format = source?.output_format
  return format ? MIME_MAP[format] ?? fallbackMime : fallbackMime
}

function formatMiB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}

export function getDataUrlEncodedByteSize(dataUrl: string): number {
  return dataUrl.length
}

export function getDataUrlDecodedByteSize(dataUrl: string): number {
  const commaIndex = dataUrl.indexOf(',')
  if (commaIndex < 0) return dataUrl.length

  const meta = dataUrl.slice(0, commaIndex)
  const payload = dataUrl.slice(commaIndex + 1)
  if (!/;base64/i.test(meta)) return decodeURIComponent(payload).length

  const normalized = payload.replace(/\s/g, '')
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding)
}

function assertMaxBytes(label: string, bytes: number, maxBytes: number) {
  if (bytes > maxBytes) {
    throw new Error(`${label}过大：${formatMiB(bytes)}，上限为 ${formatMiB(maxBytes)}`)
  }
}

export function assertImageInputPayloadSize(bytes: number) {
  assertMaxBytes('图像输入有效负载总大小', bytes, MAX_IMAGE_INPUT_PAYLOAD_BYTES)
}

export function assertMaskEditFileSize(label: string, bytes: number) {
  assertMaxBytes(label, bytes, MAX_MASK_EDIT_FILE_BYTES)
}

export async function blobToDataUrl(blob: Blob, fallbackMime: string): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''

  for (let i = 0; i < bytes.length; i += 0x8000) {
    const chunk = bytes.subarray(i, i + 0x8000)
    binary += String.fromCharCode(...chunk)
  }

  return `data:${blob.type || fallbackMime};base64,${btoa(binary)}`
}

export const IMAGE_FETCH_CORS_HINT = ' 可点链接按钮复制结果链接，或尝试开启「返回 Base64 图片数据」避免此问题。'
export const STREAMING_UNSUPPORTED_HINT = '提示：当前使用的 API 可能不支持流式传输，请尝试关闭「流式传输」功能。'
export const STREAMING_FORMAT_HINT = '提示：API 返回了无法解析的流式数据格式，请尝试关闭「流式传输」功能。'

export function appendStreamingUnsupportedHint(message: string): string {
  return message ? `${message}\n${STREAMING_UNSUPPORTED_HINT}` : STREAMING_UNSUPPORTED_HINT
}

export function appendStreamingFormatHint(message: string): string {
  return message ? `${message}\n${STREAMING_FORMAT_HINT}` : STREAMING_FORMAT_HINT
}

/** 排除明确与流式无关的状态码后追加提示 */
export function maybeAppendStreamingHint(message: string, status: number, streamImages?: boolean): string {
  if (!streamImages) return message
  if (status === 401 || status === 403 || status === 404 || status === 408 || status === 429 || status >= 500) {
    return message
  }
  return appendStreamingUnsupportedHint(message)
}

async function probeNoCorsReachability(url: string, timeoutMs = 8000): Promise<'opaque' | 'reachable' | 'failed'> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller.signal,
    })
    return response.type === 'opaque' ? 'opaque' : 'reachable'
  } catch {
    return 'failed'
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function fetchImageUrlAsDataUrl(url: string, fallbackMime: string, signal?: AbortSignal): Promise<string> {
  if (isDataUrl(url)) return url

  let response: Response
  try {
    response = await fetch(url, {
      cache: 'no-store',
      signal,
    })
  } catch (err) {
    if (err instanceof TypeError) {
      const probe = await probeNoCorsReachability(url)
      if (probe === 'opaque') {
        throw new Error(`图片已生成，但因服务商未允许跨域，图片链接下载失败。${IMAGE_FETCH_CORS_HINT}`)
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        throw new Error(`图片链接下载失败（网络不可用）。${IMAGE_FETCH_CORS_HINT}`)
      }
      throw new Error(`图片链接下载失败（可能因跨域限制、链接过期或网络异常）。${IMAGE_FETCH_CORS_HINT}`)
    }
    throw err
  }

  if (!response.ok) {
    throw new Error(`图片 URL 下载失败：HTTP ${response.status}`)
  }

  const blob = await response.blob()
  return blobToDataUrl(blob, fallbackMime)
}

export async function getApiErrorMessage(response: Response): Promise<string> {
  let errorMsg = `HTTP ${response.status}`
  const textResponse = response.clone()
  try {
    const errJson = await response.json()
    if (errJson.error?.message) {
      const details = [errJson.error.message, errJson.error.type, errJson.error.code, errJson.error.param]
        .filter((item) => typeof item === 'string' && item.trim())
      errorMsg = details.join(' ')
    }
    else if (typeof errJson.detail === 'string') errorMsg = errJson.detail
    else if (Array.isArray(errJson.detail)) errorMsg = errJson.detail.map((item: unknown) => typeof item === 'string' ? item : JSON.stringify(item)).join('\n')
    else if (typeof errJson.error === 'string') errorMsg = errJson.error
    else if (errJson.message) errorMsg = errJson.message
  } catch {
    try {
      errorMsg = await textResponse.text()
    } catch {
      /* ignore */
    }
  }
  const normalized = errorMsg.trim()
  if (/<!doctype html/i.test(normalized) || /<html[\s>]/i.test(normalized)) {
    if (response.status === 524 || response.status === 522 || response.status === 520) {
      return `网关超时或源站连接异常（HTTP ${response.status}）。同步 Images 请求可能已在上游完成并扣费，但中间代理超时导致结果无法返回；请检查 Cloudflare/CDN/反代超时，或改用支持流式/异步结果的接口。`
    }
    if (response.status >= 500) {
      return `服务端返回了 HTML 错误页（HTTP ${response.status}），通常是反向代理、CDN 或网关错误，不是正常的 JSON API 响应。`
    }
    return `接口返回了 HTML 页面而不是 JSON（HTTP ${response.status}），请检查 API 地址是否填错，或请求是否被 Cloudflare/CDN/反代拦截。`
  }
  return errorMsg
}

export function pickActualParams(source: unknown): Partial<TaskParams> {
  if (!source || typeof source !== 'object') return {}
  const record = source as Record<string, unknown>
  const actualParams: Partial<TaskParams> = {}

  if (typeof record.size === 'string') actualParams.size = record.size
  if (record.quality === 'auto' || record.quality === 'low' || record.quality === 'medium' || record.quality === 'high') {
    actualParams.quality = record.quality
  }
  if (record.output_format === 'png' || record.output_format === 'jpeg' || record.output_format === 'webp') {
    actualParams.output_format = record.output_format
  }
  if (typeof record.output_compression === 'number') actualParams.output_compression = record.output_compression
  if (record.moderation === 'auto' || record.moderation === 'low') actualParams.moderation = record.moderation
  if (typeof record.n === 'number') actualParams.n = record.n

  return actualParams
}

export function mergeActualParams(...sources: Array<Partial<TaskParams> | undefined>): Partial<TaskParams> | undefined {
  const merged = Object.assign({}, ...sources.filter((source) => source && Object.keys(source).length))
  return Object.keys(merged).length ? merged : undefined
}
