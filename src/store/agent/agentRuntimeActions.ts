import type {
  AgentConversation,
  AgentMessage,
  AgentRound,
  ApiProfile,
  AppSettings,
  TaskParams,
  TaskRecord,
  ResponsesOutputItem,
} from "../../types";
import { DEFAULT_AGENT_MAX_TOOL_ROUNDS, DEFAULT_PARAMS } from "../../types";
import {
  getAgentApiProfile,
  getAgentImageApiProfile,
  getVideoApiProfile,
  normalizeSettings,
  validateApiProfile,
} from "../../lib/api/apiProfiles";
import { callAgentResponsesApi, callBatchImageSingle, parseBatchImageCallArguments, parseSingleImageCallArguments, parseVideoCallArguments, type AgentApiResultImage } from "../../lib/agent/agentApi";
import { putVideoRecord } from "../../lib/storage/db";
import { createVideoConfigFromProfile, createVideoGenerationTask, pollVideoGenerationTask, type VideoGenerationTask } from "../../lib/video/videoApi";
import { POLL_INTERVAL_MS, stripTransientVideoUrl } from "../../lib/video/videoWorkspaceUtils";
import {
  buildAgentApiInput,
  buildReducedAgentInput,
  createAgentBatchImagesInputItem,
  buildAgentContinuationInput,
  countResponseToolCalls,
  estimateSerializedSize,
  getAgentContextSizeLimitErrorMessage,
  isAgentContextSizeLimitError,
  mergeResponseOutputItems,
  readAgentContextImageDataUrls,
} from "../../lib/agent/agentPayload";
import {
  collectAgentRoundOutputImageSlots,
  extractAgentPromptReferenceIds,
  extractAgentReferenceIds,
  getAgentCurrentReferenceId,
  getAgentGeneratedImageReferenceId,
} from "../../lib/agent/agentImageReferences";
import { getActiveAgentRounds, getAgentRoundPath } from "../../lib/agent/agentConversationTree";
import { IMAGE_FETCH_CORS_HINT } from "../../lib/api/imageApiShared";
import { validateMaskMatchesImage } from "../../lib/gallery/canvasImage";
import { orderInputImagesForMask } from "../../lib/gallery/mask";
import { normalizeParamsForSettings } from "../../lib/gallery/paramCompatibility";
import { AGENT_STOPPED_MESSAGE, getApiRequestNetworkErrorHint, sanitizeProviderErrorMessage } from "../../lib/gallery/taskErrorHandling";
import { createSettingsForApiProfile } from "../../lib/api/taskApiProfiles";
import { genId } from "../../lib/shared/id";
import type { AppState } from "../types";

type AgentRuntimeDependencies = {
  getState: () => AppState;
  setState: (
    partial:
      | Partial<AppState>
      | ((state: AppState) => Partial<AppState>),
  ) => void;
  putTask: (task: TaskRecord) => Promise<IDBValidKey>;
  updateTask: (taskId: string, patch: Partial<TaskRecord>) => void;
  storeImage: (
    dataUrl: string,
    source?: "upload" | "generated" | "mask",
  ) => Promise<string>;
  cacheImage: (id: string, dataUrl: string) => void;
  ensureImageCached: (id: string) => Promise<string | undefined>;
  persistTaskStreamPartialImage: (taskId: string, dataUrl: string) => Promise<void>;
  getRawErrorPayload: (
    err: unknown,
  ) => Pick<Partial<TaskRecord>, "rawImageUrls" | "rawResponsePayload">;
  showTaskCompletionNotification: (title: string, body: string) => void;
};


export function createAgentRuntimeActions(deps: AgentRuntimeDependencies) {
const AGENT_CONTEXT_IMAGE_HISTORY_ROUNDS = 2;
const AGENT_CONTEXT_INPUT_SOFT_LIMIT_BYTES = 4_500_000;
const AGENT_CONTEXT_REQUEST_HARD_LIMIT_BYTES = 4_800_000;
const AGENT_CONTEXT_MAX_IMAGE_BYTES_DEFAULT = 700_000;
const AGENT_CONTEXT_MAX_IMAGE_BYTES_TIGHT = 260_000;
const AGENT_TEMPORARY_ERROR_RETRY_DELAYS_MS = [2_000, 6_000] as const;
const AGENT_MAX_CONSECUTIVE_IMAGE_TOOL_FAILURE_ROUNDS = 2;
const agentRoundControllers = new Map<string, AbortController>();
const AGENT_CONVERSATION_TITLE_MAX_LENGTH = 28;

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAgentAbortError());
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(createAgentAbortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function isRetryableAgentTemporaryError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  return /auth_unavailable|no auth available|upstream service temporarily unavailable|temporarily unavailable|system under load|server overloaded|temporarily overloaded|service overloaded|over capacity|busy|try again later|our servers are currently overloaded/.test(lower) ||
    /服务繁忙|系统繁忙|负载|稍后重试|临时不可用|暂时不可用|暂时无法完成请求|请求被限流/.test(message);
}

function createAgentConversationTitle(prompt: string, fallbackTitle: string) {
  const title = prompt.replace(/\s+/g, " ").trim();
  if (!title) return fallbackTitle;
  const chars = Array.from(title);
  if (chars.length <= AGENT_CONVERSATION_TITLE_MAX_LENGTH) return title;
  return `${chars.slice(0, AGENT_CONVERSATION_TITLE_MAX_LENGTH - 3).join("")}...`;
}

function getActiveAgentConversation(): AgentConversation {
  const state = deps.getState();
  const existing = state.agentConversations.find(
    (conversation) => conversation.id === state.activeAgentConversationId,
  );
  if (existing) return existing;

  const id = state.createAgentConversation();
  return deps.getState()
    .agentConversations.find((conversation) => conversation.id === id)!;
}

function updateAgentConversation(
  conversationId: string,
  updater: (conversation: AgentConversation) => AgentConversation,
) {
  deps.setState((state) => ({
    agentConversations: state.agentConversations.map((conversation) =>
      conversation.id === conversationId ? updater(conversation) : conversation,
    ),
  }));
}

function getAgentRoundControllerKey(conversationId: string, roundId: string) {
  return `${conversationId}:${roundId}`;
}

function createAgentAbortError() {
  return new DOMException("Agent 请求已停止", "AbortError");
}

function appendAgentStoppedMessage(content: string) {
  const trimmed = content.trimEnd();
  if (!trimmed) return AGENT_STOPPED_MESSAGE;
  if (trimmed.endsWith(AGENT_STOPPED_MESSAGE)) return trimmed;
  return `${trimmed}\n\n${AGENT_STOPPED_MESSAGE}`;
}

function markAgentRoundTasksStopped(
  conversationId: string,
  roundId: string,
  now = Date.now(),
) {
  const runningTasks = deps.getState()
    .tasks.filter(
      (task) =>
        task.status === "running" &&
        task.agentConversationId === conversationId &&
        task.agentRoundId === roundId,
    );

  for (const task of runningTasks) {
    deps.updateTask(task.id, {
      status: "error",
      error: AGENT_STOPPED_MESSAGE,
      falRecoverable: false,
      customRecoverable: false,
      finishedAt: now,
      elapsed: Math.max(0, now - task.createdAt),
    });
  }
  return runningTasks.length > 0;
}

function markAgentRoundTasksFailed(
  conversationId: string,
  roundId: string,
  error: string,
  rawResponsePayload?: string,
  shouldFailTask: (task: TaskRecord) => boolean = () => true,
  now = Date.now(),
) {
  const runningTasks = deps.getState()
    .tasks.filter(
      (task) =>
        task.status === "running" &&
        task.agentConversationId === conversationId &&
        task.agentRoundId === roundId &&
        shouldFailTask(task),
    );

  for (const task of runningTasks) {
    deps.getState().setTaskStreamPreview(task.id);
    deps.updateTask(task.id, {
      status: "error",
      error,
      ...(rawResponsePayload ? { rawResponsePayload } : {}),
      falRecoverable: false,
      customRecoverable: false,
      finishedAt: now,
      elapsed: Math.max(0, now - task.createdAt),
    });
  }
  return runningTasks.length > 0;
}

function getAgentRoundSuccessfulOutputIds(
  conversationId: string,
  roundId: string,
) {
  const taskIds: string[] = [];
  const outputIds: string[] = [];
  for (const task of deps.getState().tasks) {
    if (
      task.agentConversationId !== conversationId ||
      task.agentRoundId !== roundId ||
      task.status !== "done"
    ) {
      continue;
    }
    if (!taskIds.includes(task.id)) taskIds.push(task.id);
    outputIds.push(...task.outputImages);
  }
  return { taskIds, outputIds };
}

function getAgentRoundSuccessfulVideoRecordIds(
  conversationId: string,
  roundId: string,
) {
  return deps.getState()
    .agentConversations.find((item) => item.id === conversationId)
    ?.rounds.find((round) => round.id === roundId)
    ?.outputVideoRecordIds ?? [];
}

function markAgentRoundStopped(conversationId: string, roundId: string) {
  const now = Date.now();
  const stoppedTasks = markAgentRoundTasksStopped(conversationId, roundId, now);
  let stoppedRound = false;
  updateAgentConversation(conversationId, (current) => {
    const round = current.rounds.find((item) => item.id === roundId);
    if (!round || round.status !== "running") return current;

    stoppedRound = true;
    const existingAssistantMessage = current.messages.find(
      (message) => message.roundId === roundId && message.role === "assistant",
    );
    const assistantMessageId = existingAssistantMessage?.id ?? genId();
    return {
      ...current,
      updatedAt: now,
      rounds: current.rounds.map((item) =>
        item.id === roundId
          ? {
              ...item,
              ...(assistantMessageId ? { assistantMessageId } : {}),
              status: "error",
              error: AGENT_STOPPED_MESSAGE,
              finishedAt: now,
            }
          : item,
      ),
      messages: existingAssistantMessage
        ? current.messages.map((message) =>
            message.id === existingAssistantMessage.id
              ? {
                  ...message,
                  content: appendAgentStoppedMessage(message.content),
                }
              : message,
          )
        : [
            ...current.messages,
            {
              id: assistantMessageId,
              role: "assistant",
              content: AGENT_STOPPED_MESSAGE,
              roundId,
              createdAt: now,
            },
          ],
    };
  });
  return stoppedRound || stoppedTasks;
}

function appendAgentAssistantMessageContent(
  conversationId: string,
  messageId: string,
  delta: string,
) {
  if (!delta) return;
  updateAgentConversation(conversationId, (current) => ({
    ...current,
    updatedAt: Date.now(),
    messages: current.messages.map((message) =>
      message.id === messageId
        ? { ...message, content: `${message.content}${delta}` }
        : message,
    ),
  }));
}

async function generateAgentConversationTitle(
  conversationId: string,
  prompt: string,
  inputImageIds: string[],
  fallbackTitle: string,
) {
  deps.setState((state) => {
    const next = {
      ...state.agentGeneratingTitleIds,
      [conversationId]: true as const,
    };
    return { agentGeneratingTitleIds: next };
  });
  try {
    const title = createAgentConversationTitle(prompt, fallbackTitle);
    if (!title || title === fallbackTitle) return;

    updateAgentConversation(conversationId, (current) => {
      const firstRound = current.rounds[0];
      if (
        !firstRound ||
        firstRound.prompt !== prompt ||
        current.title !== fallbackTitle
      )
        return current;
      return { ...current, title, updatedAt: Date.now() };
    });
  } catch {
    // Title generation is best-effort; keep the local fallback title on failure.
  } finally {
    deps.setState((state) => {
      const next = { ...state.agentGeneratingTitleIds };
      delete next[conversationId];
      return { agentGeneratingTitleIds: next };
    });
  }
}

function stopAgentResponse(
  conversationId = deps.getState().activeAgentConversationId,
) {
  if (!conversationId) return;
  const conversation = deps.getState()
    .agentConversations.find((item) => item.id === conversationId);
  if (!conversation) return;
  const activeRunningRound = [...getActiveAgentRounds(conversation)]
    .reverse()
    .find((round) => round.status === "running");
  const runningRound =
    activeRunningRound ??
    conversation.rounds.find((round) => round.status === "running");
  if (!runningRound) return;

  const controller = agentRoundControllers.get(
    getAgentRoundControllerKey(conversationId, runningRound.id),
  );
  if (controller) {
    controller.abort();
    if (markAgentRoundStopped(conversationId, runningRound.id)) {
      deps.getState().showToast("已停止生成", "info");
    }
    return;
  }

  markAgentRoundStopped(conversationId, runningRound.id);
  deps.getState().showToast("已停止生成", "info");
}

function uniqueIds(ids: string[]) {
  return Array.from(new Set(ids.filter(Boolean)));
}

function isLikelyImageGenerationPrompt(prompt: string) {
  return /(?:生成|画|绘制|出图|生图|图片|图像|海报|照片|插画|头像|商品图|主图|详情图|draw|image|photo|picture|poster|illustration)/i.test(prompt);
}

function isLikelyImageEditPrompt(prompt: string) {
  return /(?:换|替换|改|修改|变|变成|调整|重做|重新|换成|改成|换个|换一|颜色|背景|商品|产品|衣服|裤子|鞋|包|模特|场景|风格|姿势|角度|edit|change|replace|modify|turn into|make it|recolor|background|product|style)/i.test(prompt);
}

function hasAgentImageReferenceMention(prompt: string) {
  return /@第\s*\d+\s*轮图\s*\d+|<ref\b/i.test(prompt);
}

function isLikelyVideoGenerationPrompt(prompt: string) {
  return /(?:视频|动画|短片|短视频|动图|运镜|镜头|video|clip|animation|animate|motion)/i.test(prompt);
}

function createDirectMediaFunctionCall(
  prompt: string,
  options: { hasImageContext?: boolean } = {},
): ResponsesOutputItem | null {
  const normalizedPrompt = prompt.trim();
  if (!normalizedPrompt) return null;
  if (isLikelyVideoGenerationPrompt(normalizedPrompt)) {
    return {
      type: "function_call",
      name: "generate_video",
      call_id: `direct-video-${genId()}`,
      arguments: JSON.stringify({ prompt: normalizedPrompt }),
    };
  }
  const shouldUseImageTool =
    isLikelyImageGenerationPrompt(normalizedPrompt) ||
    (isLikelyImageEditPrompt(normalizedPrompt) &&
      (options.hasImageContext || hasAgentImageReferenceMention(normalizedPrompt)));
  if (shouldUseImageTool) {
    return {
      type: "function_call",
      name: "generate_image",
      call_id: `direct-image-${genId()}`,
      arguments: JSON.stringify({ prompt: normalizedPrompt }),
    };
  }
  return null;
}

function canUseDirectMediaFallback(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (isAgentContextSizeLimitError(error)) return false;
  if (/image_generation failed|safety rejected|invalid or empty|request body exceeds|5mb|too large|context/i.test(message)) {
    return false;
  }
  return isRetryableAgentTemporaryError(error) ||
    /upstream|bad gateway|gateway|timeout|temporarily unavailable|502|503|504|524/.test(lower);
}

async function submitAgentMessage() {
  const state = deps.getState();
  const { settings, prompt, inputImages, maskDraft, params, showToast } = state;
  const normalizedSettings = normalizeSettings(settings);
  const activeProfile = getAgentApiProfile(settings);
  const agentImageProfile = getAgentImageApiProfile(settings);

  if (
    activeProfile.provider !== "openai" ||
    activeProfile.apiMode !== "responses"
  ) {
    state.setAppMode("agent");
    return;
  }

  if (validateApiProfile(activeProfile)) {
    showToast(
      `请先完善请求 API 配置：${validateApiProfile(activeProfile)}`,
      "error",
    );
    state.setShowSettings(true);
    return;
  }

  const agentImageValidationError = validateApiProfile(agentImageProfile);
  if (agentImageValidationError) {
    showToast(
      `请先完善 Agent 生图 API 配置：${agentImageValidationError}`,
      "error",
    );
    state.setShowSettings(true);
    return;
  }

  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt) {
    showToast("请输入消息", "error");
    return;
  }

  const conversation = getActiveAgentConversation();
  if (conversation.rounds.some((round) => round.status === "running")) {
    showToast("请等待生成完成，或先停止生成", "info");
    return;
  }

  let orderedInputImages = inputImages;
  let maskImageId: string | null = null;
  let maskTargetImageId: string | null = null;

  if (maskDraft) {
    try {
      orderedInputImages = orderInputImagesForMask(
        inputImages,
        maskDraft.targetImageId,
      );
      await validateMaskMatchesImage(
        maskDraft.maskDataUrl,
        orderedInputImages[0].dataUrl,
      );
      maskImageId = await deps.storeImage(maskDraft.maskDataUrl, "mask");
      deps.cacheImage(maskImageId, maskDraft.maskDataUrl);
      maskTargetImageId = maskDraft.targetImageId;
    } catch (err) {
      if (!inputImages.some((img) => img.id === maskDraft.targetImageId)) {
        state.clearMaskDraft();
      }
      showToast(err instanceof Error ? err.message : String(err), "error");
      return;
    }
  }

  const inputImageIds = uniqueIds(orderedInputImages.map((image) => image.id));

  for (const image of orderedInputImages) {
    await deps.storeImage(image.dataUrl);
  }

  const requestSettings = createSettingsForApiProfile(
    normalizedSettings,
    activeProfile,
  );
  const imageRequestSettings = createSettingsForApiProfile(
    normalizedSettings,
    agentImageProfile,
  );
  const now = Date.now();
  const editingRound = state.agentEditingRoundId
    ? (conversation.rounds.find(
        (item) => item.id === state.agentEditingRoundId,
      ) ?? null)
    : null;
  const editingRoundAssistantMessage = editingRound?.assistantMessageId
    ? (conversation.messages.find(
        (message) => message.id === editingRound.assistantMessageId,
      ) ?? null)
    : (conversation.messages.find(
        (message) =>
          message.roundId === editingRound?.id && message.role === "assistant",
      ) ?? null);
  const editingRoundHasAssistantMessage = Boolean(editingRoundAssistantMessage);
  const editingRoundHasErrorAssistantMessage = Boolean(
    editingRound?.status === "error" &&
    editingRoundAssistantMessage?.content.startsWith("请求失败："),
  );
  const editingRoundHasChildren = editingRound
    ? conversation.rounds.some(
        (round) => (round.parentRoundId ?? null) === editingRound.id,
      )
    : false;
  const shouldAppendToEditingRound = Boolean(
    editingRound &&
    !editingRoundHasChildren &&
    (!editingRoundHasAssistantMessage || editingRoundHasErrorAssistantMessage),
  );
  const roundId =
    shouldAppendToEditingRound && editingRound ? editingRound.id : genId();
  const userMessageId =
    shouldAppendToEditingRound && editingRound
      ? editingRound.userMessageId
      : genId();
  const activeRounds = getActiveAgentRounds(conversation);
  const activeLeafId = activeRounds[activeRounds.length - 1]?.id ?? null;
  const parentRoundId = editingRound
    ? (editingRound.parentRoundId ?? null)
    : activeLeafId;
  const parentPath = parentRoundId
    ? getAgentRoundPath(conversation, parentRoundId)
    : [];
  const normalizedParams = {
    ...normalizeParamsForSettings(params, imageRequestSettings, {
      hasInputImages: inputImageIds.length > 0,
    }),
    n: DEFAULT_PARAMS.n,
    transparent_output: false,
  };
  const round: AgentRound = {
    id: roundId,
    index:
      shouldAppendToEditingRound && editingRound
        ? editingRound.index
        : parentPath.length + 1,
    parentRoundId,
    ...(editingRoundHasErrorAssistantMessage && editingRoundAssistantMessage
      ? { assistantMessageId: editingRoundAssistantMessage.id }
      : {}),
    userMessageId,
    prompt: trimmedPrompt,
    inputImageIds,
    maskTargetImageId,
    maskImageId,
    outputTaskIds: [],
    status: "running",
    error: null,
    createdAt: now,
    finishedAt: null,
  };
  const userMessage: AgentMessage = {
    id: userMessageId,
    role: "user",
    content: trimmedPrompt,
    roundId,
    inputImageIds,
    maskTargetImageId,
    maskImageId,
    createdAt: now,
  };

  let fallbackTitle: string | null = null;
  updateAgentConversation(conversation.id, (current) => {
    const nextTitle =
      current.rounds.length === 0
        ? createAgentConversationTitle(trimmedPrompt, current.title)
        : current.title;
    if (current.rounds.length === 0) fallbackTitle = nextTitle;
    const messages = shouldAppendToEditingRound
      ? current.messages.some((message) => message.id === userMessageId)
        ? current.messages.map((message) => {
            if (message.id === userMessageId) return userMessage;
            if (
              editingRoundHasErrorAssistantMessage &&
              message.id === editingRoundAssistantMessage?.id
            ) {
              return { ...message, content: "", outputTaskIds: [] };
            }
            return message;
          })
        : [...current.messages, userMessage]
      : [...current.messages, userMessage];

    return {
      ...current,
      title: nextTitle,
      activeRoundId: roundId,
      updatedAt: now,
      rounds: shouldAppendToEditingRound
        ? current.rounds.map((item) => (item.id === roundId ? round : item))
        : [...current.rounds, round],
      messages,
    };
  });

  state.setPrompt("");
  state.clearInputImages();
  state.clearMaskDraft();
  state.setAgentEditingRoundId(null);

  if (fallbackTitle) {
    void generateAgentConversationTitle(
      conversation.id,
      trimmedPrompt,
      inputImageIds,
      fallbackTitle,
    );
  }

  void executeAgentRound(
    conversation.id,
    roundId,
    normalizedParams,
    requestSettings,
    activeProfile,
    agentImageProfile,
  );
}

async function regenerateAgentAssistantMessage(
  conversationId: string,
  roundId: string,
) {
  const state = deps.getState();
  const { settings, params, showToast } = state;
  const normalizedSettings = normalizeSettings(settings);
  const activeProfile = getAgentApiProfile(settings);
  const agentImageProfile = getAgentImageApiProfile(settings);

  if (
    activeProfile.provider !== "openai" ||
    activeProfile.apiMode !== "responses"
  ) {
    state.setAppMode("agent");
    return;
  }

  if (validateApiProfile(activeProfile)) {
    showToast(
      `请先完善请求 API 配置：${validateApiProfile(activeProfile)}`,
      "error",
    );
    state.setShowSettings(true);
    return;
  }

  const agentImageValidationError = validateApiProfile(agentImageProfile);
  if (agentImageValidationError) {
    showToast(
      `请先完善 Agent 生图 API 配置：${agentImageValidationError}`,
      "error",
    );
    state.setShowSettings(true);
    return;
  }

  const conversation = state.agentConversations.find(
    (item) => item.id === conversationId,
  );
  const sourceRound =
    conversation?.rounds.find((item) => item.id === roundId) ?? null;
  const sourceUserMessage = sourceRound
    ? (conversation?.messages.find(
        (message) => message.id === sourceRound.userMessageId,
      ) ?? null)
    : null;
  if (!conversation || !sourceRound || !sourceUserMessage) {
    showToast("找不到要重新生成的 Agent 消息", "error");
    return;
  }

  if (conversation.rounds.some((round) => round.status === "running")) {
    showToast("请等待生成完成，或先停止生成", "info");
    return;
  }

  const inputImageIds = uniqueIds(sourceRound.inputImageIds);
  const requestSettings = createSettingsForApiProfile(
    normalizedSettings,
    activeProfile,
  );
  const imageRequestSettings = createSettingsForApiProfile(
    normalizedSettings,
    agentImageProfile,
  );
  const normalizedParams = {
    ...normalizeParamsForSettings(params, imageRequestSettings, {
      hasInputImages: inputImageIds.length > 0,
    }),
    n: DEFAULT_PARAMS.n,
    transparent_output: false,
  };
  const now = Date.now();
  if (sourceRound.status === "error") {
    const assistantMessageId =
      sourceRound.assistantMessageId ??
      conversation.messages.find(
        (message) =>
          message.roundId === sourceRound.id && message.role === "assistant",
      )?.id;
    updateAgentConversation(conversationId, (current) => ({
      ...current,
      activeRoundId: sourceRound.id,
      updatedAt: now,
      rounds: current.rounds.map((round) =>
        round.id === sourceRound.id
          ? {
              ...round,
              outputTaskIds: [],
              responseId: undefined,
              responseOutput: undefined,
              status: "running",
              error: null,
              finishedAt: null,
            }
          : round,
      ),
      messages: assistantMessageId
        ? current.messages.map((message) =>
            message.id === assistantMessageId
              ? { ...message, content: "", outputTaskIds: [] }
              : message,
          )
        : current.messages,
    }));
    state.setAgentEditingRoundId(null);
    void executeAgentRound(
      conversationId,
      sourceRound.id,
      normalizedParams,
      requestSettings,
      activeProfile,
      agentImageProfile,
    );
    return;
  }

  const newRoundId = genId();
  const newUserMessageId = genId();
  const newRound: AgentRound = {
    id: newRoundId,
    index: sourceRound.index,
    parentRoundId: sourceRound.parentRoundId ?? null,
    userMessageId: newUserMessageId,
    prompt: sourceRound.prompt || sourceUserMessage.content.trim(),
    inputImageIds,
    maskTargetImageId:
      sourceRound.maskTargetImageId ??
      sourceUserMessage.maskTargetImageId ??
      null,
    maskImageId:
      sourceRound.maskImageId ?? sourceUserMessage.maskImageId ?? null,
    outputTaskIds: [],
    status: "running",
    error: null,
    createdAt: now,
    finishedAt: null,
  };
  const newUserMessage: AgentMessage = {
    id: newUserMessageId,
    role: "user",
    content: sourceUserMessage.content,
    roundId: newRoundId,
    inputImageIds,
    maskTargetImageId:
      sourceRound.maskTargetImageId ??
      sourceUserMessage.maskTargetImageId ??
      null,
    maskImageId:
      sourceRound.maskImageId ?? sourceUserMessage.maskImageId ?? null,
    createdAt: now,
  };

  updateAgentConversation(conversationId, (current) => ({
    ...current,
    activeRoundId: newRoundId,
    updatedAt: now,
    rounds: [...current.rounds, newRound],
    messages: [...current.messages, newUserMessage],
  }));
  state.setAgentEditingRoundId(null);
  void executeAgentRound(
    conversationId,
    newRoundId,
    normalizedParams,
    requestSettings,
    activeProfile,
    agentImageProfile,
  );
}

async function executeAgentRound(
  conversationId: string,
  roundId: string,
  params: TaskParams,
  requestSettings: AppSettings,
  activeProfile: ApiProfile,
  agentImageProfile: ApiProfile,
) {
  const startedAt = Date.now();
  const completedVideoRecordIds: string[] = [];
  const videoProfile = getVideoApiProfile(requestSettings);
  const videoValidationError = videoProfile.provider === "openai" && videoProfile.apiMode === "videos"
    ? validateApiProfile(videoProfile)
    : null;
  deps.getState().addAgentDiagnosticLog({
    level: "info",
    scope: "agent",
    message: `Agent request started: ${activeProfile.name} / ${activeProfile.model}`,
    detail: { conversationId, roundId, provider: activeProfile.provider },
  });
  const controller = new AbortController();
  const controllerKey = getAgentRoundControllerKey(conversationId, roundId);
  agentRoundControllers.set(controllerKey, controller);
  try {
    const latestState = deps.getState();
    const conversation = latestState.agentConversations.find(
      (item) => item.id === conversationId,
    );
    if (!conversation) return;
    const round = conversation.rounds.find((item) => item.id === roundId);
    const userMessage = round
      ? conversation.messages.find(
          (message) => message.id === round.userMessageId,
        )
      : null;
    if (!round || !userMessage) return;
    const maskDataUrl = round.maskImageId
      ? await deps.ensureImageCached(round.maskImageId)
      : undefined;
    if (round.maskImageId && !maskDataUrl) throw new Error("遮罩图片已不存在");

    const apiInputBuild = await buildAgentApiInput(
      conversation,
      round,
      latestState.tasks,
      {
        imageHistoryRounds: AGENT_CONTEXT_IMAGE_HISTORY_ROUNDS,
        softLimitBytes: AGENT_CONTEXT_INPUT_SOFT_LIMIT_BYTES,
        defaultMaxImageBytes: AGENT_CONTEXT_MAX_IMAGE_BYTES_DEFAULT,
        tightMaxImageBytes: AGENT_CONTEXT_MAX_IMAGE_BYTES_TIGHT,
      },
    );
    const apiInput = apiInputBuild.input;
    if (apiInputBuild.wasReduced) {
      deps.setState({
        agentContextNotice: {
          conversationId,
          roundId,
          message: `已自动缩减 Agent 上下文，当前请求约 ${(apiInputBuild.inputSize / 1024 / 1024).toFixed(1)} MB。`,
          createdAt: Date.now(),
        },
      });
    }
    if (apiInputBuild.wasReduced) {
      deps.getState().addAgentDiagnosticLog({
        level: "warning",
        scope: "agent-context",
        message: `Agent context reduced to ${(apiInputBuild.inputSize / 1024 / 1024).toFixed(1)} MB`,
        detail: { conversationId, roundId, inputSize: apiInputBuild.inputSize },
      });
    }
    if (controller.signal.aborted) throw createAgentAbortError();
    const existingAssistantMessage = round.assistantMessageId
      ? (conversation.messages.find(
          (message) => message.id === round.assistantMessageId,
        ) ?? null)
      : (conversation.messages.find(
          (message) =>
            message.roundId === roundId && message.role === "assistant",
        ) ?? null);
    const assistantMessageId = existingAssistantMessage?.id ?? genId();
    const shouldStreamAssistantMessage = activeProfile.streamImages === true;
    const shouldStreamImagePreviews =
      activeProfile.streamImages === true ||
      agentImageProfile.streamImages === true;
    const streamingTaskIds: string[] = [];
    const taskIdByToolCallId = new Map<string, string>();

    const attachTaskToAgentRound = (taskId: string) => {
      if (streamingTaskIds.includes(taskId)) return;
      streamingTaskIds.push(taskId);
      updateAgentConversation(conversationId, (current) => ({
        ...current,
        updatedAt: Date.now(),
        rounds: current.rounds.map((item) =>
          item.id === roundId
            ? {
                ...item,
                outputTaskIds: item.outputTaskIds.includes(taskId)
                  ? item.outputTaskIds
                  : [...item.outputTaskIds, taskId],
              }
            : item,
        ),
        messages: current.messages.map((message) =>
          message.id === assistantMessageId
            ? {
                ...message,
                outputTaskIds: [
                  ...new Set([...(message.outputTaskIds ?? []), taskId]),
                ],
              }
            : message,
        ),
      }));
    };

    const ensureStreamingAgentTask = async (
      toolCallId: string,
      taskPrompt = "",
      inputImageIds = round.inputImageIds ?? [],
      options: {
        createdAt?: number;
        agentBatchCallId?: string;
        maskTargetImageId?: string | null;
        maskImageId?: string | null;
      } = {},
    ) => {
      const existingTaskId = taskIdByToolCallId.get(toolCallId);
      if (existingTaskId) return existingTaskId;

      const existingTask = deps.getState()
        .tasks.find((task) => task.agentToolCallId === toolCallId);
      if (existingTask) {
        taskIdByToolCallId.set(toolCallId, existingTask.id);
        attachTaskToAgentRound(existingTask.id);
        return existingTask.id;
      }

      const task: TaskRecord = {
        id: genId(),
        prompt: taskPrompt,
        params: { ...params, n: 1 },
        apiProvider: agentImageProfile.provider,
        apiProfileId: agentImageProfile.id,
        apiProfileName: agentImageProfile.name,
        apiMode: agentImageProfile.apiMode,
        apiModel: agentImageProfile.model,
        inputImageIds,
        maskTargetImageId:
          options.maskTargetImageId !== undefined
            ? options.maskTargetImageId
            : (round.maskTargetImageId ?? null),
        maskImageId:
          options.maskImageId !== undefined
            ? options.maskImageId
            : (round.maskImageId ?? null),
        outputImages: [],
        status: "running",
        error: null,
        createdAt: options.createdAt ?? Date.now(),
        finishedAt: null,
        elapsed: null,
        sourceMode: "agent",
        agentConversationId: conversationId,
        agentRoundId: roundId,
        agentMessageId: assistantMessageId,
        agentToolCallId: toolCallId,
        ...(options.agentBatchCallId
          ? { agentBatchCallId: options.agentBatchCallId }
          : {}),
      };

      taskIdByToolCallId.set(toolCallId, task.id);
      deps.getState().setTasks([task, ...deps.getState().tasks]);
      attachTaskToAgentRound(task.id);
      await deps.putTask(task);
      return task.id;
    };

    const completeAgentImageTask = async (
      image: AgentApiResultImage,
      rawResponsePayload?: string,
    ) => {
      const toolCallId = image.toolCallId ?? genId();
      const taskId = await ensureStreamingAgentTask(toolCallId);
      const latestTask = deps.getState()
        .tasks.find((task) => task.id === taskId);
      if (latestTask?.status === "done" && latestTask.outputImages.length > 0)
        return taskId;

      const imgId = await deps.storeImage(image.dataUrl, "generated");
      deps.cacheImage(imgId, image.dataUrl);
      const actualParams: Partial<TaskParams> = {
        ...(Object.keys(image.actualParams ?? {}).length
          ? image.actualParams
          : {}),
        n: 1,
      };
      deps.updateTask(taskId, {
        prompt: image.revisedPrompt ?? latestTask?.prompt ?? "",
        outputImages: [imgId],
        actualParams,
        actualParamsByImage: { [imgId]: actualParams },
        revisedPromptByImage: image.revisedPrompt
          ? { [imgId]: image.revisedPrompt }
          : undefined,
        rawResponsePayload,
        status: "done",
        error: null,
        finishedAt: Date.now(),
        elapsed: Date.now() - (latestTask?.createdAt ?? startedAt),
        agentToolAction: image.action,
      });
      deps.getState().setTaskStreamPreview(taskId);
      return taskId;
    };

    const failAgentImageTask = (
      toolCallId: string,
      error: string,
      rawResponsePayload?: string,
    ) => {
      const safeError = sanitizeProviderErrorMessage(error);
      const taskId = taskIdByToolCallId.get(toolCallId);
      if (!taskId) return;
      const latestTask = deps.getState()
        .tasks.find((task) => task.id === taskId);
      if (!latestTask || latestTask.status !== "running") return;

      deps.getState().setTaskStreamPreview(taskId);
      deps.updateTask(taskId, {
        status: "error",
        error: safeError,
        rawResponsePayload,
        falRecoverable: false,
        customRecoverable: false,
        finishedAt: Date.now(),
        elapsed: Date.now() - latestTask.createdAt,
      });
    };

    if (shouldStreamAssistantMessage) {
      updateAgentConversation(conversationId, (current) => ({
        ...current,
        updatedAt: Date.now(),
        rounds: current.rounds.map((item) =>
          item.id === roundId ? { ...item, assistantMessageId } : item,
        ),
        messages: current.messages.some(
          (message) => message.id === assistantMessageId,
        )
          ? current.messages.map((message) =>
              message.id === assistantMessageId
                ? { ...message, content: "", outputTaskIds: [] }
                : message,
            )
          : [
              ...current.messages,
              {
                id: assistantMessageId,
                role: "assistant",
                content: "",
                roundId,
                createdAt: Date.now(),
              },
            ],
      }));
    }
    const maxToolCalls = Number.isFinite(requestSettings.agentMaxToolRounds)
      ? Math.max(1, Math.trunc(requestSettings.agentMaxToolRounds))
      : DEFAULT_AGENT_MAX_TOOL_ROUNDS;
    let apiInputForTurn = apiInput;
    let accumulatedOutputItems: ResponsesOutputItem[] = [];
    let accumulatedText = "";
    const textSegments: string[] = [];
    let lastResponseId: string | undefined;
    let toolCallsUsed = 0;
    let reachedToolLimit = false;
    let reachedImageToolFailureLimit = false;
    let consecutiveImageToolFailureRounds = 0;
    let pendingToolTextSeparator = false;
    let usedDirectMediaFallback = false;

    // Helper: resolve reference image ids to data URLs for batch image calls
    const resolveReferenceImages = async (
      referenceIds: string[],
    ): Promise<{ dataUrls: string[]; imageIds: string[] }> => {
      const dataUrls: string[] = [];
      const imageIds: string[] = [];
      for (const refId of referenceIds) {
        // Resolve both generated image refs and current/user input refs from XML tags.
        const latestConv = deps.getState()
          .agentConversations.find((item) => item.id === conversationId);
        if (!latestConv) continue;
        for (const r of getAgentRoundPath(latestConv, roundId)) {
          for (let imgIdx = 0; imgIdx < r.inputImageIds.length; imgIdx++) {
            const currentRefId = getAgentCurrentReferenceId(r, imgIdx);
            if (currentRefId === refId) {
              const imageId = r.inputImageIds[imgIdx];
              const [dataUrl] = await readAgentContextImageDataUrls([imageId]);
              if (dataUrl) dataUrls.push(dataUrl);
              imageIds.push(imageId);
            }
          }
          const outputImages = collectAgentRoundOutputImageSlots(
            r,
            deps.getState().tasks,
          );
          for (let imgIdx = 0; imgIdx < outputImages.length; imgIdx++) {
            const generatedRefId = getAgentGeneratedImageReferenceId(r, imgIdx);
            if (generatedRefId === refId) {
              const imageId = outputImages[imgIdx];
              if (!imageId) continue;
              const [dataUrl] = await readAgentContextImageDataUrls([imageId]);
              if (dataUrl) dataUrls.push(dataUrl);
              imageIds.push(imageId);
            }
          }
        }
      }
      return { dataUrls, imageIds };
    };

    const resolveToolReferenceImages = async (
      referenceIds: string[],
      fallbackImageIds: string[] = [],
    ): Promise<{ dataUrls: string[]; imageIds: string[] }> => {
      const references = await resolveReferenceImages(referenceIds);
      if (references.imageIds.length > 0 || fallbackImageIds.length === 0) {
        return references;
      }

      const fallbackIds = uniqueIds(fallbackImageIds);
      if (fallbackIds.length === 0) return references;
      const fallbackDataUrls = await readAgentContextImageDataUrls(fallbackIds);
      return {
        dataUrls: fallbackDataUrls,
        imageIds: fallbackIds,
      };
    };

    const getToolPromptReferenceIds = (toolPrompt: string) =>
      uniqueIds([
        ...extractAgentReferenceIds(toolPrompt),
        ...extractAgentReferenceIds(round.prompt),
        ...extractAgentPromptReferenceIds(
          toolPrompt,
          getAgentRoundPath(conversation, roundId),
          deps.getState().tasks,
        ),
        ...extractAgentPromptReferenceIds(
          round.prompt,
          getAgentRoundPath(conversation, roundId),
          deps.getState().tasks,
        ),
      ]);

    const executeSingleImageFunctionCall = async (
      functionCallItem: ResponsesOutputItem,
    ): Promise<string> => {
      const args = functionCallItem.arguments ?? "";
      const item = parseSingleImageCallArguments(args);

      if (!item) {
        return JSON.stringify({ error: "Invalid or empty image arguments" });
      }

      const referenceIds = getToolPromptReferenceIds(item.prompt);
      const references = await resolveToolReferenceImages(
        referenceIds,
        round.inputImageIds ?? [],
      );
      const toolCallId = functionCallItem.call_id || genId();
      await ensureStreamingAgentTask(
        toolCallId,
        item.prompt,
        references.imageIds,
        {
          createdAt: Date.now(),
          maskTargetImageId: null,
          maskImageId: null,
        },
      );

      const result = await callBatchImageSingle({
        settings: requestSettings,
        profile: agentImageProfile,
        params,
        batchItemId: "image",
        prompt: item.prompt,
        referenceImageDataUrls: references.dataUrls,
        referenceIds,
        signal: controller.signal,
        onImageToolStarted: shouldStreamImagePreviews
          ? async () => {
              if (controller.signal.aborted) return;
            }
          : undefined,
        onPartialImage: shouldStreamImagePreviews
          ? async ({ image, partialImageIndex }) => {
              if (controller.signal.aborted) return;
              const taskId = taskIdByToolCallId.get(toolCallId);
              if (taskId) {
                deps.getState()
                  .setTaskStreamPreview(taskId, image, partialImageIndex);
                if (partialImageIndex === 0 || partialImageIndex == null) {
                  void deps.persistTaskStreamPartialImage(taskId, image);
                }
              }
            }
          : undefined,
        onImageToolCompleted: shouldStreamImagePreviews
          ? async (image) => {
              if (controller.signal.aborted) return;
              await completeAgentImageTask({
                ...image,
                toolCallId,
              });
            }
          : undefined,
      });

      toolCallsUsed += 1;

      if (result.image) {
        const taskId = taskIdByToolCallId.get(toolCallId);
        const currentTask = taskId
          ? deps.getState().tasks.find((task) => task.id === taskId)
          : undefined;
        if (!currentTask || currentTask.status !== "done") {
          await completeAgentImageTask(
            { ...result.image, toolCallId },
            result.rawResponsePayload,
          );
        }
      }

      if (!result.image) {
        failAgentImageTask(
          toolCallId,
          result.error ?? "接口未返回图片数据",
          result.rawResponsePayload,
        );
        consecutiveImageToolFailureRounds += 1;
      } else {
        consecutiveImageToolFailureRounds = 0;
      }

      return JSON.stringify({
        image: {
          status: result.image ? "done" : "error",
          ...(result.error
            ? { error: sanitizeProviderErrorMessage(result.error) }
            : {}),
        },
      });
    };

    // Helper: execute a generate_image_batch function call concurrently
    const executeBatchFunctionCall = async (
      functionCallItem: ResponsesOutputItem,
    ): Promise<string> => {
      const callId = functionCallItem.call_id ?? "";
      const args = functionCallItem.arguments ?? "";
      const batchItems = parseBatchImageCallArguments(args);

      if (!batchItems || batchItems.length === 0) {
        return JSON.stringify({ error: "Invalid or empty batch arguments" });
      }

      // Create task cards in model-provided order before starting network calls.
      const batchExecutionItems = [];
      for (const item of batchItems) {
        const referenceIds = getToolPromptReferenceIds(item.prompt);
        const references = await resolveToolReferenceImages(
          referenceIds,
          round.inputImageIds ?? [],
        );
        const batchToolCallId = genId();
        await ensureStreamingAgentTask(
          batchToolCallId,
          item.prompt,
          references.imageIds,
          {
            createdAt: Date.now(),
            maskTargetImageId: null,
            maskImageId: null,
            ...(callId ? { agentBatchCallId: callId } : {}),
          },
        );
        batchExecutionItems.push({
          item,
          batchToolCallId,
          references,
          referenceIds,
        });
      }

      // Fire all batch items concurrently after all cards are visible.
      const batchPromises = batchExecutionItems.map(
        async ({ item, batchToolCallId, references, referenceIds }) => {
          const batchResult = await callBatchImageSingle({
            settings: requestSettings,
            profile: agentImageProfile,
            params,
            batchItemId: item.id,
            prompt: item.prompt,
            referenceImageDataUrls: references.dataUrls,
            referenceIds,
            signal: controller.signal,
            onImageToolStarted: shouldStreamImagePreviews
              ? async () => {
                  if (controller.signal.aborted) return;
                }
              : undefined,
            onPartialImage: shouldStreamImagePreviews
              ? async ({ image, partialImageIndex }) => {
                  if (controller.signal.aborted) return;
                  const taskId = taskIdByToolCallId.get(batchToolCallId);
                  if (taskId) {
                    deps.getState()
                      .setTaskStreamPreview(taskId, image, partialImageIndex);
                    if (partialImageIndex === 0 || partialImageIndex == null) {
                      void deps.persistTaskStreamPartialImage(taskId, image);
                    }
                  }
                }
              : undefined,
            onImageToolCompleted: shouldStreamImagePreviews
              ? async (image) => {
                  if (controller.signal.aborted) return;
                  await completeAgentImageTask({
                    ...image,
                    toolCallId: batchToolCallId,
                  });
                }
              : undefined,
          });

          // If not streaming and we have an image, complete the pre-created task.
          if (batchResult.image && !shouldStreamImagePreviews) {
            await completeAgentImageTask(
              { ...batchResult.image, toolCallId: batchToolCallId },
              batchResult.rawResponsePayload,
            );
          }

          return batchResult;
        },
      );

      const batchResults = await Promise.allSettled(batchPromises);

      // Build function_call_output
      const outputImages: Array<{
        id: string;
        status: string;
        error?: string;
      }> = [];
      for (let i = 0; i < batchItems.length; i++) {
        const settled = batchResults[i];
        const batchItem = batchItems[i];
        if (settled.status === "fulfilled") {
          const r = settled.value;
          if (!r.image) {
            failAgentImageTask(
              batchExecutionItems[i].batchToolCallId,
              r.error ?? "接口未返回图片数据",
              r.rawResponsePayload,
            );
          }
          outputImages.push({
            id: r.batchItemId,
            status: r.image ? "done" : "error",
            ...(r.error
              ? { error: sanitizeProviderErrorMessage(r.error) }
              : {}),
          });
        } else {
          const error = sanitizeProviderErrorMessage(
            settled.reason instanceof Error
              ? settled.reason.message
              : String(settled.reason),
          );
          failAgentImageTask(batchExecutionItems[i].batchToolCallId, error);
          outputImages.push({
            id: batchItem.id,
            status: "error",
            error,
          });
        }
      }

      const successCount = outputImages.filter(
        (img) => img.status === "done",
      ).length;
      toolCallsUsed += batchItems.length;
      if (successCount === 0) {
        consecutiveImageToolFailureRounds += 1;
      } else {
        consecutiveImageToolFailureRounds = 0;
      }

      return JSON.stringify({ images: outputImages });
    };

    const attachVideoRecordToAgentRound = (recordId: string) => {
      updateAgentConversation(conversationId, (current) => ({
        ...current,
        updatedAt: Date.now(),
        rounds: current.rounds.map((round) =>
          round.id === roundId
            ? {
                ...round,
                outputVideoRecordIds: uniqueIds([
                  ...(round.outputVideoRecordIds ?? []),
                  recordId,
                ]),
              }
            : round,
        ),
        messages: current.messages.map((message) =>
          message.id === assistantMessageId
            ? {
                ...message,
                outputVideoRecordIds: uniqueIds([
                  ...(message.outputVideoRecordIds ?? []),
                  recordId,
                ]),
              }
            : message,
        ),
      }));
    };

    const executeVideoFunctionCall = async (
      functionCallItem: ResponsesOutputItem,
    ): Promise<string> => {
      const item = parseVideoCallArguments(functionCallItem.arguments ?? "");
      if (!item) return JSON.stringify({ error: "Invalid or empty video arguments" });
      if (videoValidationError || videoProfile.provider !== "openai" || videoProfile.apiMode !== "videos") {
        return JSON.stringify({
          video: {
            status: "error",
            error: videoValidationError || "请先在设置中配置 Videos API",
          },
        });
      }

      const videoConfig = createVideoConfigFromProfile(videoProfile, {
        seconds: item.seconds ?? "6",
        size: item.size ?? "1280x720",
        resolution: item.resolution ?? "720p",
      });
      const referenceIds = getToolPromptReferenceIds(item.prompt);
      const explicitReferences = await resolveToolReferenceImages(
        referenceIds,
        round.inputImageIds ?? [],
      );
      const currentRoundReferenceDataUrls = explicitReferences.dataUrls;
      const currentRoundReferenceImageIds = explicitReferences.imageIds;
      const recordId = genId();
      const baseRecord = {
        id: recordId,
        createdAt: Date.now(),
        prompt: item.prompt,
        model: videoConfig.model,
        config: {
          baseUrl: videoConfig.baseUrl,
          model: videoConfig.model,
          size: videoConfig.size,
          resolution: videoConfig.resolution,
          seconds: videoConfig.seconds,
          timeout: videoConfig.timeout,
          stream: videoConfig.stream,
        },
        referenceImageIds: currentRoundReferenceImageIds,
        referenceImageCount: currentRoundReferenceDataUrls.length,
        status: "running" as const,
        progress: 0,
      };
      await putVideoRecord(stripTransientVideoUrl(baseRecord));
      attachVideoRecordToAgentRound(recordId);

      let task: VideoGenerationTask | undefined;
      try {
        task = await createVideoGenerationTask(videoConfig, item.prompt, currentRoundReferenceDataUrls, { signal: controller.signal });
        await putVideoRecord(stripTransientVideoUrl({ ...baseRecord, task }));
        const finishVideoRecord = async (video: {
          dataUrl?: string;
          url?: string;
          mimeType: string;
          bytes: number;
        }) => {
          const completedRecord = {
            ...baseRecord,
            task,
            status: "success" as const,
            progress: 100,
            video: {
              dataUrl: video.dataUrl,
              remoteUrl: video.url?.startsWith("http") ? video.url : undefined,
              mimeType: video.mimeType,
              bytes: video.bytes,
            },
          };
          await putVideoRecord(stripTransientVideoUrl(completedRecord));
          completedVideoRecordIds.push(recordId);
          toolCallsUsed += 1;
          return JSON.stringify({
            video: {
              status: "done",
              id: recordId,
              model: videoConfig.model,
              seconds: videoConfig.seconds,
              size: videoConfig.size,
            },
          });
        };
        if (task.completedVideo) {
          return finishVideoRecord(task.completedVideo);
        }
        const deadline = Date.now() + Math.max(1, videoConfig.timeout) * 1000;
        while (Date.now() < deadline) {
          const state = await pollVideoGenerationTask(videoConfig, task, { signal: controller.signal });
          if (state.status === "completed") {
            return finishVideoRecord(state.video);
          }
          if (state.status === "failed") throw new Error(state.error);
          if (state.progress != null) {
            await putVideoRecord(stripTransientVideoUrl({
              ...baseRecord,
              task,
              progress: state.progress,
            }));
          }
          await sleep(Math.min(state.retryAfterMs ?? POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())), controller.signal);
        }

        throw new Error("视频生成超时，请稍后重试。");
      } catch (error) {
        const safeError = sanitizeProviderErrorMessage(error instanceof Error ? error.message : String(error));
        await putVideoRecord(stripTransientVideoUrl({
          ...baseRecord,
          ...(task ? { task } : {}),
          status: "failed" as const,
          error: safeError,
        }));
        throw error;
      }
    };

    while (true) {
      if (controller.signal.aborted) throw createAgentAbortError();
      const textBeforeResponse = accumulatedText;
      let currentResponseOutputItems: ResponsesOutputItem[] = [];
      const requestOptions = {
        settings: requestSettings,
        profile: activeProfile,
        imageProfile: agentImageProfile,
        params,
        maskDataUrl,
        signal: controller.signal,
        onTextDelta: shouldStreamAssistantMessage
          ? (delta: string) => {
              if (controller.signal.aborted) return;
              if (pendingToolTextSeparator && delta && accumulatedText.trim()) {
                accumulatedText += "\n\n";
                appendAgentAssistantMessageContent(
                  conversationId,
                  assistantMessageId,
                  "\n\n",
                );
              }
              pendingToolTextSeparator = false;
              accumulatedText += delta;
              appendAgentAssistantMessageContent(
                conversationId,
                assistantMessageId,
                delta,
              );
            }
          : undefined,
        onOutputItems: shouldStreamAssistantMessage
          ? (outputItems: ResponsesOutputItem[]) => {
              if (controller.signal.aborted) return;
              currentResponseOutputItems = outputItems;
              updateAgentConversation(conversationId, (current) => ({
                ...current,
                rounds: current.rounds.map((item) =>
                  item.id === roundId
                    ? {
                        ...item,
                        responseOutput: mergeResponseOutputItems(
                          accumulatedOutputItems,
                          outputItems,
                        ),
                      }
                    : item,
                ),
              }));
            }
          : undefined,
        onImageToolStarted: shouldStreamAssistantMessage
          ? async ({ toolCallId }: { toolCallId: string }) => {
              if (controller.signal.aborted) return;
              await ensureStreamingAgentTask(toolCallId);
            }
          : undefined,
        onImagePartialImage: shouldStreamAssistantMessage
          ? async ({
              toolCallId,
              image,
              partialImageIndex,
            }: {
              toolCallId: string;
              image: string;
              partialImageIndex?: number;
            }) => {
              if (controller.signal.aborted) return;
              const taskId = await ensureStreamingAgentTask(toolCallId);
              if (controller.signal.aborted) return;
              deps.getState()
                .setTaskStreamPreview(taskId, image, partialImageIndex);
              if (partialImageIndex === 0 || partialImageIndex == null) {
                void deps.persistTaskStreamPartialImage(taskId, image);
              }
            }
          : undefined,
        onImageToolCompleted: shouldStreamAssistantMessage
          ? async (image: AgentApiResultImage) => {
              if (controller.signal.aborted) return;
              await completeAgentImageTask(image);
            }
          : undefined,
        onImageToolFailed: shouldStreamAssistantMessage
          ? async ({
              toolCallId,
              error,
            }: {
              toolCallId: string;
              error: string;
            }) => {
              if (controller.signal.aborted) return;
              await ensureStreamingAgentTask(toolCallId);
              if (controller.signal.aborted) return;
              failAgentImageTask(toolCallId, error);
            }
          : undefined,
      };
      const directFallbackPrompt = round.prompt || userMessage.content;
      const directFallbackCall = createDirectMediaFunctionCall(directFallbackPrompt, {
        hasImageContext: round.inputImageIds.length > 0,
      });
      const agentToolsMode = "auto";
      const callAgentWithTemporaryRetry = async (
        input: unknown,
      ): Promise<Awaited<ReturnType<typeof callAgentResponsesApi>>> => {
        for (let attempt = 0; ; attempt += 1) {
          try {
            return await callAgentResponsesApi({
              ...requestOptions,
              input,
              toolsMode: agentToolsMode,
              allowTextOnlyFallback: !directFallbackCall,
            });
          } catch (error) {
            if (
              attempt === 0 &&
              directFallbackCall &&
              canUseDirectMediaFallback(error)
            ) {
              throw error;
            }
            const delay = AGENT_TEMPORARY_ERROR_RETRY_DELAYS_MS[attempt];
            if (
              delay == null ||
              !isRetryableAgentTemporaryError(error) ||
              controller.signal.aborted
            ) {
              throw error;
            }

            const safeMessage = sanitizeProviderErrorMessage(
              error instanceof Error ? error.message : String(error),
            );
            deps.getState().addAgentDiagnosticLog({
              level: "warning",
              scope: "agent",
              message: `Agent temporary error, retrying in ${delay}ms: ${safeMessage}`,
              detail: {
                conversationId,
                roundId,
                attempt: attempt + 1,
              },
            });
            deps.getState()
              .showToast(`Agent 临时不可用，${Math.round(delay / 1000)} 秒后自动重试`, "info");
            await sleep(delay, controller.signal);
          }
        }
      };
      let result;
      try {
        result = await callAgentWithTemporaryRetry(apiInputForTurn);
      } catch (error) {
        const directMediaCall = accumulatedOutputItems.length === 0 && toolCallsUsed === 0 && streamingTaskIds.length === 0
          ? directFallbackCall
          : null;
        if (directMediaCall && canUseDirectMediaFallback(error)) {
          const safeMessage = sanitizeProviderErrorMessage(
            error instanceof Error ? error.message : String(error),
          );
          deps.getState().addAgentDiagnosticLog({
            level: "warning",
            scope: "agent",
            message: `Agent planning failed, using direct media fallback: ${safeMessage}`,
            detail: {
              conversationId,
              roundId,
              fallbackTool: directMediaCall.name,
            },
          });
          result = {
            text: "",
            images: [],
            outputItems: [directMediaCall],
            rawResponsePayload: deps.getRawErrorPayload(error).rawResponsePayload,
          };
          usedDirectMediaFallback = true;
        } else {
        if (!isAgentContextSizeLimitError(error)) throw error;
        const reducedInput = buildReducedAgentInput(
          apiInputForTurn,
          AGENT_CONTEXT_REQUEST_HARD_LIMIT_BYTES,
        );
        if (
          estimateSerializedSize(reducedInput) >=
          estimateSerializedSize(apiInputForTurn)
        ) {
          throw new Error(getAgentContextSizeLimitErrorMessage());
        }
        deps.getState().addAgentDiagnosticLog({
          level: "warning",
          scope: "agent-context",
          message: "5MB request limit hit, retrying with reduced image context",
          detail: {
            conversationId,
            roundId,
            beforeBytes: estimateSerializedSize(apiInputForTurn),
            afterBytes: estimateSerializedSize(reducedInput),
          },
        });
        deps.setState({
          agentContextNotice: {
            conversationId,
            roundId,
            message: "接口限制了 5MB 请求体，已移除图片上下文并自动重试。",
            createdAt: Date.now(),
          },
        });
        deps.getState()
          .showToast("Agent 上下文过大，已自动缩减参考图后重试", "info");
        result = await callAgentWithTemporaryRetry(reducedInput).catch((retryError) => {
          if (isAgentContextSizeLimitError(retryError)) {
            throw new Error(getAgentContextSizeLimitErrorMessage());
          }
          throw retryError;
        });
        apiInputForTurn = reducedInput;
        }
      }
      if (controller.signal.aborted) throw createAgentAbortError();

      lastResponseId = result.responseId ?? lastResponseId;
      currentResponseOutputItems = currentResponseOutputItems.length
        ? currentResponseOutputItems
        : (result.outputItems ?? []);
      accumulatedOutputItems = mergeResponseOutputItems(
        accumulatedOutputItems,
        currentResponseOutputItems,
      );

      const responseText = result.text.trim();
      if (responseText && accumulatedText === textBeforeResponse) {
        const textToAppend = accumulatedText
          ? `\n\n${responseText}`
          : responseText;
        accumulatedText += textToAppend;
        if (shouldStreamAssistantMessage)
          appendAgentAssistantMessageContent(
            conversationId,
            assistantMessageId,
            textToAppend,
          );
      }
      const newTextInThisResponse = accumulatedText
        .slice(textBeforeResponse.length)
        .trim();
      if (newTextInThisResponse) textSegments.push(newTextInThisResponse);

      // Process built-in image_generation_call results (single images)
      for (const image of result.images) {
        if (image.toolCallId && taskIdByToolCallId.has(image.toolCallId)) {
          const completedTaskId = await completeAgentImageTask(
            image,
            result.rawResponsePayload,
          );
          const promptRefIds = uniqueIds(
            extractAgentReferenceIds(image.revisedPrompt ?? ""),
          );
          if (promptRefIds.length > 0) {
            const promptRefs = await resolveReferenceImages(promptRefIds);
            if (promptRefs.imageIds.length > 0) {
              const latestTask = deps.getState()
                .tasks.find((t) => t.id === completedTaskId);
              if (latestTask) {
                const mergedInputIds = uniqueIds([
                  ...latestTask.inputImageIds,
                  ...promptRefs.imageIds,
                ]);
                if (mergedInputIds.length !== latestTask.inputImageIds.length) {
                  deps.updateTask(completedTaskId, {
                    inputImageIds: mergedInputIds,
                  });
                }
              }
            }
          }
          continue;
        }
        const promptRefIds = uniqueIds(
          extractAgentReferenceIds(image.revisedPrompt ?? ""),
        );
        const promptRefs = await resolveReferenceImages(promptRefIds);
        const imgId = await deps.storeImage(image.dataUrl, "generated");
        deps.cacheImage(imgId, image.dataUrl);
        const actualParams: Partial<TaskParams> = {
          ...(Object.keys(image.actualParams ?? {}).length
            ? image.actualParams
            : {}),
          n: 1,
        };
        const task: TaskRecord = {
          id: genId(),
          prompt: image.revisedPrompt ?? round?.prompt ?? userMessage.content,
          params,
          apiProvider: agentImageProfile.provider,
          apiProfileId: agentImageProfile.id,
          apiProfileName: agentImageProfile.name,
          apiMode: agentImageProfile.apiMode,
          apiModel: agentImageProfile.model,
          inputImageIds: uniqueIds([
            ...(round?.inputImageIds ?? []),
            ...promptRefs.imageIds,
          ]),
          maskTargetImageId: round?.maskTargetImageId ?? null,
          maskImageId: round?.maskImageId ?? null,
          outputImages: [imgId],
          actualParams,
          actualParamsByImage: { [imgId]: actualParams },
          revisedPromptByImage: image.revisedPrompt
            ? { [imgId]: image.revisedPrompt }
            : undefined,
          rawResponsePayload: result.rawResponsePayload,
          status: "done",
          error: null,
          createdAt: startedAt,
          finishedAt: Date.now(),
          elapsed: Date.now() - startedAt,
          sourceMode: "agent",
          agentConversationId: conversationId,
          agentRoundId: roundId,
          agentMessageId: assistantMessageId,
          agentToolCallId: image.toolCallId,
          agentToolAction: image.action,
        };
        deps.getState().setTasks([task, ...deps.getState().tasks]);
        attachTaskToAgentRound(task.id);
        await deps.putTask(task);
      }

      if (result.rawResponsePayload && streamingTaskIds.length > 0) {
        for (const taskId of streamingTaskIds) {
          const latestTask = deps.getState()
            .tasks.find((task) => task.id === taskId);
          if (latestTask && !latestTask.rawResponsePayload)
            deps.updateTask(taskId, {
              rawResponsePayload: result.rawResponsePayload,
            });
        }
      }

      // Check for function calls that require continuation
      const singleImageFunctionCalls = currentResponseOutputItems.filter(
        (item) =>
          item.type === "function_call" && item.name === "generate_image",
      );
      const batchFunctionCalls = currentResponseOutputItems.filter(
        (item) =>
          item.type === "function_call" && item.name === "generate_image_batch",
      );
      const continueFunctionCalls = currentResponseOutputItems.filter(
        (item) =>
          item.type === "function_call" && item.name === "continue_generation",
      );
      const videoFunctionCalls = currentResponseOutputItems.filter(
        (item) =>
          item.type === "function_call" && item.name === "generate_video",
      );

      // Count built-in tool calls (image_generation, web_search) for budget tracking
      const responseToolCalls = countResponseToolCalls(
        currentResponseOutputItems,
      );
      toolCallsUsed += responseToolCalls;

      // Collect function_call_output items for all function calls that need responses
      const functionCallOutputs: ResponsesOutputItem[] = [];

      if (singleImageFunctionCalls.length > 0) {
        for (const fc of singleImageFunctionCalls) {
          const output = await executeSingleImageFunctionCall(fc);
          functionCallOutputs.push({
            type: "function_call_output",
            call_id: fc.call_id,
            output,
          });
        }
      }

      if (batchFunctionCalls.length > 0) {
        for (const fc of batchFunctionCalls) {
          const output = await executeBatchFunctionCall(fc);
          functionCallOutputs.push({
            type: "function_call_output",
            call_id: fc.call_id,
            output,
          });
        }
      }

      if (videoFunctionCalls.length > 0) {
        for (const fc of videoFunctionCalls) {
          const output = await executeVideoFunctionCall(fc);
          functionCallOutputs.push({
            type: "function_call_output",
            call_id: fc.call_id,
            output,
          });
        }
      }

      for (const fc of continueFunctionCalls) {
        functionCallOutputs.push({
          type: "function_call_output",
          call_id: fc.call_id,
          output: JSON.stringify({ status: "continued" }),
        });
      }

      // If no function calls need output → model decided the task is done → break
      if (functionCallOutputs.length === 0) {
        updateAgentConversation(conversationId, (current) => ({
          ...current,
          updatedAt: Date.now(),
          rounds: current.rounds.map((item) =>
            item.id === roundId
              ? {
                  ...item,
                  responseId: lastResponseId,
                  responseOutput: accumulatedOutputItems,
                }
              : item,
          ),
        }));
        break;
      }

      const accumulatedOutputItemsWithFunctionOutputs =
        mergeResponseOutputItems(accumulatedOutputItems, functionCallOutputs);

      updateAgentConversation(conversationId, (current) => ({
        ...current,
        updatedAt: Date.now(),
        rounds: current.rounds.map((item) =>
          item.id === roundId
            ? {
                ...item,
                responseId: lastResponseId,
                responseOutput: accumulatedOutputItemsWithFunctionOutputs,
              }
            : item,
          ),
      }));

      if (usedDirectMediaFallback) {
        accumulatedOutputItems = accumulatedOutputItemsWithFunctionOutputs;
        break;
      }

      if (
        consecutiveImageToolFailureRounds >=
        AGENT_MAX_CONSECUTIVE_IMAGE_TOOL_FAILURE_ROUNDS
      ) {
        reachedImageToolFailureLimit = true;
        break;
      }

      if (toolCallsUsed >= maxToolCalls) {
        reachedToolLimit = true;
        break;
      }

      // Build continuation input with function call outputs and available refs
      const latestConversation = deps.getState()
        .agentConversations.find((item) => item.id === conversationId);
      const latestRound = latestConversation?.rounds.find(
        (item) => item.id === roundId,
      );
      if (!latestRound) break;

      const continuationBase = buildAgentContinuationInput(
        apiInput,
        latestRound,
        deps.getState().tasks,
        accumulatedOutputItems,
        toolCallsUsed,
        maxToolCalls,
      );
      // Insert function_call_output items before the continuation system message
      continuationBase.splice(
        continuationBase.length - 1,
        0,
        ...functionCallOutputs,
      );
      // Inject batch-generated images as input_image user message for model visibility
      const batchImagesItem = await createAgentBatchImagesInputItem(
        latestRound,
        deps.getState().tasks,
        streamingTaskIds,
      );
      if (batchImagesItem)
        continuationBase.splice(
          continuationBase.length - 1,
          0,
          batchImagesItem,
        );
      apiInputForTurn =
        estimateSerializedSize(continuationBase) >
        AGENT_CONTEXT_REQUEST_HARD_LIMIT_BYTES
          ? buildReducedAgentInput(
              continuationBase,
              AGENT_CONTEXT_REQUEST_HARD_LIMIT_BYTES,
            )
          : continuationBase;
      accumulatedOutputItems = accumulatedOutputItemsWithFunctionOutputs;
      pendingToolTextSeparator = true;
    }

    markAgentRoundTasksFailed(
      conversationId,
      roundId,
      "内置 image_generation 工具未返回图片",
      undefined,
      (task) => Boolean(task.agentToolCallId && !task.agentBatchCallId && !task.agentToolCallId.startsWith("direct-")),
    );

    const taskIds: string[] = [...streamingTaskIds];
    const outputIds = taskIds.flatMap(
      (taskId) =>
        deps.getState().tasks.find((task) => task.id === taskId)
          ?.outputImages ?? [],
    );
    const videoRecordIds =
      deps.getState()
        .agentConversations.find((item) => item.id === conversationId)
        ?.rounds.find((round) => round.id === roundId)
        ?.outputVideoRecordIds ?? [];
    const limitNotice = [
      reachedToolLimit
        ? `已达到最大工具调用次数（${maxToolCalls}），已停止自动续跑。`
        : "",
      reachedImageToolFailureLimit
        ? "连续生图失败，已停止自动重试。请检查模型、API 配置或降低尺寸后手动重试。"
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    const joinedText = textSegments.join("\n\n").trim();
    const finalContent =
      [joinedText, limitNotice]
        .filter(Boolean)
        .join(joinedText ? "\n\n" : "") ||
      (videoRecordIds.length > 0
        ? "视频已生成，可在视频创作台查看。"
        : taskIds.length > 0 || outputIds.length > 0
          ? "图像已生成。"
          : "");

    const assistantMessage: AgentMessage = {
      id: assistantMessageId,
      role: "assistant",
      content: finalContent,
      roundId,
      outputTaskIds: taskIds,
      outputVideoRecordIds: videoRecordIds,
      createdAt: Date.now(),
    };

    updateAgentConversation(conversationId, (current) => ({
      ...current,
      updatedAt: Date.now(),
      rounds: current.rounds.map((round) =>
        round.id === roundId
          ? {
              ...round,
              assistantMessageId,
              outputTaskIds: taskIds,
              outputVideoRecordIds: videoRecordIds,
              responseId: lastResponseId,
              responseOutput: accumulatedOutputItems,
              status: "done",
              error: null,
              finishedAt: Date.now(),
            }
          : round,
      ),
      messages: current.messages.some(
        (message) => message.id === assistantMessageId,
      )
        ? current.messages.map((message) =>
            message.id === assistantMessageId ? assistantMessage : message,
          )
        : [...current.messages, assistantMessage],
    }));

    deps.getState()
      .showToast(
        outputIds.length > 0 ? "Agent 已生成图片" : "Agent 已回复",
        "success",
      );
    deps.showTaskCompletionNotification(
      outputIds.length > 0 ? "Agent 已生成图片" : "Agent 已回复",
      outputIds.length > 0
        ? `Agent 回复已结束，共生成 ${outputIds.length} 张图片。`
        : "Agent 回复已结束。",
    );
  } catch (err) {
    if (controller.signal.aborted) {
      if (markAgentRoundStopped(conversationId, roundId)) {
        deps.getState().showToast("已停止生成", "info");
      }
      return;
    }

    let message = isAgentContextSizeLimitError(err)
      ? getAgentContextSizeLimitErrorMessage()
      : err instanceof Error
        ? err.message
        : String(err);
    message = sanitizeProviderErrorMessage(message);
    const usesApiProxy = activeProfile.apiProxy ?? requestSettings.apiProxy;
    const networkErrorHint = getApiRequestNetworkErrorHint(
      err,
      startedAt,
      usesApiProxy,
      activeProfile,
    );
    if (networkErrorHint && !message.includes(IMAGE_FETCH_CORS_HINT)) {
      message += `\n${networkErrorHint}`;
    }

    const successfulOutputs = getAgentRoundSuccessfulOutputIds(
      conversationId,
      roundId,
    );
    const successfulVideoRecordIds = uniqueIds([
      ...completedVideoRecordIds,
      ...getAgentRoundSuccessfulVideoRecordIds(conversationId, roundId)
        .filter((id) => completedVideoRecordIds.includes(id)),
    ]);
    if (successfulOutputs.outputIds.length > 0 || successfulVideoRecordIds.length > 0) {
      markAgentRoundTasksFailed(
        conversationId,
        roundId,
        message,
        deps.getRawErrorPayload(err).rawResponsePayload,
        (task) => task.status === "running",
      );
      deps.getState().addAgentDiagnosticLog({
        level: "warning",
        scope: "agent",
        message: `Agent follow-up failed after images were generated: ${message}`,
        detail: {
          conversationId,
          roundId,
          elapsedMs: Date.now() - startedAt,
          outputImageCount: successfulOutputs.outputIds.length,
          outputVideoCount: successfulVideoRecordIds.length,
        },
      });

      updateAgentConversation(conversationId, (current) => {
        const currentRound = current.rounds.find((round) => round.id === roundId);
        const existingAssistantMessage = currentRound?.assistantMessageId
          ? current.messages.find(
              (item) => item.id === currentRound.assistantMessageId,
            )
          : current.messages.find(
              (item) => item.roundId === roundId && item.role === "assistant",
        );
        const messageId = existingAssistantMessage?.id ?? genId();
        const currentContent = existingAssistantMessage?.content.trim() ?? "";
        const fallbackContent = currentContent || (successfulVideoRecordIds.length > 0
          ? "视频已生成，可在视频创作台查看。"
          : "图片已生成。");

        return {
          ...current,
          updatedAt: Date.now(),
          rounds: current.rounds.map((round) =>
            round.id === roundId
              ? {
                  ...round,
                  assistantMessageId: messageId,
                  outputTaskIds: successfulOutputs.taskIds,
                  outputVideoRecordIds: successfulVideoRecordIds,
                  status: "done",
                  error: null,
                  finishedAt: Date.now(),
                }
              : round,
          ),
          messages: existingAssistantMessage
            ? current.messages.map((item) =>
                item.id === existingAssistantMessage.id
                  ? {
                      ...item,
                      content: fallbackContent,
                      outputTaskIds: successfulOutputs.taskIds,
                      outputVideoRecordIds: successfulVideoRecordIds,
                    }
                  : item,
              )
            : [
                ...current.messages,
                {
                  id: messageId,
                  role: "assistant",
                  content: fallbackContent,
                  roundId,
                  outputTaskIds: successfulOutputs.taskIds,
                  outputVideoRecordIds: successfulVideoRecordIds,
                  createdAt: Date.now(),
                },
              ],
        };
      });
      deps.getState().showToast(successfulVideoRecordIds.length > 0 ? "视频已生成" : "图片已生成", "success");
      return;
    }

    markAgentRoundTasksFailed(
      conversationId,
      roundId,
      message,
      deps.getRawErrorPayload(err).rawResponsePayload,
    );
    deps.getState().addAgentDiagnosticLog({
      level: "error",
      scope: "agent",
      message,
      detail: {
        conversationId,
        roundId,
        elapsedMs: Date.now() - startedAt,
      },
    });

    updateAgentConversation(conversationId, (current) => {
      const failedRound = current.rounds.find((round) => round.id === roundId);
      const existingAssistantMessage = failedRound?.assistantMessageId
        ? current.messages.find(
            (item) => item.id === failedRound.assistantMessageId,
          )
        : current.messages.find(
            (item) => item.roundId === roundId && item.role === "assistant",
          );
      const errorContent = `请求失败：${message}`;

      return {
        ...current,
        title:
          current.rounds.length === 1 && current.rounds[0].id === roundId
            ? "新对话"
            : current.title,
        updatedAt: Date.now(),
        rounds: current.rounds.map((round) =>
          round.id === roundId
            ? {
                ...round,
                ...(existingAssistantMessage
                  ? { assistantMessageId: existingAssistantMessage.id }
                  : {}),
                status: "error",
                error: message,
                finishedAt: Date.now(),
              }
            : round,
        ),
        messages: existingAssistantMessage
          ? current.messages.map((item) =>
              item.id === existingAssistantMessage.id
                ? { ...item, content: errorContent }
                : item,
            )
          : [
              ...current.messages,
              {
                id: genId(),
                role: "assistant",
                content: errorContent,
                roundId,
                createdAt: Date.now(),
              },
            ],
      };
    });
    deps.getState().showToast(`Agent 请求失败：${message}`, "error");
  } finally {
    if (agentRoundControllers.get(controllerKey) === controller) {
      agentRoundControllers.delete(controllerKey);
    }
  }
}

  return {
    stopAgentResponse,
    submitAgentMessage,
    regenerateAgentAssistantMessage,
  };
}
