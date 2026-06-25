import type {
  AgentConversation,
  AgentDiagnosticLog,
  AppSettings,
  InputImage,
  ResponsesOutputItem,
  SeriesReferenceImage,
  SeriesReferenceSlot,
  TaskRecord,
} from "../../types";
import type { AppState } from "../types";
import { normalizeSettings } from "../../lib/api/apiProfiles";
import {
  getPersistableAgentConversations,
  getPersistableResponseOutputItem,
  normalizeAgentConversations,
} from "../../lib/agent/agentConversationStorage";
import {
  cleanStaleAgentInputDrafts,
  getPersistableAgentInputDrafts,
  getPersistableGalleryInputDraft,
  isEmptyAgentInputDraft,
  normalizeAgentInputDraft,
  normalizeAgentInputDrafts,
  normalizeAgentInputDraftsByKey,
  restoreAgentInputDraftState,
} from "../../lib/storage/inputDrafts";
import {
  ensureDefaultFavoriteCollection,
  normalizeFavoriteCollections,
  resolveDefaultFavoriteCollectionId,
} from "../../lib/storage/favoriteCollections";
import {
  normalizeCreativeNegativePresets,
  normalizeCreativeStylePresets,
  normalizeCreativeSubjectProfiles,
  normalizePromptTemplates,
} from "../../lib/creative/creativeAssets";
import {
  normalizeSeriesReferenceHistory,
  normalizeSeriesReferenceImage,
  normalizeSeriesReferenceSlots,
  stripSeriesReferencePayload,
} from "../../lib/gallery/seriesReferences";
import { getImage, replaceAgentConversations } from "../../lib/storage/db";
import { cacheImage } from "../../lib/storage/imageCache";

let agentConversationPersistenceReady = false;
let agentConversationMigrationPending = false;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function isAgentConversationPersistenceReady() {
  return agentConversationPersistenceReady;
}

export function consumeAgentConversationMigrationPending() {
  const pending = agentConversationMigrationPending;
  agentConversationPersistenceReady = true;
  agentConversationMigrationPending = false;
  return pending;
}

export function getPersistedState(state: AppState) {
  const settings = normalizeSettings(state.settings);
  const galleryInputDraft = getPersistableGalleryInputDraft(state);
  return {
    settings,
    params: state.params,
    ...(settings.persistInputOnRestart &&
    (state.appMode === "gallery" || galleryInputDraft)
      ? {
          prompt: galleryInputDraft?.prompt ?? "",
          inputImages:
            galleryInputDraft?.inputImages.map((img) => ({
              id: img.id,
              dataUrl: "",
            })) ?? [],
        }
      : {}),
    dismissedCodexCliPrompts: state.dismissedCodexCliPrompts,
    appMode: state.appMode,
    galleryInputDraft:
      settings.persistInputOnRestart && galleryInputDraft
        ? {
            ...galleryInputDraft,
            inputImages: galleryInputDraft.inputImages.map((img) => ({
              id: img.id,
              dataUrl: "",
            })),
          }
        : null,
    ...(agentConversationMigrationPending && !agentConversationPersistenceReady
      ? {
          agentConversations: getPersistableAgentConversations(
            state.agentConversations,
          ),
        }
      : {}),
    activeAgentConversationId: state.activeAgentConversationId,
    agentInputDrafts: getPersistableAgentInputDrafts(state),
    agentSidebarCollapsed: state.agentSidebarCollapsed,
    agentAssetTab: state.agentAssetTab,
    agentAssetPanelCollapsed: state.agentAssetPanelCollapsed,
    favoriteCollections: state.favoriteCollections,
    defaultFavoriteCollectionId: state.defaultFavoriteCollectionId,
    promptTemplates: state.promptTemplates,
    creativeStylePresets: state.creativeStylePresets,
    creativeSubjectProfiles: state.creativeSubjectProfiles,
    creativeNegativePresets: state.creativeNegativePresets,
    seriesReferenceImage: state.seriesReferenceImage
      ? stripSeriesReferencePayload(state.seriesReferenceImage)
      : null,
    seriesReferenceHistory: state.seriesReferenceHistory.map(
      stripSeriesReferencePayload,
    ),
    seriesReferenceSlots: {
      person: state.seriesReferenceSlots.person
        ? stripSeriesReferencePayload(state.seriesReferenceSlots.person)
        : null,
      product: state.seriesReferenceSlots.product
        ? stripSeriesReferencePayload(state.seriesReferenceSlots.product)
        : null,
      style: state.seriesReferenceSlots.style
        ? stripSeriesReferencePayload(state.seriesReferenceSlots.style)
        : null,
    },
    utilityPanelOpen: state.utilityPanelOpen,
    agentDiagnosticLogs: state.agentDiagnosticLogs.slice(0, 80),
    supportPromptDismissed: state.supportPromptDismissed,
    supportPromptOpen: state.supportPromptOpen,
    supportPromptSkippedForImportedData:
      state.supportPromptSkippedForImportedData,
  };
}

export function mergePersistedState(
  persistedState: unknown,
  currentState: AppState,
): AppState {
  if (!persistedState || typeof persistedState !== "object")
    return currentState;

  const persisted = persistedState as Partial<AppState>;
  const settings = normalizeSettings(
    persisted.settings ?? currentState.settings,
  );
  const hasPersistedAgentConversations = Array.isArray(
    persisted.agentConversations,
  );
  if (
    hasPersistedAgentConversations &&
    normalizeAgentConversations(persisted.agentConversations).length > 0
  ) {
    agentConversationMigrationPending = true;
  }
  const agentConversations = hasPersistedAgentConversations
    ? normalizeAgentConversations(persisted.agentConversations)
    : currentState.agentConversations;
  const activeAgentConversationId =
    typeof persisted.activeAgentConversationId === "string" &&
    (!hasPersistedAgentConversations ||
      agentConversations.some(
        (conversation) =>
          conversation.id === persisted.activeAgentConversationId,
      ))
      ? persisted.activeAgentConversationId
      : (agentConversations[0]?.id ?? null);
  const appMode =
    persisted.appMode === "agent" || persisted.appMode === "video"
      ? persisted.appMode
      : "gallery";
  const galleryInputDraft = settings.persistInputOnRestart
    ? normalizeAgentInputDraft(
        persisted.galleryInputDraft ?? {
          prompt: persisted.prompt,
          inputImages: persisted.inputImages,
          maskDraft: null,
          maskEditorImageId: null,
        },
      )
    : null;
  const normalizedAgentInputDrafts = hasPersistedAgentConversations
    ? normalizeAgentInputDrafts(persisted.agentInputDrafts, agentConversations)
    : normalizeAgentInputDraftsByKey(persisted.agentInputDrafts);
  let agentInputDrafts = cleanStaleAgentInputDrafts(
    normalizedAgentInputDrafts,
    activeAgentConversationId,
  );
  if (
    appMode === "agent" &&
    activeAgentConversationId &&
    !agentInputDrafts[activeAgentConversationId] &&
    settings.persistInputOnRestart &&
    typeof persisted.prompt === "string"
  ) {
    agentInputDrafts = {
      ...agentInputDrafts,
      [activeAgentConversationId]: normalizeAgentInputDraft(
        {
          prompt: persisted.prompt,
          inputImages: persisted.inputImages,
          maskDraft: null,
          maskEditorImageId: null,
        },
        Date.now(),
      ),
    };
  }
  const restoredAgentDraft =
    appMode === "agent" && activeAgentConversationId
      ? (agentInputDrafts[activeAgentConversationId] ?? null)
      : null;
  const favoriteCollections = Array.isArray(persisted.favoriteCollections)
    ? ensureDefaultFavoriteCollection(
        normalizeFavoriteCollections(persisted.favoriteCollections),
      )
    : currentState.favoriteCollections;
  const promptTemplates = normalizePromptTemplates(
    persisted.promptTemplates ?? currentState.promptTemplates,
  );
  const creativeStylePresets = normalizeCreativeStylePresets(
    persisted.creativeStylePresets ?? currentState.creativeStylePresets,
  );
  const creativeSubjectProfiles = normalizeCreativeSubjectProfiles(
    persisted.creativeSubjectProfiles ?? currentState.creativeSubjectProfiles,
  );
  const creativeNegativePresets = normalizeCreativeNegativePresets(
    persisted.creativeNegativePresets ?? currentState.creativeNegativePresets,
  );
  const seriesReferenceImage = normalizeSeriesReferenceImage(
    persisted.seriesReferenceImage ?? currentState.seriesReferenceImage,
  );
  const seriesReferenceHistory = normalizeSeriesReferenceHistory(
    persisted.seriesReferenceHistory ?? currentState.seriesReferenceHistory,
  );
  const seriesReferenceSlots = normalizeSeriesReferenceSlots(
    persisted.seriesReferenceSlots ?? currentState.seriesReferenceSlots,
  );
  const agentDiagnosticLogs = Array.isArray(persisted.agentDiagnosticLogs)
    ? persisted.agentDiagnosticLogs
        .filter(
          (item: unknown): item is AgentDiagnosticLog =>
            isRecord(item) &&
            typeof item.message === "string" &&
            typeof item.createdAt === "number",
        )
        .slice(0, 80)
    : currentState.agentDiagnosticLogs;
  const defaultFavoriteCollectionId = resolveDefaultFavoriteCollectionId(
    favoriteCollections,
    persisted.defaultFavoriteCollectionId,
  );
  return {
    ...currentState,
    ...persisted,
    settings,
    appMode,
    galleryInputDraft:
      galleryInputDraft && !isEmptyAgentInputDraft(galleryInputDraft)
        ? galleryInputDraft
        : null,
    agentConversations,
    activeAgentConversationId,
    agentInputDrafts,
    agentSidebarCollapsed: Boolean(persisted.agentSidebarCollapsed),
    agentAssetTab:
      persisted.agentAssetTab === "references" ? "references" : "outputs",
    agentAssetPanelCollapsed: Boolean(persisted.agentAssetPanelCollapsed),
    favoriteCollections,
    promptTemplates,
    creativeStylePresets,
    creativeSubjectProfiles,
    creativeNegativePresets,
    seriesReferenceImage,
    seriesReferenceHistory,
    seriesReferenceSlots,
    utilityPanelOpen: Boolean(persisted.utilityPanelOpen),
    agentDiagnosticLogs,
    defaultFavoriteCollectionId,
    activeFavoriteCollectionId: null,
    favoritePickerTaskIds: null,
    supportPromptDismissed: Boolean(persisted.supportPromptDismissed),
    supportPromptOpen: Boolean(persisted.supportPromptOpen),
    supportPromptSkippedForImportedData: Boolean(
      persisted.supportPromptSkippedForImportedData,
    ),
    prompt: restoredAgentDraft
      ? restoredAgentDraft.prompt
      : (galleryInputDraft?.prompt ?? ""),
    inputImages: restoredAgentDraft
      ? restoredAgentDraft.inputImages
      : (galleryInputDraft?.inputImages ?? []),
    maskDraft: restoredAgentDraft
      ? restoredAgentDraft.maskDraft
      : (galleryInputDraft?.maskDraft ?? null),
    maskEditorImageId: restoredAgentDraft
      ? restoredAgentDraft.maskEditorImageId
      : (galleryInputDraft?.maskEditorImageId ?? null),
  };
}

export async function replaceStoredAgentConversations(
  conversations: AgentConversation[],
) {
  await replaceAgentConversations(
    conversations.map(getPersistableAgentConversation),
  );
}

export function getPersistableAgentConversation(
  conversation: AgentConversation,
): AgentConversation {
  return getPersistableAgentConversations([conversation])[0]!;
}

export async function restoreSeriesReferenceImageData(
  image: SeriesReferenceImage | null,
) {
  if (!image?.id || image.dataUrl) return image;
  const storedImage = await getImage(image.id);
  if (!storedImage?.dataUrl) return null;
  cacheImage(image.id, storedImage.dataUrl);
  return { ...image, dataUrl: storedImage.dataUrl };
}

export function getPersistableRawResponsePayload(rawResponsePayload?: string) {
  if (!rawResponsePayload) return rawResponsePayload;
  try {
    const payload = JSON.parse(rawResponsePayload) as { output?: unknown };
    if (!Array.isArray(payload.output)) return rawResponsePayload;
    const output = payload.output.map((item) =>
      isRecord(item)
        ? getPersistableResponseOutputItem(item as ResponsesOutputItem)
        : item,
    );
    return JSON.stringify({ ...payload, output }, null, 2);
  } catch {
    return rawResponsePayload;
  }
}

export function getPersistableTask(task: TaskRecord): TaskRecord {
  const rawResponsePayload = getPersistableRawResponsePayload(
    task.rawResponsePayload,
  );
  if (rawResponsePayload === task.rawResponsePayload) return task;
  return { ...task, rawResponsePayload };
}

export async function restoreInputImagesFromStorage(images: InputImage[]) {
  const restoredInputImages: InputImage[] = [];
  for (const img of images) {
    if (img.dataUrl) {
      restoredInputImages.push(img);
      cacheImage(img.id, img.dataUrl);
      continue;
    }
    const storedImage = await getImage(img.id);
    if (storedImage?.dataUrl) {
      restoredInputImages.push({ ...img, dataUrl: storedImage.dataUrl });
      cacheImage(img.id, storedImage.dataUrl);
    }
  }
  return restoredInputImages;
}

export function hasInputImagesChanged(
  previous: InputImage[],
  restored: InputImage[],
) {
  return (
    restored.length !== previous.length ||
    restored.some((img, index) => img.dataUrl !== previous[index]?.dataUrl)
  );
}

export function createEmptySeriesReferenceSlots(): Record<
  SeriesReferenceSlot,
  SeriesReferenceImage | null
> {
  return { person: null, product: null, style: null };
}
