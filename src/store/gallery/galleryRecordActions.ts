import type { TaskRecord } from "../../types";
import { getActiveApiProfile, normalizeSettings } from "../../lib/api/apiProfiles";
import {
  clearPartialFailedTaskErrors,
  collectOutputImagesForInput,
  createRetryTaskRecord,
  createTaskOutputSeriesReference,
  getFailedTaskCleanupPlan,
  getUnreferencedTaskImageIds,
  removeDeletedTaskIdsFromSelection,
  resolveReuseConfigState,
  restoreTaskInputImages,
  restoreTaskMaskDraft,
} from "../../lib/gallery/galleryTasks";
import type { AppState } from "../types";
import type { SubmitTaskOptions } from "./gallerySubmissionActions";

type GalleryRecordDependencies = {
  getState: () => AppState;
  putTask: (task: TaskRecord) => Promise<IDBValidKey>;
  deleteTask: (taskId: string) => Promise<void>;
  deleteImage: (imageId: string) => Promise<void>;
  deleteImageCacheEntry: (imageId: string) => void;
  ensureImageCached: (imageId: string) => Promise<string | undefined>;
  executeTask: (taskId: string) => void;
  submitTask: (options?: SubmitTaskOptions) => Promise<void>;
  removeMultipleTasks: (taskIds: string[]) => Promise<void>;
  scrubAgentOutputPayloadsForDeletedTasks: (
    deletedTasks: TaskRecord[],
    remainingTasks: TaskRecord[],
  ) => Promise<TaskRecord[]>;
};

export async function retryTaskAction(
  deps: GalleryRecordDependencies,
  task: TaskRecord,
) {
  const { settings } = deps.getState();
  const activeProfile = getActiveApiProfile(settings);
  const newTask = createRetryTaskRecord(task, settings, activeProfile);

  const latestTasks = deps.getState().tasks;
  deps.getState().setTasks([newTask, ...latestTasks]);
  await deps.putTask(newTask);

  deps.executeTask(newTask.id);
}

export async function retryMultipleTasksAction(
  deps: GalleryRecordDependencies,
  taskIds: string[],
) {
  const { tasks, showToast, clearSelection } = deps.getState();
  const idSet = new Set(taskIds);
  const targetTasks = tasks.filter((task) => idSet.has(task.id));
  if (!targetTasks.length) return;

  for (const task of targetTasks) {
    await retryTaskAction(deps, task);
  }

  clearSelection();
  showToast(`已重新提交 ${targetTasks.length} 个任务`, "success");
}

export async function reuseConfigAction(
  deps: GalleryRecordDependencies,
  task: TaskRecord,
) {
  const {
    settings,
    setPrompt,
    setParams,
    setInputImages,
    setMaskDraft,
    clearMaskDraft,
    showToast,
    setConfirmDialog,
    setReusedTaskApiProfile,
  } = deps.getState();
  const normalizedSettings = normalizeSettings(settings);
  const currentProfile = getActiveApiProfile(settings);
  const reuseState = resolveReuseConfigState(task, normalizedSettings);
  const {
    matchedProfile,
    shouldTemporarilyReuseProfile,
    missingReusedProfile,
    taskProfileName,
  } = reuseState;

  setParams(reuseState.params);
  setReusedTaskApiProfile(
    shouldTemporarilyReuseProfile && matchedProfile ? matchedProfile.id : null,
    missingReusedProfile,
    taskProfileName,
  );
  clearMaskDraft();

  const imgs = await restoreTaskInputImages(task, deps.ensureImageCached);
  setInputImages(imgs);
  setPrompt(task.prompt);
  const maskDraft = await restoreTaskMaskDraft(
    task,
    imgs,
    deps.ensureImageCached,
  );
  if (maskDraft) setMaskDraft(maskDraft);
  else clearMaskDraft();
  if (missingReusedProfile) {
    setConfirmDialog({
      title: "找不到 API 配置",
      message: `找不到复用任务所使用的 API 配置「${taskProfileName}」，要使用当前的 API 配置「${currentProfile.name}」提交任务吗？`,
      confirmText: "使用当前配置提交",
      cancelText: "放弃提交",
      action: () => {
        void deps.submitTask({ useCurrentApiProfileWhenReusedMissing: true });
      },
    });
    return;
  }

  showToast(
    shouldTemporarilyReuseProfile && matchedProfile
      ? `已临时复用该任务的 API 配置「${matchedProfile.name}」`
      : "已复用配置到输入框",
    "success",
  );
}

export async function editOutputsAction(
  deps: GalleryRecordDependencies,
  task: TaskRecord,
) {
  const { inputImages, addInputImage, showToast } = deps.getState();
  if (!task.outputImages?.length) return;

  const images = await collectOutputImagesForInput(
    task,
    inputImages,
    deps.ensureImageCached,
  );
  for (const image of images) addInputImage(image);
  showToast(`已添加 ${images.length} 张输出图到输入`, "success");
}

export async function setTaskOutputAsSeriesReferenceAction(
  deps: GalleryRecordDependencies,
  task: TaskRecord,
  imageId = task.outputImages?.[0],
) {
  const { showToast, setSeriesReferenceImage } = deps.getState();
  if (!imageId) {
    showToast("当前任务没有可设为系列基准的图片", "info");
    return;
  }

  const reference = await createTaskOutputSeriesReference(
    task,
    imageId,
    deps.ensureImageCached,
  );
  if (!reference) {
    showToast("基准图读取失败，请稍后重试", "error");
    return;
  }

  setSeriesReferenceImage(reference);
  showToast("已设为系列基准图，后续画廊生成会自动带入参考图", "success");
}

export async function removeMultipleTasksAction(
  deps: GalleryRecordDependencies,
  taskIds: string[],
) {
  const {
    tasks,
    setTasks,
    inputImages,
    galleryInputDraft,
    seriesReferenceImage,
    seriesReferenceHistory,
    seriesReferenceSlots,
    showToast,
    selectedTaskIds,
  } = deps.getState();

  if (!taskIds.length) return;

  const toDelete = new Set(taskIds);
  const deletedTasks = tasks.filter((task) => toDelete.has(task.id));
  const remaining = await deps.scrubAgentOutputPayloadsForDeletedTasks(
    deletedTasks,
    tasks.filter((task) => !toDelete.has(task.id)),
  );

  setTasks(remaining);
  for (const id of taskIds) {
    await deps.deleteTask(id);
  }

  const latestState = deps.getState();
  const unreferencedImageIds = getUnreferencedTaskImageIds(deletedTasks, {
    tasks: remaining,
    inputImages,
    galleryInputDraft,
    agentInputDrafts: latestState.agentInputDrafts,
    agentConversations: latestState.agentConversations,
    seriesReferenceImage,
    seriesReferenceHistory,
    seriesReferenceSlots,
  });

  for (const imageId of unreferencedImageIds) {
    await deps.deleteImage(imageId);
    deps.deleteImageCacheEntry(imageId);
  }

  const newSelection = removeDeletedTaskIdsFromSelection(
    selectedTaskIds,
    toDelete,
  );
  if (newSelection.length !== selectedTaskIds.length) {
    deps.getState().setSelectedTaskIds(newSelection);
  }

  showToast(`已删除 ${taskIds.length} 个任务`, "success");
}

export async function clearFailedTasksAction(
  deps: GalleryRecordDependencies,
  taskIds?: string[],
) {
  const { failedTaskIds, partialFailedTaskIds } = getFailedTaskCleanupPlan(
    deps.getState().tasks,
    taskIds,
  );

  if (failedTaskIds.length)
    await removeMultipleTasksAction(deps, failedTaskIds);
  if (partialFailedTaskIds.size) {
    const { tasks, setTasks, selectedTaskIds, setSelectedTaskIds, showToast } =
      deps.getState();
    const updated = clearPartialFailedTaskErrors(tasks, partialFailedTaskIds);
    setTasks(updated);
    const nextSelectedTaskIds = removeDeletedTaskIdsFromSelection(
      selectedTaskIds,
      partialFailedTaskIds,
    );
    if (nextSelectedTaskIds.length !== selectedTaskIds.length)
      setSelectedTaskIds(nextSelectedTaskIds);
    await Promise.all(
      updated
        .filter((task) => partialFailedTaskIds.has(task.id))
        .map((task) => deps.putTask(task)),
    );
    showToast(`已清除 ${partialFailedTaskIds.size} 条部分失败记录`, "success");
  }
}

export async function removeTaskAction(
  deps: GalleryRecordDependencies,
  task: TaskRecord,
) {
  const {
    tasks,
    setTasks,
    inputImages,
    galleryInputDraft,
    seriesReferenceImage,
    seriesReferenceHistory,
    seriesReferenceSlots,
    showToast,
  } = deps.getState();

  const remaining = await deps.scrubAgentOutputPayloadsForDeletedTasks(
    [task],
    tasks.filter((item) => item.id !== task.id),
  );
  setTasks(remaining);
  await deps.deleteTask(task.id);

  const latestState = deps.getState();
  const unreferencedImageIds = getUnreferencedTaskImageIds([task], {
    tasks: remaining,
    inputImages,
    galleryInputDraft,
    agentInputDrafts: latestState.agentInputDrafts,
    agentConversations: latestState.agentConversations,
    seriesReferenceImage,
    seriesReferenceHistory,
    seriesReferenceSlots,
  });

  for (const imageId of unreferencedImageIds) {
    await deps.deleteImage(imageId);
    deps.deleteImageCacheEntry(imageId);
  }

  showToast("任务已删除", "success");
}
