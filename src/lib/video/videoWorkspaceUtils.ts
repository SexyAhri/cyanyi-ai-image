import type { VideoGenerationRecord } from '../../types'

export type MediaAsset = {
  id: string
  name: string
  url: string
  type: string
  bytes: number
}

export const POLL_INTERVAL_MS = 2500

export const sizeOptions = [
  { label: '横屏', value: '1280x720' },
  { label: '竖屏', value: '720x1280' },
  { label: '方形', value: '1024x1024' },
  { label: '宽屏', value: '1792x1024' },
  { label: '长图', value: '1024x1792' },
]

export const resolutionOptions = [
  { label: '720p', value: '720p' },
  { label: '480p', value: '480p' },
  { label: '1080p', value: '1080p' },
]

export function stripTransientVideoUrl(record: VideoGenerationRecord): VideoGenerationRecord {
  const baseRecord = record.referenceImageDataUrls
    ? { ...record, referenceImageDataUrls: undefined }
    : record
  if (!baseRecord.video?.remoteUrl?.startsWith('blob:')) return baseRecord
  return {
    ...baseRecord,
    video: {
      ...baseRecord.video,
      remoteUrl: undefined,
    },
  }
}

export function removeMediaAsset(items: MediaAsset[], id: string) {
  const removed = items.find((item) => item.id === id)
  if (removed) URL.revokeObjectURL(removed.url)
  return items.filter((item) => item.id !== id)
}

export function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('参考图读取失败'))
    reader.readAsDataURL(file)
  })
}

export function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = window.setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      window.clearTimeout(timer)
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    }, { once: true })
  })
}

export function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

export function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function statusLabel(status: VideoGenerationRecord['status']) {
  if (status === 'success') return '成功'
  if (status === 'failed') return '失败'
  if (status === 'cancelled') return '已取消'
  if (status === 'queued') return '排队中'
  return '生成中'
}

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`
}
