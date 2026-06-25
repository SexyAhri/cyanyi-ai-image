import { useRef, useState } from "react";
import { addImageFromFile, createInputImageFromFile, submitSeriesBatch, useStore } from "../../store";
import {
  downloadImageEntriesAsZip,
  formatExportFileTime,
} from "../../lib/gallery/downloadImages";
import {
  ECOMMERCE_CONSISTENCY_LOCK,
  ECOMMERCE_SCENE_PRESETS,
  ECOMMERCE_SIZE_PRESETS,
  PLATFORM_COMPLIANCE_PRESETS,
  STYLING_REFERENCE_MODES,
  STYLING_TARGET_REFERENCES,
  buildEcommercePackageEntries,
  buildEcommercePrompt,
  buildMarketingCopy,
  buildStylingInstruction,
  getEcommerceTaskMeta,
  parseSkuLines,
  type EcommerceItem,
  type EcommerceSceneId,
  type EcommerceSizeId,
  type PlatformComplianceId,
  type PreviewPrompt,
  type StylingReferenceMode,
  type StylingTargetReferenceKind,
} from "../../lib/creative/ecommerceTools";
import type { InputImage } from "../../types";
import EcommerceMarketingCopyPanel from "./ecommerce/EcommerceMarketingCopyPanel";
import EcommerceStylingPanel from "./ecommerce/EcommerceStylingPanel";

export default function EcommerceToolsPanel() {
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const targetReferenceInputRef = useRef<HTMLInputElement>(null);
  const tasks = useStore((s) => s.tasks);
  const settings = useStore((s) => s.settings);
  const params = useStore((s) => s.params);
  const inputImages = useStore((s) => s.inputImages);
  const addInputImage = useStore((s) => s.addInputImage);
  const clearInputImages = useStore((s) => s.clearInputImages);
  const seriesReferenceImage = useStore((s) => s.seriesReferenceImage);
  const seriesReferenceSlots = useStore((s) => s.seriesReferenceSlots);
  const setSeriesReferenceImage = useStore((s) => s.setSeriesReferenceImage);
  const setParams = useStore((s) => s.setParams);
  const setSettings = useStore((s) => s.setSettings);
  const showToast = useStore((s) => s.showToast);
  const [productName, setProductName] = useState("");
  const [sku, setSku] = useState("");
  const [sellingPoints, setSellingPoints] = useState("");
  const [audience, setAudience] = useState("");
  const [sizeId, setSizeId] = useState<EcommerceSizeId>("tmall-main");
  const [sceneIds, setSceneIds] = useState<EcommerceSceneId[]>([
    "white-main",
    "scene",
    "detail",
  ]);
  const [platformId, setPlatformId] = useState<PlatformComplianceId>("tmall");
  const [skuBatchText, setSkuBatchText] = useState("");
  const [exportBatchId, setExportBatchId] = useState("all");
  const [stylingEnabled, setStylingEnabled] = useState(false);
  const [stylingNotes, setStylingNotes] = useState("");
  const [stylingMode, setStylingMode] =
    useState<StylingReferenceMode>("same-outfit");
  const [pendingTargetReferenceKind, setPendingTargetReferenceKind] =
    useState<StylingTargetReferenceKind>("outfit");
  const [targetReferenceIds, setTargetReferenceIds] = useState<
    Record<StylingTargetReferenceKind, string[]>
  >({
    outfit: [],
    model: [],
    scene: [],
  });
  const [marketingCopy, setMarketingCopy] = useState(() =>
    buildMarketingCopy("", "", ""),
  );
  const [previewPrompts, setPreviewPrompts] = useState<PreviewPrompt[]>([]);
  const [previewLabel, setPreviewLabel] = useState("");

  const selectedSize =
    ECOMMERCE_SIZE_PRESETS.find((item) => item.id === sizeId) ??
    ECOMMERCE_SIZE_PRESETS[0];
  const selectedScenes = ECOMMERCE_SCENE_PRESETS.filter((item) =>
    sceneIds.includes(item.id),
  );
  const selectedPlatform =
    PLATFORM_COMPLIANCE_PRESETS.find((item) => item.id === platformId) ??
    PLATFORM_COMPLIANCE_PRESETS[0];
  const productSlotReference = seriesReferenceSlots.product;
  const targetReferenceIdSet = new Set(Object.values(targetReferenceIds).flat());
  const productInputImages = inputImages.filter(
    (image) => !targetReferenceIdSet.has(image.id),
  );
  const effectiveProductReference =
    productInputImages[0] ?? productSlotReference ?? seriesReferenceImage;
  const hasProductReference = Boolean(effectiveProductReference?.dataUrl);
  const referenceSourceText = productInputImages.length
    ? `当前上传 ${productInputImages.length} 张`
    : productSlotReference
      ? "固定产品槽"
      : seriesReferenceImage
        ? "系列基准图"
        : "未上传";
  const isLockActive =
    settings.promptStyleLockEnabled &&
    settings.promptStyleLockText === ECOMMERCE_CONSISTENCY_LOCK;
  const marketingCopyText = [
    `海报标题：${marketingCopy.title}`,
    `海报副标题：${marketingCopy.subtitle}`,
    `详情页卖点：${marketingCopy.detailBullets.join("；")}`,
  ].join("\n");
  const marketingCopyPlainText = [
    `海报标题：${marketingCopy.title}`,
    `海报副标题：${marketingCopy.subtitle}`,
    "详情页卖点：",
    ...marketingCopy.detailBullets.map((item) => `- ${item}`),
    "短视频脚本：",
    ...marketingCopy.videoScript.map((item) => `- ${item}`),
  ].join("\n");
  const stylingInstruction = buildStylingInstruction({
    enabled: stylingEnabled,
    mode: stylingMode,
    notes: stylingNotes.trim(),
    targetReferenceSummary: STYLING_TARGET_REFERENCES.map((item) => {
      const refs = targetReferenceIds[item.id]
        .map((id) => inputImages.findIndex((image) => image.id === id) + 1)
        .filter((index) => index > 0);
      return refs.length
        ? `${item.label}：第 ${refs.join("、")} 张参考图。`
        : "";
    })
      .filter(Boolean)
      .join("\n"),
  });

  const ecommerceDoneTasks = tasks.filter((task) => {
    const meta = getEcommerceTaskMeta(task);
    return task.status === "done" && task.outputImages.length > 0 && meta.isEcommerce;
  });
  const exportBatches = Array.from(
    ecommerceDoneTasks
      .reduce((map, task) => {
        const batchId = task.seriesBatchId || `single:${task.id}`;
        const meta = getEcommerceTaskMeta(task);
        const existing = map.get(batchId);
        if (existing) {
          existing.count += task.outputImages.length;
          existing.updatedAt = Math.max(existing.updatedAt, task.createdAt);
          return map;
        }
        map.set(batchId, {
          id: batchId,
          label:
            task.seriesBatchLabel ||
            meta.displayName ||
            `电商套图 ${new Date(task.createdAt).toLocaleString()}`,
          count: task.outputImages.length,
          updatedAt: task.createdAt,
        });
        return map;
      }, new Map<string, { id: string; label: string; count: number; updatedAt: number }>())
      .values(),
  ).sort((a, b) => b.updatedAt - a.updatedAt);
  const exportTasks =
    exportBatchId === "all"
      ? ecommerceDoneTasks
      : ecommerceDoneTasks.filter((task) => {
          const batchId = task.seriesBatchId || `single:${task.id}`;
          return batchId === exportBatchId;
        });
  const exportImageCount = exportTasks.reduce(
    (sum, task) => sum + task.outputImages.length,
    0,
  );

  const toggleScene = (sceneId: EcommerceSceneId) => {
    setSceneIds((current) => {
      if (current.includes(sceneId)) {
        const next = current.filter((id) => id !== sceneId);
        return next.length ? next : current;
      }
      return [...current, sceneId];
    });
  };

  const applySize = (size = selectedSize.size) => {
    setParams({ size });
    showToast(`已切换尺寸：${size}`, "success");
  };

  const toggleLock = () => {
    if (isLockActive) {
      setSettings({ promptStyleLockEnabled: false });
      showToast("商品一致性锁已关闭", "info");
      return;
    }
    setSettings({
      promptStyleLockEnabled: true,
      promptStyleLockText: ECOMMERCE_CONSISTENCY_LOCK,
    });
    showToast("商品一致性锁已开启", "success");
  };

  const refreshMarketingCopy = () => {
    setMarketingCopy(buildMarketingCopy(productName, sellingPoints, audience));
    showToast("文案和卖点已生成", "success");
  };

  const copyMarketingCopy = async () => {
    try {
      await navigator.clipboard.writeText(marketingCopyPlainText);
      showToast("文案和卖点已复制", "success");
    } catch {
      showToast("复制失败，请手动选择复制", "error");
    }
  };

  const handleReferenceUpload = async (files: FileList | null) => {
    const imageFiles = Array.from(files ?? []).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (!imageFiles.length) {
      showToast("请选择商品参考图片", "info");
      return;
    }
    for (const file of imageFiles.slice(0, 6)) {
      await addImageFromFile(file);
    }
    if (referenceInputRef.current) referenceInputRef.current.value = "";
    showToast(`已添加 ${Math.min(imageFiles.length, 6)} 张商品参考图`, "success");
  };

  const handleTargetReferenceUpload = async (
    kind: StylingTargetReferenceKind,
    files: FileList | null,
  ) => {
    const imageFiles = Array.from(files ?? []).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (!imageFiles.length) {
      showToast("请选择目标参考图片", "info");
      return;
    }
    const createdImages: InputImage[] = [];
    for (const file of imageFiles.slice(0, 4)) {
      const image = await createInputImageFromFile(file);
      if (!image) continue;
      addInputImage(image);
      createdImages.push(image);
    }
    if (targetReferenceInputRef.current) {
      targetReferenceInputRef.current.value = "";
    }
    if (!createdImages.length) {
      showToast("目标参考图添加失败", "error");
      return;
    }
    setTargetReferenceIds((current) => ({
      ...current,
      [kind]: [
        ...current[kind],
        ...createdImages
          .map((image) => image.id)
          .filter((id) => !current[kind].includes(id)),
      ].slice(-4),
    }));
    if (!stylingEnabled) setStylingEnabled(true);
    const label =
      STYLING_TARGET_REFERENCES.find((item) => item.id === kind)?.label ??
      "目标参考";
    showToast(`已添加 ${createdImages.length} 张${label}`, "success");
  };

  const ensureProductReference = () => {
    if (inputImages.length > 0) return true;
    if (productSlotReference?.dataUrl) {
      setSeriesReferenceImage({
        ...productSlotReference,
        label: productSlotReference.label || "固定产品参考",
      });
      return true;
    }
    if (seriesReferenceImage?.dataUrl) return true;
    showToast("请先上传商品参考图，或在创作资产里设置固定产品/系列基准图", "error");
    return false;
  };

  const createPrompts = (items: EcommerceItem[]): PreviewPrompt[] =>
    items.flatMap((item, itemIndex) =>
      selectedScenes.map((scene) => ({
        id: `${item.sku || item.productName || itemIndex}-${scene.id}-${itemIndex}`,
        label: `${item.sku || item.productName || "商品"} / ${scene.label}`,
        text: buildEcommercePrompt({
          productName: item.productName,
          sku: item.sku,
          sellingPoints: item.sellingPoints,
          audience,
          sceneLabel: scene.label,
          scenePrompt: scene.prompt,
          complianceText: selectedPlatform.text,
          marketingCopyText,
          stylingInstruction,
          includeConsistencyLock: isLockActive,
        }),
      })),
    );

  const prepareCurrentPreview = () => {
    if (!productName.trim() && !sku.trim()) {
      showToast("请先填写商品名或 SKU", "info");
      return;
    }
    if (!ensureProductReference()) return;
    setPreviewPrompts(
      createPrompts([
        {
          productName: productName.trim(),
          sku: sku.trim(),
          sellingPoints: sellingPoints.trim(),
        },
      ]),
    );
    setPreviewLabel(productName.trim() || sku.trim() || "电商套图");
    showToast("已生成提示词预览，请确认后提交", "success");
  };

  const prepareSkuPreview = () => {
    if (!ensureProductReference()) return;
    const skuItems = parseSkuLines(skuBatchText);
    if (!skuItems.length) {
      showToast("请按每行填写：SKU, 商品名, 卖点", "info");
      return;
    }
    const estimatedCount = skuItems.length * selectedScenes.length;
    if (estimatedCount > 30) {
      showToast("一次最多提交 30 张图，请减少 SKU 或套图类型", "error");
      return;
    }
    setPreviewPrompts(createPrompts(skuItems));
    setPreviewLabel(`SKU 批量 ${skuItems.length} 款`);
    showToast("已生成 SKU 批量提示词预览", "success");
  };

  const submitPreview = async () => {
    const prompts = previewPrompts.map((item) => item.text.trim()).filter(Boolean);
    if (!prompts.length) {
      showToast("没有可提交的提示词", "info");
      return;
    }
    applySize(selectedSize.size);
    await submitSeriesBatch(prompts, { label: previewLabel });
    setPreviewPrompts([]);
    if (previewLabel.startsWith("SKU 批量")) setSkuBatchText("");
  };

  const handleExportPackage = async () => {
    if (!exportTasks.length) {
      showToast("暂无可导出的电商套图任务", "info");
      return;
    }
    const selectedBatch = exportBatches.find((item) => item.id === exportBatchId);
    const zipName =
      exportBatchId === "all"
        ? `ecommerce-pack-${formatExportFileTime(new Date())}`
        : `ecommerce-pack-${selectedBatch?.label || formatExportFileTime(new Date())}`;
    try {
      const result = await downloadImageEntriesAsZip(
        buildEcommercePackageEntries(exportTasks),
        zipName,
      );
      if (result.successCount === 0) {
        showToast("套图包导出失败", "error");
      } else if (result.failCount > 0) {
        showToast(
          `套图包部分导出失败：成功 ${result.successCount}，失败 ${result.failCount}`,
          "error",
        );
      } else {
        showToast(`套图包已导出：${result.successCount} 张`, "success");
      }
    } catch (error) {
      console.error(error);
      showToast("套图包导出失败", "error");
    }
  };

  return (
    <>
      <section className="rounded-2xl border border-orange-200/80 bg-gradient-to-br from-orange-50 via-white to-amber-50 p-4 shadow-sm dark:border-orange-400/20 dark:from-orange-500/10 dark:via-white/[0.04] dark:to-amber-500/10 md:col-span-2">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              电商套图生成器
            </h3>
            <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
              按“商品信息 → 出图策略 → 预览提交”走，SKU 批量和文案结果单独放，不混在一起。
            </p>
          </div>
          <div className="rounded-full bg-white/80 px-3 py-1.5 text-xs text-orange-700 shadow-sm dark:bg-white/[0.08] dark:text-orange-200">
            当前尺寸：{selectedSize.size}
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.12fr)_minmax(360px,0.88fr)]">
          <div className="space-y-3">
            <div className="rounded-2xl border border-orange-100 bg-white/90 p-4 shadow-sm dark:border-white/[0.08] dark:bg-black/20">
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-orange-600 text-xs font-semibold text-white">
                  1
                </span>
                <div>
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    商品信息
                  </div>
                  <p className="text-xs text-gray-400">
                    单品出图填这里，SKU 批量在下面单独导入。
                  </p>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  value={productName}
                  onChange={(event) => setProductName(event.target.value)}
                  placeholder="商品名，例如：便携榨汁杯"
                  className="w-full rounded-xl border border-orange-100 bg-white px-3 py-2 text-sm outline-none focus:border-orange-400 dark:border-white/[0.08] dark:bg-black/20"
                />
                <input
                  value={sku}
                  onChange={(event) => setSku(event.target.value)}
                  placeholder="SKU / 款号，可选"
                  className="w-full rounded-xl border border-orange-100 bg-white px-3 py-2 text-sm outline-none focus:border-orange-400 dark:border-white/[0.08] dark:bg-black/20"
                />
              </div>
              <input
                value={audience}
                onChange={(event) => setAudience(event.target.value)}
                placeholder="适用人群，例如：通勤女性 / 宝妈 / 户外爱好者"
                className="mt-2 w-full rounded-xl border border-orange-100 bg-white px-3 py-2 text-sm outline-none focus:border-orange-400 dark:border-white/[0.08] dark:bg-black/20"
              />
              <textarea
                value={sellingPoints}
                onChange={(event) => setSellingPoints(event.target.value)}
                placeholder="核心卖点，例如：无线便携 / 大容量 / 易清洗 / 高颜值礼盒包装"
                rows={3}
                className="mt-2 w-full resize-none rounded-xl border border-orange-100 bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-orange-400 dark:border-white/[0.08] dark:bg-black/20"
              />
              <div
                className={`mt-3 rounded-2xl border p-3 ${
                  hasProductReference
                    ? "border-green-200 bg-green-50/80 dark:border-green-400/20 dark:bg-green-500/10"
                    : "border-red-200 bg-red-50/80 dark:border-red-400/20 dark:bg-red-500/10"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div
                      className={`text-xs font-medium ${
                        hasProductReference
                          ? "text-green-800 dark:text-green-200"
                          : "text-red-700 dark:text-red-200"
                      }`}
                    >
                      商品参考图：{referenceSourceText}
                    </div>
                    <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                      电商套图必须先上传真实商品参考图，否则模型可能生成错产品。
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <input
                      ref={referenceInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(event) =>
                        void handleReferenceUpload(event.target.files)
                      }
                    />
                    <button
                      type="button"
                      onClick={() => referenceInputRef.current?.click()}
                      className="rounded-xl bg-orange-600 px-3 py-2 text-xs font-medium text-white transition hover:bg-orange-500"
                    >
                      上传商品参考
                    </button>
                    {inputImages.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          clearInputImages();
                          setTargetReferenceIds({
                            outfit: [],
                            model: [],
                            scene: [],
                          });
                          showToast("已清空当前上传参考图", "info");
                        }}
                        className="rounded-xl bg-white px-3 py-2 text-xs font-medium text-gray-600 shadow-sm transition hover:bg-gray-50 dark:bg-white/[0.08] dark:text-gray-200"
                      >
                        清空上传
                      </button>
                    )}
                  </div>
                </div>
                {effectiveProductReference?.dataUrl && (
                  <div className="mt-3 flex gap-2 overflow-x-auto">
                    {(productInputImages.length
                      ? productInputImages
                      : [effectiveProductReference])
                      .slice(0, 6)
                      .map((image) => (
                        <div
                          key={image.id}
                          className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-white/80 bg-white shadow-sm dark:border-white/[0.08] dark:bg-black/20"
                        >
                          <img
                            src={image.dataUrl}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-orange-100 bg-white/90 p-4 shadow-sm dark:border-white/[0.08] dark:bg-black/20">
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-orange-600 text-xs font-semibold text-white">
                  2
                </span>
                <div>
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    出图策略
                  </div>
                  <p className="text-xs text-gray-400">
                    先选平台尺寸，再选套图类型和合规口径。
                  </p>
                </div>
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                <div>
                  <div className="mb-2 text-xs font-medium text-gray-700 dark:text-gray-200">
                    平台尺寸预设
                  </div>
                  <div className="grid gap-2">
                    {ECOMMERCE_SIZE_PRESETS.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setSizeId(item.id);
                          applySize(item.size);
                        }}
                        className={`rounded-xl border px-3 py-2 text-left transition ${
                          sizeId === item.id || params.size === item.size
                            ? "border-orange-300 bg-orange-100 text-orange-900 dark:border-orange-300/40 dark:bg-orange-500/20 dark:text-orange-100"
                            : "border-orange-100 bg-white text-gray-700 hover:border-orange-200 hover:bg-orange-50 dark:border-white/[0.08] dark:bg-black/20 dark:text-gray-200"
                        }`}
                      >
                        <span className="block text-sm font-medium">{item.label}</span>
                        <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">
                          {item.size} · {item.hint}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-xs font-medium text-gray-700 dark:text-gray-200">
                    平台合规预设
                  </div>
                  <div className="grid gap-2">
                    {PLATFORM_COMPLIANCE_PRESETS.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setPlatformId(item.id)}
                        className={`rounded-xl border px-3 py-2 text-left text-sm transition ${
                          platformId === item.id
                            ? "border-cyan-300 bg-cyan-50 text-cyan-900 dark:border-cyan-300/40 dark:bg-cyan-500/20 dark:text-cyan-100"
                            : "border-gray-200 bg-white text-gray-700 hover:border-cyan-200 hover:bg-cyan-50 dark:border-white/[0.08] dark:bg-black/20 dark:text-gray-200"
                        }`}
                      >
                        <span className="font-medium">{item.label}</span>
                        <span className="mt-1 block line-clamp-2 text-xs text-gray-500 dark:text-gray-400">
                          {item.text}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-4">
                <div className="mb-2 text-xs font-medium text-gray-700 dark:text-gray-200">
                  套图类型
                </div>
                <div className="flex flex-wrap gap-2">
                  {ECOMMERCE_SCENE_PRESETS.map((item) => {
                    const active = sceneIds.includes(item.id);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => toggleScene(item.id)}
                        className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                          active
                            ? "bg-gray-900 text-white dark:bg-white dark:text-gray-950"
                            : "bg-white text-gray-600 shadow-sm hover:bg-gray-50 dark:bg-white/[0.08] dark:text-gray-200"
                        }`}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-blue-100 bg-blue-50/80 p-4 shadow-sm dark:border-blue-400/20 dark:bg-blue-500/10">
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">
                  3
                </span>
                <div>
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    预览并提交
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    先预览提示词，确认后才会真正扣费生成。
                  </p>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={prepareCurrentPreview}
                  disabled={!hasProductReference}
                  className="rounded-xl bg-orange-600 px-3 py-2.5 text-sm font-medium text-white transition hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  预览当前商品
                </button>
                <button
                  type="button"
                  onClick={prepareSkuPreview}
                  disabled={!hasProductReference}
                  className="rounded-xl bg-gray-900 px-3 py-2.5 text-sm font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-white dark:text-gray-950 dark:hover:bg-gray-200"
                >
                  预览 SKU 批量
                </button>
              </div>
              {!hasProductReference && (
                <p className="mt-2 text-xs leading-5 text-red-500 dark:text-red-300">
                  请先上传商品参考图，或在创作资产里设置固定产品/系列基准图，再生成套图。
                </p>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-2xl border border-orange-100 bg-white/90 p-4 shadow-sm dark:border-white/[0.08] dark:bg-black/20">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    商品一致性锁
                  </div>
                  <p className="mt-1 text-xs text-gray-400">
                    用参考图做系列时建议开启，避免商品结构、Logo、颜色跑偏。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={toggleLock}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                    isLockActive
                      ? "bg-orange-600 text-white"
                      : "bg-orange-50 text-orange-700 hover:bg-orange-100 dark:bg-orange-500/10 dark:text-orange-200"
                  }`}
                >
                  {isLockActive ? "已开启" : "已关闭"}
                </button>
              </div>
              <div className="rounded-xl bg-orange-50 p-3 text-xs leading-5 text-orange-900 dark:bg-orange-500/10 dark:text-orange-100">
                {isLockActive
                  ? "提交预览时会自动写入商品一致性要求。"
                  : "关闭后会更自由，但商品细节可能更容易漂移。"}
              </div>
            </div>

            <EcommerceMarketingCopyPanel
              marketingCopy={marketingCopy}
              setMarketingCopy={setMarketingCopy}
              onCopy={copyMarketingCopy}
              onRefresh={refreshMarketingCopy}
            />

            <EcommerceStylingPanel
              inputImages={inputImages}
              hasProductReference={hasProductReference}
              pendingTargetReferenceKind={pendingTargetReferenceKind}
              setPendingTargetReferenceKind={setPendingTargetReferenceKind}
              setStylingEnabled={setStylingEnabled}
              setStylingMode={setStylingMode}
              setStylingNotes={setStylingNotes}
              stylingEnabled={stylingEnabled}
              stylingMode={stylingMode}
              stylingNotes={stylingNotes}
              targetReferenceIds={targetReferenceIds}
              targetReferenceInputRef={targetReferenceInputRef}
              onTargetReferenceUpload={handleTargetReferenceUpload}
            />

            <div className="rounded-2xl border border-dashed border-orange-200 bg-white/75 p-4 dark:border-orange-400/20 dark:bg-black/20">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    SKU 批量导入
                  </div>
                  <p className="mt-1 text-xs text-gray-400">
                    多款商品走这里，和上面的单品输入互不干扰。
                  </p>
                </div>
                <span className="rounded-full bg-orange-100 px-2.5 py-1 text-[11px] text-orange-700 dark:bg-orange-500/10 dark:text-orange-200">
                  当前最多 {Math.floor(30 / selectedScenes.length)} 款
                </span>
              </div>
              <textarea
                value={skuBatchText}
                onChange={(event) => setSkuBatchText(event.target.value)}
                placeholder={
                  "SKU001, 便携榨汁杯, 大容量/无线/易清洗\nSKU002, 保温杯, 316不锈钢/保温12小时"
                }
                rows={4}
                className="w-full resize-none rounded-xl border border-orange-100 bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-orange-400 dark:border-white/[0.08] dark:bg-black/20"
              />
            </div>
          </div>
        </div>
      </section>

      {previewPrompts.length > 0 && (
        <section className="rounded-2xl border border-blue-200 bg-blue-50/70 p-4 shadow-sm dark:border-blue-400/20 dark:bg-blue-500/10 md:col-span-2">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                提示词预览后再提交
              </h3>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                可直接编辑或删除单条，确认后才会真正提交生成任务。
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPreviewPrompts([])}
                className="rounded-xl bg-white px-3 py-2 text-xs font-medium text-gray-600 shadow-sm hover:bg-gray-50 dark:bg-white/[0.08] dark:text-gray-200"
              >
                清空预览
              </button>
              <button
                type="button"
                onClick={() => void submitPreview()}
                className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-500"
              >
                确认提交 {previewPrompts.length} 条
              </button>
            </div>
          </div>
          <div className="max-h-96 space-y-2 overflow-y-auto">
            {previewPrompts.map((item, index) => (
              <div
                key={item.id}
                className="rounded-xl border border-blue-100 bg-white p-3 dark:border-white/[0.08] dark:bg-black/20"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-xs font-medium text-blue-700 dark:text-blue-200">
                    {index + 1}. {item.label}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setPreviewPrompts((current) =>
                        current.filter((target) => target.id !== item.id),
                      )
                    }
                    className="text-xs text-red-500 hover:text-red-600"
                  >
                    删除
                  </button>
                </div>
                <textarea
                  value={item.text}
                  onChange={(event) =>
                    setPreviewPrompts((current) =>
                      current.map((target) =>
                        target.id === item.id
                          ? { ...target, text: event.target.value }
                          : target,
                      ),
                    )
                  }
                  rows={8}
                  className="w-full resize-y rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs leading-5 outline-none focus:border-blue-400 dark:border-white/[0.08] dark:bg-black/20"
                />
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-gray-200/70 bg-white/80 p-4 shadow-sm dark:border-white/[0.08] dark:bg-white/[0.04] md:col-span-2">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              套图任务包导出
            </h3>
            <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
              按电商批次打包下载，文件名自动使用 SKU / 商品名 + 套图类型 + 序号，方便直接交付运营。
            </p>
          </div>
          <div className="rounded-full bg-gray-100 px-3 py-1.5 text-xs text-gray-500 dark:bg-black/20 dark:text-gray-400">
            可导出 {exportImageCount} 张
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-200">
              选择导出批次
            </span>
            <select
              value={exportBatchId}
              onChange={(event) => setExportBatchId(event.target.value)}
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-orange-400 dark:border-white/[0.08] dark:bg-black/20 dark:text-gray-100"
            >
              <option value="all">
                全部电商套图任务（{ecommerceDoneTasks.length} 个任务）
              </option>
              {exportBatches.map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {batch.label}（{batch.count} 张）
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={() => void handleExportPackage()}
            disabled={!exportImageCount}
            className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-gray-950 dark:hover:bg-gray-200"
          >
            导出套图 ZIP
          </button>
        </div>

        <div className="mt-3 rounded-xl bg-gray-50 p-3 text-xs leading-5 text-gray-500 dark:bg-black/20 dark:text-gray-400">
          命名示例：
          <span className="ml-1 font-mono text-gray-700 dark:text-gray-200">
            SKU001-白底主图-01.jpg
          </span>
          。如果任务没有 SKU，会自动用商品名兜底。
        </div>
      </section>
    </>
  );
}
