import type { ApiProfile, AppSettings, TaskParams, TaskRecord } from "../../types";
import {
  getCustomProviderDefinition,
  normalizeSettings,
} from "./apiProfiles";

export function isAsyncCustomProviderTask(
  settings: AppSettings,
  provider: string,
  hasInputImages: boolean,
) {
  const customProvider = getCustomProviderDefinition(settings, provider);
  if (!customProvider?.poll) return false;
  const submitMapping =
    hasInputImages && customProvider.editSubmit
      ? customProvider.editSubmit
      : customProvider.submit;
  return Boolean(submitMapping.taskIdPath);
}

export function usesConcurrentOpenAIImageRequests(
  profile: ApiProfile,
  params: TaskParams,
) {
  const n = params.n > 0 ? params.n : 1;
  if (profile.provider !== "openai" || n <= 1) return false;
  if (profile.apiMode === "responses") return true;
  return (
    profile.apiMode === "images" && (profile.codexCli || profile.streamImages)
  );
}

export function getCustomRecoveryProfile(
  settings: AppSettings,
  task: TaskRecord,
) {
  const provider = task.apiProvider;
  if (!provider || provider === "openai") return null;
  const taskProfile = getTaskApiProfile(settings, task);
  if (taskProfile?.provider === provider) return taskProfile;
  return null;
}

export function getTaskApiProfile(
  settings: AppSettings,
  task: TaskRecord,
): ApiProfile | null {
  const normalized = normalizeSettings(settings);
  const provider = task.apiProvider;

  if (!task.apiProfileId) return null;

  const byId = normalized.profiles.find(
    (profile) => profile.id === task.apiProfileId,
  );
  if (byId && (!provider || byId.provider === provider)) return byId;
  return null;
}

export function createSettingsForApiProfile(
  settings: AppSettings,
  profile: ApiProfile,
): AppSettings {
  const normalized = normalizeSettings(settings);
  return normalizeSettings({
    ...normalized,
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
    model: profile.model,
    timeout: profile.timeout,
    apiMode: profile.apiMode,
    codexCli: profile.codexCli,
    apiProxy: profile.apiProxy,
    profiles: normalized.profiles.map((item) =>
      item.id === profile.id ? profile : item,
    ),
    activeProfileId: profile.id,
  });
}

export function getReusedTaskApiProfile(
  settings: AppSettings,
  profileId: string | null,
): ApiProfile | null {
  if (!profileId) return null;
  return (
    normalizeSettings(settings).profiles.find(
      (profile) => profile.id === profileId,
    ) ?? null
  );
}

export function getTaskApiProfileName(task: TaskRecord) {
  return task.apiProfileName || task.apiModel || "未知配置";
}
