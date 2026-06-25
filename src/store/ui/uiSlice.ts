import type { StateCreator } from "zustand";
import { dismissAllTooltips } from "../../lib/ui/tooltipDismiss";
import { getToastMessage } from "../../lib/gallery/toastMessages";
import type { AppState } from "../types";

export type UiSlice = Pick<
  AppState,
  | "detailTaskId"
  | "setDetailTaskId"
  | "lightboxImageId"
  | "lightboxImageList"
  | "setLightboxImageId"
  | "showSettings"
  | "settingsTabRequest"
  | "setShowSettings"
  | "supportPromptOpen"
  | "supportPromptDismissed"
  | "supportPromptSkippedForImportedData"
  | "agentContextNotice"
  | "setSupportPromptOpen"
  | "dismissSupportPrompt"
  | "toast"
  | "showToast"
  | "confirmDialog"
  | "setConfirmDialog"
>;

export const createUiSlice: StateCreator<AppState, [], [], UiSlice> = (set) => ({
  detailTaskId: null,
  setDetailTaskId: (detailTaskId) => {
    if (detailTaskId) dismissAllTooltips();
    set({ detailTaskId });
  },
  lightboxImageId: null,
  lightboxImageList: [],
  setLightboxImageId: (lightboxImageId, list) => {
    if (lightboxImageId) dismissAllTooltips();
    set({
      lightboxImageId,
      lightboxImageList: list ?? (lightboxImageId ? [lightboxImageId] : []),
    });
  },
  showSettings: false,
  settingsTabRequest: null,
  setShowSettings: (showSettings, settingsTabRequest) => {
    if (showSettings) dismissAllTooltips();
    set({
      showSettings,
      ...(settingsTabRequest ? { settingsTabRequest } : {}),
      ...(!showSettings ? { settingsTabRequest: null } : {}),
    });
  },
  supportPromptOpen: false,
  supportPromptDismissed: false,
  supportPromptSkippedForImportedData: false,
  agentContextNotice: null,
  setSupportPromptOpen: (supportPromptOpen) => set({ supportPromptOpen }),
  dismissSupportPrompt: () =>
    set({ supportPromptOpen: false, supportPromptDismissed: true }),
  toast: null,
  showToast: (message, type = "info") => {
    const toastMessage = getToastMessage(message, type);
    const toast = { message: toastMessage, type };
    set({ toast });
    setTimeout(() => {
      set((state) => (state.toast === toast ? { toast: null } : state));
    }, 3000);
  },
  confirmDialog: null,
  setConfirmDialog: (confirmDialog) => {
    if (confirmDialog) dismissAllTooltips();
    set({ confirmDialog });
  },
});
