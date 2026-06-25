import type { StateCreator } from "zustand";
import type { AppSettings } from "../../types";
import { DEFAULT_SETTINGS, normalizeSettings } from "../../lib/api/apiProfiles";
import type { AppState } from "../types";

export type SettingsSlice = Pick<
  AppState,
  "settings" | "setSettings" | "dismissedCodexCliPrompts" | "dismissCodexCliPrompt"
>;

export function createSettingsSlice(options: {
  onQueueResume: () => void;
}): StateCreator<AppState, [], [], SettingsSlice> {
  return (set) => ({
    settings: { ...DEFAULT_SETTINGS },
    setSettings: (s) =>
      set((state) => {
        const previous = normalizeSettings(state.settings);
        const incoming = s as Partial<AppSettings>;
        const hasLegacyOverrides =
          incoming.baseUrl !== undefined ||
          incoming.apiKey !== undefined ||
          incoming.model !== undefined ||
          incoming.timeout !== undefined ||
          incoming.apiMode !== undefined ||
          incoming.codexCli !== undefined ||
          incoming.apiProxy !== undefined ||
          incoming.streamImages !== undefined ||
          incoming.streamPartialImages !== undefined;
        const merged = normalizeSettings({ ...previous, ...incoming });
        if (hasLegacyOverrides && incoming.profiles === undefined) {
          merged.profiles = merged.profiles.map((profile) =>
            profile.id === merged.activeProfileId
              ? {
                  ...profile,
                  baseUrl: incoming.baseUrl ?? profile.baseUrl,
                  apiKey: incoming.apiKey ?? profile.apiKey,
                  model: incoming.model ?? profile.model,
                  timeout: incoming.timeout ?? profile.timeout,
                  apiMode:
                    incoming.apiMode === "images" ||
                    incoming.apiMode === "responses" ||
                    incoming.apiMode === "videos"
                      ? incoming.apiMode
                      : profile.apiMode,
                  codexCli: incoming.codexCli ?? profile.codexCli,
                  apiProxy: incoming.apiProxy ?? profile.apiProxy,
                  streamImages: incoming.streamImages ?? profile.streamImages,
                  streamPartialImages:
                    incoming.streamPartialImages ?? profile.streamPartialImages,
                }
              : profile,
          );
        }
        const settings = normalizeSettings(merged);
        const shouldClearReusedProfile =
          state.reusedTaskApiProfileId &&
          settings.activeProfileId === state.reusedTaskApiProfileId;
        if (!settings.queuePaused) setTimeout(options.onQueueResume, 0);
        return {
          settings,
          ...(shouldClearReusedProfile
            ? {
                reusedTaskApiProfileId: null,
                reusedTaskApiProfileName: null,
                reusedTaskApiProfileMissing: false,
              }
            : {}),
        };
      }),
    dismissedCodexCliPrompts: [],
    dismissCodexCliPrompt: (key) =>
      set((state) => ({
        dismissedCodexCliPrompts: state.dismissedCodexCliPrompts.includes(key)
          ? state.dismissedCodexCliPrompts
          : [...state.dismissedCodexCliPrompts, key],
      })),
  });
}
