import type {
  AgentConversation,
  AgentDiagnosticLog,
  AppMode,
  AppSettings,
  CreativeNegativePreset,
  CreativeStylePreset,
  CreativeSubjectProfile,
  FavoriteCollection,
  InputImage,
  MaskDraft,
  PromptTemplate,
  SeriesReferenceImage,
  SeriesReferenceSlot,
  TaskParams,
  TaskRecord,
} from "../types";
import type { GalleryTaskFilterStatus } from "../lib/gallery/galleryTasks";
import type { AgentInputDraft } from "../lib/storage/inputDrafts";
import type { ToastType } from "../lib/gallery/toastMessages";

export type AgentContextNotice = {
  conversationId: string;
  roundId: string;
  message: string;
  createdAt: number;
};

export type SettingsTab = "general" | "agent" | "api" | "data" | "about";

export type ConfirmDialogState = {
  title: string;
  message: string;
  checkbox?: {
    label: string;
    defaultChecked?: boolean;
    disabled?: boolean;
    tone?: "primary" | "danger";
  };
  confirmText?: string;
  cancelText?: string;
  showCancel?: boolean;
  buttons?: Array<{
    label: string;
    tone?: "primary" | "secondary" | "danger" | "warning";
    action: (checkboxChecked?: boolean) => void;
  }>;
  icon?: "info" | "copy";
  minConfirmDelayMs?: number;
  messageAlign?: "left" | "center";
  tone?: "danger" | "warning";
  action?: (checkboxChecked?: boolean) => void;
  cancelAction?: (checkboxChecked?: boolean) => void;
} | null;

export interface AppState {
  appMode: AppMode;
  setAppMode: (mode: AppMode) => void;

  settings: AppSettings;
  setSettings: (s: Partial<AppSettings>) => void;
  dismissedCodexCliPrompts: string[];
  dismissCodexCliPrompt: (key: string) => void;

  prompt: string;
  setPrompt: (p: string) => void;
  inputImages: InputImage[];
  addInputImage: (img: InputImage) => void;
  replaceInputImage: (idx: number, img: InputImage) => void;
  removeInputImage: (idx: number) => void;
  clearInputImages: () => void;
  setInputImages: (
    imgs: InputImage[],
    options?: { equivalentImageIds?: Record<string, string> },
  ) => void;
  moveInputImage: (fromIdx: number, toIdx: number) => void;
  maskDraft: MaskDraft | null;
  setMaskDraft: (draft: MaskDraft | null) => void;
  clearMaskDraft: () => void;
  maskEditorImageId: string | null;
  setMaskEditorImageId: (id: string | null) => void;
  galleryInputDraft: AgentInputDraft | null;
  seriesReferenceImage: SeriesReferenceImage | null;
  setSeriesReferenceImage: (image: SeriesReferenceImage | null) => void;
  seriesReferenceHistory: SeriesReferenceImage[];
  removeSeriesReferenceHistoryItem: (imageId: string) => void;
  seriesReferenceSlots: Record<
    SeriesReferenceSlot,
    SeriesReferenceImage | null
  >;
  setSeriesReferenceSlot: (
    slot: SeriesReferenceSlot,
    image: SeriesReferenceImage | null,
  ) => void;
  setSeriesReferenceFromSlot: (slot: SeriesReferenceSlot) => void;

  params: TaskParams;
  setParams: (p: Partial<TaskParams>) => void;
  reusedTaskApiProfileId: string | null;
  reusedTaskApiProfileName: string | null;
  reusedTaskApiProfileMissing: boolean;
  setReusedTaskApiProfile: (
    profileId: string | null,
    missing?: boolean,
    profileName?: string | null,
  ) => void;

  agentConversations: AgentConversation[];
  agentConversationsLoaded: boolean;
  activeAgentConversationId: string | null;
  agentInputDrafts: Record<string, AgentInputDraft>;
  agentSidebarCollapsed: boolean;
  agentAssetTab: "references" | "outputs";
  agentAssetPanelCollapsed: boolean;
  agentMobileHeaderVisible: boolean;
  agentEditingRoundId: string | null;
  agentEditingConversationId: string | null;
  agentGeneratingTitleIds: Record<string, true>;
  createAgentConversation: () => string;
  setActiveAgentConversationId: (id: string | null) => void;
  setActiveAgentRoundId: (
    conversationId: string,
    roundId: string | null,
  ) => void;
  renameAgentConversation: (id: string, title: string) => void;
  deleteAgentConversation: (id: string) => void;
  clearAgentConversation: (id: string) => void;
  setAgentSidebarCollapsed: (collapsed: boolean) => void;
  setAgentAssetTab: (tab: "references" | "outputs") => void;
  setAgentAssetPanelCollapsed: (collapsed: boolean) => void;
  setAgentMobileHeaderVisible: (visible: boolean) => void;
  setAgentEditingRoundId: (id: string | null) => void;
  setAgentEditingConversationId: (id: string | null) => void;

  tasks: TaskRecord[];
  setTasks: (t: TaskRecord[]) => void;
  favoriteCollections: FavoriteCollection[];
  setFavoriteCollections: (collections: FavoriteCollection[]) => void;
  defaultFavoriteCollectionId: string | null;
  setDefaultFavoriteCollectionId: (id: string | null) => void;
  activeFavoriteCollectionId: string | null;
  isManageCollectionsModalOpen: boolean;
  setActiveFavoriteCollectionId: (id: string | null) => void;
  openManageCollectionsModal: () => void;
  closeManageCollectionsModal: () => void;
  favoritePickerTaskIds: string[] | null;
  openFavoritePicker: (taskIds: string[]) => void;
  closeFavoritePicker: () => void;
  updateTaskMetadata: (
    taskId: string,
    patch: Pick<Partial<TaskRecord>, "note" | "tags">,
  ) => void;
  markTasksCompared: (taskIds: string[]) => void;
  streamPreviews: Record<string, string>;
  streamPreviewSlots: Record<string, Record<string, string>>;
  setTaskStreamPreview: (
    taskId: string,
    image?: string,
    requestIndex?: number,
  ) => void;

  promptTemplates: PromptTemplate[];
  addPromptTemplate: (
    template: Pick<PromptTemplate, "title" | "content" | "category">,
  ) => void;
  updatePromptTemplate: (
    id: string,
    patch: Partial<Pick<PromptTemplate, "title" | "content" | "category">>,
  ) => void;
  deletePromptTemplate: (id: string) => void;
  creativeAssetsOpen: boolean;
  setCreativeAssetsOpen: (open: boolean) => void;
  creativeStylePresets: CreativeStylePreset[];
  addCreativeStylePreset: (
    preset: Pick<CreativeStylePreset, "title" | "content"> & {
      tags?: string[];
    },
  ) => void;
  updateCreativeStylePreset: (
    id: string,
    patch: Partial<Pick<CreativeStylePreset, "title" | "content" | "tags">>,
  ) => void;
  deleteCreativeStylePreset: (id: string) => void;
  creativeSubjectProfiles: CreativeSubjectProfile[];
  addCreativeSubjectProfile: (
    profile: Pick<CreativeSubjectProfile, "name" | "description"> & {
      negativePrompt?: string;
    },
  ) => void;
  updateCreativeSubjectProfile: (
    id: string,
    patch: Partial<
      Pick<CreativeSubjectProfile, "name" | "description" | "negativePrompt">
    >,
  ) => void;
  deleteCreativeSubjectProfile: (id: string) => void;
  creativeNegativePresets: CreativeNegativePreset[];
  addCreativeNegativePreset: (
    preset: Pick<CreativeNegativePreset, "title" | "content">,
  ) => void;
  updateCreativeNegativePreset: (
    id: string,
    patch: Partial<Pick<CreativeNegativePreset, "title" | "content">>,
  ) => void;
  deleteCreativeNegativePreset: (id: string) => void;
  utilityPanelOpen: boolean;
  setUtilityPanelOpen: (open: boolean) => void;
  agentDiagnosticLogs: AgentDiagnosticLog[];
  addAgentDiagnosticLog: (
    log: Omit<AgentDiagnosticLog, "id" | "createdAt"> & { createdAt?: number },
  ) => void;
  clearAgentDiagnosticLogs: () => void;

  searchQuery: string;
  setSearchQuery: (q: string) => void;
  filterStatus: GalleryTaskFilterStatus;
  setFilterStatus: (status: AppState["filterStatus"]) => void;
  filterFavorite: boolean;
  setFilterFavorite: (f: boolean) => void;

  selectedTaskIds: string[];
  setSelectedTaskIds: (ids: string[] | ((prev: string[]) => string[])) => void;
  toggleTaskSelection: (id: string, force?: boolean) => void;
  clearSelection: () => void;
  selectedFavoriteCollectionIds: string[];
  setSelectedFavoriteCollectionIds: (
    ids: string[] | ((prev: string[]) => string[]),
  ) => void;
  toggleFavoriteCollectionSelection: (id: string, force?: boolean) => void;
  clearFavoriteCollectionSelection: () => void;

  detailTaskId: string | null;
  setDetailTaskId: (id: string | null) => void;
  lightboxImageId: string | null;
  lightboxImageList: string[];
  setLightboxImageId: (id: string | null, list?: string[]) => void;
  showSettings: boolean;
  settingsTabRequest: SettingsTab | null;
  setShowSettings: (v: boolean, tab?: SettingsTab) => void;
  supportPromptOpen: boolean;
  supportPromptDismissed: boolean;
  supportPromptSkippedForImportedData: boolean;
  agentContextNotice: AgentContextNotice | null;
  setSupportPromptOpen: (v: boolean) => void;
  dismissSupportPrompt: () => void;

  toast: { message: string; type: ToastType } | null;
  showToast: (message: string, type?: ToastType) => void;

  confirmDialog: ConfirmDialogState;
  setConfirmDialog: (d: ConfirmDialogState) => void;
}
