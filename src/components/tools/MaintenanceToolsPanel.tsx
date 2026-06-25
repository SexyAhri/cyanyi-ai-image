import { useRef } from "react";
import { exportData, importData, useStore } from "../../store";

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

export default function MaintenanceToolsPanel() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const agentDiagnosticLogs = useStore((s) => s.agentDiagnosticLogs);
  const clearAgentDiagnosticLogs = useStore((s) => s.clearAgentDiagnosticLogs);
  const showToast = useStore((s) => s.showToast);

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
    <>
      <section className="rounded-2xl border border-gray-200/70 bg-white/80 p-4 shadow-sm dark:border-white/[0.08] dark:bg-white/[0.04]">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            备份 / 恢复
          </h3>
          <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
            上传 GitHub 前、换机器前，建议先导出一份完整备份。
          </p>
        </div>

        <div className="space-y-2">
          <button
            type="button"
            onClick={() => void exportData({ exportConfig: true, exportTasks: true })}
            className="w-full rounded-xl bg-gray-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-gray-700 dark:bg-white dark:text-gray-950 dark:hover:bg-gray-200"
          >
            导出完整备份
          </button>
          <button
            type="button"
            onClick={() => void exportData({ exportConfig: true, exportTasks: false })}
            className="w-full rounded-xl bg-gray-100 px-3 py-2 text-sm font-medium text-gray-800 transition hover:bg-gray-200 dark:bg-white/[0.08] dark:text-gray-100 dark:hover:bg-white/[0.14]"
          >
            只导出配置和模板
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(event) => void handleImportFile(event.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 dark:border-white/[0.08] dark:text-gray-200 dark:hover:bg-white/[0.08]"
          >
            导入备份 ZIP
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200/70 bg-white/80 p-4 shadow-sm dark:border-white/[0.08] dark:bg-white/[0.04] md:col-span-2">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Agent 诊断日志
            </h3>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              慢、5MB、失败和上下文压缩等问题会记录在这里。
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
                  <span className="font-mono text-gray-400">{log.scope}</span>
                  <span className="text-gray-400">{formatTime(log.createdAt)}</span>
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
    </>
  );
}
