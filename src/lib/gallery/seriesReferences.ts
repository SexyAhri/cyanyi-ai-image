import type { SeriesReferenceImage, SeriesReferenceSlot } from '../../types'

export const SERIES_REFERENCE_HISTORY_LIMIT = 5
export const SERIES_REFERENCE_SLOTS: SeriesReferenceSlot[] = [
  'person',
  'product',
  'style',
]

export function normalizeSeriesReferenceImage(
  value: unknown,
): SeriesReferenceImage | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()) {
    return null
  }
  return {
    id: value.id,
    dataUrl: typeof value.dataUrl === 'string' ? value.dataUrl : '',
    sourceTaskId:
      typeof value.sourceTaskId === 'string' && value.sourceTaskId.trim()
        ? value.sourceTaskId
        : undefined,
    label:
      typeof value.label === 'string' && value.label.trim()
        ? value.label.trim().slice(0, 40)
        : undefined,
    purpose:
      value.purpose === 'person' ||
      value.purpose === 'product' ||
      value.purpose === 'style' ||
      value.purpose === 'composition' ||
      value.purpose === 'reference'
        ? value.purpose
        : undefined,
    createdAt:
      typeof value.createdAt === 'number' && Number.isFinite(value.createdAt)
        ? value.createdAt
        : Date.now(),
  }
}

export function stripSeriesReferencePayload(image: SeriesReferenceImage) {
  return { ...image, dataUrl: '' }
}

export function normalizeSeriesReferenceHistory(value: unknown): SeriesReferenceImage[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value
    .map(normalizeSeriesReferenceImage)
    .filter((item): item is SeriesReferenceImage => {
      if (!item || seen.has(item.id)) return false
      seen.add(item.id)
      return true
    })
    .slice(0, SERIES_REFERENCE_HISTORY_LIMIT)
}

export function normalizeSeriesReferenceSlots(
  value: unknown,
): Record<SeriesReferenceSlot, SeriesReferenceImage | null> {
  const source = isRecord(value) ? value : {}
  return {
    person: normalizeSeriesReferenceImage(source.person),
    product: normalizeSeriesReferenceImage(source.product),
    style: normalizeSeriesReferenceImage(source.style),
  }
}

export function addSeriesReferenceToHistory(
  history: SeriesReferenceImage[],
  image: SeriesReferenceImage,
) {
  return [
    image,
    ...history.filter((item) => item.id !== image.id),
  ].slice(0, SERIES_REFERENCE_HISTORY_LIMIT)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
