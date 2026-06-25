import type { FavoriteCollection, TaskRecord } from "../../types";
import {
  createDeleteFavoriteCollectionPlan,
  createFavoriteCollectionDraft,
  getFavoriteCollectionTitleFromState,
  getTaskFavoriteCollectionIdsFromState,
  renameFavoriteCollections,
  updateTaskFavoriteCollections,
} from "./favoriteActions";
import type { AppState } from "../types";

type FavoriteStoreDependencies = {
  getState: () => AppState;
  putTask: (task: TaskRecord) => Promise<IDBValidKey>;
  removeMultipleTasks: (taskIds: string[]) => Promise<void>;
};

export function getTaskFavoriteCollectionIdsAction(
  deps: FavoriteStoreDependencies,
  task: TaskRecord,
) {
  return getTaskFavoriteCollectionIdsFromState(
    task,
    deps.getState().defaultFavoriteCollectionId,
  );
}

export function getFavoriteCollectionTitleAction(
  deps: FavoriteStoreDependencies,
  collectionId: string | null,
  collections = deps.getState().favoriteCollections,
) {
  return getFavoriteCollectionTitleFromState(collectionId, collections);
}

export function createFavoriteCollectionAction(
  deps: FavoriteStoreDependencies,
  name: string,
): FavoriteCollection | null {
  const state = deps.getState();
  const result = createFavoriteCollectionDraft(name, state.favoriteCollections);
  if (result.kind === "empty") return null;
  if (result.kind === "too-long") {
    state.showToast("收藏夹名称最多 60 个字符", "error");
    return null;
  }
  if (result.kind === "existing") return result.collection;

  state.setFavoriteCollections([
    ...state.favoriteCollections,
    result.collection,
  ]);
  state.showToast(`已创建收藏夹「${result.collection.name}」`, "success");
  return result.collection;
}

export function renameFavoriteCollectionAction(
  deps: FavoriteStoreDependencies,
  collectionId: string,
  name: string,
) {
  const { favoriteCollections, setFavoriteCollections, showToast } =
    deps.getState();
  const result = renameFavoriteCollections(
    favoriteCollections,
    collectionId,
    name,
  );
  if (result.kind === "noop") return;
  if (result.kind === "too-long") {
    showToast("收藏夹名称最多 60 个字符", "error");
    return;
  }
  setFavoriteCollections(result.collections);
  showToast("收藏夹名称已更新", "success");
}

export async function updateTasksFavoriteCollectionsAction(
  deps: FavoriteStoreDependencies,
  taskIds: string[],
  collectionIds: string[],
) {
  const {
    tasks,
    defaultFavoriteCollectionId,
    setTasks,
    clearSelection,
    showToast,
  } = deps.getState();
  const { ids, updated, changedTaskIds } = updateTaskFavoriteCollections(
    tasks,
    defaultFavoriteCollectionId,
    taskIds,
    collectionIds,
  );
  if (!changedTaskIds.size) {
    clearSelection();
    return;
  }
  setTasks(updated);
  await Promise.all(
    updated
      .filter((task) => changedTaskIds.has(task.id))
      .map((task) => deps.putTask(task)),
  );
  clearSelection();
  showToast(ids.length ? "收藏夹已更新" : "已取消收藏", "success");
}

export async function deleteFavoriteCollectionAction(
  deps: FavoriteStoreDependencies,
  collectionId: string,
  deleteTasks = false,
) {
  const state = deps.getState();
  const plan = createDeleteFavoriteCollectionPlan(
    {
      tasks: state.tasks,
      favoriteCollections: state.favoriteCollections,
      defaultFavoriteCollectionId: state.defaultFavoriteCollectionId,
      activeFavoriteCollectionId: state.activeFavoriteCollectionId,
    },
    collectionId,
    deleteTasks,
  );
  if (plan.kind === "noop") return;

  state.setFavoriteCollections(plan.nextCollections);
  if (
    plan.nextDefaultFavoriteCollectionId !== state.defaultFavoriteCollectionId
  ) {
    state.setDefaultFavoriteCollectionId(plan.nextDefaultFavoriteCollectionId);
  }
  if (
    plan.nextActiveFavoriteCollectionId !== state.activeFavoriteCollectionId
  ) {
    state.setActiveFavoriteCollectionId(plan.nextActiveFavoriteCollectionId);
  }

  if (deleteTasks) {
    if (plan.idsByTaskToKeep.size) {
      const latestTasks = deps.getState().tasks;
      const updated = latestTasks.map((task) => {
        const ids = plan.idsByTaskToKeep.get(task.id);
        return ids
          ? { ...task, favoriteCollectionIds: ids, isFavorite: true }
          : task;
      });
      deps.getState().setTasks(updated);
      await Promise.all(
        updated
          .filter((task) => plan.idsByTaskToKeep.has(task.id))
          .map((task) => deps.putTask(task)),
      );
    }
    if (plan.taskIdsToDelete.length)
      await deps.removeMultipleTasks(plan.taskIdsToDelete);
  } else if (plan.taskIds.length) {
    const updated = state.tasks.map((task) => {
      const ids = plan.idsByTaskId.get(task.id);
      if (!ids) return task;
      return {
        ...task,
        favoriteCollectionIds: ids,
        isFavorite: ids.length > 0,
      };
    });
    state.setTasks(updated);
    await Promise.all(
      updated
        .filter((task) => plan.idsByTaskId.has(task.id))
        .map((task) => deps.putTask(task)),
    );
  }
  deps
    .getState()
    .setSelectedFavoriteCollectionIds((ids) =>
      ids.filter((id) => id !== collectionId),
    );
  deps
    .getState()
    .showToast(`已删除收藏夹「${plan.collection.name}」`, "success");
}
