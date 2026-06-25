import { useState } from "react";
import {
  getActiveApiProfile,
  normalizeSettings,
  validateApiProfile,
} from "../../lib/api/apiProfiles";
import { useStore } from "../../store";
import EcommerceToolsPanel from "./EcommerceToolsPanel";
import MaintenanceToolsPanel from "./MaintenanceToolsPanel";
import OverviewToolsPanel, { type ApiCheck } from "./OverviewToolsPanel";
import PromptToolsPanel from "./PromptToolsPanel";

const UTILITY_TABS = [
  {
    id: "overview",
    label: "运行监控",
    description: "API 体检、队列和失败重试",
  },
  {
    id: "ecommerce",
    label: "电商出图",
    description: "商品套图、尺寸和 SKU 批量",
  },
  {
    id: "prompts",
    label: "提示词生产",
    description: "系列批量、增强和模板库",
  },
  {
    id: "maintenance",
    label: "数据维护",
    description: "备份恢复和诊断日志",
  },
] as const;

type UtilityTabId = (typeof UTILITY_TABS)[number]["id"];

function getApiChecks(): ApiCheck[] {
  const settings = normalizeSettings(useStore.getState().settings);
  const profile = getActiveApiProfile(settings);
  const configError = validateApiProfile(profile);
  const baseUrlOk = profile.apiProxy || /^https?:\/\//i.test(profile.baseUrl.trim());
  const timeoutOk = Number.isFinite(profile.timeout) && profile.timeout >= 30;
  const streamLooksOk =
    profile.provider === "openai" ||
    profile.provider === "gemini" ||
    profile.provider === "grok";
  const modeMessage =
    profile.apiMode === "videos"
      ? "适合视频生成"
      : profile.apiMode === "responses"
        ? "适合 Agent / Responses 生图"
        : "适合画廊 Images 生图";

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
      label: "API Mode",
      ok: true,
      message: modeMessage,
    },
    {
      label: "Streaming",
      ok: !profile.streamImages || streamLooksOk,
      message: profile.streamImages
        ? streamLooksOk
          ? `已开启流式，部分图 ${profile.streamPartialImages ?? 1}`
          : "当前 Provider 可能不支持流式，失败时建议关闭"
        : "未开启流式，兼容性更稳",
    },
    {
      label: "Image Return",
      ok: true,
      message: profile.responseFormatB64Json
        ? "优先要求 Base64，避免图片 URL 跨域"
        : "可返回 URL 或 Base64，遇到跨域可开启 Base64",
    },
    {
      label: "Queue",
      ok: settings.queueMaxConcurrency >= 1,
      message: `${settings.queuePaused ? "已暂停" : "运行中"}，并发 ${settings.queueMaxConcurrency}`,
    },
  ];
}

export default function UtilityPanel() {
  const setUtilityPanelOpen = useStore((s) => s.setUtilityPanelOpen);
  const showToast = useStore((s) => s.showToast);
  const [checks, setChecks] = useState<ApiCheck[]>(() => getApiChecks());
  const [activeTab, setActiveTab] = useState<UtilityTabId>("ecommerce");

  return (
    <div
      data-no-drag-select
      className="fixed inset-0 z-50 flex justify-end bg-black/25 p-3 backdrop-blur-sm dark:bg-black/45"
      onClick={() => setUtilityPanelOpen(false)}
    >
      <div
        className="flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-white/60 bg-gray-50/95 shadow-2xl ring-1 ring-black/5 dark:border-white/[0.08] dark:bg-gray-950/95 dark:ring-white/10"
        onClick={(event) => event.stopPropagation()}
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
              按用途拆成监控、电商、提示词和数据维护，少翻设置，多做事。
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

        <div className="border-b border-gray-200/70 bg-white/55 px-4 py-3 dark:border-white/[0.08] dark:bg-white/[0.03]">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {UTILITY_TABS.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`rounded-2xl border px-3 py-2.5 text-left transition ${
                    active
                      ? "border-blue-300 bg-blue-600 text-white shadow-sm"
                      : "border-gray-200 bg-white/80 text-gray-600 hover:border-blue-200 hover:bg-blue-50 dark:border-white/[0.08] dark:bg-black/20 dark:text-gray-300 dark:hover:bg-blue-500/10"
                  }`}
                >
                  <span className="block text-sm font-medium">{tab.label}</span>
                  <span
                    className={`mt-1 block text-xs ${
                      active ? "text-blue-100" : "text-gray-400"
                    }`}
                  >
                    {tab.description}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid flex-1 gap-4 overflow-y-auto p-4 md:grid-cols-2">
          {activeTab === "overview" && (
            <OverviewToolsPanel
              checks={checks}
              onRefreshChecks={() => {
                setChecks(getApiChecks());
                showToast("API 配置体检已刷新", "success");
              }}
            />
          )}

          {activeTab === "ecommerce" && <EcommerceToolsPanel />}

          {activeTab === "prompts" && <PromptToolsPanel />}

          {activeTab === "maintenance" && <MaintenanceToolsPanel />}
        </div>
      </div>
    </div>
  );
}
