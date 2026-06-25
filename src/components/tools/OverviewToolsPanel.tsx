import { retryMultipleTasks, useStore } from "../../store";

export type ApiCheck = {
  label: string;
  ok: boolean;
  message: string;
};

export default function OverviewToolsPanel(props: {
  checks: ApiCheck[];
  onRefreshChecks: () => void;
}) {
  const tasks = useStore((s) => s.tasks);
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const setFilterStatus = useStore((s) => s.setFilterStatus);
  const setSearchQuery = useStore((s) => s.setSearchQuery);
  const setSelectedTaskIds = useStore((s) => s.setSelectedTaskIds);
  const clearSelection = useStore((s) => s.clearSelection);
  const showToast = useStore((s) => s.showToast);
  const runningCount = tasks.filter(
    (task) => task.status === "running" && !task.queued,
  ).length;
  const queuedCount = tasks.filter(
    (task) => task.status === "running" && task.queued,
  ).length;
  const doneCount = tasks.filter((task) => task.status === "done").length;
  const errorCount = tasks.filter((task) => task.status === "error").length;
  const failedTasks = tasks.filter((task) => task.status === "error");
  const queuedTasks = tasks.filter(
    (task) => task.status === "running" && task.queued,
  );

  return (
    <>
      <section className="rounded-2xl border border-gray-200/70 bg-white/80 p-4 shadow-sm dark:border-white/[0.08] dark:bg-white/[0.04]">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            API 配置体检
          </h3>
          <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
            本地静态诊断，不会消耗生成额度。
          </p>
        </div>
        <div className="space-y-2">
          {props.checks.map((check) => (
            <div
              key={check.label}
              className="flex items-start gap-2 rounded-xl bg-gray-100/80 p-3 text-xs dark:bg-black/20"
            >
              <span
                className={`mt-0.5 h-2.5 w-2.5 rounded-full ${
                  check.ok ? "bg-green-500" : "bg-red-500"
                }`}
              />
              <div>
                <div className="font-medium text-gray-800 dark:text-gray-100">
                  {check.label}
                </div>
                <div className="mt-0.5 text-gray-500 dark:text-gray-400">
                  {check.message}
                </div>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={props.onRefreshChecks}
            className="w-full rounded-xl bg-gray-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-gray-700 dark:bg-white dark:text-gray-950 dark:hover:bg-gray-200"
          >
            重新体检
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200/70 bg-white/80 p-4 shadow-sm dark:border-white/[0.08] dark:bg-white/[0.04]">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            任务队列状态
          </h3>
          <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
            快速查看当前是否在生成或排队。
          </p>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-xl bg-blue-50 p-3 dark:bg-blue-500/10">
              <div className="text-xs text-blue-500">运行中</div>
              <div className="mt-1 text-2xl font-semibold text-blue-700 dark:text-blue-300">
                {runningCount}
              </div>
            </div>
            <div className="rounded-xl bg-amber-50 p-3 dark:bg-amber-500/10">
              <div className="text-xs text-amber-600">排队中</div>
              <div className="mt-1 text-2xl font-semibold text-amber-700 dark:text-amber-300">
                {queuedCount}
              </div>
            </div>
            <div className="rounded-xl bg-green-50 p-3 dark:bg-green-500/10">
              <div className="text-xs text-green-600">已完成</div>
              <div className="mt-1 text-2xl font-semibold text-green-700 dark:text-green-300">
                {doneCount}
              </div>
            </div>
            <div className="rounded-xl bg-red-50 p-3 dark:bg-red-500/10">
              <div className="text-xs text-red-600">失败</div>
              <div className="mt-1 text-2xl font-semibold text-red-700 dark:text-red-300">
                {errorCount}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-gray-100/80 p-2 text-xs dark:bg-black/20">
            <button
              type="button"
              onClick={() => setSettings({ queuePaused: !settings.queuePaused })}
              className="rounded-lg bg-white px-3 py-1.5 font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 dark:bg-white/[0.08] dark:text-gray-100 dark:hover:bg-white/[0.14]"
            >
              {settings.queuePaused ? "恢复队列" : "暂停队列"}
            </button>
            <label className="flex items-center gap-1 text-gray-500 dark:text-gray-400">
              并发
              <select
                value={settings.queueMaxConcurrency}
                onChange={(event) =>
                  setSettings({ queueMaxConcurrency: Number(event.target.value) })
                }
                className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 outline-none dark:border-white/[0.08] dark:bg-black/20 dark:text-gray-100"
              >
                {[1, 2, 3, 4, 5, 6].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setFilterStatus("error");
                setSearchQuery("");
                setSelectedTaskIds(failedTasks.map((task) => task.id));
                showToast(`已选中 ${failedTasks.length} 个失败任务`, "info");
              }}
              disabled={!failedTasks.length}
              className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-red-500/10 dark:text-red-300 dark:hover:bg-red-500/20"
            >
              选中失败
            </button>
            <button
              type="button"
              onClick={() => void retryMultipleTasks(failedTasks.map((task) => task.id))}
              disabled={!failedTasks.length}
              className="rounded-xl bg-cyan-50 px-3 py-2 text-sm font-medium text-cyan-700 transition hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-cyan-500/10 dark:text-cyan-300 dark:hover:bg-cyan-500/20"
            >
              重试失败
            </button>
            <button
              type="button"
              onClick={() => {
                setFilterStatus("running");
                setSelectedTaskIds(queuedTasks.map((task) => task.id));
                showToast(`已选中 ${queuedTasks.length} 个排队任务`, "info");
              }}
              disabled={!queuedTasks.length}
              className="rounded-xl bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/20"
            >
              选中排队
            </button>
            <button
              type="button"
              onClick={() => {
                clearSelection();
                setFilterStatus("all");
                setSearchQuery("");
                showToast("已恢复全部任务视图", "success");
              }}
              className="rounded-xl bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-200 dark:bg-white/[0.08] dark:text-gray-100 dark:hover:bg-white/[0.14]"
            >
              全部视图
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
