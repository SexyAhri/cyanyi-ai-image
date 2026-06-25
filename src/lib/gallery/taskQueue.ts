import type { AppSettings, TaskRecord } from "../../types";
import { normalizeSettings } from "../api/apiProfiles";

type TaskQueueOptions = {
  getSettings: () => AppSettings;
  getTask: (taskId: string) => TaskRecord | undefined;
  updateTask: (taskId: string, patch: Partial<TaskRecord>) => void;
  runTask: (taskId: string) => Promise<void>;
};

export function createTaskQueue(options: TaskQueueOptions) {
  const runningTaskExecutions = new Set<string>();
  const queuedTaskIds: string[] = [];

  const startQueuedTasks = () => {
    const settings = normalizeSettings(options.getSettings());
    if (settings.queuePaused) return;
    while (
      runningTaskExecutions.size < settings.queueMaxConcurrency &&
      queuedTaskIds.length > 0
    ) {
      const taskId = queuedTaskIds.shift();
      if (!taskId || runningTaskExecutions.has(taskId)) continue;
      const task = options.getTask(taskId);
      if (!task || task.status !== "running") continue;
      runningTaskExecutions.add(taskId);
      options.updateTask(taskId, {
        queued: false,
        autoRetryNextAt: undefined,
        autoRetryReason: undefined,
      });
      void options.runTask(taskId).finally(() => {
        runningTaskExecutions.delete(taskId);
        startQueuedTasks();
      });
    }
  };

  const enqueueTask = (taskId: string) => {
    const settings = normalizeSettings(options.getSettings());
    if (!queuedTaskIds.includes(taskId) && !runningTaskExecutions.has(taskId)) {
      queuedTaskIds.push(taskId);
    }
    if (
      settings.queuePaused ||
      runningTaskExecutions.size >= settings.queueMaxConcurrency
    ) {
      options.updateTask(taskId, { queued: true });
      return;
    }
    startQueuedTasks();
  };

  return { enqueueTask, startQueuedTasks };
}
