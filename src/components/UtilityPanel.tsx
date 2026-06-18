import { useRef, useState, type ReactNode } from "react";
import { exportData, importData, retryMultipleTasks, useStore } from "../store";
import {
  getActiveApiProfile,
  normalizeSettings,
  validateApiProfile,
} from "../lib/apiProfiles";

type ApiCheck = {
  label: string;
  ok: boolean;
  message: string;
};

function formatTime(value: number) {
  return new Date(value).toLocaleString();
}

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function formatDiagnosticLogs(
  logs: ReturnType<typeof useStore.getState>["agentDiagnosticLogs"],
) {
  return logs
    .map((log) => {
      const detail =
        log.detail == null ? "" : `\n${JSON.stringify(log.detail, null, 2)}`;
      return `[${formatTime(log.createdAt)}] ${log.level.toUpperCase()} ${log.scope ?? "agent"}\n${log.message}${detail}`;
    })
    .join("\n\n---\n\n");
}

function getApiChecks(): ApiCheck[] {
  const settings = normalizeSettings(useStore.getState().settings);
  const profile = getActiveApiProfile(settings);
  const configError = validateApiProfile(profile);
  const baseUrlOk =
    profile.provider === "fal" ||
    profile.apiProxy ||
    /^https?:\/\//i.test(profile.baseUrl.trim());
  const timeoutOk = Number.isFinite(profile.timeout) && profile.timeout >= 30;

  return [
    {
      label: "API Profile",
      ok: !configError,
      message: configError ? `需要补全：${configError}` : `${profile.name} 已配置`,
    },
    {
      label: "Endpoint",
      ok: baseUrlOk,
      message: profile.apiProxy ? "使用内置代理" : profile.baseUrl || "未填写 API URL",
    },
    {
      label: "Model",
      ok: Boolean(profile.model.trim()),
      message: profile.model || "未填写模型 ID",
    },
    {
      label: "Timeout",
      ok: timeoutOk,
      message: `${profile.timeout}s`,
    },
    {
      label: "Queue",
      ok: settings.queueMaxConcurrency >= 1,
      message: `${settings.queuePaused ? "已暂停" : "运行中"}，并发 ${settings.queueMaxConcurrency}`,
    },
  ];
}

function Section(props: { title: string; children: ReactNode; hint?: string }) {
  return (
    <section className="rounded-2xl border border-gray-200/70 bg-white/80 p-4 shadow-sm dark:border-white/[0.08] dark:bg-white/[0.04]">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {props.title}
        </h3>
        {props.hint && (
          <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
            {props.hint}
          </p>
        )}
      </div>
      {props.children}
    </section>
  );
}

export default function UtilityPanel() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const setUtilityPanelOpen = useStore((s) => s.setUtilityPanelOpen);
  const prompt = useStore((s) => s.prompt);
  const setPrompt = useStore((s) => s.setPrompt);
  const promptTemplates = useStore((s) => s.promptTemplates);
  const addPromptTemplate = useStore((s) => s.addPromptTemplate);
  const deletePromptTemplate = useStore((s) => s.deletePromptTemplate);
  const agentDiagnosticLogs = useStore((s) => s.agentDiagnosticLogs);
  const clearAgentDiagnosticLogs = useStore((s) => s.clearAgentDiagnosticLogs);
  const tasks = useStore((s) => s.tasks);
  const setSettings = useStore((s) => s.setSettings);
  const setFilterStatus = useStore((s) => s.setFilterStatus);
  const setSearchQuery = useStore((s) => s.setSearchQuery);
  const setSelectedTaskIds = useStore((s) => s.setSelectedTaskIds);
  const clearSelection = useStore((s) => s.clearSelection);
  const showToast = useStore((s) => s.showToast);
  const settings = useStore((s) => s.settings);
  const [checks, setChecks] = useState<ApiCheck[]>(() => getApiChecks());
  const [templateTitle, setTemplateTitle] = useState("");
  const [templateContent, setTemplateContent] = useState("");
  const [templateCategory, setTemplateCategory] = useState("");
  const [templateQuery, setTemplateQuery] = useState("");
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
  const templateKeyword = templateQuery.trim().toLowerCase();
  const filteredPromptTemplates = templateKeyword
    ? promptTemplates.filter((template) =>
        [template.title, template.category ?? "", template.content]
          .join("\n")
          .toLowerCase()
          .includes(templateKeyword),
      )
    : promptTemplates;

  const handleAddTemplate = () => {
    const content = templateContent.trim() || prompt.trim();
    if (!content) {
      showToast("请先填写模板内容，或在输入框里写好提示词", "info");
      return;
    }
    addPromptTemplate({
      title: templateTitle.trim() || "自定义模板",
      content,
      category: templateCategory.trim() || undefined,
    });
    setTemplateTitle("");
    setTemplateContent("");
    setTemplateCategory("");
    showToast("提示词模板已保存", "success");
  };

  const handleImportFile = async (file: File | null) => {
    if (!file) return;
    await importData(file, { importConfig: true, importTasks: true });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleCopyDiagnosticLogs = async () => {
    if (!agentDiagnosticLogs.length) {
      showToast("暂无可复制的诊断日志", "info");
      return;
    }
    try {
      await navigator.clipboard.writeText(formatDiagnosticLogs(agentDiagnosticLogs));
      showToast("诊断日志已复制", "success");
    } catch {
      showToast("复制失败，请手动导出日志", "error");
    }
  };

  const handleExportDiagnosticLogs = () => {
    if (!agentDiagnosticLogs.length) {
      showToast("暂无可导出的诊断日志", "info");
      return;
    }
    downloadTextFile(
      `agent-diagnostic-${new Date().toISOString().replace(/[:.]/g, "-")}.log`,
      formatDiagnosticLogs(agentDiagnosticLogs),
    );
    showToast("诊断日志已导出", "success");
  };

  return (
    <div
      data-no-drag-select
      className="fixed inset-0 z-50 flex justify-end bg-black/25 p-3 backdrop-blur-sm dark:bg-black/45"
      onClick={() => setUtilityPanelOpen(false)}
    >
      <div
        className="flex h-full w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-white/60 bg-gray-50/95 shadow-2xl ring-1 ring-black/5 dark:border-white/[0.08] dark:bg-gray-950/95 dark:ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-gray-200/70 px-5 py-4 dark:border-white/[0.08]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-500">
              Ops Panel
            </p>
            <h2 className="mt-1 text-xl font-semibold text-gray-950 dark:text-white">
              实用工具面板
            </h2>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              诊断、模板、备份和日志都放这里，少翻设置。
            </p>
          </div>
          <button
            type="button"
            onClick={() => setUtilityPanelOpen(false)}
            className="rounded-full px-3 py-1.5 text-sm text-gray-500 transition hover:bg-gray-200/70 hover:text-gray-900 dark:hover:bg-white/[0.08] dark:hover:text-white"
          >
            关闭
          </button>
        </div>

        <div className="grid flex-1 gap-4 overflow-y-auto p-4 md:grid-cols-2">
          <Section title="API 配置体检" hint="本地静态诊断，不会消耗生成额度。">
            <div className="space-y-2">
              {checks.map((check) => (
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
                onClick={() => {
                  setChecks(getApiChecks());
                  showToast("API 配置体检已刷新", "success");
                }}
                className="w-full rounded-xl bg-gray-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-gray-700 dark:bg-white dark:text-gray-950 dark:hover:bg-gray-200"
              >
                重新体检
              </button>
            </div>
          </Section>

          <Section title="任务队列状态" hint="快速查看当前是否在生成或排队。">
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
                    onChange={(e) =>
                      setSettings({ queueMaxConcurrency: Number(e.target.value) })
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
          </Section>

          <Section title="提示词模板库" hint="常用提示词可以保存，一键追加到当前输入框。">
            <div className="space-y-2">
              <input
                value={templateQuery}
                onChange={(e) => setTemplateQuery(e.target.value)}
                placeholder="搜索模板标题、分类或内容"
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 dark:border-white/[0.08] dark:bg-black/20"
              />
              <input
                value={templateTitle}
                onChange={(e) => setTemplateTitle(e.target.value)}
                placeholder="模板标题"
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 dark:border-white/[0.08] dark:bg-black/20"
              />
              <input
                value={templateCategory}
                onChange={(e) => setTemplateCategory(e.target.value)}
                placeholder="分类，可选"
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 dark:border-white/[0.08] dark:bg-black/20"
              />
              <textarea
                value={templateContent}
                onChange={(e) => setTemplateContent(e.target.value)}
                placeholder="模板内容；留空则保存当前输入框内容"
                rows={3}
                className="w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 dark:border-white/[0.08] dark:bg-black/20"
              />
              <button
                type="button"
                onClick={handleAddTemplate}
                className="w-full rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-500"
              >
                保存模板
              </button>
              <div className="text-xs text-gray-400">
                显示 {filteredPromptTemplates.length} / {promptTemplates.length} 个模板
              </div>
              <div className="max-h-72 space-y-2 overflow-y-auto pt-1">
                {filteredPromptTemplates.map((template) => (
                  <div
                    key={template.id}
                    className="rounded-xl border border-gray-200 bg-white p-3 text-sm dark:border-white/[0.08] dark:bg-black/20"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-medium text-gray-900 dark:text-gray-100">
                          {template.title}
                        </div>
                        {template.category && (
                          <div className="mt-0.5 text-xs text-gray-400">
                            {template.category}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => deletePromptTemplate(template.id)}
                        className="text-xs text-red-500 hover:text-red-600"
                      >
                        删除
                      </button>
                    </div>
                    <p className="mt-2 line-clamp-3 text-xs leading-5 text-gray-500 dark:text-gray-400">
                      {template.content}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setPrompt(
                          prompt.trim()
                            ? `${prompt.trim()}\n\n${template.content}`
                            : template.content,
                        );
                        showToast("模板已追加到输入框", "success");
                      }}
                      className="mt-2 rounded-lg bg-gray-100 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200 dark:bg-white/[0.08] dark:text-gray-200 dark:hover:bg-white/[0.14]"
                    >
                      追加使用
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </Section>

          <Section title="备份 / 恢复" hint="上传 GitHub 前、换机器前，建议先导出一份。">
            <div className="space-y-2">
              <button
                type="button"
                onClick={() =>
                  void exportData({ exportConfig: true, exportTasks: true })
                }
                className="w-full rounded-xl bg-gray-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-gray-700 dark:bg-white dark:text-gray-950 dark:hover:bg-gray-200"
              >
                导出完整备份
              </button>
              <button
                type="button"
                onClick={() =>
                  void exportData({ exportConfig: true, exportTasks: false })
                }
                className="w-full rounded-xl bg-gray-100 px-3 py-2 text-sm font-medium text-gray-800 transition hover:bg-gray-200 dark:bg-white/[0.08] dark:text-gray-100 dark:hover:bg-white/[0.14]"
              >
                只导出配置和模板
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip,application/zip"
                className="hidden"
                onChange={(e) =>
                  void handleImportFile(e.target.files?.[0] ?? null)
                }
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 dark:border-white/[0.08] dark:text-gray-200 dark:hover:bg-white/[0.08]"
              >
                导入备份 ZIP
              </button>
            </div>
          </Section>

          <section className="rounded-2xl border border-gray-200/70 bg-white/80 p-4 shadow-sm dark:border-white/[0.08] dark:bg-white/[0.04] md:col-span-2">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  Agent 诊断日志
                </h3>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  慢、5MB、失败、上下文压缩这些都会记录到这里。
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleCopyDiagnosticLogs}
                  className="rounded-lg px-2.5 py-1.5 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-white/[0.08]"
                >
                  复制
                </button>
                <button
                  type="button"
                  onClick={handleExportDiagnosticLogs}
                  className="rounded-lg px-2.5 py-1.5 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-white/[0.08]"
                >
                  导出
                </button>
                <button
                  type="button"
                  onClick={clearAgentDiagnosticLogs}
                  className="rounded-lg px-2.5 py-1.5 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-white/[0.08]"
                >
                  清空
                </button>
              </div>
            </div>
            <div className="max-h-80 space-y-2 overflow-y-auto">
              {agentDiagnosticLogs.length === 0 ? (
                <div className="rounded-xl bg-gray-100 p-4 text-center text-sm text-gray-500 dark:bg-black/20">
                  暂无诊断日志
                </div>
              ) : (
                agentDiagnosticLogs.map((log) => (
                  <div
                    key={log.id}
                    className="rounded-xl bg-gray-100 p-3 text-xs dark:bg-black/20"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 font-medium ${
                          log.level === "error"
                            ? "bg-red-500 text-white"
                            : log.level === "warning"
                              ? "bg-amber-500 text-white"
                              : "bg-blue-500 text-white"
                        }`}
                      >
                        {log.level}
                      </span>
                      <span className="font-mono text-gray-400">
                        {log.scope}
                      </span>
                      <span className="text-gray-400">
                        {formatTime(log.createdAt)}
                      </span>
                    </div>
                    <div className="mt-2 whitespace-pre-wrap break-words text-gray-700 dark:text-gray-200">
                      {log.message}
                    </div>
                    {log.detail != null ? (
                      <pre className="mt-2 max-h-28 overflow-auto rounded-lg bg-black/5 p-2 text-[11px] text-gray-500 dark:bg-white/[0.04]">
                        {String(JSON.stringify(log.detail, null, 2) ?? "")}
                      </pre>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
