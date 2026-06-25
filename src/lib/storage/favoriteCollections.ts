import type { FavoriteCollection, TaskRecord } from '../../types'

export const ALL_FAVORITES_COLLECTION_ID = '__all_favorites__'
export const DEFAULT_FAVORITE_COLLECTION_ID = '__default_favorites__'
export const DEFAULT_FAVORITE_COLLECTION_NAME = '默认'

export function normalizeFavoriteCollectionName(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

export function createDefaultFavoriteCollection(now = Date.now()): FavoriteCollection {
  return {
    id: DEFAULT_FAVORITE_COLLECTION_ID,
    name: DEFAULT_FAVORITE_COLLECTION_NAME,
    createdAt: now,
    updatedAt: now,
  }
}

export function normalizeFavoriteCollections(value: unknown): FavoriteCollection[] {
  const now = Date.now()
  const collections = Array.isArray(value) ? value : []
  const normalized: FavoriteCollection[] = []
  const ids = new Set<string>()
  for (const item of collections) {
    if (!isRecord(item)) continue
    if (typeof item.id !== 'string' || !item.id.trim()) continue
    const id = item.id
    if (id === ALL_FAVORITES_COLLECTION_ID || ids.has(id)) continue
    const name = normalizeFavoriteCollectionName(
      typeof item.name === 'string' ? item.name : '',
    )
    if (!name) continue
    ids.add(id)
    normalized.push({
      id,
      name: name.slice(0, 60),
      createdAt: typeof item.createdAt === 'number' ? item.createdAt : now,
      updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : now,
    })
  }
  return normalized
}

export function ensureDefaultFavoriteCollection(collections: FavoriteCollection[]) {
  if (collections.length > 0) return collections
  return [createDefaultFavoriteCollection(), ...collections]
}

export function ensureDefaultNamedCollection(collections: FavoriteCollection[]) {
  if (getDefaultNamedFavoriteCollectionId(collections)) return collections
  return [createDefaultFavoriteCollection(), ...collections]
}

export function getDefaultNamedFavoriteCollectionId(
  collections: FavoriteCollection[],
) {
  return (
    collections.find(
      (collection) => collection.id === DEFAULT_FAVORITE_COLLECTION_ID,
    )?.id ??
    collections.find(
      (collection) => collection.name === DEFAULT_FAVORITE_COLLECTION_NAME,
    )?.id ??
    null
  )
}

export function resolveDefaultFavoriteCollectionId(
  collections: FavoriteCollection[],
  preferredId: unknown,
) {
  if (preferredId === null) return null
  if (
    typeof preferredId === 'string' &&
    collections.some((collection) => collection.id === preferredId)
  ) {
    return preferredId
  }
  if (
    collections.some(
      (collection) => collection.id === DEFAULT_FAVORITE_COLLECTION_ID,
    )
  ) {
    return DEFAULT_FAVORITE_COLLECTION_ID
  }
  return collections[0]?.id ?? null
}

export function normalizeFavoriteCollectionIds(ids: unknown) {
  if (!Array.isArray(ids)) return []
  return Array.from(
    new Set(
      ids.map(String).filter((id) => id && id !== ALL_FAVORITES_COLLECTION_ID),
    ),
  )
}

export function sameFavoriteCollectionIds(a: string[], b: string[]) {
  if (a.length !== b.length) return false
  const bSet = new Set(b)
  return a.every((id) => bSet.has(id))
}

export function normalizeTaskFavoriteState(
  task: TaskRecord,
  collections: FavoriteCollection[],
): TaskRecord {
  const collectionIdSet = new Set(
    collections.map((collection) => collection.id),
  )
  const normalizedIds = normalizeFavoriteCollectionIds(
    task.favoriteCollectionIds,
  ).filter((id) => collectionIdSet.has(id))
  const defaultId = getDefaultNamedFavoriteCollectionId(collections)
  const ids =
    normalizedIds.length > 0
      ? normalizedIds
      : task.isFavorite && defaultId
        ? [defaultId]
        : []
  const isFavorite = ids.length > 0 || Boolean(task.isFavorite)
  if (
    ids.length === (task.favoriteCollectionIds ?? []).length &&
    ids.every((id, index) => id === task.favoriteCollectionIds?.[index]) &&
    Boolean(task.isFavorite) === isFavorite
  ) {
    return task
  }
  return { ...task, favoriteCollectionIds: ids, isFavorite }
}

export function normalizeLoadedFavoriteState(
  tasks: TaskRecord[],
  collections: FavoriteCollection[],
  preferredDefaultFavoriteCollectionId: string | null,
) {
  let changed = false
  const normalizedCollections = ensureDefaultNamedCollection(
    ensureDefaultFavoriteCollection(normalizeFavoriteCollections(collections)),
  )
  const defaultFavoriteCollectionId = resolveDefaultFavoriteCollectionId(
    normalizedCollections,
    preferredDefaultFavoriteCollectionId,
  )
  const normalizedTasks = tasks.map((task) => {
    const nextTask = normalizeTaskFavoriteState(task, normalizedCollections)
    if (nextTask !== task) changed = true
    return nextTask
  })
  return {
    tasks: normalizedTasks,
    collections: normalizedCollections,
    defaultFavoriteCollectionId,
    changed,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
