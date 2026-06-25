import type { DownloadImageZipEntry } from "../gallery/downloadImages";
import type { TaskRecord } from "../../types";

export const ECOMMERCE_CONSISTENCY_LOCK =
  "电商商品一致性要求：必须保持商品主体完全一致，包括外形结构、颜色、材质、包装、Logo、文字位置和比例；不要改动商品关键卖点，不要新增不存在的配件，不要让包装文字乱码或变形。只允许改变背景、光影、摆放场景、构图和营销氛围。";

export const ECOMMERCE_SIZE_PRESETS = [
  {
    id: "tmall-main",
    label: "淘宝/天猫主图",
    size: "1024x1024",
    hint: "方图，适合白底主图和货架图",
  },
  {
    id: "detail-long",
    label: "详情页竖图",
    size: "1024x1536",
    hint: "竖版，适合卖点拆解",
  },
  {
    id: "xhs-douyin",
    label: "小红书/抖音",
    size: "1080x1440",
    hint: "竖版种草和短视频封面",
  },
  {
    id: "banner",
    label: "横版海报",
    size: "1280x720",
    hint: "活动 banner / 首屏横图",
  },
] as const;

export const ECOMMERCE_SCENE_PRESETS = [
  {
    id: "white-main",
    label: "白底主图",
    prompt:
      "生成电商白底主图，商品居中占画面主体，干净纯白或浅灰背景，商业摄影棚布光，边缘清晰，适合平台主图审核。",
  },
  {
    id: "scene",
    label: "场景图",
    prompt:
      "生成真实使用场景图，让商品自然出现在生活化环境中，突出使用体验和质感，背景高级但不要抢主体。",
  },
  {
    id: "detail",
    label: "详情卖点图",
    prompt:
      "生成详情页卖点展示图，画面要能表达核心功能优势，保留标题和卖点文案留白区域，构图清晰适合落地页。",
  },
  {
    id: "social",
    label: "种草图",
    prompt:
      "生成小红书/抖音种草风格封面，视觉有生活方式氛围，商品自然醒目，适合吸引点击和收藏。",
  },
  {
    id: "promo",
    label: "促销图",
    prompt:
      "生成促销活动海报图，保留醒目的价格/活动文案空间，有节日或大促氛围，商品仍然是第一视觉中心。",
  },
] as const;

export const PLATFORM_COMPLIANCE_PRESETS = [
  {
    id: "tmall",
    label: "淘宝/天猫",
    text:
      "平台合规：主图保持干净专业，避免夸张水印、过多促销字、低俗擦边元素；商品主体清晰完整，不误导材质、容量、功效。",
  },
  {
    id: "xhs",
    label: "小红书",
    text:
      "平台合规：画面更像真实种草分享，避免绝对化功效承诺；标题自然有吸引力，不做医疗、瘦身、功效夸大表达。",
  },
  {
    id: "douyin",
    label: "抖音",
    text:
      "平台合规：封面信息简洁强钩子，避免密集文字和虚假承诺；画面要适合短视频首帧，主体醒目，留出字幕区。",
  },
  {
    id: "detail",
    label: "详情页",
    text:
      "平台合规：卖点表达清晰可验证，避免第一、最强、永久等绝对化词；预留标题、参数、功能拆解和免责声明区域。",
  },
] as const;

export type EcommerceSceneId = (typeof ECOMMERCE_SCENE_PRESETS)[number]["id"];
export type EcommerceSizeId = (typeof ECOMMERCE_SIZE_PRESETS)[number]["id"];
export type PlatformComplianceId =
  (typeof PLATFORM_COMPLIANCE_PRESETS)[number]["id"];
export type StylingReferenceMode = "same-model" | "same-outfit" | "scene-only";
export type StylingTargetReferenceKind = "outfit" | "model" | "scene";

export const STYLING_REFERENCE_MODES: Array<{
  id: StylingReferenceMode;
  label: string;
  hint: string;
}> = [
  {
    id: "same-model",
    label: "同模特换衣",
    hint: "锁住脸型、发型、身材和气质，只替换服装/搭配。",
  },
  {
    id: "same-outfit",
    label: "同衣服换模特",
    hint: "锁住服装版型、颜色、材质和细节，只替换模特。",
  },
  {
    id: "scene-only",
    label: "只换场景",
    hint: "锁住人物和商品，只改变背景、光影和使用环境。",
  },
];

export const STYLING_TARGET_REFERENCES: Array<{
  id: StylingTargetReferenceKind;
  label: string;
  hint: string;
}> = [
  {
    id: "outfit",
    label: "目标衣服参考",
    hint: "要换上的衣服、饰品、鞋包或美妆效果。",
  },
  {
    id: "model",
    label: "目标模特参考",
    hint: "要替换成的模特、人群、肤色或气质。",
  },
  {
    id: "scene",
    label: "目标场景参考",
    hint: "要替换成的背景、空间、光影或拍摄氛围。",
  },
];

export type EcommerceItem = {
  sku?: string;
  productName: string;
  sellingPoints: string;
};

export type PreviewPrompt = {
  id: string;
  label: string;
  text: string;
};

export function parseSkuLines(value: string): EcommerceItem[] {
  return value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line
        .split(/\t|,|，/)
        .map((item) => item.trim())
        .filter(Boolean);
      return {
        sku: parts[0] ?? "",
        productName: parts[1] ?? parts[0] ?? "",
        sellingPoints: parts.slice(2).join(" / "),
      };
    })
    .filter((item) => item.sku || item.productName || item.sellingPoints);
}

function splitSellingPoints(value: string) {
  return value
    .split(/\/|、|，|,|\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 6);
}

export function buildMarketingCopy(
  productName: string,
  sellingPoints: string,
  audience: string,
) {
  const name = productName.trim() || "这款商品";
  const points = splitSellingPoints(sellingPoints);
  const mainPoint = points[0] || "高颜值实用";
  const target = audience.trim() || "追求品质生活的人群";
  return {
    title: `${name}，把${mainPoint}带进日常`,
    subtitle: `为${target}设计，兼顾颜值、体验和实用细节。`,
    detailBullets:
      points.length > 0
        ? points.map((point) => `突出「${point}」：用清晰场景和近景细节展示真实价值。`)
        : [
            "展示商品主体、材质和使用方式。",
            "用真实场景强化购买理由。",
            "保留标题和参数说明区域。",
          ],
    videoScript: [
      "0-2 秒：用商品高光细节或使用痛点开场，快速抓住注意力。",
      `2-6 秒：展示 ${name} 的核心卖点：${points.slice(0, 3).join("、") || mainPoint}。`,
      `6-10 秒：切到${target}的真实使用场景，突出前后体验变化。`,
      "10-12 秒：收尾给出购买理由和简短行动引导。",
    ],
  };
}

export function buildStylingInstruction(options: {
  enabled: boolean;
  mode: StylingReferenceMode;
  notes: string;
  targetReferenceSummary: string;
}) {
  if (!options.enabled) return "";
  const modeInstruction =
    options.mode === "same-model"
      ? "参考图用途：保留同一个模特身份，必须保持脸型、五官、发型、身材比例、肤色气质和姿态风格一致；只替换服装、配饰、妆容或搭配。"
      : options.mode === "same-outfit"
        ? "参考图用途：保留同一套衣服/穿戴商品，必须保持版型、颜色、面料、纹理、Logo、扣子、口袋、饰品造型等细节一致；只替换模特、肤色、人群或拍摄姿态。"
        : "参考图用途：保留参考图中的人物、服装、商品和关键细节一致；只替换场景、背景、光影、机位和营销氛围。";
  return [
    "换装 / 场景替换要求：适合服装、饰品、美妆、穿戴类商品。",
    modeInstruction,
    options.targetReferenceSummary,
    options.notes ? `补充要求：${options.notes}` : "",
    "必须严格参考上传图，不要凭空生成另一件衣服、另一个商品或另一个人物身份；没有明确要求替换的部分都保持一致。",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildEcommercePrompt(options: {
  productName: string;
  sku?: string;
  sellingPoints: string;
  audience: string;
  sceneLabel: string;
  scenePrompt: string;
  complianceText: string;
  marketingCopyText: string;
  stylingInstruction: string;
  includeConsistencyLock?: boolean;
}) {
  return [
    `商品：${options.productName || options.sku || "未命名商品"}`,
    options.sku ? `SKU：${options.sku}` : "",
    options.sellingPoints ? `核心卖点：${options.sellingPoints}` : "",
    options.audience ? `适用人群：${options.audience}` : "",
    `出图类型：${options.sceneLabel}`,
    options.scenePrompt,
    options.marketingCopyText,
    options.complianceText,
    options.stylingInstruction,
    options.includeConsistencyLock ? ECOMMERCE_CONSISTENCY_LOCK : "",
    "画面要求：真实商业质感，主体清晰，避免畸形、错字、水印、伪造品牌授权标识。",
  ]
    .filter(Boolean)
    .join("\n");
}

function sanitizePackageName(value: string) {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

function getPromptLineValue(prompt: string, label: string) {
  const line = prompt
    .split(/\r?\n/)
    .find((item) => item.trim().startsWith(`${label}：`));
  return line?.split("：").slice(1).join("：").trim() ?? "";
}

export function getEcommerceTaskMeta(task: TaskRecord) {
  const sku = getPromptLineValue(task.prompt, "SKU");
  const productName = getPromptLineValue(task.prompt, "商品");
  const scene = getPromptLineValue(task.prompt, "出图类型");
  const fallbackName = task.seriesBatchLabel || productName || task.id;
  return {
    sku,
    productName,
    scene,
    displayName: sku || productName || fallbackName,
    isEcommerce: Boolean(scene && (sku || productName || task.seriesBatchLabel)),
  };
}

export function buildEcommercePackageEntries(
  tasks: TaskRecord[],
): DownloadImageZipEntry[] {
  const orderedTasks = [...tasks].sort((a, b) => a.createdAt - b.createdAt);
  return orderedTasks.flatMap((task, taskIndex) => {
    const meta = getEcommerceTaskMeta(task);
    const skuPart = sanitizePackageName(
      meta.sku || meta.productName || `task-${taskIndex + 1}`,
    );
    const scenePart = sanitizePackageName(meta.scene || "成品图");
    return task.outputImages.map((imageId, imageIndex) => ({
      imageId,
      fileNameBase: `${skuPart}-${scenePart}-${String(imageIndex + 1).padStart(2, "0")}`,
    }));
  });
}
