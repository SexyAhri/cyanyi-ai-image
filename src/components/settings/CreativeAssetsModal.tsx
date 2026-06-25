import { useMemo, useState, type ReactNode } from "react";
import { useStore } from "../../store";
import type {
  CreativeNegativePreset,
  CreativeStylePreset,
  CreativeSubjectProfile,
  SeriesReferenceSlot,
} from "../../types";
import { useCloseOnEscape } from "../../hooks/useCloseOnEscape";
import { usePreventBackgroundScroll } from "../../hooks/usePreventBackgroundScroll";

type AssetTab = "styles" | "subjects" | "negative";

const SERIES_SLOT_META: Array<{ id: SeriesReferenceSlot; label: string; desc: string }> = [
  { id: "person", label: "固定人物", desc: "角色脸、服装和身份一致" },
  { id: "product", label: "固定产品", desc: "商品结构、材质和配色一致" },
  { id: "style", label: "固定画风", desc: "画面质感和审美方向一致" },
];

const TAB_META: Array<{ id: AssetTab; title: string; desc: string }> = [
  { id: "styles", title: "风格模板", desc: "统一画面审美" },
  { id: "subjects", title: "角色档案", desc: "固定主体设定" },
  { id: "negative", title: "禁止项", desc: "减少跑偏问题" },
];

function appendPromptBlock(prompt: string, title: string, content: string) {
  const block = `【${title}】\n${content.trim()}`;
  return prompt.trim() ? `${prompt.trim()}\n\n${block}` : block;
}

function TextField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
        {props.label}
      </span>
      <input
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder={props.placeholder}
        className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100 dark:border-white/[0.1] dark:bg-white/[0.06] dark:text-white dark:focus:ring-blue-500/15"
      />
    </label>
  );
}

function TextAreaField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
        {props.label}
      </span>
      <textarea
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder={props.placeholder}
        rows={props.rows ?? 4}
        className="mt-1 w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm leading-6 text-gray-900 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100 dark:border-white/[0.1] dark:bg-white/[0.06] dark:text-white dark:focus:ring-blue-500/15"
      />
    </label>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-200 bg-white/60 p-6 text-center text-sm text-gray-500 dark:border-white/[0.1] dark:bg-white/[0.03] dark:text-gray-400">
      {children}
    </div>
  );
}

function AssetCard(props: {
  title: string;
  subtitle?: string;
  content: string;
  extra?: ReactNode;
  onUse: () => void;
  onDelete: () => void;
  useLabel?: string;
}) {
  return (
    <article className="group rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md dark:border-white/[0.08] dark:bg-white/[0.04] dark:hover:border-blue-400/40">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-gray-950 dark:text-white">
            {props.title}
          </h3>
          {props.subtitle && (
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {props.subtitle}
            </p>
          )}
        </div>
        {props.extra}
      </div>
      <p className="mt-3 line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-gray-600 dark:text-gray-300">
        {props.content}
      </p>
      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={props.onDelete}
          className="rounded-full px-3 py-1.5 text-xs text-gray-500 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-300"
        >
          删除
        </button>
        <button
          type="button"
          onClick={props.onUse}
          className="rounded-full bg-gray-950 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-600 dark:bg-white dark:text-gray-950 dark:hover:bg-blue-200"
        >
          {props.useLabel ?? "应用"}
        </button>
      </div>
    </article>
  );
}

export default function CreativeAssetsModal() {
  const open = useStore((state) => state.creativeAssetsOpen);
  const setOpen = useStore((state) => state.setCreativeAssetsOpen);
  const settings = useStore((state) => state.settings);
  const setSettings = useStore((state) => state.setSettings);
  const prompt = useStore((state) => state.prompt);
  const setPrompt = useStore((state) => state.setPrompt);
  const showToast = useStore((state) => state.showToast);
  const seriesReferenceImage = useStore((state) => state.seriesReferenceImage);
  const setSeriesReferenceImage = useStore((state) => state.setSeriesReferenceImage);
  const seriesReferenceHistory = useStore((state) => state.seriesReferenceHistory);
  const removeSeriesReferenceHistoryItem = useStore((state) => state.removeSeriesReferenceHistoryItem);
  const seriesReferenceSlots = useStore((state) => state.seriesReferenceSlots);
  const setSeriesReferenceSlot = useStore((state) => state.setSeriesReferenceSlot);
  const setSeriesReferenceFromSlot = useStore((state) => state.setSeriesReferenceFromSlot);
  const styles = useStore((state) => state.creativeStylePresets);
  const addStyle = useStore((state) => state.addCreativeStylePreset);
  const deleteStyle = useStore((state) => state.deleteCreativeStylePreset);
  const subjects = useStore((state) => state.creativeSubjectProfiles);
  const addSubject = useStore((state) => state.addCreativeSubjectProfile);
  const deleteSubject = useStore((state) => state.deleteCreativeSubjectProfile);
  const negatives = useStore((state) => state.creativeNegativePresets);
  const addNegative = useStore((state) => state.addCreativeNegativePreset);
  const deleteNegative = useStore((state) => state.deleteCreativeNegativePreset);
  const [activeTab, setActiveTab] = useState<AssetTab>("styles");
  const [styleTitle, setStyleTitle] = useState("");
  const [styleContent, setStyleContent] = useState("");
  const [styleTags, setStyleTags] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [subjectDescription, setSubjectDescription] = useState("");
  const [subjectNegative, setSubjectNegative] = useState("");
  const [negativeTitle, setNegativeTitle] = useState("");
  const [negativeContent, setNegativeContent] = useState("");
  const activeMeta = useMemo(
    () => TAB_META.find((item) => item.id === activeTab) ?? TAB_META[0],
    [activeTab],
  );

  useCloseOnEscape(open, () => setOpen(false));
  usePreventBackgroundScroll(open);

  if (!open) return null;

  const applyStyleLock = (preset: CreativeStylePreset) => {
    setSettings({
      ...settings,
      promptStyleLockEnabled: true,
      promptStyleLockText: preset.content,
    });
    showToast("已应用为全局风格锁", "success");
  };

  const applySubject = (profile: CreativeSubjectProfile) => {
    const content = profile.negativePrompt
      ? `${profile.description}\n禁止项：${profile.negativePrompt}`
      : profile.description;
    setPrompt(appendPromptBlock(prompt, `角色档案：${profile.name}`, content));
    showToast("已追加到当前提示词", "success");
  };

  const applyNegative = (preset: CreativeNegativePreset) => {
    setPrompt(appendPromptBlock(prompt, `禁止项：${preset.title}`, preset.content));
    showToast("已追加到当前提示词", "success");
  };

  const handleAddStyle = () => {
    if (!styleTitle.trim() || !styleContent.trim()) {
      showToast("请填写风格名称和内容", "info");
      return;
    }
    addStyle({
      title: styleTitle,
      content: styleContent,
      tags: styleTags.split(/[,，\s]+/).filter(Boolean),
    });
    setStyleTitle("");
    setStyleContent("");
    setStyleTags("");
    showToast("风格模板已保存", "success");
  };

  const handleAddSubject = () => {
    if (!subjectName.trim() || !subjectDescription.trim()) {
      showToast("请填写角色名称和固定设定", "info");
      return;
    }
    addSubject({
      name: subjectName,
      description: subjectDescription,
      negativePrompt: subjectNegative,
    });
    setSubjectName("");
    setSubjectDescription("");
    setSubjectNegative("");
    showToast("角色档案已保存", "success");
  };

  const handleAddNegative = () => {
    if (!negativeTitle.trim() || !negativeContent.trim()) {
      showToast("请填写禁止项名称和内容", "info");
      return;
    }
    addNegative({ title: negativeTitle, content: negativeContent });
    setNegativeTitle("");
    setNegativeContent("");
    showToast("禁止项已保存", "success");
  };

  return (
    <div
      data-no-drag-select
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-3 backdrop-blur-sm dark:bg-black/55"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <div className="flex h-[min(840px,92vh)] w-full max-w-6xl overflow-hidden rounded-[28px] border border-white/70 bg-gray-50/95 shadow-2xl ring-1 ring-black/5 dark:border-white/[0.08] dark:bg-gray-950/95 dark:ring-white/10">
        <aside className="hidden w-64 shrink-0 flex-col border-r border-gray-200/70 bg-white/80 dark:border-white/[0.08] dark:bg-white/[0.03] md:flex">
          <div className="shrink-0 p-5 pb-3">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-blue-500">
              Creative Assets
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-gray-950 dark:text-white">
              创作资产
            </h2>
            <p className="mt-2 text-sm leading-6 text-gray-500 dark:text-gray-400">
              把常用风格、角色设定和禁止项沉淀下来，后续系列图会稳定很多。
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-1 custom-scrollbar">
          <nav className="space-y-2">
            {TAB_META.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`w-full rounded-2xl px-4 py-3 text-left transition ${
                  activeTab === tab.id
                    ? "bg-gray-950 text-white shadow-lg shadow-gray-900/10 dark:bg-white dark:text-gray-950"
                    : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.06]"
                }`}
              >
                <span className="block text-sm font-medium">{tab.title}</span>
                <span className="mt-0.5 block text-xs opacity-70">{tab.desc}</span>
              </button>
            ))}
          </nav>
          <div className="mt-4 rounded-2xl border border-indigo-200/70 bg-indigo-50/80 p-3 dark:border-indigo-400/20 dark:bg-indigo-500/10">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-semibold text-indigo-900 dark:text-indigo-100">
                系列基准图
              </div>
              {seriesReferenceImage && (
                <button
                  type="button"
                  onClick={() => {
                    setSeriesReferenceImage(null);
                    showToast("已移除系列基准图", "success");
                  }}
                  className="text-xs text-indigo-600 hover:text-indigo-800 dark:text-indigo-200"
                >
                  移除
                </button>
              )}
            </div>
            {seriesReferenceImage ? (
              <div className="mt-2 flex items-center gap-2.5">
                <div className="h-10 w-10 overflow-hidden rounded-xl bg-white/80 dark:bg-white/[0.08]">
                  {seriesReferenceImage.dataUrl && (
                    <img src={seriesReferenceImage.dataUrl} className="h-full w-full object-cover" alt="" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-indigo-900 dark:text-indigo-100">
                    {seriesReferenceImage.label ?? "当前启用"}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-indigo-700/80 dark:text-indigo-100/70">
                    后续画廊生成自动参考
                  </p>
                </div>
              </div>
            ) : (
              <p className="mt-2 text-xs leading-5 text-indigo-700/80 dark:text-indigo-100/70">
                在成品图右键或任务卡按钮中选择“系列基准”，后续画廊生成会自动参考它。
              </p>
            )}

            <div className="mt-3 space-y-1.5">
              {SERIES_SLOT_META.map((slot) => {
                const image = seriesReferenceSlots[slot.id];
                return (
                  <div key={slot.id} className="rounded-xl bg-white/70 p-2 dark:bg-white/[0.06]">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 shrink-0 overflow-hidden rounded-lg bg-indigo-100 dark:bg-white/[0.08]">
                        {image?.dataUrl && (
                          <img src={image.dataUrl} className="h-full w-full object-cover" alt="" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium text-indigo-950 dark:text-indigo-100">
                          {slot.label}
                        </div>
                        <div className="truncate text-[10px] text-indigo-700/70 dark:text-indigo-100/60">
                          {image ? "已保存" : slot.desc}
                        </div>
                      </div>
                    </div>
                    <div className="mt-1.5 grid grid-cols-3 gap-1">
                      <button
                        type="button"
                        disabled={!seriesReferenceImage}
                        onClick={() => {
                          if (!seriesReferenceImage) return;
                          setSeriesReferenceSlot(slot.id, {
                            ...seriesReferenceImage,
                            label: slot.label,
                          });
                          showToast(`已存入${slot.label}`, "success");
                        }}
                        className="rounded-lg px-1.5 py-1 text-[10px] text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-40 dark:text-indigo-100 dark:hover:bg-white/[0.08]"
                      >
                        存当前
                      </button>
                      <button
                        type="button"
                        disabled={!image}
                        onClick={() => {
                          setSeriesReferenceFromSlot(slot.id);
                          showToast(`已切换到${slot.label}`, "success");
                        }}
                        className="rounded-lg px-1.5 py-1 text-[10px] text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-40 dark:text-indigo-100 dark:hover:bg-white/[0.08]"
                      >
                        设当前
                      </button>
                      <button
                        type="button"
                        disabled={!image}
                        onClick={() => {
                          setSeriesReferenceSlot(slot.id, null);
                          showToast(`已清空${slot.label}`, "success");
                        }}
                        className="rounded-lg px-1.5 py-1 text-[10px] text-indigo-500 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-40 dark:text-indigo-200 dark:hover:bg-red-500/10 dark:hover:text-red-200"
                      >
                        清空
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {seriesReferenceHistory.length > 0 && (
              <div className="mt-3">
                <div className="text-xs font-semibold text-indigo-900 dark:text-indigo-100">
                  最近 5 张
                </div>
                <div className="mt-2 grid grid-cols-5 gap-1">
                  {seriesReferenceHistory.map((image, index) => (
                    <button
                      key={image.id}
                      type="button"
                      onClick={() => {
                        setSeriesReferenceImage(image);
                        showToast("已切换系列基准图", "success");
                      }}
                      onDoubleClick={() => {
                        removeSeriesReferenceHistoryItem(image.id);
                        showToast("已从历史移除", "success");
                      }}
                      title={`点击切换，双击移除：最近基准 ${index + 1}`}
                      className={`h-8 overflow-hidden rounded-lg border bg-white transition ${
                        seriesReferenceImage?.id === image.id
                          ? "border-indigo-500 ring-2 ring-indigo-300"
                          : "border-white/70 hover:border-indigo-300 dark:border-white/[0.08]"
                      }`}
                    >
                      {image.dataUrl && (
                        <img src={image.dataUrl} className="h-full w-full object-cover" alt="" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-start justify-between gap-3 border-b border-gray-200/70 px-5 py-4 dark:border-white/[0.08]">
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                当前模块
              </p>
              <h2 className="mt-1 text-xl font-semibold text-gray-950 dark:text-white">
                {activeMeta.title}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-full px-3 py-1.5 text-sm text-gray-500 transition hover:bg-gray-200/70 hover:text-gray-900 dark:hover:bg-white/[0.08] dark:hover:text-white"
            >
              关闭
            </button>
          </header>

          <div className="flex gap-2 overflow-x-auto border-b border-gray-200/70 px-4 py-3 dark:border-white/[0.08] md:hidden">
            {TAB_META.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`shrink-0 rounded-full px-4 py-2 text-sm ${
                  activeTab === tab.id
                    ? "bg-gray-950 text-white dark:bg-white dark:text-gray-950"
                    : "bg-white text-gray-600 dark:bg-white/[0.06] dark:text-gray-300"
                }`}
              >
                {tab.title}
              </button>
            ))}
          </div>

          <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-w-0 space-y-3">
              {activeTab === "styles" &&
                (styles.length ? (
                  styles.map((preset) => (
                    <AssetCard
                      key={preset.id}
                      title={preset.title}
                      subtitle={preset.tags?.join(" / ")}
                      content={preset.content}
                      useLabel="设为风格锁"
                      onUse={() => applyStyleLock(preset)}
                      onDelete={() => deleteStyle(preset.id)}
                    />
                  ))
                ) : (
                  <EmptyState>暂无风格模板，先在右侧新增一个。</EmptyState>
                ))}

              {activeTab === "subjects" &&
                (subjects.length ? (
                  subjects.map((profile) => (
                    <AssetCard
                      key={profile.id}
                      title={profile.name}
                      subtitle={profile.negativePrompt ? "包含禁止项" : undefined}
                      content={
                        profile.negativePrompt
                          ? `${profile.description}\n\n禁止项：${profile.negativePrompt}`
                          : profile.description
                      }
                      useLabel="追加到提示词"
                      onUse={() => applySubject(profile)}
                      onDelete={() => deleteSubject(profile.id)}
                    />
                  ))
                ) : (
                  <EmptyState>暂无角色档案，适合保存固定主角或产品主体。</EmptyState>
                ))}

              {activeTab === "negative" &&
                (negatives.length ? (
                  negatives.map((preset) => (
                    <AssetCard
                      key={preset.id}
                      title={preset.title}
                      content={preset.content}
                      useLabel="追加到提示词"
                      onUse={() => applyNegative(preset)}
                      onDelete={() => deleteNegative(preset.id)}
                    />
                  ))
                ) : (
                  <EmptyState>暂无禁止项，适合保存常见避坑词。</EmptyState>
                ))}
            </div>

            <aside className="rounded-3xl border border-gray-200/80 bg-white p-4 shadow-sm dark:border-white/[0.08] dark:bg-white/[0.04]">
              {activeTab === "styles" && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-950 dark:text-white">
                      新增风格模板
                    </h3>
                    <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                      保存后可一键设为全局风格锁，所有画廊和 Agent 生图都会带上。
                    </p>
                  </div>
                  <TextField
                    label="名称"
                    value={styleTitle}
                    onChange={setStyleTitle}
                    placeholder="例如：水彩绘本风"
                  />
                  <TextField
                    label="标签"
                    value={styleTags}
                    onChange={setStyleTags}
                    placeholder="商业, 人像, 写实"
                  />
                  <TextAreaField
                    label="风格约束"
                    value={styleContent}
                    onChange={setStyleContent}
                    placeholder="描述画面质感、光影、配色、镜头和稳定要求"
                    rows={7}
                  />
                  <button
                    type="button"
                    onClick={handleAddStyle}
                    className="w-full rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-500/20 transition hover:bg-blue-500"
                  >
                    保存风格模板
                  </button>
                </div>
              )}

              {activeTab === "subjects" && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-950 dark:text-white">
                      新增角色档案
                    </h3>
                    <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                      适合固定主角、产品、IP 形象。生成前追加到提示词即可。
                    </p>
                  </div>
                  <TextField
                    label="名称"
                    value={subjectName}
                    onChange={setSubjectName}
                    placeholder="例如：品牌主角 Ahri"
                  />
                  <TextAreaField
                    label="固定设定"
                    value={subjectDescription}
                    onChange={setSubjectDescription}
                    placeholder="写清楚主体外观、服装、材质、气质、不可变特征"
                    rows={6}
                  />
                  <TextAreaField
                    label="禁止改变"
                    value={subjectNegative}
                    onChange={setSubjectNegative}
                    placeholder="例如：不要改变脸型、发色、服装主色"
                    rows={3}
                  />
                  <button
                    type="button"
                    onClick={handleAddSubject}
                    className="w-full rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-500/20 transition hover:bg-blue-500"
                  >
                    保存角色档案
                  </button>
                </div>
              )}

              {activeTab === "negative" && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-950 dark:text-white">
                      新增禁止项
                    </h3>
                    <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                      把常见错误整理成固定禁止项，减少每次重复输入。
                    </p>
                  </div>
                  <TextField
                    label="名称"
                    value={negativeTitle}
                    onChange={setNegativeTitle}
                    placeholder="例如：人物修复避坑"
                  />
                  <TextAreaField
                    label="禁止项内容"
                    value={negativeContent}
                    onChange={setNegativeContent}
                    placeholder="避免畸形手指、额外肢体、文字乱码..."
                    rows={8}
                  />
                  <button
                    type="button"
                    onClick={handleAddNegative}
                    className="w-full rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-500/20 transition hover:bg-blue-500"
                  >
                    保存禁止项
                  </button>
                </div>
              )}
            </aside>
          </div>
        </section>
      </div>
    </div>
  );
}
