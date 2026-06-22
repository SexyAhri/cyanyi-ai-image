import type { ApiProfile } from '../types'
import type { CallApiOptions, CallApiResult } from './imageApiShared'
import {
  assertImageInputPayloadSize,
  blobToDataUrl,
  fetchImageUrlAsDataUrl,
  getApiErrorMessage,
  getDataUrlEncodedByteSize,
  isDataUrl,
  isHttpUrl,
  MIME_MAP,
  normalizeBase64Image,
} from './imageApiShared'

type GeminiPart = {
  text?: string
  inlineData?: {
    mimeType: string
    data: string
  }
}

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: GeminiPart[]
    }
  }>
}

type ChatCompletionChunk = {
  choices?: Array<{
    delta?: {
      content?: string
      reasoning_content?: string
    }
    message?: {
      content?: string
    }
  }>
}

type ChatCompletionResponse = ChatCompletionChunk & {
  data?: unknown
}

const GEMINI_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
const EMPTY_CHAT_COMPLETION_MAX_ATTEMPTS = 2

export function normalizeGeminiImageModel(model: string): string {
  const normalized = model.trim().toLowerCase()
  if (normalized === 'nano-banana-2') return 'gemini-3.1-flash-image'
  if (normalized === 'nano-banana-pro') return 'gemini-3-pro-image-preview'
  if (normalized === 'nano-banana') return 'gemini-2.5-flash-image'
  return model.trim()
}

function normalizeGeminiBaseUrl(baseUrl: string): string {
  return (baseUrl.trim() || GEMINI_DEFAULT_BASE_URL).replace(/\/+$/, '')
}

function isGoogleGeminiBaseUrl(baseUrl: string): boolean {
  try {
    return new URL(normalizeGeminiBaseUrl(baseUrl)).hostname.endsWith('generativelanguage.googleapis.com')
  } catch {
    return false
  }
}

function buildChatCompletionsUrl(baseUrl: string): string {
  const normalized = normalizeGeminiBaseUrl(baseUrl)
  if (/\/chat\/completions$/i.test(normalized)) return normalized
  return `${normalized}/chat/completions`
}

function parseDataUrl(dataUrl: string): { mimeType: string; data: string } | null {
  const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/)
  if (!match) return null
  return { mimeType: match[1], data: match[2] }
}

function createGeminiParts(opts: CallApiOptions): GeminiPart[] {
  const parts: GeminiPart[] = [{ text: opts.prompt }]
  for (const dataUrl of opts.inputImageDataUrls) {
    const parsed = parseDataUrl(dataUrl)
    if (!parsed) continue
    parts.push({
      inlineData: {
        mimeType: parsed.mimeType,
        data: parsed.data,
      },
    })
  }
  return parts
}

function extractGeminiImages(payload: GeminiResponse, fallbackMime: string): CallApiResult {
  const parts = payload.candidates?.flatMap((candidate) => candidate.content?.parts ?? []) ?? []
  const images = parts
    .map((part) => part.inlineData)
    .filter((inlineData): inlineData is NonNullable<GeminiPart['inlineData']> => Boolean(inlineData?.data))
    .map((inlineData) => normalizeBase64Image(inlineData.data, inlineData.mimeType || fallbackMime))

  if (!images.length) {
    const err = new Error('Gemini 没有返回图片数据，请检查模型是否支持图片生成。')
    ;(err as any).rawResponsePayload = JSON.stringify(payload, null, 2)
    throw err
  }

  return {
    images,
    actualParams: { n: images.length },
    actualParamsList: images.map(() => ({})),
    revisedPrompts: [],
  }
}

function createChatCompletionContent(opts: CallApiOptions): string | Array<Record<string, unknown>> {
  if (!opts.inputImageDataUrls.length) return opts.prompt

  return [
    { type: 'text', text: opts.prompt },
    ...opts.inputImageDataUrls.map((dataUrl) => ({
      type: 'image_url',
      image_url: { url: dataUrl },
    })),
  ]
}

function collectImageUrlsFromUnknown(value: unknown, urls: Set<string>) {
  if (typeof value === 'string') {
    for (const url of extractImageUrlsFromText(value)) urls.add(url)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectImageUrlsFromUnknown(item, urls)
    return
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectImageUrlsFromUnknown(item, urls)
    }
  }
}

function extractImageUrlsFromText(text: string): string[] {
  const urls = new Set<string>()
  const markdownImagePattern = /!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
  let match: RegExpExecArray | null
  while ((match = markdownImagePattern.exec(text))) {
    const url = match[1]
    if (isHttpUrl(url) || isDataUrl(url)) urls.add(url)
  }
  const markdownLinkPattern = /\[[^\]]+]\((https?:\/\/[^)\s]+|data:[^)\s]+)(?:\s+"[^"]*")?\)/g
  while ((match = markdownLinkPattern.exec(text))) {
    const url = match[1]
    if (isLikelyImageUrl(url)) urls.add(url)
  }
  const plainUrlPattern = /https?:\/\/[^\s<>"'`，。！？、）)]+/g
  while ((match = plainUrlPattern.exec(text))) {
    const url = match[0].replace(/[.,;:!?]+$/, '')
    if (isLikelyImageUrl(url)) urls.add(url)
  }
  return [...urls]
}

function extractImageUrls(payload: unknown, text: string): string[] {
  const urls = new Set<string>(extractImageUrlsFromText(text))
  collectImageUrlsFromUnknown(payload, urls)
  return [...urls]
}

function isLikelyImageUrl(url: string): boolean {
  return isDataUrl(url)
    || /^https?:\/\/.+\.(?:png|jpe?g|webp|gif|avif)(?:[?#].*)?$/i.test(url)
    || /^https?:\/\/.+\/(?:files\/)?image(?:[?#].*)?$/i.test(url)
}

function appendChatChunkContent(payload: ChatCompletionResponse): string {
  return payload.choices
    ?.map((choice) => choice.delta?.content ?? choice.message?.content ?? '')
    .join('') ?? ''
}

function getObjectMessage(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  for (const key of ['message', 'msg', 'detail']) {
    const item = record[key]
    if (typeof item === 'string' && item.trim()) return item.trim()
  }
  return null
}

function getChatCompletionBusinessError(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const message = getChatCompletionBusinessError(item)
      if (message) return message
    }
    return null
  }

  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>

  if (record.success === false || record.status === 'error' || record.status === 'failed') {
    return getObjectMessage(record) ?? getObjectMessage(record.error) ?? '接口返回失败状态。'
  }

  if (typeof record.error === 'string' && record.error.trim()) return record.error.trim()
  const nestedErrorMessage = getObjectMessage(record.error)
  if (nestedErrorMessage) return nestedErrorMessage

  return null
}

function hasPositiveCompletionTokens(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasPositiveCompletionTokens)
  if (!value || typeof value !== 'object') return false

  const record = value as Record<string, unknown>
  const usage = record.usage
  if (usage && typeof usage === 'object') {
    const usageRecord = usage as Record<string, unknown>
    const completionTokens = Number(usageRecord.completion_tokens ?? usageRecord.output_tokens ?? 0)
    if (Number.isFinite(completionTokens) && completionTokens > 0) return true
  }

  return Object.values(record).some((item) => item !== usage && hasPositiveCompletionTokens(item))
}

function hasAnyChoices(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasAnyChoices)
  if (!value || typeof value !== 'object') return false

  const record = value as Record<string, unknown>
  if ('choices' in record) return Array.isArray(record.choices) && record.choices.length > 0
  return Object.values(record).some(hasAnyChoices)
}

function isRetryableEmptyChatCompletion(payload: unknown, text: string, imageUrls: string[]): boolean {
  if (text.trim() || imageUrls.length) return false
  if (hasAnyChoices(payload)) return false
  return !hasPositiveCompletionTokens(payload)
}

function isEventStreamResponse(response: Response): boolean {
  return response.headers.get('Content-Type')?.toLowerCase().includes('text/event-stream') ?? false
}

async function readChatCompletionResponse(response: Response): Promise<{ text: string; payload?: unknown; rawPayload: string }> {
  if (!isEventStreamResponse(response)) {
    const payload = await response.json() as ChatCompletionResponse
    return {
      text: appendChatChunkContent(payload),
      payload,
      rawPayload: JSON.stringify(payload, null, 2),
    }
  }

  if (!response.body) throw new Error('Gemini 兼容接口没有返回可读取的流式响应。')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  const payloads: unknown[] = []

  const processBlock = (block: string) => {
    const dataItems = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .map((line) => line.trim())
      .filter(Boolean)

    for (const data of dataItems) {
      if (data === '[DONE]') continue
      const payload = JSON.parse(data) as ChatCompletionResponse
      payloads.push(payload)
      text += appendChatChunkContent(payload)
    }
  }

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let separatorIndex = buffer.search(/\r?\n\r?\n/)
    while (separatorIndex >= 0) {
      const separator = buffer.match(/\r?\n\r?\n/)?.[0] ?? '\n\n'
      processBlock(buffer.slice(0, separatorIndex))
      buffer = buffer.slice(separatorIndex + separator.length)
      separatorIndex = buffer.search(/\r?\n\r?\n/)
    }
  }

  buffer += decoder.decode()
  if (buffer.trim()) processBlock(buffer)
  return {
    text,
    payload: payloads,
    rawPayload: JSON.stringify(payloads, null, 2),
  }
}

async function fetchGrokImageUrlAsDataUrl(url: string, fallbackMime: string, signal?: AbortSignal): Promise<string> {
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      signal,
    })
    if (!response.ok) return url
    return blobToDataUrl(await response.blob(), fallbackMime)
  } catch {
    return url
  }
}

function getChatCompatibleProviderLabel(profile: ApiProfile): string {
  if (profile.provider === 'grok') return 'Grok'
  if (profile.provider === 'gemini') return 'Gemini'
  return '兼容'
}

async function callGeminiChatCompletionsApiAttempt(opts: CallApiOptions, profile: ApiProfile, mime: string): Promise<CallApiResult> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), profile.timeout * 1000)

  try {
    const response = await fetch(buildChatCompletionsUrl(profile.baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${profile.apiKey}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
      body: JSON.stringify({
        model: profile.model.trim(),
        messages: [{
          role: 'user',
          content: createChatCompletionContent(opts),
        }],
        stream: true,
        temperature: 0.7,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0,
      }),
      signal: controller.signal,
    })

    if (!response.ok) throw new Error(await getApiErrorMessage(response))

    const { text, payload, rawPayload } = await readChatCompletionResponse(response)
    const businessError = getChatCompletionBusinessError(payload)
    if (businessError) {
      const err = new Error(businessError)
      ;(err as any).rawResponsePayload = rawPayload
      throw err
    }

    const imageUrls = extractImageUrls(payload, text)
    const rawImageUrls = imageUrls.filter(isHttpUrl)
    const images = await Promise.all(imageUrls.map((url) =>
      isDataUrl(url)
        ? url
        : profile.provider === 'grok'
          ? fetchGrokImageUrlAsDataUrl(url, mime, controller.signal)
          : fetchImageUrlAsDataUrl(url, mime, controller.signal),
    ))

    if (!images.length) {
      const label = getChatCompatibleProviderLabel(profile)
      const isEmptyChatCompletion = isRetryableEmptyChatCompletion(payload, text, imageUrls)
      const err = new Error(`${label} 兼容接口没有返回图片链接，请确认模型会输出 Markdown 图片链接。`)
      ;(err as any).rawResponsePayload = rawPayload || text
      ;(err as any).retryableEmptyChatCompletion = isEmptyChatCompletion
      throw err
    }

    return {
      images,
      actualParams: { n: images.length },
      actualParamsList: images.map(() => ({})),
      revisedPrompts: [],
      ...(rawImageUrls.length ? { rawImageUrls } : {}),
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

async function callGeminiChatCompletionsApi(opts: CallApiOptions, profile: ApiProfile, mime: string): Promise<CallApiResult> {
  let lastEmptyError: unknown

  for (let attempt = 1; attempt <= EMPTY_CHAT_COMPLETION_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await callGeminiChatCompletionsApiAttempt(opts, profile, mime)
    } catch (err) {
      if (!(err as { retryableEmptyChatCompletion?: unknown }).retryableEmptyChatCompletion) throw err
      lastEmptyError = err
      if (attempt >= EMPTY_CHAT_COMPLETION_MAX_ATTEMPTS) break
    }
  }

  const label = getChatCompatibleProviderLabel(profile)
  const err = new Error(`${label} 兼容接口连续返回空响应，已自动重试但仍未拿到图片，请稍后再试。`)
  const rawResponsePayload = (lastEmptyError as { rawResponsePayload?: unknown } | null)?.rawResponsePayload
  if (typeof rawResponsePayload === 'string') {
    ;(err as any).rawResponsePayload = rawResponsePayload
  }
  throw err
}

export async function callGeminiImageApi(opts: CallApiOptions, profile: ApiProfile): Promise<CallApiResult> {
  if (opts.maskDataUrl) {
    throw new Error('Gemini 图片接口暂不支持遮罩局部重绘，请改用 OpenAI Images API。')
  }

  assertImageInputPayloadSize(
    opts.inputImageDataUrls.reduce((sum, dataUrl) => sum + getDataUrlEncodedByteSize(dataUrl), 0),
  )

  const mime = MIME_MAP[opts.params.output_format] || 'image/png'
  if (!isGoogleGeminiBaseUrl(profile.baseUrl)) {
    return callGeminiChatCompletionsApi(opts, profile, mime)
  }

  const model = normalizeGeminiImageModel(profile.model)
  const baseUrl = normalizeGeminiBaseUrl(profile.baseUrl)
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), profile.timeout * 1000)

  try {
    const response = await fetch(`${baseUrl}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': profile.apiKey,
      },
      cache: 'no-store',
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: createGeminiParts(opts),
          },
        ],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
        },
      }),
      signal: controller.signal,
    })

    if (!response.ok) throw new Error(await getApiErrorMessage(response))
    return extractGeminiImages(await response.json() as GeminiResponse, mime)
  } finally {
    clearTimeout(timeoutId)
  }
}
