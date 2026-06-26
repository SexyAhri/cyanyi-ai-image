import { sanitizeProviderErrorMessage } from './providerErrors'

export type ApiConnectionConfig = {
  baseUrl: string
  apiKey: string
  apiMode?: 'images' | 'responses' | 'videos'
  model?: string
}

export type FetchedApiModel = {
  id: string
  supportedEndpointTypes: string[]
}

export type ApiConnectionTestResult = {
  models: FetchedApiModel[]
}

export async function testOpenAICompatibleConnection(config: ApiConnectionConfig, signal?: AbortSignal) {
  if (!config.baseUrl.trim()) throw new Error('请先填写 Base URL')
  if (!config.apiKey.trim()) throw new Error('请先填写 API Key')

  const response = await fetch(buildApiUrl(config.baseUrl, '/models'), {
    headers: {
      Authorization: `Bearer ${config.apiKey.trim()}`,
    },
    cache: 'no-store',
    signal,
  })

  if (!response.ok) {
    throw new Error(await readConnectionError(response))
  }

  const payload = await response.json().catch(() => null)
  if (config.apiMode === 'responses') {
    await testResponsesTextRequest(config, signal)
  }

  return {
    models: parseModelList(payload),
  }
}

export function parseModelList(payload: unknown): FetchedApiModel[] {
  if (!payload || typeof payload !== 'object') return []
  const record = payload as Record<string, unknown>
  const data = Array.isArray(record.data) ? record.data : []
  const seen = new Set<string>()
  const models: FetchedApiModel[] = []

  for (const item of data) {
    if (!item || typeof item !== 'object') continue
    const model = item as Record<string, unknown>
    const id = typeof model.id === 'string' ? model.id.trim() : ''
    if (!id || seen.has(id)) continue
    const supportedEndpointTypes = Array.isArray(model.supported_endpoint_types)
      ? model.supported_endpoint_types.filter((type): type is string => typeof type === 'string' && type.trim().length > 0)
      : []
    seen.add(id)
    models.push({ id, supportedEndpointTypes })
  }

  return models
}

function buildApiUrl(baseUrl: string, path: string) {
  const normalizedBase = baseUrl.trim().replace(/\/+$/, '')
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${normalizedBase}${normalizedPath}`
}

async function testResponsesTextRequest(config: ApiConnectionConfig, signal?: AbortSignal) {
  const model = config.model?.trim()
  if (!model) throw new Error('请先填写模型 ID')

  const response = await fetch(buildApiUrl(config.baseUrl, '/responses'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey.trim()}`,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
    body: JSON.stringify({
      model,
      input: '请只回复 OK，用于测试接口连通性。',
      max_output_tokens: 16,
    }),
    signal,
  })

  if (!response.ok) {
    throw new Error(await readConnectionError(response))
  }

  await response.json().catch(() => null)
}

async function readConnectionError(response: Response) {
  try {
    const payload = await response.json() as { error?: { message?: string }; msg?: string; message?: string }
    return sanitizeProviderErrorMessage(payload.msg || payload.message || payload.error?.message || statusMessage(response.status))
  } catch {
    return statusMessage(response.status)
  }
}

function statusMessage(status: number) {
  if (status === 401 || status === 403) return '连接测试失败：请检查 API Key、模型权限或中转站权限。'
  if (status === 404) return '连接测试失败：接口地址可能不正确，未找到 /models。'
  if (status === 429) return '连接测试失败：当前接口被限流，请稍后重试。'
  return `连接测试失败：HTTP ${status}`
}
