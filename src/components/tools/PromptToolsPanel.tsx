import { useState } from "react";
import { submitSeriesBatch, useStore } from "../../store";

const PROMPT_ENHANCERS = [
  {
    title: "电商产品图",
    content:
      "请优化为电商产品主图：主体居中清晰，保留产品结构和材质，商业摄影布光，背景干净高级，适合详情页展示。",
  },
  {
    title: "固定角色设定",
    content:
      "请优化为系列角色图：保持同一人物身份、脸型、发型、服装主色和气质，只改变动作、场景和镜头，不改变核心外观。",
  },
  {
    title: "海报视觉",
    content:
      "请优化为海报视觉：明确主题层级，强构图，电影级光影，留出标题空间，画面有冲击力但不杂乱。",
  },
  {
    title: "写实摄影",
    content:
      "请优化为真实摄影风格：自然镜头语言，真实材质和光影，避免塑料感、过度锐化、AI感和不合理结构。",
  },
  {
    title: "视频分镜",
    content:
      "请优化为视频分镜提示词：描述镜头运动、主体动作、场景变化、光线氛围和时长节奏，保持主体连续性。",
  },
];

function ToolSection(props: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
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

export default function PromptToolsPanel() {
  const prompt = useStore((s) => s.prompt);
  const setPrompt = useStore((s) => s.setPrompt);
  const promptTemplates = useStore((s) => s.promptTemplates);
  const addPromptTemplate = useStore((s) => s.addPromptTemplate);
  const deletePromptTemplate = useStore((s) => s.deletePromptTemplate);
  const showToast = useStore((s) => s.showToast);
  const [templateTitle, setTemplateTitle] = useState("");
  const [templateContent, setTemplateContent] = useState("");
  const [templateCategory, setTemplateCategory] = useState("");
  const [templateQuery, setTemplateQuery] = useState("");
  const [seriesBatchTitle, setSeriesBatchTitle] = useState("");
  const [seriesBatchPrompts, setSeriesBatchPrompts] = useState("");
  const templateKeyword = templateQuery.trim().toLowerCase();
  const filteredPromptTemplates = templateKeyword
    ? promptTemplates.filter((template) =>
        [template.title, template.category ?? "", template.content]
          .join("\n")
          .toLowerCase()
          .includes(templateKeyword),
      )
    : promptTemplates;

  const appendPromptEnhancer = (content: string) => {
    const base = prompt.trim();
    setPrompt(base ? `${base}\n\n${content}` : content);
    showToast("提示词增强已追加到输入框", "success");
  };

  const handleSubmitSeriesBatch = async () => {
    const prompts = seriesBatchPrompts
      .split(/\n+/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (!prompts.length) {
      showToast("请每行填写一条系列提示词", "info");
      return;
    }
    await submitSeriesBatch(prompts, { label: seriesBatchTitle });
    setSeriesBatchPrompts("");
    setSeriesBatchTitle("");
  };

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

  return (
    <>
      <section className="rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 via-white to-cyan-50 p-4 shadow-sm dark:border-blue-400/20 dark:from-blue-500/10 dark:via-white/[0.04] dark:to-cyan-500/10 md:col-span-2">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            提示词增强
          </h3>
          <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
            先选一个方向追加到输入框，再按需保存成模板或批量生成。
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {PROMPT_ENHANCERS.map((item) => (
            <button
              key={item.title}
              type="button"
              onClick={() => appendPromptEnhancer(item.content)}
              className="rounded-xl border border-blue-100 bg-white/90 px-3 py-3 text-left text-sm transition hover:border-blue-300 hover:bg-blue-50 dark:border-white/[0.08] dark:bg-black/20 dark:hover:bg-blue-500/10"
            >
              <span className="font-medium text-gray-900 dark:text-gray-100">
                {item.title}
              </span>
              <span className="mt-1 block line-clamp-3 text-xs leading-5 text-gray-500 dark:text-gray-400">
                {item.content}
              </span>
            </button>
          ))}
        </div>
      </section>

      <ToolSection
        title="系列批量生成"
        hint="每行一条提示词，自动沿用当前基准图、参数和 API 配置提交。"
      >
        <div className="space-y-2">
          <input
            value={seriesBatchTitle}
            onChange={(event) => setSeriesBatchTitle(event.target.value)}
            placeholder="批次名称，可选"
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 dark:border-white/[0.08] dark:bg-black/20"
          />
          <textarea
            value={seriesBatchPrompts}
            onChange={(event) => setSeriesBatchPrompts(event.target.value)}
            placeholder={
              "春季海报，固定同一人物，樱花街道\n夏季海报，固定同一人物，海边阳光\n秋季海报，固定同一人物，落叶公园"
            }
            rows={5}
            className="w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-blue-400 dark:border-white/[0.08] dark:bg-black/20"
          />
          <button
            type="button"
            onClick={() => void handleSubmitSeriesBatch()}
            className="w-full rounded-xl bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-indigo-500"
          >
            提交系列批量任务
          </button>
          <p className="text-xs leading-5 text-gray-500 dark:text-gray-400">
            建议先设置“系列基准图”或固定人物/产品/画风槽，再批量生成，稳定性更好。
          </p>
        </div>
      </ToolSection>

      <ToolSection title="提示词模板库" hint="常用提示词可以保存，一键追加到当前输入框。">
        <div className="space-y-2">
          <input
            value={templateQuery}
            onChange={(event) => setTemplateQuery(event.target.value)}
            placeholder="搜索模板标题、分类或内容"
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 dark:border-white/[0.08] dark:bg-black/20"
          />
          <input
            value={templateTitle}
            onChange={(event) => setTemplateTitle(event.target.value)}
            placeholder="模板标题"
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 dark:border-white/[0.08] dark:bg-black/20"
          />
          <input
            value={templateCategory}
            onChange={(event) => setTemplateCategory(event.target.value)}
            placeholder="分类，可选"
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 dark:border-white/[0.08] dark:bg-black/20"
          />
          <textarea
            value={templateContent}
            onChange={(event) => setTemplateContent(event.target.value)}
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
          <div className="max-h-60 space-y-2 overflow-y-auto pt-1">
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
      </ToolSection>
    </>
  );
}
