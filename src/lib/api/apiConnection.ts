import { sanitizeProviderErrorMessage } from './providerErrors'

export type ApiConnectionConfig = {
  baseUrl: string
  apiKey: string
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

  return true
}

function buildApiUrl(baseUrl: string, path: string) {
  const normalizedBase = baseUrl.trim().replace(/\/+$/, '')
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${normalizedBase}${normalizedPath}`
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
