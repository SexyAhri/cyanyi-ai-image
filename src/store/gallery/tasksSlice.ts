import type { StateCreator } from "zustand";
import type { TaskRecord } from "../../types";
import type { AppState } from "../types";

export type TasksSlice = Pick<
  AppState,
  | "tasks"
  | "setTasks"
  | "updateTaskMetadata"
  | "markTasksCompared"
  | "streamPreviews"
  | "streamPreviewSlots"
  | "setTaskStreamPreview"
>;

export function createTasksSlice(options: {
  shouldResetSupportPromptSkip: (tasks: TaskRecord[]) => boolean;
  updateTaskInStore: (taskId: string, patch: Partial<TaskRecord>) => void;
  persistTask: (task: TaskRecord) => void | Promise<unknown>;
}): StateCreator<AppState, [], [], TasksSlice> {
  return (set, get) => ({
    tasks: [],
    setTasks: (tasks) =>
      set(() => ({
        tasks,
        ...(options.shouldResetSupportPromptSkip(tasks)
          ? { supportPromptSkippedForImportedData: false }
          : {}),
      })),
    updateTaskMetadata: (taskId, patch) => {
      const tags = patch.tags
        ? Array.from(
            new Set(
              patch.tags
                .map((tag) => tag.trim())
                .filter(Boolean)
                .map((tag) => tag.slice(0, 32)),
            ),
          ).slice(0, 12)
        : undefined;
      options.updateTaskInStore(taskId, {
        ...(patch.note !== undefined
          ? { note: patch.note.trim().slice(0, 500) || undefined }
          : {}),
        ...(patch.tags !== undefined ? { tags } : {}),
      });
    },
    markTasksCompared: (taskIds) => {
      const uniqueIds = Array.from(new Set(taskIds)).filter(Boolean);
      if (uniqueIds.length < 2) return;
      set((state) => ({
        tasks: state.tasks.map((task) =>
          uniqueIds.includes(task.id)
            ? {
                ...task,
                comparedWithTaskIds: uniqueIds.filter((id) => id !== task.id),
              }
            : task,
        ),
      }));
      for (const task of get().tasks) {
        if (uniqueIds.includes(task.id)) void options.persistTask(task);
      }
    },
    streamPreviews: {},
    streamPreviewSlots: {},
    setTaskStreamPreview: (taskId, image, requestIndex = 0) =>
      set((state) => {
        if (image) {
          const slotKey = String(requestIndex);
          const currentSlots = state.streamPreviewSlots[taskId] ?? {};
          if (
            state.streamPreviews[taskId] === image &&
            currentSlots[slotKey] === image
          )
            return state;
          return {
            streamPreviews: { ...state.streamPreviews, [taskId]: image },
            streamPreviewSlots: {
              ...state.streamPreviewSlots,
              [taskId]: { ...currentSlots, [slotKey]: image },
            },
          };
        }

        if (
          !(taskId in state.streamPreviews) &&
          !(taskId in state.streamPreviewSlots)
        )
          return state;
        const next = { ...state.streamPreviews };
        const nextSlots = { ...state.streamPreviewSlots };
        delete next[taskId];
        delete nextSlots[taskId];
        return { streamPreviews: next, streamPreviewSlots: nextSlots };
      }),
  });
}
