import type { SeriesReferenceImage, TaskRecord } from "../../types";
import {
  mergeAgentConversationsForStorage,
  normalizeAgentConversations,
} from "../../lib/agent/agentConversationStorage";
import { collectStateReferencedImageIds } from "../../lib/gallery/imageReferences";
import { remapImageMentionsForOrder } from "../../lib/gallery/promptImageMentions";
import { normalizeLoadedFavoriteState } from "../../lib/storage/favoriteCollections";
import {
  cleanStaleAgentInputDrafts,
  isEmptyAgentInputDraft,
  normalizeAgentInputDrafts,
  restoreAgentInputDraftState,
  restoreGalleryInputDraftState,
  type AgentInputDraft,
} from "../../lib/storage/inputDrafts";
import { SERIES_REFERENCE_SLOTS } from "../../lib/gallery/seriesReferences";
import { OPENAI_INTERRUPTED_ERROR } from "../../lib/gallery/taskErrorHandling";
import type { AppState } from "../types";
import {
  consumeAgentConversationMigrationPending,
  createEmptySeriesReferenceSlots,
  getPersistableTask,
  hasInputImagesChanged,
  replaceStoredAgentConversations,
  restoreInputImagesFromStorage,
  restoreSeriesReferenceImageData,
} from "./persistence";

type InitStoreDependencies = {
  getState: () => AppState;
  setState: (
    partial:
      | Partial<AppState>
      | ((state: AppState) => Partial<AppState>),
  ) => void;
  getAllTasks: () => Promise<TaskRecord[]>;
  getAllAgentConversations: () => Promise<AppState["agentConversations"]>;
  getAllImageIds: () => Promise<string[]>;
  deleteImage: (imageId: string) => Promise<void>;
  putTask: (task: TaskRecord) => Promise<IDBValidKey>;
  flushAgentConversationsToIndexedDB: () => Promise<void>;
  shouldFlushAgentConversations: () => boolean;
  scheduleThumbnailBackfill: (imageIds: string[]) => void;
  scheduleCustomRecovery: (taskId: string) => void;
  showSupportPromptForExistingLocalData: (tasks: TaskRecord[]) => void;
};

export function markInterruptedOpenAIRunningTasks(
  tasks: TaskRecord[],
  now = Date.now(),
) {
  const interruptedTasks: TaskRecord[] = [];
  const updatedTasks = tasks.map((task) => {
    if (task.status !== "running" || task.customTaskId) return task;

    const updated: TaskRecord = {
      ...task,
      status: "error",
      error: OPENAI_INTERRUPTED_ERROR,
      falRecoverable: false,
      finishedAt: now,
      elapsed: Math.max(0, now - task.createdAt),
    };
    interruptedTasks.push(updated);
    return updated;
  });

  return { tasks: updatedTasks, interruptedTasks };
}

export async function initStoreAction(deps: InitStoreDependencies) {
  const legacyAgentConversations = normalizeAgentConversations(
    deps.getState().agentConversations,
  );
  const storedTasks = await deps.getAllTasks();
  const storedAgentConversations = normalizeAgentConversations(
    await deps.getAllAgentConversations(),
  );
  let loadedAgentConversations = mergeAgentConversationsForStorage(
    storedAgentConversations,
    legacyAgentConversations,
  );
  const currentAgentConversations = normalizeAgentConversations(
    deps.getState().agentConversations,
  );
  loadedAgentConversations = mergeAgentConversationsForStorage(
    loadedAgentConversations,
    currentAgentConversations,
  );
  const activeAgentConversationId =
    deps.getState().activeAgentConversationId &&
    loadedAgentConversations.some(
      (conversation) =>
        conversation.id === deps.getState().activeAgentConversationId,
    )
      ? deps.getState().activeAgentConversationId
      : (loadedAgentConversations[0]?.id ?? null);
  if (
    loadedAgentConversations.length > 0 ||
    legacyAgentConversations.length > 0
  ) {
    deps.setState((state) => {
      const agentInputDrafts = cleanStaleAgentInputDrafts(
        normalizeAgentInputDrafts(
          state.agentInputDrafts,
          loadedAgentConversations,
        ),
        activeAgentConversationId,
      );
      return {
        agentConversations: loadedAgentConversations,
        agentConversationsLoaded: true,
        activeAgentConversationId,
        agentInputDrafts,
        ...(state.appMode === "agent"
          ? restoreAgentInputDraftState(
              agentInputDrafts,
              activeAgentConversationId,
            )
          : {}),
      };
    });
    await replaceStoredAgentConversations(loadedAgentConversations);
  } else {
    deps.setState({ agentConversationsLoaded: true });
  }

  const shouldRewritePersistedLocalState =
    consumeAgentConversationMigrationPending();
  if (deps.shouldFlushAgentConversations()) {
    await deps.flushAgentConversationsToIndexedDB();
  }
  if (shouldRewritePersistedLocalState) {
    deps.setState({});
  }

  const { tasks: markedTasks, interruptedTasks } =
    markInterruptedOpenAIRunningTasks(storedTasks);
  const interruptedTaskIds = new Set(interruptedTasks.map((task) => task.id));
  const favoriteState = deps.getState();
  const normalizedFavorites = normalizeLoadedFavoriteState(
    markedTasks.map(getPersistableTask),
    favoriteState.favoriteCollections,
    favoriteState.defaultFavoriteCollectionId,
  );
  const tasks = normalizedFavorites.tasks;
  if (normalizedFavorites.collections !== favoriteState.favoriteCollections) {
    favoriteState.setFavoriteCollections(normalizedFavorites.collections);
  }
  if (
    normalizedFavorites.defaultFavoriteCollectionId !==
    favoriteState.defaultFavoriteCollectionId
  ) {
    deps
      .getState()
      .setDefaultFavoriteCollectionId(
        normalizedFavorites.defaultFavoriteCollectionId,
      );
  }
  await Promise.all(
    tasks
      .filter(
        (task, index) =>
          normalizedFavorites.changed ||
          interruptedTaskIds.has(task.id) ||
          task.rawResponsePayload !== markedTasks[index]?.rawResponsePayload,
      )
      .map((task) => deps.putTask(task)),
  );
  deps.getState().setTasks(tasks);
  deps.showSupportPromptForExistingLocalData(tasks);
  for (const task of tasks) {
    if (
      task.customTaskId &&
      (task.status === "running" || task.customRecoverable)
    ) {
      deps.scheduleCustomRecovery(task.id);
    }
  }

  const state = deps.getState();
  const persistedInputImages = state.inputImages;
  const galleryInputDraft = state.galleryInputDraft;
  const seriesReferenceImage = state.seriesReferenceImage;
  const seriesReferenceHistory = state.seriesReferenceHistory;
  const seriesReferenceSlots = state.seriesReferenceSlots;
  const agentConversations = state.agentConversations;
  const agentInputDrafts = state.agentInputDrafts;
  const referencedIds = collectStateReferencedImageIds({
    tasks,
    inputImages: persistedInputImages,
    galleryInputDraft,
    agentInputDrafts,
    agentConversations,
    seriesReferenceImage,
    seriesReferenceHistory,
    seriesReferenceSlots,
  });

  const imageIds = await deps.getAllImageIds();
  const referencedImageIds: string[] = [];
  for (const imageId of imageIds) {
    if (referencedIds.has(imageId)) {
      referencedImageIds.push(imageId);
    } else {
      await deps.deleteImage(imageId);
    }
  }
  deps.scheduleThumbnailBackfill(referencedImageIds);

  const restoredInputImages =
    await restoreInputImagesFromStorage(persistedInputImages);
  if (hasInputImagesChanged(persistedInputImages, restoredInputImages)) {
    deps.getState().setInputImages(restoredInputImages);
  }

  const restoredSeriesReferenceImage =
    await restoreSeriesReferenceImageData(seriesReferenceImage);
  const restoredSeriesReferenceHistory = (
    await Promise.all(
      seriesReferenceHistory.map((image) =>
        restoreSeriesReferenceImageData(image),
      ),
    )
  ).filter((image): image is SeriesReferenceImage => Boolean(image));
  const restoredSeriesReferenceSlots = createEmptySeriesReferenceSlots();
  for (const slot of SERIES_REFERENCE_SLOTS) {
    restoredSeriesReferenceSlots[slot] = await restoreSeriesReferenceImageData(
      seriesReferenceSlots[slot],
    );
  }
  deps.setState({
    seriesReferenceImage: restoredSeriesReferenceImage,
    seriesReferenceHistory: restoredSeriesReferenceHistory,
    seriesReferenceSlots: restoredSeriesReferenceSlots,
  });

  if (galleryInputDraft) {
    const restoredGalleryImages = await restoreInputImagesFromStorage(
      galleryInputDraft.inputImages,
    );
    const shouldClearMask =
      Boolean(galleryInputDraft.maskDraft) &&
      !restoredGalleryImages.some(
        (image) => image.id === galleryInputDraft.maskDraft?.targetImageId,
      );
    const restoredGalleryDraft: AgentInputDraft = {
      ...galleryInputDraft,
      inputImages: restoredGalleryImages,
      prompt: remapImageMentionsForOrder(
        galleryInputDraft.prompt,
        galleryInputDraft.inputImages,
        restoredGalleryImages,
      ),
      ...(shouldClearMask ? { maskDraft: null, maskEditorImageId: null } : {}),
    };
    const galleryDraftsChanged =
      hasInputImagesChanged(
        galleryInputDraft.inputImages,
        restoredGalleryImages,
      ) || shouldClearMask;
    if (galleryDraftsChanged) {
      const latestState = deps.getState();
      const nextGalleryInputDraft = isEmptyAgentInputDraft(restoredGalleryDraft)
        ? null
        : restoredGalleryDraft;
      deps.setState({
        galleryInputDraft: nextGalleryInputDraft,
        ...(latestState.appMode === "gallery"
          ? restoreGalleryInputDraftState(nextGalleryInputDraft)
          : {}),
      });
    }
  }

  const restoredAgentInputDrafts: Record<string, AgentInputDraft> = {};
  let agentDraftsChanged = false;
  for (const [conversationId, draft] of Object.entries(agentInputDrafts)) {
    const restoredDraftImages = await restoreInputImagesFromStorage(
      draft.inputImages,
    );

    const shouldClearMask =
      Boolean(draft.maskDraft) &&
      !restoredDraftImages.some(
        (image) => image.id === draft.maskDraft?.targetImageId,
      );
    const restoredDraft: AgentInputDraft = {
      ...draft,
      inputImages: restoredDraftImages,
      prompt: remapImageMentionsForOrder(
        draft.prompt,
        draft.inputImages,
        restoredDraftImages,
      ),
      ...(shouldClearMask ? { maskDraft: null, maskEditorImageId: null } : {}),
    };
    if (!isEmptyAgentInputDraft(restoredDraft))
      restoredAgentInputDrafts[conversationId] = restoredDraft;
    if (
      hasInputImagesChanged(draft.inputImages, restoredDraftImages) ||
      shouldClearMask
    ) {
      agentDraftsChanged = true;
    }
  }
  if (agentDraftsChanged) {
    const latestState = deps.getState();
    deps.setState({
      agentInputDrafts: restoredAgentInputDrafts,
      ...(latestState.appMode === "agent"
        ? restoreAgentInputDraftState(
            restoredAgentInputDrafts,
            latestState.activeAgentConversationId,
          )
        : {}),
    });
  }
}
