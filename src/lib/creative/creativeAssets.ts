import type {
  CreativeNegativePreset,
  CreativeStylePreset,
  CreativeSubjectProfile,
  PromptTemplate,
} from "../../types";
import { genId } from "../shared/id";

const DEFAULT_PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: "template-product-shot",
    title: "产品图精修",
    category: "商业",
    content:
      "保留主体结构，优化光影、质感和背景，让画面像专业电商产品摄影，干净高级。",
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "template-character-polish",
    title: "角色细化",
    category: "人物",
    content:
      "保持人物身份和构图不变，增强面部细节、服装材质、发丝和整体光影，画面更精致。",
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "template-local-edit",
    title: "局部修改",
    category: "编辑",
    content:
      "只修改我标注或描述的局部区域，其他区域保持不变，边缘自然融合。",
    createdAt: 0,
    updatedAt: 0,
  },
];

const DEFAULT_CREATIVE_STYLE_PRESETS: CreativeStylePreset[] = [
  {
    id: "style-cinematic-commercial",
    title: "电影感商业大片",
    tags: ["商业", "电影感"],
    content:
      "统一为高端商业摄影质感，电影级布光，主体清晰，背景干净但有层次，色彩克制高级，细节真实自然。",
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "style-soft-anime",
    title: "柔和二次元插画",
    tags: ["插画", "角色"],
    content:
      "统一为柔和精致的二次元插画风格，线条干净，色彩明亮通透，角色比例稳定，表情自然，画面温暖。",
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "style-realistic-product",
    title: "真实产品摄影",
    tags: ["产品", "写实"],
    content:
      "统一为真实产品摄影风格，保持产品结构和材质准确，光影自然，背景简洁，适合电商展示。",
    createdAt: 0,
    updatedAt: 0,
  },
];

const DEFAULT_CREATIVE_SUBJECT_PROFILES: CreativeSubjectProfile[] = [
  {
    id: "subject-main-character",
    name: "主角档案",
    description:
      "固定同一个角色/主体的外观特征、服装、发型、年龄感和核心气质，后续只改变场景、动作或镜头。",
    negativePrompt: "不要改变身份、脸型、发型、服装主色、主体比例。",
    createdAt: 0,
    updatedAt: 0,
  },
];

const DEFAULT_CREATIVE_NEGATIVE_PRESETS: CreativeNegativePreset[] = [
  {
    id: "negative-common-image",
    title: "常用生图禁止项",
    content:
      "避免低清晰度、畸形手指、扭曲五官、文字乱码、多余肢体、主体变形、过度锐化、塑料质感。",
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "negative-consistency",
    title: "一致性禁止项",
    content:
      "不要改变主体身份、服装主色、核心风格、镜头比例、画面色调，不要引入无关元素。",
    createdAt: 0,
    updatedAt: 0,
  },
];

export function normalizePromptTemplates(value: unknown): PromptTemplate[] {
  const list = Array.isArray(value) ? value : DEFAULT_PROMPT_TEMPLATES;
  const now = Date.now();
  const seen = new Set<string>();
  return list
    .map((item): PromptTemplate | null => {
      if (!isRecord(item)) return null;
      const title = typeof item.title === "string" ? item.title.trim() : "";
      const content =
        typeof item.content === "string" ? item.content.trim() : "";
      if (!title || !content) return null;
      const id =
        typeof item.id === "string" && item.id.trim() ? item.id : genId();
      if (seen.has(id)) return null;
      seen.add(id);
      return {
        id,
        title: title.slice(0, 80),
        content,
        category:
          typeof item.category === "string" && item.category.trim()
            ? item.category.trim().slice(0, 40)
            : undefined,
        createdAt: typeof item.createdAt === "number" ? item.createdAt : now,
        updatedAt: typeof item.updatedAt === "number" ? item.updatedAt : now,
      };
    })
    .filter((item): item is PromptTemplate => Boolean(item));
}

export function normalizeCreativeStylePresets(
  value: unknown,
): CreativeStylePreset[] {
  const list = Array.isArray(value) ? value : DEFAULT_CREATIVE_STYLE_PRESETS;
  const now = Date.now();
  const seen = new Set<string>();
  return list
    .map((item): CreativeStylePreset | null => {
      if (!isRecord(item)) return null;
      const title = typeof item.title === "string" ? item.title.trim() : "";
      const content =
        typeof item.content === "string" ? item.content.trim() : "";
      if (!title || !content) return null;
      const id =
        typeof item.id === "string" && item.id.trim() ? item.id : genId();
      if (seen.has(id)) return null;
      seen.add(id);
      return {
        id,
        title: title.slice(0, 80),
        content,
        tags: normalizeTags(item.tags),
        createdAt: typeof item.createdAt === "number" ? item.createdAt : now,
        updatedAt: typeof item.updatedAt === "number" ? item.updatedAt : now,
      };
    })
    .filter((item): item is CreativeStylePreset => Boolean(item));
}

export function normalizeCreativeSubjectProfiles(
  value: unknown,
): CreativeSubjectProfile[] {
  const list = Array.isArray(value)
    ? value
    : DEFAULT_CREATIVE_SUBJECT_PROFILES;
  const now = Date.now();
  const seen = new Set<string>();
  return list
    .map((item): CreativeSubjectProfile | null => {
      if (!isRecord(item)) return null;
      const name = typeof item.name === "string" ? item.name.trim() : "";
      const description =
        typeof item.description === "string" ? item.description.trim() : "";
      if (!name || !description) return null;
      const id =
        typeof item.id === "string" && item.id.trim() ? item.id : genId();
      if (seen.has(id)) return null;
      seen.add(id);
      return {
        id,
        name: name.slice(0, 80),
        description,
        negativePrompt:
          typeof item.negativePrompt === "string" && item.negativePrompt.trim()
            ? item.negativePrompt.trim()
            : undefined,
        createdAt: typeof item.createdAt === "number" ? item.createdAt : now,
        updatedAt: typeof item.updatedAt === "number" ? item.updatedAt : now,
      };
    })
    .filter((item): item is CreativeSubjectProfile => Boolean(item));
}

export function normalizeCreativeNegativePresets(
  value: unknown,
): CreativeNegativePreset[] {
  const list = Array.isArray(value) ? value : DEFAULT_CREATIVE_NEGATIVE_PRESETS;
  const now = Date.now();
  const seen = new Set<string>();
  return list
    .map((item): CreativeNegativePreset | null => {
      if (!isRecord(item)) return null;
      const title = typeof item.title === "string" ? item.title.trim() : "";
      const content =
        typeof item.content === "string" ? item.content.trim() : "";
      if (!title || !content) return null;
      const id =
        typeof item.id === "string" && item.id.trim() ? item.id : genId();
      if (seen.has(id)) return null;
      seen.add(id);
      return {
        id,
        title: title.slice(0, 80),
        content,
        createdAt: typeof item.createdAt === "number" ? item.createdAt : now,
        updatedAt: typeof item.updatedAt === "number" ? item.updatedAt : now,
      };
    })
    .filter((item): item is CreativeNegativePreset => Boolean(item));
}

function normalizeTags(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tags = value
    .map((item) => (typeof item === "string" ? item.trim().slice(0, 20) : ""))
    .filter(Boolean)
    .slice(0, 8);
  return tags.length ? Array.from(new Set(tags)) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
