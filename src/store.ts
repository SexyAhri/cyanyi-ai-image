import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  AppSettings,
  InputImage,
  TaskRecord,
} from "./types";
import {
  getActiveApiProfile,
  getAgentApiProfile,
  normalizeSettings,
} from "./lib/api/apiProfiles";
import {
  getAllTasks,
  putTask as dbPutTask,
  deleteTask as dbDeleteTask,
  getAllAgentConversations,
  getAllImageIds,
  deleteImage,
  storeImage,
} from "./lib/storage/db";
import {
  scrubAgentConversationsForDeletedTasks,
  scrubTaskRawResponsePayloadForDeletedTasks,
} from "./lib/agent/agentPayload";
import { showBrowserNotification } from "./lib/ui/browserNotification";
import {
  migratePersistedState,
} from "./lib/agent/agentConversationStorage";
import type { GalleryTaskFilterStatus } from "./lib/gallery/galleryTasks";
import {
  cleanStaleAgentInputDrafts,
  restoreAgentInputDraftState,
  restoreGalleryInputDraftState,
  saveActiveAgentInputDrafts,
  saveGalleryInputDraft,
} from "./lib/storage/inputDrafts";
import {
  normalizeCreativeNegativePresets,
  normalizeCreativeStylePresets,
  normalizeCreativeSubjectProfiles,
  normalizePromptTemplates,
} from "./lib/creative/creativeAssets";
import {
  cacheImage,
  deleteCachedImage,
  deleteImageCacheEntry,
  ensureImageCached,
  scheduleThumbnailBackfill,
} from "./lib/storage/imageCache";
import {
  isImageReferencedByState,
} from "./lib/gallery/imageReferences";
import {
  deleteUnreferencedImageIds as deleteStoredUnreferencedImageIds,
  persistTaskStreamPartialImage as persistStoredTaskStreamPartialImage,
  storeTaskOutputImages as storeTaskOutputImagesInDb,
} from "./lib/gallery/taskOutputs";
import type { AppState } from "./store/types";
import { createAgentSlice } from "./store/agent/agentSlice";
import { createCreativeAssetsSlice } from "./store/creative/creativeAssetsSlice";
import { createFavoritesSlice } from "./store/favorites/favoritesSlice";
import { createGallerySlice } from "./store/gallery/gallerySlice";
import { createInputSlice } from "./store/input/inputSlice";
import { createSettingsSlice } from "./store/settings/settingsSlice";
import { createTasksSlice } from "./store/gallery/tasksSlice";
import { createUiSlice } from "./store/ui/uiSlice";
import {
  addImageFromFileAction,
  addImageFromUrlAction,
  clearDataAction,
  createInputImageFromFileAction,
  exportDataAction,
  importDataAction,
  type ClearOptions,
  type ExportOptions,
  type ImportOptions,
} from "./store/lifecycle/dataLifecycleActions";
import {
  normalizeFavoritePatch,
} from "./store/favorites/favoriteActions";
import {
  createFavoriteCollectionAction,
  deleteFavoriteCollectionAction,
  getFavoriteCollectionTitleAction,
  getTaskFavoriteCollectionIdsAction,
  renameFavoriteCollectionAction,
  updateTasksFavoriteCollectionsAction,
} from "./store/favorites/favoriteStoreActions";
import {
  submitSeriesBatchAction,
  submitTaskAction,
  type SubmitSeriesBatchOptions,
  type SubmitTaskOptions,
} from "./store/gallery/gallerySubmissionActions";
import {
  clearFailedTasksAction,
  editOutputsAction,
  removeMultipleTasksAction,
  removeTaskAction,
  retryMultipleTasksAction,
  retryTaskAction,
  reuseConfigAction,
  setTaskOutputAsSeriesReferenceAction,
} from "./store/gallery/galleryRecordActions";
import { createTaskExecutionController } from "./store/gallery/taskExecutionController";
import { createAgentRuntimeActions } from "./store/agent/agentRuntimeActions";
import {
  initStoreAction,
} from "./store/lifecycle/initializationActions";
import {
  getPersistableTask,
  getPersistedState,
  isAgentConversationPersistenceReady,
  mergePersistedState,
  replaceStoredAgentConversations,
} from "./store/lifecycle/persistence";

export { migratePersistedState } from "./lib/agent/agentConversationStorage";
export { getErrorToastMessage } from "./lib/gallery/toastMessages";
export { getPersistedState } from "./store/lifecycle/persistence";
export type {
  AppState,
  AgentContextNotice,
  ConfirmDialogState,
  SettingsTab,
} from "./store/types";
export {
  deleteAgentRoundFromConversation,
  getActiveAgentRounds,
  getAgentBranchLeafId,
  getAgentRoundPath,
  getAgentSiblingRounds,
  remapAgentRoundMentionsForPathChange,
} from "./lib/agent/agentConversationTree";
export { cleanStaleAgentInputDrafts } from "./lib/storage/inputDrafts";
export {
  ALL_FAVORITES_COLLECTION_ID,
  DEFAULT_FAVORITE_COLLECTION_ID,
  DEFAULT_FAVORITE_COLLECTION_NAME,
} from "./lib/storage/favoriteCollections";
export {
  taskHasOutputErrors,
  taskMatchesFilterStatus,
  taskMatchesSearchQuery,
} from "./lib/gallery/galleryTasks";
export {
  ensureImageCached,
  ensureImageThumbnailCached,
  getCachedImage,
  subscribeImageThumbnail,
} from "./lib/storage/imageCache";
export { sanitizeProviderErrorMessage } from "./lib/gallery/taskErrorHandling";
export { getTaskApiProfile } from "./lib/api/taskApiProfiles";

const SUPPORT_PROMPT_IMAGE_THRESHOLD = 50;
function isAgentTask(task: TaskRecord) {
  return (
    task.sourceMode === "agent" ||
    Boolean(task.agentConversationId || task.agentRoundId)
  );
}

function showTaskCompletionNotification(title: string, body: string) {
  const settings = normalizeSettings(useStore.getState().settings);
  if (!settings.taskCompletionNotification) return;
  showBrowserNotification(title, { body });
}

function countSuccessfulOutputImages(tasks: TaskRecord[]) {
  return tasks.reduce(
    (count, task) =>
      count +
      (task.status === "done" && !isAgentTask(task)
        ? task.outputImages.length
        : 0),
    0,
  );
}

function skipSupportPromptForImportedData(tasks: TaskRecord[]) {
  const count = countSuccessfulOutputImages(tasks);
  useStore.setState((state) => {
    if (state.supportPromptDismissed) return {};
    if (count <= SUPPORT_PROMPT_IMAGE_THRESHOLD) {
      return { supportPromptSkippedForImportedData: false };
    }
    if (state.supportPromptOpen) return {};
    return { supportPromptSkippedForImportedData: true };
  });
}

function showSupportPromptForExistingLocalData(tasks: TaskRecord[]) {
  const count = countSuccessfulOutputImages(tasks);
  useStore.setState((state) => {
    if (state.supportPromptDismissed || state.supportPromptOpen) return {};
    if (count <= SUPPORT_PROMPT_IMAGE_THRESHOLD) {
      return { supportPromptSkippedForImportedData: false };
    }
    if (state.supportPromptSkippedForImportedData) return {};
    return { supportPromptOpen: true };
  });
}

function maybeOpenSupportPrompt(
  previousTasks: TaskRecord[],
  nextTasks: TaskRecord[],
  taskId: string,
) {
  const state = useStore.getState();
  if (
    state.supportPromptDismissed ||
    state.supportPromptOpen ||
    state.supportPromptSkippedForImportedData
  )
    return;

  const previousTask = previousTasks.find((task) => task.id === taskId);
  const nextTask = nextTasks.find((task) => task.id === taskId);
  if (
    !nextTask ||
    previousTask?.status === "done" ||
    nextTask.status !== "done" ||
    nextTask.outputImages.length === 0
  )
    return;

  const previousCount = countSuccessfulOutputImages(previousTasks);
  const nextCount = countSuccessfulOutputImages(nextTasks);
  if (
    previousCount <= SUPPORT_PROMPT_IMAGE_THRESHOLD &&
    nextCount > SUPPORT_PROMPT_IMAGE_THRESHOLD
  ) {
    useStore.setState({ supportPromptOpen: true });
  }
}

export async function deleteImageIfUnreferenced(imageId: string) {
  deleteImageCacheEntry(imageId);
  if (isImageReferencedByState(useStore.getState(), imageId)) return;
  try {
    await deleteImage(imageId);
  } catch {
    // 清理是内存/存储优化，失败不影响替换结果。
  }
}

export const useStore = create<AppState>()(
  persist(
    (set, get, api) => ({
      // Mode
      appMode: "gallery",
      setAppMode: (appMode) => {
        if (appMode === "gallery") {
          const state = get();
          const agentInputDrafts = saveActiveAgentInputDrafts(state);
          const galleryInputDraft = saveGalleryInputDraft(state);
          set((state) => ({
            appMode,
            agentInputDrafts,
            galleryInputDraft,
            agentMobileHeaderVisible: true,
            selectedTaskIds: [],
            selectedFavoriteCollectionIds: [],
            agentEditingRoundId: null,
            ...(state.appMode === "agent"
              ? restoreGalleryInputDraftState(galleryInputDraft)
              : {}),
          }));
          return;
        }

        if (appMode === "video") {
          const state = get();
          const galleryInputDraft = saveGalleryInputDraft(state);
          set({
            appMode,
            galleryInputDraft,
            agentMobileHeaderVisible: true,
            selectedTaskIds: [],
            selectedFavoriteCollectionIds: [],
            agentEditingRoundId: null,
          });
          return;
        }

        const state = get();
        const settings = normalizeSettings(state.settings);
        const activeProfile = getAgentApiProfile(settings);

        if (
          activeProfile.provider === "openai" &&
          activeProfile.apiMode === "responses"
        ) {
          const galleryInputDraft = saveGalleryInputDraft(state);
          set((state) => ({
            appMode: "agent",
            galleryInputDraft,
            agentMobileHeaderVisible: false,
            agentSidebarCollapsed: true,
            agentAssetPanelCollapsed: true,
            selectedTaskIds: [],
            selectedFavoriteCollectionIds: [],
            ...restoreAgentInputDraftState(
              state.agentInputDrafts,
              state.activeAgentConversationId,
            ),
          }));
          return;
        }

        if (
          activeProfile.provider === "openai" &&
          activeProfile.apiMode !== "responses"
        ) {
          state.setConfirmDialog({
            title: "需要 Responses API 配置",
            message: `当前配置「${activeProfile.name}」使用的是 Images API，仅支持生成图片，无 Agent 模式需要的对话能力。\n\n请前往 API 配置页，将当前配置调整为 Responses API，或切换/新建一个支持 Responses API 的配置。`,
            confirmText: "去设置",
            cancelText: "取消",
            action: () => {
              useStore.getState().setShowSettings(true, "api");
            },
          });
          return;
        }

        state.setConfirmDialog({
          title: "配置不支持 Agent 模式",
          message: `当前配置「${activeProfile.name}」所属的服务商暂不支持 Agent 模式。Agent 模式需要使用支持 Responses API 的 OpenAI 配置。\n\n请前往 API 配置页，切换或新建一个支持 Responses API 的配置。`,
          confirmText: "去设置",
          cancelText: "取消",
          action: () => {
            useStore.getState().setShowSettings(true, "api");
          },
        });
      },

      ...createSettingsSlice({ onQueueResume: startQueuedTasks })(
        set,
        get,
        api,
      ),

      ...createInputSlice({
        deleteCachedImage,
        deleteImageIfUnreferenced,
      })(set, get, api),

      ...createAgentSlice(set, get, api),

      ...createTasksSlice({
        shouldResetSupportPromptSkip: (tasks) =>
          countSuccessfulOutputImages(tasks) <= SUPPORT_PROMPT_IMAGE_THRESHOLD,
        updateTaskInStore,
        persistTask: putTask,
      })(set, get, api),
      ...createFavoritesSlice(set, get, api),
      ...createCreativeAssetsSlice({
        normalizePromptTemplates,
        normalizeCreativeStylePresets,
        normalizeCreativeSubjectProfiles,
        normalizeCreativeNegativePresets,
      })(set, get, api),

      ...createGallerySlice(set, get, api),

      ...createUiSlice(set, get, api),
    }),
    {
      name: "gpt-image-playground",
      version: 2,
      migrate: (persistedState) => migratePersistedState(persistedState),
      partialize: getPersistedState,
      merge: mergePersistedState,
    },
  ),
);

let lastStoredAgentConversations = useStore.getState().agentConversations;
let agentConversationPersistRunning = false;
let agentConversationPersistQueued = false;

async function flushAgentConversationsToIndexedDB() {
  if (agentConversationPersistRunning) {
    agentConversationPersistQueued = true;
    return;
  }

  agentConversationPersistRunning = true;
  try {
    do {
      agentConversationPersistQueued = false;
      const conversations = useStore.getState().agentConversations;
      await replaceStoredAgentConversations(conversations);
      lastStoredAgentConversations = conversations;
    } while (
      agentConversationPersistQueued ||
      useStore.getState().agentConversations !== lastStoredAgentConversations
    );
  } finally {
    agentConversationPersistRunning = false;
  }
}

useStore.subscribe((state) => {
  if (state.agentConversations === lastStoredAgentConversations) return;
  if (!isAgentConversationPersistenceReady()) {
    agentConversationPersistQueued = true;
    return;
  }
  void flushAgentConversationsToIndexedDB();
});

// ===== Actions =====

export function getTaskVersionChain(
  taskId: string,
  tasks = useStore.getState().tasks,
): TaskRecord[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const chain: TaskRecord[] = [];
  const seen = new Set<string>();
  let current = byId.get(taskId) ?? null;

  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.unshift(current);
    const explicitParent = current.parentTaskId
      ? byId.get(current.parentTaskId)
      : null;
    if (explicitParent) {
      current = explicitParent;
      continue;
    }
    current =
      tasks.find((candidate) =>
        candidate.outputImages.some((imageId) =>
          current?.inputImageIds.includes(imageId),
        ),
      ) ?? null;
  }

  return chain;
}

function putTask(task: TaskRecord): Promise<IDBValidKey> {
  return dbPutTask(getPersistableTask(task));
}

export function getCodexCliPromptKey(settings: AppSettings): string {
  const profile = getActiveApiProfile(settings);
  return `${profile.baseUrl}\n${profile.apiKey}`;
}

export { markInterruptedOpenAIRunningTasks } from "./store/lifecycle/initializationActions";

export function showCodexCliPrompt(
  force = false,
  reason = "接口返回的提示词已被改写",
) {
  const state = useStore.getState();
  const settings = state.settings;
  const promptKey = getCodexCliPromptKey(settings);
  if (
    !force &&
    (settings.codexCli || state.dismissedCodexCliPrompts.includes(promptKey))
  )
    return;

  state.setConfirmDialog({
    title: "检测到 Codex CLI API",
    message: `${reason}，当前 API 来源很可能是 Codex CLI。\n\n是否开启 Codex CLI 兼容模式？开启后会禁用在此处无效的质量参数，并在 Images API 多图生成时使用并发请求，解决该 API 数量参数无效的问题。同时，提示词文本开头会加入简短的不改写要求，避免模型重写提示词，偏离原意。`,
    confirmText: "开启",
    action: () => {
      const state = useStore.getState();
      state.dismissCodexCliPrompt(promptKey);
      state.setSettings({ codexCli: true });
    },
    cancelAction: () => useStore.getState().dismissCodexCliPrompt(promptKey),
  });
}

export async function initStore() {
  await initStoreAction({
    getState: useStore.getState,
    setState: useStore.setState,
    getAllTasks,
    getAllAgentConversations,
    getAllImageIds,
    deleteImage,
    putTask,
    flushAgentConversationsToIndexedDB,
    shouldFlushAgentConversations: () =>
      agentConversationPersistQueued ||
      useStore.getState().agentConversations !== lastStoredAgentConversations,
    scheduleThumbnailBackfill,
    scheduleCustomRecovery: (taskId) =>
      taskExecutionController.scheduleCustomRecovery(taskId, 0),
    showSupportPromptForExistingLocalData,
  });
}

export async function submitTask(options: SubmitTaskOptions = {}) {
  await submitTaskAction(
    {
      getState: useStore.getState,
      putTask,
      executeTask,
    },
    options,
  );
}

export async function submitSeriesBatch(
  prompts: string[],
  options: SubmitSeriesBatchOptions = {},
) {
  await submitSeriesBatchAction(
    {
      getState: useStore.getState,
      putTask,
      executeTask,
    },
    prompts,
    options,
  );
}

async function storeTaskOutputImages(task: TaskRecord, images: string[]) {
  return storeTaskOutputImagesInDb(task, images, {
    getReferenceState: () => useStore.getState(),
  });
}

async function deleteUnreferencedImageIds(imageIds: Iterable<string>) {
  return deleteStoredUnreferencedImageIds(imageIds, {
    getReferenceState: () => useStore.getState(),
  });
}

async function persistTaskStreamPartialImage(taskId: string, dataUrl: string) {
  return persistStoredTaskStreamPartialImage(taskId, dataUrl, {
    getReferenceState: () => useStore.getState(),
    getTask: (id) => useStore.getState().tasks.find((task) => task.id === id),
    updateTask: updateTaskInStore,
  });
}

const taskExecutionController = createTaskExecutionController({
  getState: useStore.getState,
  updateTask: updateTaskInStore,
  storeTaskOutputImages,
  deleteUnreferencedImageIds,
  persistTaskStreamPartialImage,
  ensureImageCached,
  deleteCachedImage,
  showTaskCompletionNotification,
  showCodexCliPrompt,
  isAgentTask,
});

const agentRuntimeActions = createAgentRuntimeActions({
  getState: useStore.getState,
  setState: useStore.setState,
  putTask,
  updateTask: updateTaskInStore,
  storeImage,
  cacheImage,
  ensureImageCached,
  persistTaskStreamPartialImage,
  getRawErrorPayload,
  showTaskCompletionNotification,
});

export function stopAgentResponse(
  conversationId = useStore.getState().activeAgentConversationId,
) {
  agentRuntimeActions.stopAgentResponse(conversationId);
}

export async function submitAgentMessage() {
  await agentRuntimeActions.submitAgentMessage();
}

export async function regenerateAgentAssistantMessage(
  conversationId: string,
  roundId: string,
) {
  await agentRuntimeActions.regenerateAgentAssistantMessage(
    conversationId,
    roundId,
  );
}


function startQueuedTasks() {
  taskExecutionController.startQueuedTasks();
}

function executeTask(taskId: string) {
  taskExecutionController.executeTask(taskId);
}

function getRawErrorPayload(
  err: unknown,
): Pick<Partial<TaskRecord>, "rawImageUrls" | "rawResponsePayload"> {
  return taskExecutionController.getRawErrorPayload(err);
}

async function scrubAgentOutputPayloadsForDeletedTasks(
  deletedTasks: TaskRecord[],
  remainingTasks: TaskRecord[],
) {
  if (deletedTasks.length === 0) return remainingTasks;

  const conversations = scrubAgentConversationsForDeletedTasks(
    useStore.getState().agentConversations,
    deletedTasks,
  );
  const scrubbedTasks = remainingTasks.map((task) =>
    scrubTaskRawResponsePayloadForDeletedTasks(
      task,
      conversations,
      deletedTasks,
    ),
  );
  useStore.setState({ agentConversations: conversations });

  for (const task of scrubbedTasks) {
    const previous = remainingTasks.find((item) => item.id === task.id);
    if (previous?.rawResponsePayload !== task.rawResponsePayload)
      await putTask(task);
  }

  return scrubbedTasks;
}

export function updateTaskInStore(taskId: string, patch: Partial<TaskRecord>) {
  const { tasks, setTasks, defaultFavoriteCollectionId } = useStore.getState();
  const updated = tasks.map((t) =>
    t.id === taskId
      ? {
          ...t,
          ...normalizeFavoritePatch(t, patch, defaultFavoriteCollectionId),
        }
      : t,
  );
  const task = updated.find((t) => t.id === taskId);
  setTasks(updated);
  maybeOpenSupportPrompt(tasks, updated, taskId);
  if (task) putTask(task);
}

function getFavoriteStoreDependencies() {
  return {
    getState: useStore.getState,
    putTask,
    removeMultipleTasks,
  };
}

export function getTaskFavoriteCollectionIds(task: TaskRecord) {
  return getTaskFavoriteCollectionIdsAction(
    getFavoriteStoreDependencies(),
    task,
  );
}

export function getFavoriteCollectionTitle(
  collectionId: string | null,
  collections = useStore.getState().favoriteCollections,
) {
  return getFavoriteCollectionTitleAction(
    getFavoriteStoreDependencies(),
    collectionId,
    collections,
  );
}

export function createFavoriteCollection(name: string) {
  return createFavoriteCollectionAction(getFavoriteStoreDependencies(), name);
}

export function renameFavoriteCollection(collectionId: string, name: string) {
  return renameFavoriteCollectionAction(
    getFavoriteStoreDependencies(),
    collectionId,
    name,
  );
}

export async function updateTasksFavoriteCollections(
  taskIds: string[],
  collectionIds: string[],
) {
  return updateTasksFavoriteCollectionsAction(
    getFavoriteStoreDependencies(),
    taskIds,
    collectionIds,
  );
}

export async function deleteFavoriteCollection(
  collectionId: string,
  deleteTasks = false,
) {
  return deleteFavoriteCollectionAction(
    getFavoriteStoreDependencies(),
    collectionId,
    deleteTasks,
  );
}

function getGalleryRecordDependencies() {
  return {
    getState: useStore.getState,
    setState: useStore.setState,
    putTask,
    deleteTask: dbDeleteTask,
    deleteImage,
    deleteImageCacheEntry,
    ensureImageCached,
    executeTask,
    submitTask,
    removeMultipleTasks,
    scrubAgentOutputPayloadsForDeletedTasks,
  };
}

/** 重试失败的任务：创建新任务并执行 */
export async function retryTask(task: TaskRecord) {
  return retryTaskAction(getGalleryRecordDependencies(), task);
}

/** 复用配置 */
export async function retryMultipleTasks(taskIds: string[]) {
  return retryMultipleTasksAction(getGalleryRecordDependencies(), taskIds);
}

export async function reuseConfig(task: TaskRecord) {
  return reuseConfigAction(getGalleryRecordDependencies(), task);
}

/** 编辑任务输出 */
export async function editOutputs(task: TaskRecord) {
  return editOutputsAction(getGalleryRecordDependencies(), task);
}

export async function setTaskOutputAsSeriesReference(
  task: TaskRecord,
  imageId = task.outputImages?.[0],
) {
  return setTaskOutputAsSeriesReferenceAction(
    getGalleryRecordDependencies(),
    task,
    imageId,
  );
}

export async function removeMultipleTasks(taskIds: string[]) {
  return removeMultipleTasksAction(getGalleryRecordDependencies(), taskIds);
}

/** 清除失败的任务 */
export async function clearFailedTasks(taskIds?: string[]) {
  return clearFailedTasksAction(getGalleryRecordDependencies(), taskIds);
}

/** 删除任务 */
export async function removeTask(task: TaskRecord) {
  return removeTaskAction(getGalleryRecordDependencies(), task);
}

export async function clearData(
  options: ClearOptions = { clearConfig: true, clearTasks: true },
) {
  return clearDataAction(getDataLifecycleDependencies(), options);
}

function getDataLifecycleDependencies() {
  return {
    store: useStore,
    putTask,
    replaceStoredAgentConversations,
    skipSupportPromptForImportedData,
  };
}

export async function exportData(
  options: ExportOptions = { exportConfig: true, exportTasks: true },
) {
  return exportDataAction(getDataLifecycleDependencies(), options);
}

export async function importData(
  file: File,
  options: ImportOptions = { importConfig: true, importTasks: true },
): Promise<boolean> {
  return importDataAction(getDataLifecycleDependencies(), file, options);
}

export async function addImageFromFile(file: File): Promise<void> {
  return addImageFromFileAction(getDataLifecycleDependencies(), file);
}

export async function createInputImageFromFile(
  file: File,
): Promise<InputImage | null> {
  return createInputImageFromFileAction(file);
}

export async function addImageFromUrl(src: string): Promise<void> {
  return addImageFromUrlAction(getDataLifecycleDependencies(), src);
}
