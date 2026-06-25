import type { TaskRecord } from "../../types";
import {
  getGalleryApiProfile,
  normalizeSettings,
  validateApiProfile,
} from "../../lib/api/apiProfiles";
import { storeImage } from "../../lib/storage/db";
import { validateMaskMatchesImage } from "../../lib/gallery/canvasImage";
import { orderInputImagesForMask } from "../../lib/gallery/mask";
import {
  getChangedParams,
  normalizeParamsForSettings,
} from "../../lib/gallery/paramCompatibility";
import {
  createSettingsForApiProfile,
  getReusedTaskApiProfile,
} from "../../lib/api/taskApiProfiles";
import {
  createTransparentOutputMeta,
  getTransparentRequestParams,
} from "../../lib/gallery/transparentImage";
import { cacheImage } from "../../lib/storage/imageCache";
import { genId } from "../../lib/shared/id";
import { applyPromptStyleLock } from "../../lib/gallery/promptStyleLock";
import type { AppState } from "../types";

export type SubmitTaskOptions = {
  allowFullMask?: boolean;
  useCurrentApiProfileWhenReusedMissing?: boolean;
  promptOverride?: string;
  seriesBatchId?: string;
  seriesBatchLabel?: string;
};

export type SubmitSeriesBatchOptions = {
  label?: string;
};

type GallerySubmissionDependencies = {
  getState: () => AppState;
  putTask: (task: TaskRecord) => Promise<IDBValidKey>;
  executeTask: (taskId: string) => void;
};

export async function submitTaskAction(
  deps: GallerySubmissionDependencies,
  options: SubmitTaskOptions = {},
) {
  const {
    settings,
    prompt,
    inputImages,
    maskDraft,
    params,
    reusedTaskApiProfileId,
    reusedTaskApiProfileName,
    reusedTaskApiProfileMissing,
    showToast,
    setConfirmDialog,
  } = deps.getState();

  const normalizedSettings = normalizeSettings(settings);
  let activeProfile = getGalleryApiProfile(settings);
  let requestSettings = createSettingsForApiProfile(
    normalizedSettings,
    activeProfile,
  );
  if (
    normalizedSettings.reuseTaskApiProfileTemporarily &&
    (reusedTaskApiProfileId || reusedTaskApiProfileMissing)
  ) {
    const reusedProfile = getReusedTaskApiProfile(
      normalizedSettings,
      reusedTaskApiProfileId,
    );
    if (!reusedProfile) {
      if (options.useCurrentApiProfileWhenReusedMissing) {
        deps.getState().setReusedTaskApiProfile(null);
      } else {
        setConfirmDialog({
          title: "找不到 API 配置",
          message: `找不到复用任务所使用的 API 配置「${reusedTaskApiProfileName || "未知配置"}」，要使用当前的 API 配置「${activeProfile.name}」提交任务吗？`,
          confirmText: "使用当前配置提交",
          cancelText: "放弃提交",
          action: () => {
            void submitTaskAction(deps, {
              ...options,
              useCurrentApiProfileWhenReusedMissing: true,
            });
          },
        });
        return;
      }
    } else {
      activeProfile = reusedProfile;
      requestSettings = createSettingsForApiProfile(
        normalizedSettings,
        reusedProfile,
      );
    }
  }

  if (validateApiProfile(activeProfile)) {
    showToast(
      `请先完善请求 API 配置：${validateApiProfile(activeProfile)}`,
      "error",
    );
    deps.getState().setShowSettings(true);
    return;
  }

  const submittedPrompt = options.promptOverride ?? prompt;

  if (!submittedPrompt.trim()) {
    showToast("请输入提示词", "error");
    return;
  }

  let orderedInputImages = inputImages;
  let maskImageId: string | null = null;
  let maskTargetImageId: string | null = null;
  const seriesReferenceImage = deps.getState().seriesReferenceImage;
  if (
    seriesReferenceImage?.id &&
    seriesReferenceImage.dataUrl &&
    !maskDraft &&
    !orderedInputImages.some((img) => img.id === seriesReferenceImage.id)
  ) {
    orderedInputImages = [
      {
        id: seriesReferenceImage.id,
        dataUrl: seriesReferenceImage.dataUrl,
      },
      ...orderedInputImages,
    ];
  }

  if (maskDraft) {
    try {
      orderedInputImages = orderInputImagesForMask(
        inputImages,
        maskDraft.targetImageId,
      );
      const coverage = await validateMaskMatchesImage(
        maskDraft.maskDataUrl,
        orderedInputImages[0].dataUrl,
      );
      if (coverage === "full" && !options.allowFullMask) {
        setConfirmDialog({
          title: "确认编辑整张图片？",
          message:
            "当前遮罩覆盖了整张图片，提交后可能会重绘全部内容。是否继续？",
          confirmText: "继续提交",
          tone: "warning",
          action: () => {
            void submitTaskAction(deps, { allowFullMask: true });
          },
        });
        return;
      }
      maskImageId = await storeImage(maskDraft.maskDataUrl, "mask");
      cacheImage(maskImageId, maskDraft.maskDataUrl);
      maskTargetImageId = maskDraft.targetImageId;
    } catch (err) {
      if (!inputImages.some((img) => img.id === maskDraft.targetImageId)) {
        deps.getState().clearMaskDraft();
      }
      showToast(err instanceof Error ? err.message : String(err), "error");
      return;
    }
  }

  for (const img of orderedInputImages) {
    await storeImage(img.dataUrl);
  }

  const normalizedParams = normalizeParamsForSettings(params, requestSettings, {
    hasInputImages: orderedInputImages.length > 0,
  });
  const shouldUseTransparentOutput =
    normalizedParams.output_format === "png" &&
    normalizedParams.transparent_output;
  const taskParams = shouldUseTransparentOutput
    ? getTransparentRequestParams(normalizedParams)
    : { ...normalizedParams, transparent_output: false };
  const basePrompt = submittedPrompt.trim();
  const effectivePrompt = applyPromptStyleLock(basePrompt, normalizedSettings);
  const transparentMeta = taskParams.transparent_output
    ? createTransparentOutputMeta(effectivePrompt)
    : null;
  const normalizedParamPatch = getChangedParams(params, taskParams);
  if (Object.keys(normalizedParamPatch).length) {
    deps.getState().setParams(normalizedParamPatch);
  }

  const taskId = genId();
  const task: TaskRecord = {
    id: taskId,
    prompt: basePrompt,
    params: taskParams,
    apiProvider: activeProfile.provider,
    apiProfileId: activeProfile.id,
    apiProfileName: activeProfile.name,
    apiMode: activeProfile.apiMode,
    apiModel: activeProfile.model,
    seriesBatchId: options.seriesBatchId,
    seriesBatchLabel: options.seriesBatchLabel,
    inputImageIds: orderedInputImages.map((i) => i.id),
    maskTargetImageId,
    maskImageId,
    transparentOutput: transparentMeta?.transparentOutput,
    transparentPrompt: transparentMeta?.effectivePrompt,
    outputImages: [],
    status: "running",
    error: null,
    createdAt: Date.now(),
    finishedAt: null,
    elapsed: null,
  };

  const latestTasks = deps.getState().tasks;
  deps.getState().setTasks([task, ...latestTasks]);
  await deps.putTask(task);
  deps.getState().showToast("任务已提交", "success");

  if (settings.clearInputAfterSubmit) {
    deps.getState().setPrompt("");
    deps.getState().clearInputImages();
  }
  deps.getState().setReusedTaskApiProfile(null);

  deps.executeTask(taskId);
}

export async function submitSeriesBatchAction(
  deps: GallerySubmissionDependencies,
  prompts: string[],
  options: SubmitSeriesBatchOptions = {},
) {
  const cleanPrompts = prompts
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 30);
  const { showToast, settings } = deps.getState();
  if (!cleanPrompts.length) {
    showToast("请先填写至少 1 条系列提示词", "info");
    return;
  }

  const batchId = genId();
  const batchLabel =
    options.label?.trim().slice(0, 60) ||
    `系列批量 ${new Date().toLocaleString()}`;
  const clearInputAfterSubmit = settings.clearInputAfterSubmit;
  if (clearInputAfterSubmit) {
    deps.getState().setSettings({ clearInputAfterSubmit: false });
  }
  try {
    for (const prompt of cleanPrompts) {
      await submitTaskAction(deps, {
        promptOverride: prompt,
        seriesBatchId: batchId,
        seriesBatchLabel: batchLabel,
      });
    }
  } finally {
    if (clearInputAfterSubmit) {
      deps.getState().setSettings({ clearInputAfterSubmit: true });
    }
  }
  showToast(`已提交 ${cleanPrompts.length} 个系列任务`, "success");
}
