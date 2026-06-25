import type { FavoriteCollection, TaskRecord } from "../../types";
import {
  ALL_FAVORITES_COLLECTION_ID,
  DEFAULT_FAVORITE_COLLECTION_NAME,
  normalizeFavoriteCollectionIds,
  normalizeFavoriteCollectionName,
  sameFavoriteCollectionIds,
} from "../../lib/storage/favoriteCollections";
import { genId } from "../../lib/shared/id";
import type { AppState } from "../types";

export function normalizeFavoritePatch(
  task: TaskRecord,
  patch: Partial<TaskRecord>,
  defaultFavoriteCollectionId: string | null,
): Partial<TaskRecord> {
  if ("favoriteCollectionIds" in patch) {
    const ids = normalizeFavoriteCollectionIds(patch.favoriteCollectionIds);
    return { ...patch, favoriteCollectionIds: ids, isFavorite: ids.length > 0 };
  }
  if ("isFavorite" in patch) {
    if (patch.isFavorite) {
      const ids = normalizeFavoriteCollectionIds(task.favoriteCollectionIds);
      return {
        ...patch,
        favoriteCollectionIds: ids.length
          ? ids
          : defaultFavoriteCollectionId
            ? [defaultFavoriteCollectionId]
            : [],
      };
    }
    return { ...patch, favoriteCollectionIds: [] };
  }
  return patch;
}

export function getTaskFavoriteCollectionIdsFromState(
  task: TaskRecord,
  defaultFavoriteCollectionId: string | null,
) {
  const ids = normalizeFavoriteCollectionIds(task.favoriteCollectionIds);
  if (ids.length > 0) return ids;
  return task.isFavorite && defaultFavoriteCollectionId
    ? [defaultFavoriteCollectionId]
    : [];
}

export function getFavoriteCollectionTitleFromState(
  collectionId: string | null,
  collections: FavoriteCollection[],
) {
  if (collectionId === ALL_FAVORITES_COLLECTION_ID) return "全部";
  return (
    collections.find((collection) => collection.id === collectionId)?.name ??
    DEFAULT_FAVORITE_COLLECTION_NAME
  );
}

export function createFavoriteCollectionDraft(
  name: string,
  collections: FavoriteCollection[],
) {
  const normalizedName = normalizeFavoriteCollectionName(name);
  if (!normalizedName) return { kind: "empty" as const };
  if (Array.from(normalizedName).length > 60) {
    return { kind: "too-long" as const };
  }
  const existing = collections.find(
    (collection) => collection.name === normalizedName,
  );
  if (existing) return { kind: "existing" as const, collection: existing };
  const now = Date.now();
  return {
    kind: "created" as const,
    collection: {
      id: genId(),
      name: normalizedName,
      createdAt: now,
      updatedAt: now,
    },
  };
}

export function renameFavoriteCollections(
  collections: FavoriteCollection[],
  collectionId: string,
  name: string,
) {
  const normalizedName = normalizeFavoriteCollectionName(name);
  if (!normalizedName || collectionId === ALL_FAVORITES_COLLECTION_ID) {
    return { kind: "noop" as const, collections };
  }
  if (Array.from(normalizedName).length > 60) {
    return { kind: "too-long" as const, collections };
  }
  return {
    kind: "renamed" as const,
    collections: collections.map((collection) =>
      collection.id === collectionId
        ? { ...collection, name: normalizedName, updatedAt: Date.now() }
        : collection,
    ),
  };
}

export function updateTaskFavoriteCollections(
  tasks: TaskRecord[],
  defaultFavoriteCollectionId: string | null,
  taskIds: string[],
  collectionIds: string[],
) {
  const ids = normalizeFavoriteCollectionIds(collectionIds);
  const uniqueTaskIds = Array.from(new Set(taskIds)).filter(Boolean);
  const idSet = new Set(uniqueTaskIds);
  const changedTaskIds = new Set<string>();
  const updated = tasks.map((task) => {
    if (!idSet.has(task.id)) return task;
    if (
      sameFavoriteCollectionIds(
        getTaskFavoriteCollectionIdsFromState(
          task,
          defaultFavoriteCollectionId,
        ),
        ids,
      )
    )
      return task;
    changedTaskIds.add(task.id);
    return { ...task, favoriteCollectionIds: ids, isFavorite: ids.length > 0 };
  });
  return { ids, updated, changedTaskIds };
}

export function createDeleteFavoriteCollectionPlan(
  state: Pick<
    AppState,
    | "tasks"
    | "favoriteCollections"
    | "defaultFavoriteCollectionId"
    | "activeFavoriteCollectionId"
  >,
  collectionId: string,
  deleteTasks: boolean,
) {
  if (!collectionId || collectionId === ALL_FAVORITES_COLLECTION_ID)
    return { kind: "noop" as const };
  const collection = state.favoriteCollections.find(
    (item) => item.id === collectionId,
  );
  if (!collection || state.favoriteCollections.length <= 1)
    return { kind: "noop" as const };

  const collectionTaskRefs = state.tasks
    .map((task) => ({
      task,
      favoriteIds: getTaskFavoriteCollectionIdsFromState(
        task,
        state.defaultFavoriteCollectionId,
      ),
    }))
    .filter(({ favoriteIds }) => favoriteIds.includes(collectionId));
  const taskIds = collectionTaskRefs.map(({ task }) => task.id);
  const nextCollections = state.favoriteCollections.filter(
    (item) => item.id !== collectionId,
  );
  const nextCollectionIdSet = new Set(nextCollections.map((item) => item.id));
  const nextDefaultFavoriteCollectionId =
    state.defaultFavoriteCollectionId === collectionId
      ? (nextCollections[0]?.id ?? null)
      : state.defaultFavoriteCollectionId;
  const nextActiveFavoriteCollectionId =
    state.activeFavoriteCollectionId === collectionId
      ? null
      : state.activeFavoriteCollectionId;

  const idsByTaskToKeep = new Map<string, string[]>();
  const taskIdsToDelete: string[] = [];
  const idsByTaskId = new Map<string, string[]>();

  for (const { task, favoriteIds } of collectionTaskRefs) {
    const nextIds = favoriteIds.filter(
      (id) => id !== collectionId && nextCollectionIdSet.has(id),
    );
    idsByTaskId.set(task.id, nextIds);
    if (!deleteTasks) continue;
    if (nextIds.length) idsByTaskToKeep.set(task.id, nextIds);
    else taskIdsToDelete.push(task.id);
  }

  return {
    kind: "delete" as const,
    collection,
    taskIds,
    nextCollections,
    nextDefaultFavoriteCollectionId,
    nextActiveFavoriteCollectionId,
    idsByTaskToKeep,
    taskIdsToDelete,
    idsByTaskId,
  };
}
