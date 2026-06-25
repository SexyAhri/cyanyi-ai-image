import type {
  AgentConversation,
  AgentMessage,
  AgentRound,
  ResponsesApiResponse,
  ResponsesOutputItem,
  TaskRecord,
} from "../../types";
import { resizeImageDataUrl } from "../gallery/canvasImage";
import { getAgentRoundPath } from "./agentConversationTree";
import {
  collectAgentRoundOutputImageSlots,
  getAgentCurrentReferenceId,
  getAgentGeneratedImageReferenceId,
  replaceAgentPromptImageReferencesForApi,
  resolveAgentPromptImageReferences,
} from "./agentImageReferences";
import { ensureImageCached } from "../storage/imageCache";

export type AgentContextImageOptions = {
  maxWidth?: number;
  maxHeight?: number;
  maxEncodedBytesPerImage?: number;
};

export type AgentApiInputBuildStrategy = {
  historyRoundsWithImages: number;
  includeReferencedImages: boolean;
  maxImageBytes: number;
  maxWidth: number;
  maxHeight: number;
};

export type AgentApiInputBuildResult = {
  input: unknown[];
  wasReduced: boolean;
  inputSize: number;
};

type BuildAgentApiInputOptions = {
  imageHistoryRounds: number;
  softLimitBytes: number;
  defaultMaxImageBytes: number;
  tightMaxImageBytes: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export async function readAgentImageDataUrls(ids: string[]) {
  const dataUrls: string[] = [];
  for (const id of ids) {
    const dataUrl = await ensureImageCached(id);
    if (dataUrl) dataUrls.push(dataUrl);
  }
  return dataUrls;
}

export async function readAgentContextImageDataUrls(
  ids: string[],
  opts: AgentContextImageOptions = {},
) {
  const {
    maxWidth = 1024,
    maxHeight = 1024,
    maxEncodedBytesPerImage = 700_000,
  } = opts;
  const dataUrls: string[] = [];

  for (const id of ids) {
    const original = await ensureImageCached(id);
    if (!original) continue;

    let candidate = original;
    if (candidate.length > maxEncodedBytesPerImage) {
      try {
        candidate = await resizeImageDataUrl(candidate, {
          maxWidth,
          maxHeight,
          mimeType: "image/jpeg",
          quality: 0.8,
        });
      } catch {
        candidate = original;
      }
    }

    if (candidate.length > maxEncodedBytesPerImage) {
      try {
        candidate = await resizeImageDataUrl(candidate, {
          maxWidth: Math.min(maxWidth, 768),
          maxHeight: Math.min(maxHeight, 768),
          mimeType: "image/jpeg",
          quality: 0.72,
        });
      } catch {
        candidate = original;
      }
    }

    dataUrls.push(candidate);
  }

  return dataUrls;
}

export function estimateSerializedSize(value: unknown) {
  try {
    return JSON.stringify(value).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function isAgentContextSizeLimitError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /request body exceeds your tier limit/i.test(message) ||
    /\b5MB\b/i.test(message)
  );
}

export function getAgentContextSizeLimitErrorMessage() {
  return "当前 Agent 上下文图片和历史内容过大，已超过接口请求体限制。请减少参考图、清空当前对话，或从新对话继续。";
}

export function escapeXmlAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function truncateAgentReferencePrompt(prompt: string) {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  return normalized.length > 1200
    ? `${normalized.slice(0, 1200)}...`
    : normalized;
}

export function createAgentAssistantFallbackItem(text: string) {
  return {
    role: "assistant",
    content: [{ type: "output_text", text }],
  };
}

export function parseResponseOutputFromPayload(
  rawResponsePayload?: string,
): ResponsesOutputItem[] | null {
  if (!rawResponsePayload) return null;
  try {
    const payload = JSON.parse(rawResponsePayload) as { output?: unknown };
    return Array.isArray(payload.output)
      ? (payload.output as ResponsesOutputItem[])
      : null;
  } catch {
    return null;
  }
}

export function sanitizeResponseOutputItemForInput(
  item: ResponsesOutputItem,
): unknown | null {
  if (item.type === "web_search_call") return null;
  if (item.type === "image_generation_call") return null;

  if (item.type === "message") {
    const content = (item.content ?? [])
      .map((part) => {
        if (typeof part.text !== "string") return null;
        if (part.type === "output_text" || part.type === "text") {
          return { type: "output_text", text: part.text };
        }
        return null;
      })
      .filter((part): part is { type: "output_text"; text: string } =>
        Boolean(part),
      );

    return content.length > 0 ? { role: "assistant", content } : null;
  }

  return item;
}

export function filterAgentRoundResponseOutputForInput(
  _round: AgentRound,
  _tasks: TaskRecord[],
  output: ResponsesOutputItem[],
) {
  return output;
}

export function scrubResponseOutputForDeletedAgentTasks(
  round: AgentRound,
  output: ResponsesOutputItem[],
  deletedTasks: TaskRecord[],
) {
  const deletedTaskIds = new Set(deletedTasks.map((task) => task.id));
  const deletedToolCallIds = new Set(
    deletedTasks
      .filter((task) => task.agentRoundId === round.id && task.agentToolCallId)
      .map((task) => task.agentToolCallId!),
  );
  if (deletedTaskIds.size === 0) return output;

  let anonymousImageIndex = 0;
  return output.filter((item) => {
    if (item.type !== "image_generation_call") return true;

    if (typeof item.id === "string" && item.id) {
      return !deletedToolCallIds.has(item.id);
    }

    const taskId = round.outputTaskIds[anonymousImageIndex];
    anonymousImageIndex += 1;
    return !deletedTaskIds.has(taskId);
  });
}

export function scrubAgentConversationsForDeletedTasks(
  conversations: AgentConversation[],
  deletedTasks: TaskRecord[],
) {
  if (deletedTasks.length === 0) return conversations;

  return conversations.map((conversation) => ({
    ...conversation,
    rounds: conversation.rounds.map((round) => {
      const roundDeletedTasks = deletedTasks.filter((task) =>
        round.outputTaskIds.includes(task.id),
      );
      if (roundDeletedTasks.length === 0 || !round.responseOutput?.length)
        return round;
      return {
        ...round,
        responseOutput: scrubResponseOutputForDeletedAgentTasks(
          round,
          round.responseOutput,
          roundDeletedTasks,
        ),
      };
    }),
  }));
}

export function scrubTaskRawResponsePayloadForDeletedTasks(
  task: TaskRecord,
  conversations: AgentConversation[],
  deletedTasks: TaskRecord[],
) {
  if (!task.rawResponsePayload || !task.agentRoundId) return task;

  const round = conversations
    .flatMap((conversation) => conversation.rounds)
    .find((item) => item.id === task.agentRoundId);
  if (!round) return task;

  const roundDeletedTasks = deletedTasks.filter((item) =>
    round.outputTaskIds.includes(item.id),
  );
  if (roundDeletedTasks.length === 0) return task;

  try {
    const payload = JSON.parse(task.rawResponsePayload) as ResponsesApiResponse;
    if (!Array.isArray(payload.output)) return task;
    const output = scrubResponseOutputForDeletedAgentTasks(
      round,
      payload.output,
      roundDeletedTasks,
    );
    if (output.length === payload.output.length) return task;
    return {
      ...task,
      rawResponsePayload: JSON.stringify({ ...payload, output }, null, 2),
    };
  } catch {
    return task;
  }
}

export function sanitizeResponseOutputForInput(
  output: ResponsesOutputItem[],
  options: { allowPendingFunctionCalls?: boolean } = {},
) {
  const items = output
    .map(sanitizeResponseOutputItemForInput)
    .filter((item): item is unknown => item != null);
  if (options.allowPendingFunctionCalls) return items;

  const functionCallIds = new Set<string>();
  const functionOutputCallIds = new Set<string>();
  for (const item of items) {
    if (!isRecord(item)) continue;
    const callId = typeof item.call_id === "string" ? item.call_id : "";
    if (!callId) continue;
    if (item.type === "function_call") functionCallIds.add(callId);
    if (item.type === "function_call_output") functionOutputCallIds.add(callId);
  }

  return items.filter((item) => {
    if (!isRecord(item)) return true;
    const callId = typeof item.call_id === "string" ? item.call_id : "";
    if (item.type === "function_call")
      return callId && functionOutputCallIds.has(callId);
    if (item.type === "function_call_output")
      return callId && functionCallIds.has(callId);
    return true;
  });
}

export function mergeResponseOutputItems(
  previous: ResponsesOutputItem[],
  next: ResponsesOutputItem[],
) {
  const merged = [...previous];
  for (const item of next) {
    const index = item.id
      ? merged.findIndex((existing) => existing.id === item.id)
      : -1;
    if (index >= 0) merged[index] = item;
    else merged.push(item);
  }
  return merged;
}

export function countResponseToolCalls(output: ResponsesOutputItem[]) {
  return output.filter((item) => item.type === "image_generation_call").length;
}

export function createAgentContinuationInputItem(
  newImageRefs: string[],
  toolCallsUsed: number,
  maxToolCalls: number,
) {
  const lines = [
    "[System] The app has saved your generated outputs and is continuing the same Agent turn.",
  ];
  if (newImageRefs.length > 0) {
    lines.push(
      `The following image ref ids are now available for you to reference in subsequent image_generation prompts: ${newImageRefs.join(", ")}`,
    );
  }
  lines.push(
    "Continue generating. Do NOT repeat what you already said in earlier responses.",
    "If you still need another round after this (e.g. more dependent images), call continue_generation.",
    `Tool-call budget: ${toolCallsUsed}/${maxToolCalls} used.`,
  );
  return {
    role: "user",
    content: [
      {
        type: "input_text",
        text: lines.join("\n"),
      },
    ],
  };
}

export function buildAgentContinuationInput(
  baseInput: unknown[],
  round: AgentRound,
  tasks: TaskRecord[],
  currentRoundOutput: ResponsesOutputItem[],
  toolCallsUsed: number,
  maxToolCalls: number,
) {
  const input = [
    ...baseInput,
    ...sanitizeResponseOutputForInput(currentRoundOutput, {
      allowPendingFunctionCalls: true,
    }),
  ];
  const newImageRefs = collectAgentRoundOutputImageSlots(round, tasks)
    .map((imageId, index) =>
      imageId
        ? `<ref id="${getAgentGeneratedImageReferenceId(round, index)}" />`
        : null,
    )
    .filter((ref): ref is string => Boolean(ref));
  input.push(
    createAgentContinuationInputItem(newImageRefs, toolCallsUsed, maxToolCalls),
  );
  return input;
}

export function getAgentRoundResponseOutput(
  round: AgentRound,
  tasks: TaskRecord[],
): ResponsesOutputItem[] | null {
  if (round.responseOutput?.length) return round.responseOutput;

  for (const taskId of round.outputTaskIds) {
    const task = tasks.find((item) => item.id === taskId);
    const output = parseResponseOutputFromPayload(task?.rawResponsePayload);
    if (output?.length) return output;
  }

  return null;
}

export async function createAgentUserInputItem(
  conversation: AgentConversation,
  round: AgentRound,
  message: AgentMessage,
  tasks: TaskRecord[],
  options: {
    includeImages?: boolean;
    imageOptions?: AgentContextImageOptions;
  } = {},
) {
  const imageDataUrls =
    options.includeImages === false
      ? []
      : await readAgentContextImageDataUrls(
          round.inputImageIds,
          options.imageOptions,
        );
  const rounds = getAgentRoundPath(conversation, round.id);
  const text = replaceAgentPromptImageReferencesForApi(
    message.content,
    round,
    rounds,
    tasks,
  );
  const referenceText =
    round.inputImageIds.length > 0
      ? `\n\n<available_refs>${round.inputImageIds.map((_, index) => `\n  <ref id="${getAgentCurrentReferenceId(round, index)}" />`).join("")}\n</available_refs>`
      : "";
  return {
    role: "user",
    content: [
      { type: "input_text", text: `${text}${referenceText}` },
      ...imageDataUrls.map((dataUrl) => ({
        type: "input_image",
        image_url: dataUrl,
      })),
    ],
  };
}

export async function createAgentGeneratedImagesInputItem(
  round: AgentRound,
  tasks: TaskRecord[],
  options: {
    includeImages?: boolean;
    imageOptions?: AgentContextImageOptions;
  } = {},
) {
  const contentParts: Array<{
    type: string;
    text?: string;
    image_url?: string;
  }> = [];
  let imageIndex = 0;
  for (const taskId of round.outputTaskIds) {
    const task = tasks.find((item) => item.id === taskId);
    if (!task) {
      contentParts.push({
        type: "input_text",
        text: `<removed_ref id="${getAgentGeneratedImageReferenceId(round, imageIndex)}" />`,
      });
      imageIndex += 1;
      continue;
    }
    for (const imageId of task.outputImages) {
      const [dataUrl] =
        options.includeImages === false
          ? []
          : await readAgentContextImageDataUrls(
              [imageId],
              options.imageOptions,
            );
      if (dataUrl && options.includeImages !== false) {
        contentParts.push({ type: "input_image", image_url: dataUrl });
      }
      const refId = getAgentGeneratedImageReferenceId(round, imageIndex);
      const prompt = truncateAgentReferencePrompt(task.prompt || "");
      const promptAttribute = prompt
        ? ` prompt="${escapeXmlAttribute(prompt)}"`
        : "";
      contentParts.push({
        type: "input_text",
        text: `<ref id="${refId}"${promptAttribute} />`,
      });
      imageIndex += 1;
    }
  }
  if (contentParts.length === 0) return null;
  return { role: "user", content: contentParts };
}

export async function createAgentBatchImagesInputItem(
  round: AgentRound,
  tasks: TaskRecord[],
  batchTaskIds: string[],
) {
  const contentParts: Array<{
    type: string;
    text?: string;
    image_url?: string;
  }> = [];
  let baseImageIndex = 0;
  for (const taskId of round.outputTaskIds) {
    if (batchTaskIds.includes(taskId)) break;
    const task = tasks.find((item) => item.id === taskId);
    baseImageIndex += task ? task.outputImages.length : 1;
  }
  let imageIndex = baseImageIndex;
  for (const taskId of batchTaskIds) {
    const task = tasks.find((item) => item.id === taskId);
    if (!task || task.status !== "done") continue;
    for (const imgId of task.outputImages) {
      const [dataUrl] = await readAgentContextImageDataUrls([imgId]);
      if (dataUrl) {
        contentParts.push({ type: "input_image", image_url: dataUrl });
      }
      const refId = getAgentGeneratedImageReferenceId(round, imageIndex);
      const prompt = truncateAgentReferencePrompt(task.prompt || "");
      const promptAttribute = prompt
        ? ` prompt="${escapeXmlAttribute(prompt)}"`
        : "";
      contentParts.push({
        type: "input_text",
        text: `<ref id="${refId}"${promptAttribute} />`,
      });
      imageIndex += 1;
    }
  }
  if (contentParts.length === 0) return null;
  return { role: "user", content: contentParts };
}

export async function buildAgentApiInputWithStrategy(
  conversation: AgentConversation,
  currentRound: AgentRound,
  tasks: TaskRecord[],
  strategy: AgentApiInputBuildStrategy,
): Promise<unknown[]> {
  const input: unknown[] = [];
  const rounds = getAgentRoundPath(conversation, currentRound.id);
  const referencedImageIds = new Set(
    resolveAgentPromptImageReferences(currentRound.prompt, rounds, tasks),
  );
  const recentImageRoundIds = new Set(
    rounds
      .slice(Math.max(0, rounds.length - strategy.historyRoundsWithImages))
      .map((round) => round.id),
  );
  const referencedImageRoundIds = new Set(
    strategy.includeReferencedImages
      ? rounds
          .filter((round) =>
            collectAgentRoundOutputImageSlots(round, tasks).some(
              (imageId) => imageId != null && referencedImageIds.has(imageId),
            ),
          )
          .map((round) => round.id)
      : [],
  );

  for (const round of rounds) {
    const userMessage = conversation.messages.find(
      (message) => message.id === round.userMessageId,
    );
    if (!userMessage) continue;
    const shouldIncludeRoundImages =
      round.id === currentRound.id ||
      recentImageRoundIds.has(round.id) ||
      referencedImageRoundIds.has(round.id);

    input.push(
      await createAgentUserInputItem(conversation, round, userMessage, tasks, {
        includeImages: shouldIncludeRoundImages,
        imageOptions: {
          maxWidth: strategy.maxWidth,
          maxHeight: strategy.maxHeight,
          maxEncodedBytesPerImage: strategy.maxImageBytes,
        },
      }),
    );
    if (round.id === currentRound.id) continue;

    const output = getAgentRoundResponseOutput(round, tasks);
    if (output?.length) {
      const sanitizedOutput = sanitizeResponseOutputForInput(
        filterAgentRoundResponseOutputForInput(round, tasks, output),
      );
      if (sanitizedOutput.length > 0) {
        input.push(...sanitizedOutput);
      } else {
        const assistantMessage = round.assistantMessageId
          ? conversation.messages.find(
              (message) => message.id === round.assistantMessageId,
            )
          : null;
        input.push(
          createAgentAssistantFallbackItem(
            assistantMessage?.content || "图像已生成。",
          ),
        );
      }
    } else {
      const assistantMessage = round.assistantMessageId
        ? conversation.messages.find(
            (message) => message.id === round.assistantMessageId,
          )
        : null;
      input.push(
        createAgentAssistantFallbackItem(
          assistantMessage?.content || "[No text response]",
        ),
      );
    }

    if (round.outputTaskIds.length > 0) {
      const imagesItem = await createAgentGeneratedImagesInputItem(
        round,
        tasks,
        {
          includeImages: shouldIncludeRoundImages,
          imageOptions: {
            maxWidth: strategy.maxWidth,
            maxHeight: strategy.maxHeight,
            maxEncodedBytesPerImage: strategy.maxImageBytes,
          },
        },
      );
      if (imagesItem) input.push(imagesItem);
    }
  }

  return input;
}

export async function buildAgentApiInput(
  conversation: AgentConversation,
  currentRound: AgentRound,
  tasks: TaskRecord[],
  options: BuildAgentApiInputOptions,
): Promise<AgentApiInputBuildResult> {
  const strategies: AgentApiInputBuildStrategy[] = [
    {
      historyRoundsWithImages: options.imageHistoryRounds,
      includeReferencedImages: true,
      maxImageBytes: options.defaultMaxImageBytes,
      maxWidth: 1024,
      maxHeight: 1024,
    },
    {
      historyRoundsWithImages: 1,
      includeReferencedImages: true,
      maxImageBytes: 420_000,
      maxWidth: 896,
      maxHeight: 896,
    },
    {
      historyRoundsWithImages: 0,
      includeReferencedImages: true,
      maxImageBytes: options.tightMaxImageBytes,
      maxWidth: 768,
      maxHeight: 768,
    },
    {
      historyRoundsWithImages: 0,
      includeReferencedImages: false,
      maxImageBytes: options.tightMaxImageBytes,
      maxWidth: 640,
      maxHeight: 640,
    },
  ];

  let fallbackInput: unknown[] = [];
  let fallbackSize = 0;
  for (let index = 0; index < strategies.length; index += 1) {
    const strategy = strategies[index];
    const candidate = await buildAgentApiInputWithStrategy(
      conversation,
      currentRound,
      tasks,
      strategy,
    );
    const size = estimateSerializedSize(candidate);
    fallbackInput = candidate;
    fallbackSize = size;
    if (size <= options.softLimitBytes) {
      return {
        input: candidate,
        wasReduced: index > 0,
        inputSize: size,
      };
    }
  }

  return {
    input: fallbackInput,
    wasReduced: true,
    inputSize: fallbackSize,
  };
}

export function stripInputImagesFromAgentInput(input: unknown[]): unknown[] {
  return input.map((item) => {
    if (!isRecord(item)) return item;
    if (!Array.isArray(item.content)) return item;
    return {
      ...item,
      content: item.content.filter(
        (part) => !(isRecord(part) && part.type === "input_image"),
      ),
    };
  });
}

export function buildReducedAgentInput(
  input: unknown[],
  hardLimitBytes: number,
): unknown[] {
  const noImages = stripInputImagesFromAgentInput(input);
  if (estimateSerializedSize(noImages) <= hardLimitBytes) return noImages;
  return noImages;
}
