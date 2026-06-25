export function sanitizeProviderErrorMessage(message: string): string {
  const text = extractProviderErrorText(message)
  if (!text) return '生成失败，请稍后重试。'
  const lower = text.toLowerCase()

  if (
    /system under load|server overloaded|temporarily overloaded|service overloaded|over capacity|busy|try again later|our servers are currently overloaded/.test(lower) ||
    /服务繁忙|系统繁忙|负载|稍后重试/.test(text)
  ) {
    return '服务繁忙，请稍后重试'
  }

  if (/invalid[_\s-]?size|size is invalid|unsupported[_\s-]?size|invalid resolution|unsupported resolution/.test(lower)) {
    return '当前模型不支持所选尺寸或清晰度，请换成该模型支持的尺寸/清晰度，或切换其他模型。'
  }

  if (/invalid[_\s-]?(duration|seconds)|unsupported[_\s-]?(duration|seconds)|duration is invalid|seconds is invalid/.test(lower)) {
    return '当前模型不支持所选秒数，请调整秒数，或切换支持该时长的模型。'
  }

  if (/unsupported.*(image|reference|audio|video)|invalid.*(image|reference|audio|video)|reference.*not supported/.test(lower)) {
    return '当前模型不支持所选参考素材，请移除参考图/视频/音频，或切换支持参考素材的模型。'
  }

  if (/invalid[_\s-]?parameter|unsupported parameter|unknown parameter|invalid request|param/.test(lower)) {
    return '当前模型不支持部分生成参数，请调整尺寸、清晰度、秒数或参考素材后重试。'
  }

  if (
    /no available channel|channel_circuit_open|circuit breaker|under group|unsupported_model|auto-recovery probe/.test(lower) ||
    /渠道|通道|分组|无可用|没有可用|模型暂不支持|暂时不可用|熔断/.test(text)
  ) {
    return '当前模型暂不可用，请稍后重试或切换模型。'
  }

  if (
    /insufficient|balance|quota|billing|credit|pre[-\s]?charge|payment/.test(lower) ||
    /余额|额度|预扣|扣费|欠费|充值|账户金额|余额不足/.test(text)
  ) {
    return '当前接口暂时无法完成请求，请稍后重试或切换 API 配置。'
  }

  if (/auth_unavailable|no auth available/.test(lower)) {
    return 'Agent 主模型鉴权不可用，请检查 Agent API 配置或切换可用配置。'
  }

  if (/access token|unauthorized|forbidden|invalid api key|permission|auth/.test(lower) || /无权|鉴权|权限|密钥/.test(text)) {
    return '当前接口暂时无法完成请求，请检查 API Key 或切换 API 配置。'
  }

  return text
    .replace(/\s*\(?request\s*id\s*[:：]\s*[^)\s]+[)]?/gi, '')
    .replace(/\s*\(?请求\s*id\s*[:：]\s*[^)\s]+[)]?/gi, '')
    .replace(/\bmodel\s+[-\w.:/]+\b/gi, 'model')
    .replace(/\b(?:gpt|grok|sora|veo|nano|gemini|claude)[-\w.]*\b/gi, '模型')
    .replace(/\$[0-9]+(?:\.[0-9]+)?/g, '***')
    .trim()
}

function extractProviderErrorText(message: string): string {
  const text = String(message || '').trim()
  if (!text) return ''
  const parsed = parseJsonLike(text)
  return parsed ? getMessageFromValue(parsed) || text : text
}

function parseJsonLike(text: string): unknown | null {
  const candidates = [text]
  const firstBrace = text.indexOf('{')
  const lastBrace = text.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(text.slice(firstBrace, lastBrace + 1))

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch {
      try {
        return JSON.parse(candidate.replace(/\\"/g, '"'))
      } catch {
        // Try the next candidate.
      }
    }
  }
  return null
}

function getMessageFromValue(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const direct = record.message ?? record.msg
  if (typeof direct === 'string' && direct.trim()) return direct.trim()
  const nested = getMessageFromValue(record.error)
  if (nested) return nested
  const data = getMessageFromValue(record.data)
  if (data) return data
  return null
}
