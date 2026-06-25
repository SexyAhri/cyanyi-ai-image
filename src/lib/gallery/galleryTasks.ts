import type {
  AgentConversation,
  ApiProfile,
  AppSettings,
  InputImage,
  MaskDraft,
  SeriesReferenceImage,
  SeriesReferenceSlot,
  TaskRecord,
} from "../../types";
import type { AgentInputDraft } from "../storage/inputDrafts";
import { getActiveApiProfile } from "../api/apiProfiles";
import {
  addTaskReferencedImageIds,
  collectStateReferencedImageIds,
} from "./imageReferences";
import { normalizeParamsForSettings } from "./paramCompatibility";
import {
  createSettingsForApiProfile,
  getTaskApiProfile,
  getTaskApiProfileName,
} from "../api/taskApiProfiles";
import {
  createTransparentOutputMeta,
  getTransparentRequestParams,
} from "./transparentImage";
import { applyPromptStyleLock } from "./promptStyleLock";
import { genId } from "../shared/id";

export type GalleryTaskFilterStatus = "all" | "running" | "done" | "error";

export function taskHasOutputErrors(task: Pick<TaskRecord, "outputErrors">) {
  return Boolean(task.outputErrors?.length);
}

export function taskMatchesFilterStatus(
  task: TaskRecord,
  filterStatus: GalleryTaskFilterStatus,
) {
  if (filterStatus === "all") return true;
  if (filterStatus === "error")
    return task.status === "error" || taskHasOutputErrors(task);
  return task.status === filterStatus;
}

export function taskMatchesSearchQuery(task: TaskRecord, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const prompt = (task.prompt || "").toLowerCase();
  const paramStr = JSON.stringify(task.params).toLowerCase();
  const errorStr = [
    task.error,
    ...(task.outputErrors ?? []).map((item) => item.error),
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  const metadataStr = [task.note, ...(task.tags ?? [])]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  return (
    prompt.includes(q) ||
    paramStr.includes(q) ||
    errorStr.includes(q) ||
    metadataStr.includes(q)
  );
}

type TaskRemovalReferenceState = {
  tasks: TaskRecord[];
  inputImages: InputImage[];
  galleryInputDraft: AgentInputDraft | null;
  agentInputDrafts: Record<string, AgentInputDraft>;
  agentConversations: AgentConversation[];
  seriesReferenceImage: SeriesReferenceImage | null;
  seriesReferenceHistory: SeriesReferenceImage[];
  seriesReferenceSlots: Record<SeriesReferenceSlot, SeriesReferenceImage | null>;
};

export function getTaskReferencedImageIds(tasks: TaskRecord[]) {
  const imageIds = new Set<string>();
  for (const task of tasks) addTaskReferencedImageIds(imageIds, task);
  return imageIds;
}

export function getUnreferencedTaskImageIds(
  deletedTasks: TaskRecord[],
  referenceState: TaskRemovalReferenceState,
) {
  const deletedImageIds = getTaskReferencedImageIds(deletedTasks);
  const stillUsed = collectStateReferencedImageIds(referenceState);
  return Array.from(deletedImageIds).filter((imgId) => !stillUsed.has(imgId));
}

export function removeDeletedTaskIdsFromSelection(
  selectedTaskIds: string[],
  deletedTaskIds: Set<string>,
) {
  return selectedTaskIds.filter((id) => !deletedTaskIds.has(id));
}

export function getFailedTaskCleanupPlan(
  tasks: TaskRecord[],
  taskIds?: string[],
) {
  const targetTaskIds = taskIds ? new Set(taskIds) : null;
  const failedTasks = tasks.filter(
    (task) =>
      taskMatchesFilterStatus(task, "error") &&
      (!targetTaskIds || targetTaskIds.has(task.id)),
  );
  const failedTaskIds = failedTasks
    .filter((task) => task.status === "error")
    .map((task) => task.id);
  const partialFailedTaskIds = new Set(
    failedTasks
      .filter((task) => task.status !== "error" && taskHasOutputErrors(task))
      .map((task) => task.id),
  );

  return { failedTaskIds, partialFailedTaskIds };
}

export function clearPartialFailedTaskErrors(
  tasks: TaskRecord[],
  partialFailedTaskIds: Set<string>,
) {
  return tasks.map((task) =>
    partialFailedTaskIds.has(task.id)
      ? { ...task, outputErrors: undefined }
      : task,
  );
}

export function createRetryTaskRecord(
  task: TaskRecord,
  settings: AppSettings,
  activeProfile: ApiProfile,
  now = Date.now(),
): TaskRecord {
  const normalizedParams = normalizeParamsForSettings(task.params, settings, {
    hasInputImages: task.inputImageIds.length > 0,
  });
  const shouldUseTransparentOutput =
    normalizedParams.output_format === "png" &&
    normalizedParams.transparent_output;
  const taskParams = shouldUseTransparentOutput
    ? getTransparentRequestParams(normalizedParams)
    : { ...normalizedParams, transparent_output: false };
  const effectivePrompt = applyPromptStyleLock(task.prompt, settings);
  const transparentMeta = taskParams.transparent_output
    ? createTransparentOutputMeta(effectivePrompt)
    : null;
  const agentMeta =
    task.sourceMode === "agent" || task.agentConversationId || task.agentRoundId
      ? {
          sourceMode: "agent" as const,
          agentConversationId: task.agentConversationId,
          agentRoundId: task.agentRoundId,
          agentMessageId: task.agentMessageId,
          agentToolCallId: task.agentToolCallId,
          agentBatchCallId: task.agentBatchCallId,
          agentToolAction: task.agentToolAction,
        }
      : {};

  return {
    id: genId(),
    prompt: task.prompt,
    params: taskParams,
    apiProvider: activeProfile.provider,
    apiProfileId: activeProfile.id,
    apiProfileName: activeProfile.name,
    apiMode: activeProfile.apiMode,
    apiModel: activeProfile.model,
    parentTaskId: task.id,
    inputImageIds: [...task.inputImageIds],
    maskTargetImageId: task.maskTargetImageId ?? null,
    maskImageId: task.maskImageId ?? null,
    transparentOutput: transparentMeta?.transparentOutput,
    transparentPrompt: transparentMeta?.effectivePrompt,
    outputImages: [],
    status: "running",
    error: null,
    createdAt: now,
    finishedAt: null,
    elapsed: null,
    ...agentMeta,
  };
}

export function resolveReuseConfigState(
  task: TaskRecord,
  settings: AppSettings,
) {
  const normalizedSettings = settings;
  const currentProfile = getActiveApiProfile(settings);
  const matchedProfile = normalizedSettings.reuseTaskApiProfileTemporarily
    ? getTaskApiProfile(normalizedSettings, task)
    : null;
  const shouldTemporarilyReuseProfile = Boolean(
    matchedProfile && currentProfile && matchedProfile.id !== currentProfile.id,
  );
  const missingReusedProfile =
    normalizedSettings.reuseTaskApiProfileTemporarily && !matchedProfile;
  const taskProfileName = matchedProfile?.name ?? getTaskApiProfileName(task);
  const paramsSettings =
    shouldTemporarilyReuseProfile && matchedProfile
      ? createSettingsForApiProfile(normalizedSettings, matchedProfile)
      : normalizedSettings;

  return {
    currentProfile,
    matchedProfile,
    shouldTemporarilyReuseProfile,
    missingReusedProfile,
    taskProfileName,
    params: normalizeParamsForSettings(task.params, paramsSettings, {
      hasInputImages: task.inputImageIds.length > 0,
    }),
  };
}

export async function restoreTaskInputImages(
  task: TaskRecord,
  ensureImageCached: (imageId: string) => Promise<string | undefined>,
) {
  const imgs: InputImage[] = [];
  for (const imgId of task.inputImageIds) {
    const dataUrl = await ensureImageCached(imgId);
    if (dataUrl) imgs.push({ id: imgId, dataUrl });
  }
  return imgs;
}

export async function restoreTaskMaskDraft(
  task: TaskRecord,
  inputImages: InputImage[],
  ensureImageCached: (imageId: string) => Promise<string | undefined>,
): Promise<MaskDraft | null> {
  const maskTargetImageId =
    task.maskTargetImageId ?? (task.maskImageId ? task.inputImageIds[0] : null);
  if (
    !maskTargetImageId ||
    !task.maskImageId ||
    !inputImages.some((img) => img.id === maskTargetImageId)
  ) {
    return null;
  }

  const maskDataUrl = await ensureImageCached(task.maskImageId);
  if (!maskDataUrl) return null;
  return {
    targetImageId: maskTargetImageId,
    maskDataUrl,
    updatedAt: Date.now(),
  };
}

export async function collectOutputImagesForInput(
  task: TaskRecord,
  existingInputImages: InputImage[],
  ensureImageCached: (imageId: string) => Promise<string | undefined>,
) {
  const existingIds = new Set(existingInputImages.map((image) => image.id));
  const images: InputImage[] = [];
  for (const imgId of task.outputImages || []) {
    if (existingIds.has(imgId)) continue;
    const dataUrl = await ensureImageCached(imgId);
    if (dataUrl) images.push({ id: imgId, dataUrl });
  }
  return images;
}

export async function createTaskOutputSeriesReference(
  task: TaskRecord,
  imageId: string | undefined,
  ensureImageCached: (imageId: string) => Promise<string | undefined>,
): Promise<SeriesReferenceImage | null> {
  if (!imageId) return null;
  const dataUrl = await ensureImageCached(imageId);
  if (!dataUrl) return null;
  return {
    id: imageId,
    dataUrl,
    sourceTaskId: task.id,
    label: "系列基准",
    createdAt: Date.now(),
  };
}
