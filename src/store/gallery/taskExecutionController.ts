import type { ApiProfile, AppSettings, TaskRecord } from "../../types";
import { callImageApi } from "../../lib/api/api";
import { getActiveApiProfile, getCustomProviderDefinition } from "../../lib/api/apiProfiles";
import { IMAGE_FETCH_CORS_HINT } from "../../lib/api/imageApiShared";
import { replaceImageMentionsForApi } from "../../lib/gallery/promptImageMentions";
import { applyPromptStyleLock } from "../../lib/gallery/promptStyleLock";
import { getCustomQueuedImageResult } from "../../lib/api/openaiCompatibleImageApi";
import {
  createOpenAITimeoutError,
  getApiRequestNetworkErrorHint,
  getAutoRetryFinalError,
  sanitizeProviderErrorMessage,
  shouldAutoRetryTaskError,
  shouldFallbackNonStreaming,
  type TimeoutStreamingHintProfile,
} from "../../lib/gallery/taskErrorHandling";
import { createTaskQueue } from "../../lib/gallery/taskQueue";
import {
  createSettingsForApiProfile,
  getCustomRecoveryProfile,
  getTaskApiProfile,
  isAsyncCustomProviderTask,
  usesConcurrentOpenAIImageRequests,
} from "../../lib/api/taskApiProfiles";
import {
  firstActualParams,
  mapActualParamsByImage,
  readImageSizeParamsList,
} from "../../lib/gallery/taskOutputs";
import type { AppState } from "../types";

const CUSTOM_RECOVERY_POLL_MS = 10_000;
const AUTO_RETRY_DELAYS_MS = [3_000, 8_000] as const;

type StoreTaskOutputImagesResult = {
  outputIds: string[];
  outputDataUrls: string[];
  transparentOriginalImageIds?: string[];
};

type TaskExecutionControllerDependencies = {
  getState: () => AppState;
  updateTask: (taskId: string, patch: Partial<TaskRecord>) => void;
  storeTaskOutputImages: (
    task: TaskRecord,
    images: string[],
  ) => Promise<StoreTaskOutputImagesResult>;
  deleteUnreferencedImageIds: (imageIds: Iterable<string>) => Promise<void>;
  persistTaskStreamPartialImage: (
    taskId: string,
    dataUrl: string,
  ) => Promise<unknown>;
  ensureImageCached: (imageId: string) => Promise<string | undefined>;
  deleteCachedImage: (imageId: string) => void;
  showTaskCompletionNotification: (title: string, body: string) => void;
  showCodexCliPrompt: (force?: boolean, reason?: string) => void;
  isAgentTask: (task: TaskRecord) => boolean;
};

export type TaskExecutionController = {
  startQueuedTasks: () => void;
  executeTask: (taskId: string) => void;
  scheduleCustomRecovery: (taskId: string, delayMs?: number) => void;
  getRawErrorPayload: (
    err: unknown,
  ) => Pick<Partial<TaskRecord>, "rawImageUrls" | "rawResponsePayload">;
};

export function createTaskExecutionController(
  deps: TaskExecutionControllerDependencies,
): TaskExecutionController {
  const customRecoveryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const autoRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const openAIWatchdogTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function isRunningOpenAITask(task: TaskRecord) {
    return task.status === "running";
  }

  function clearOpenAIWatchdogTimer(taskId: string) {
    const timer = openAIWatchdogTimers.get(taskId);
    if (timer) clearTimeout(timer);
    openAIWatchdogTimers.delete(taskId);
  }

  function failOpenAITaskIfStillRunning(
    taskId: string,
    error: string,
    now = Date.now(),
  ) {
    const task = deps.getState().tasks.find((item) => item.id === taskId);
    if (!task || !isRunningOpenAITask(task)) return false;

    deps.updateTask(taskId, {
      status: "error",
      error,
      falRecoverable: false,
      finishedAt: now,
      elapsed: Math.max(0, now - task.createdAt),
    });
    return true;
  }

  function scheduleOpenAIWatchdog(
    taskId: string,
    timeoutSeconds: number,
    profile?: TimeoutStreamingHintProfile | null,
  ) {
    clearOpenAIWatchdogTimer(taskId);
    const task = deps.getState().tasks.find((item) => item.id === taskId);
    if (!task || !isRunningOpenAITask(task)) return;

    const timeoutMs = Math.max(0, timeoutSeconds * 1000);
    const remainingMs = Math.max(0, timeoutMs - (Date.now() - task.createdAt));
    const timer = setTimeout(() => {
      openAIWatchdogTimers.delete(taskId);
      const failed = failOpenAITaskIfStillRunning(
        taskId,
        createOpenAITimeoutError(timeoutSeconds, profile),
      );
      if (failed) deps.getState().showToast("OpenAI 任务请求超时", "error");
    }, remainingMs);
    openAIWatchdogTimers.set(taskId, timer);
  }

  function clearAutoRetryTimer(taskId: string) {
    const timer = autoRetryTimers.get(taskId);
    if (timer) clearTimeout(timer);
    autoRetryTimers.delete(taskId);
  }

  function scheduleTaskAutoRetry(
    taskId: string,
    task: TaskRecord,
    err: unknown,
  ): boolean {
    if (!shouldAutoRetryTaskError(err)) return false;

    const retryCount = task.autoRetryCount ?? 0;
    const delay = AUTO_RETRY_DELAYS_MS[retryCount];
    if (delay == null) return false;

    clearAutoRetryTimer(taskId);
    const nextRetryCount = retryCount + 1;
    const nextAt = Date.now() + delay;
    deps.updateTask(taskId, {
      status: "running",
      error: null,
      queued: true,
      autoRetryCount: nextRetryCount,
      autoRetryNextAt: nextAt,
      autoRetryReason: "网络连接中断",
    });
    deps
      .getState()
      .showToast(
        `网络连接中断，${Math.round(delay / 1000)} 秒后自动重试`,
        "info",
      );

    const timer = setTimeout(() => {
      autoRetryTimers.delete(taskId);
      const latestTask = deps
        .getState()
        .tasks.find((item) => item.id === taskId);
      if (!latestTask || latestTask.status !== "running") return;
      executeTask(taskId);
    }, delay);
    autoRetryTimers.set(taskId, timer);
    return true;
  }

  function getRawErrorPayload(
    err: unknown,
  ): Pick<Partial<TaskRecord>, "rawImageUrls" | "rawResponsePayload"> {
    if (!(err instanceof Error)) return {};

    const rawImageUrls =
      "rawImageUrls" in err
        ? (err as { rawImageUrls?: unknown }).rawImageUrls
        : undefined;
    const rawResponsePayload =
      "rawResponsePayload" in err
        ? (err as { rawResponsePayload?: unknown }).rawResponsePayload
        : undefined;
    return {
      rawImageUrls:
        Array.isArray(rawImageUrls) && rawImageUrls.length
          ? rawImageUrls.filter((url): url is string => typeof url === "string")
          : undefined,
      rawResponsePayload:
        typeof rawResponsePayload === "string" ? rawResponsePayload : undefined,
    };
  }

  function clearCustomRecoveryTimer(taskId: string) {
    const timer = customRecoveryTimers.get(taskId);
    if (timer) clearTimeout(timer);
    customRecoveryTimers.delete(taskId);
  }

  function scheduleCustomRecovery(
    taskId: string,
    delayMs = CUSTOM_RECOVERY_POLL_MS,
  ) {
    if (customRecoveryTimers.has(taskId)) return;
    const timer = setTimeout(() => {
      customRecoveryTimers.delete(taskId);
      recoverCustomTask(taskId);
    }, delayMs);
    customRecoveryTimers.set(taskId, timer);
  }

  async function completeRecoveredCustomTask(
    task: TaskRecord,
    result: Awaited<ReturnType<typeof getCustomQueuedImageResult>>,
  ) {
    const latest = deps.getState().tasks.find((item) => item.id === task.id);
    if (!latest || latest.status === "done") return;

    const { outputIds, outputDataUrls, transparentOriginalImageIds } =
      await deps.storeTaskOutputImages(task, result.images);
    const actualParamsList = await readImageSizeParamsList(outputDataUrls);

    deps.updateTask(task.id, {
      outputImages: outputIds,
      transparentOriginalImages: transparentOriginalImageIds,
      actualParams: firstActualParams(actualParamsList),
      actualParamsByImage: mapActualParamsByImage(outputIds, actualParamsList),
      revisedPromptByImage: undefined,
      status: "done",
      error: null,
      customRecoverable: false,
      finishedAt: Date.now(),
      elapsed: Date.now() - task.createdAt,
    });
    deps
      .getState()
      .showToast(
        `自定义异步任务已恢复，共 ${outputIds.length} 张图片`,
        "success",
      );
    if (!deps.isAgentTask(task))
      deps.showTaskCompletionNotification(
        "图像生成完成",
        `自定义异步任务已恢复，共 ${outputIds.length} 张图片。`,
      );
  }

  async function recoverCustomTask(taskId: string) {
    const { settings, tasks } = deps.getState();
    const task = tasks.find((item) => item.id === taskId);
    if (!task || !task.customTaskId || task.status === "done") return;

    const profile = getCustomRecoveryProfile(settings, task);
    const customProvider = task.apiProvider
      ? getCustomProviderDefinition(settings, task.apiProvider)
      : null;
    if (!profile || !customProvider?.poll) {
      scheduleCustomRecovery(taskId);
      return;
    }

    try {
      const result = await getCustomQueuedImageResult(
        profile,
        customProvider,
        task.customTaskId,
        task.params,
      );
      clearCustomRecoveryTimer(taskId);
      await completeRecoveredCustomTask(task, result);
    } catch (err) {
      clearCustomRecoveryTimer(taskId);
      deps.updateTask(taskId, {
        status: "error",
        error: err instanceof Error ? err.message : String(err),
        ...getRawErrorPayload(err),
        customRecoverable: false,
        finishedAt: Date.now(),
        elapsed: Date.now() - task.createdAt,
      });
    }
  }

  async function runTaskExecution(taskId: string) {
    const { settings } = deps.getState();
    const task = deps.getState().tasks.find((item) => item.id === taskId);
    if (!task) return;
    const taskProfile = getTaskApiProfile(settings, task);
    if (!taskProfile && task.apiProfileId) {
      deps.updateTask(taskId, {
        status: "error",
        error: "找不到此任务所使用的 API 配置。",
        falRecoverable: false,
        customRecoverable: false,
        finishedAt: Date.now(),
        elapsed: Date.now() - task.createdAt,
      });
      return;
    }
    const activeProfile = taskProfile ?? getActiveApiProfile(settings);
    let requestSettings = createSettingsForApiProfile(settings, activeProfile);
    if (task.autoRetryReason === "stream-fallback") {
      requestSettings = createSettingsForApiProfile(settings, {
        ...activeProfile,
        streamImages: false,
      });
    }
    const taskProvider = task.apiProvider ?? activeProfile.provider;
    let customTaskInfo: { taskId: string } | null = task.customTaskId
      ? { taskId: task.customTaskId }
      : null;

    if (
      !isAsyncCustomProviderTask(
        requestSettings,
        taskProvider,
        task.inputImageIds.length > 0,
      ) &&
      !usesConcurrentOpenAIImageRequests(activeProfile, task.params)
    ) {
      scheduleOpenAIWatchdog(taskId, activeProfile.timeout, activeProfile);
    }

    try {
      const inputDataUrls: string[] = [];
      for (const imgId of task.inputImageIds) {
        const dataUrl = await deps.ensureImageCached(imgId);
        if (!dataUrl) throw new Error("输入图片已不存在");
        inputDataUrls.push(dataUrl);
      }
      let maskDataUrl: string | undefined;
      if (task.maskImageId) {
        maskDataUrl = await deps.ensureImageCached(task.maskImageId);
        if (!maskDataUrl) throw new Error("遮罩图片已不存在");
      }

      const requestPrompt =
        task.transparentOutput && task.transparentPrompt
          ? task.transparentPrompt
          : applyPromptStyleLock(task.prompt, requestSettings);

      const result = await callImageApi({
        settings: requestSettings,
        prompt: replaceImageMentionsForApi(
          requestPrompt,
          inputDataUrls.length,
        ),
        params: task.params,
        inputImageDataUrls: inputDataUrls,
        maskDataUrl,
        onCustomTaskEnqueued: (request) => {
          customTaskInfo = request;
          deps.updateTask(taskId, {
            customTaskId: request.taskId,
            customRecoverable: false,
          });
        },
        onPartialImage: (partial) => {
          deps
            .getState()
            .setTaskStreamPreview(taskId, partial.image, partial.requestIndex);
          void deps.persistTaskStreamPartialImage(taskId, partial.image);
        },
      });

      const latestBeforeSuccess = deps
        .getState()
        .tasks.find((item) => item.id === taskId);
      if (!latestBeforeSuccess || latestBeforeSuccess.status !== "running") {
        deps.getState().setTaskStreamPreview(taskId);
        return;
      }

      const { outputIds, outputDataUrls, transparentOriginalImageIds } =
        await deps.storeTaskOutputImages(task, result.images);
      const isAsyncCustomTask =
        taskProvider !== "openai" && Boolean(customTaskInfo);
      const actualParamsList = isAsyncCustomTask
        ? await readImageSizeParamsList(outputDataUrls)
        : result.actualParamsList;
      const actualParams = isAsyncCustomTask
        ? firstActualParams(actualParamsList)
        : { ...result.actualParams, n: outputIds.length };
      const shouldStoreRevisedPrompts = !isAsyncCustomTask;
      const actualParamsByImage = mapActualParamsByImage(
        outputIds,
        actualParamsList,
      );
      const revisedPromptByImage = shouldStoreRevisedPrompts
        ? result.revisedPrompts?.reduce<Record<string, string>>(
            (acc, revisedPrompt, index) => {
              const imgId = outputIds[index];
              if (imgId && revisedPrompt && revisedPrompt.trim())
                acc[imgId] = revisedPrompt;
              return acc;
            },
            {},
          )
        : undefined;
      const promptWasRevised =
        shouldStoreRevisedPrompts &&
        result.revisedPrompts?.some(
          (revisedPrompt) =>
            revisedPrompt?.trim() &&
            revisedPrompt.trim() !== requestPrompt.trim(),
        );
      const hasRevisedPromptValue =
        shouldStoreRevisedPrompts &&
        result.revisedPrompts?.some((revisedPrompt) => revisedPrompt?.trim());
      if (
        taskProvider === "openai" &&
        activeProfile.apiMode === "responses" &&
        !activeProfile.codexCli
      ) {
        if (promptWasRevised) {
          deps.showCodexCliPrompt();
        } else if (!hasRevisedPromptValue) {
          deps.showCodexCliPrompt(false, "接口没有返回官方 API 会返回的部分信息");
        }
      }

      const latestBeforeUpdate = deps
        .getState()
        .tasks.find((item) => item.id === taskId);
      if (!latestBeforeUpdate || latestBeforeUpdate.status !== "running") {
        deps.getState().setTaskStreamPreview(taskId);
        return;
      }
      const partialImageIdsToClean =
        latestBeforeUpdate.streamPartialImageIds || [];
      clearOpenAIWatchdogTimer(taskId);
      clearAutoRetryTimer(taskId);
      deps.getState().setTaskStreamPreview(taskId);
      deps.updateTask(taskId, {
        outputImages: outputIds,
        transparentOriginalImages: transparentOriginalImageIds,
        outputErrors: result.failedRequests?.length
          ? result.failedRequests
          : undefined,
        streamPartialImageIds: undefined,
        rawImageUrls: result.rawImageUrls?.length
          ? result.rawImageUrls
          : undefined,
        actualParams,
        actualParamsByImage,
        revisedPromptByImage:
          revisedPromptByImage && Object.keys(revisedPromptByImage).length > 0
            ? revisedPromptByImage
            : undefined,
        status: "done",
        autoRetryCount: undefined,
        autoRetryNextAt: undefined,
        autoRetryReason: undefined,
        finishedAt: Date.now(),
        elapsed: Date.now() - task.createdAt,
        customRecoverable: false,
      });
      void deps.deleteUnreferencedImageIds(partialImageIdsToClean);

      const failedCount = result.failedRequests?.length ?? 0;
      const completionMessage =
        failedCount > 0
          ? `生成完成：成功 ${outputIds.length} 张，失败 ${failedCount} 张`
          : `生成完成，共 ${outputIds.length} 张图片`;
      deps
        .getState()
        .showToast(completionMessage, failedCount > 0 ? "error" : "success");
      if (!deps.isAgentTask(task))
        deps.showTaskCompletionNotification(
          "图像生成完成",
          `${completionMessage}。`,
        );
      const currentMask = deps.getState().maskDraft;
      if (
        maskDataUrl &&
        currentMask &&
        currentMask.targetImageId === task.maskTargetImageId &&
        currentMask.maskDataUrl === maskDataUrl
      ) {
        deps.getState().clearMaskDraft();
      }
    } catch (err) {
      clearOpenAIWatchdogTimer(taskId);
      const latestTask =
        deps.getState().tasks.find((item) => item.id === taskId) ?? task;
      if (latestTask.status !== "running") return;
      deps.getState().setTaskStreamPreview(taskId);
      const latestCustomTaskInfo =
        customTaskInfo ??
        (latestTask.customTaskId ? { taskId: latestTask.customTaskId } : null);
      if (latestCustomTaskInfo && shouldAutoRetryTaskError(err)) {
        deps.updateTask(taskId, {
          status: "error",
          error: "与自定义异步任务的连接已断开，之后会继续查询任务结果。",
          customTaskId: latestCustomTaskInfo.taskId,
          customRecoverable: true,
          finishedAt: Date.now(),
          elapsed: Date.now() - task.createdAt,
        });
        scheduleCustomRecovery(taskId);
      } else {
        const fallbackProfile = getTaskApiProfile(
          deps.getState().settings,
          latestTask,
        );
        if (
          fallbackProfile?.streamImages &&
          latestTask.autoRetryReason !== "stream-fallback" &&
          shouldFallbackNonStreaming(err)
        ) {
          deps.updateTask(taskId, {
            status: "running",
            error: null,
            autoRetryCount: (latestTask.autoRetryCount ?? 0) + 1,
            autoRetryReason: "stream-fallback",
            queued: false,
          });
          requestSettings = createSettingsForApiProfile(deps.getState().settings, {
            ...fallbackProfile,
            streamImages: false,
          });
          deps
            .getState()
            .showToast("流式返回格式异常，已自动改用非流式重试一次", "info");
          void runTaskExecution(taskId);
          return;
        }
        if (scheduleTaskAutoRetry(taskId, latestTask, err)) return;

        let errorMessage = sanitizeProviderErrorMessage(
          err instanceof Error ? err.message : String(err),
        );
        const settings = deps.getState().settings;
        const profile = getTaskApiProfile(settings, latestTask);
        const usesApiProxy = profile?.apiProxy ?? settings.apiProxy;
        const activeProfile = getActiveApiProfile(settings);
        const hintProfile = profile ?? {
          provider: latestTask.apiProvider ?? activeProfile.provider,
          apiMode: settings.apiMode,
          streamImages: activeProfile.streamImages,
          streamPartialImages: activeProfile.streamPartialImages,
        };
        const networkErrorHint = getApiRequestNetworkErrorHint(
          err,
          latestTask.createdAt,
          usesApiProxy,
          hintProfile,
        );
        if (networkErrorHint && !errorMessage.includes(IMAGE_FETCH_CORS_HINT)) {
          errorMessage += `\n${networkErrorHint}`;
        }
        if (shouldAutoRetryTaskError(err) && latestTask.autoRetryCount) {
          errorMessage = getAutoRetryFinalError(latestTask.autoRetryCount);
        }
        deps.updateTask(taskId, {
          status: "error",
          error: errorMessage,
          ...getRawErrorPayload(err),
          customRecoverable: false,
          autoRetryNextAt: undefined,
          autoRetryReason: undefined,
          finishedAt: Date.now(),
          elapsed: Date.now() - task.createdAt,
        });
        if (!shouldAutoRetryTaskError(err)) {
          deps.getState().setDetailTaskId(taskId);
        }
      }
    } finally {
      for (const imgId of task.inputImageIds) {
        deps.deleteCachedImage(imgId);
      }
    }
  }

  const taskQueue = createTaskQueue({
    getSettings: () => deps.getState().settings,
    getTask: (taskId) =>
      deps.getState().tasks.find((item) => item.id === taskId),
    updateTask: deps.updateTask,
    runTask: runTaskExecution,
  });

  function startQueuedTasks() {
    taskQueue.startQueuedTasks();
  }

  function executeTask(taskId: string) {
    taskQueue.enqueueTask(taskId);
  }

  return {
    startQueuedTasks,
    executeTask,
    scheduleCustomRecovery,
    getRawErrorPayload,
  };
}
