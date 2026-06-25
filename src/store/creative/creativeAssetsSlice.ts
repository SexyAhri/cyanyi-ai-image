import type { StateCreator } from "zustand";
import type {
  CreativeNegativePreset,
  CreativeStylePreset,
  CreativeSubjectProfile,
  PromptTemplate,
} from "../../types";
import { genId } from "../../lib/shared/id";
import type { AppState } from "../types";

type CreativeAssetsNormalizers = {
  normalizePromptTemplates: (value: unknown) => PromptTemplate[];
  normalizeCreativeStylePresets: (value: unknown) => CreativeStylePreset[];
  normalizeCreativeSubjectProfiles: (
    value: unknown,
  ) => CreativeSubjectProfile[];
  normalizeCreativeNegativePresets: (
    value: unknown,
  ) => CreativeNegativePreset[];
};

export type CreativeAssetsSlice = Pick<
  AppState,
  | "promptTemplates"
  | "addPromptTemplate"
  | "updatePromptTemplate"
  | "deletePromptTemplate"
  | "creativeAssetsOpen"
  | "setCreativeAssetsOpen"
  | "creativeStylePresets"
  | "addCreativeStylePreset"
  | "updateCreativeStylePreset"
  | "deleteCreativeStylePreset"
  | "creativeSubjectProfiles"
  | "addCreativeSubjectProfile"
  | "updateCreativeSubjectProfile"
  | "deleteCreativeSubjectProfile"
  | "creativeNegativePresets"
  | "addCreativeNegativePreset"
  | "updateCreativeNegativePreset"
  | "deleteCreativeNegativePreset"
  | "utilityPanelOpen"
  | "setUtilityPanelOpen"
  | "agentDiagnosticLogs"
  | "addAgentDiagnosticLog"
  | "clearAgentDiagnosticLogs"
>;

export function createCreativeAssetsSlice(
  normalizers: CreativeAssetsNormalizers,
): StateCreator<AppState, [], [], CreativeAssetsSlice> {
  return (set) => ({
    promptTemplates: normalizers.normalizePromptTemplates(undefined),
    addPromptTemplate: (template) =>
      set((state) => {
        const now = Date.now();
        const next: PromptTemplate = {
          id: genId(),
          title: template.title.trim().slice(0, 80) || "未命名模板",
          content: template.content.trim(),
          category: template.category?.trim() || undefined,
          createdAt: now,
          updatedAt: now,
        };
        if (!next.content) return state;
        return { promptTemplates: [next, ...state.promptTemplates] };
      }),
    updatePromptTemplate: (id, patch) =>
      set((state) => ({
        promptTemplates: state.promptTemplates.map((template) =>
          template.id === id
            ? {
                ...template,
                ...(patch.title !== undefined
                  ? {
                      title: patch.title.trim().slice(0, 80) || template.title,
                    }
                  : {}),
                ...(patch.content !== undefined
                  ? { content: patch.content.trim() || template.content }
                  : {}),
                ...(patch.category !== undefined
                  ? { category: patch.category.trim() || undefined }
                  : {}),
                updatedAt: Date.now(),
              }
            : template,
        ),
      })),
    deletePromptTemplate: (id) =>
      set((state) => ({
        promptTemplates: state.promptTemplates.filter(
          (template) => template.id !== id,
        ),
      })),
    creativeAssetsOpen: false,
    setCreativeAssetsOpen: (creativeAssetsOpen) => set({ creativeAssetsOpen }),
    creativeStylePresets: normalizers.normalizeCreativeStylePresets(undefined),
    addCreativeStylePreset: (preset) =>
      set((state) => {
        const title = preset.title.trim();
        const content = preset.content.trim();
        if (!title || !content) return state;
        const now = Date.now();
        return {
          creativeStylePresets: [
            {
              id: genId(),
              title: title.slice(0, 80),
              content,
              tags: normalizeTags(preset.tags),
              createdAt: now,
              updatedAt: now,
            },
            ...state.creativeStylePresets,
          ],
        };
      }),
    updateCreativeStylePreset: (id, patch) =>
      set((state) => ({
        creativeStylePresets: state.creativeStylePresets.map((preset) =>
          preset.id === id
            ? {
                ...preset,
                ...(patch.title !== undefined
                  ? { title: patch.title.trim().slice(0, 80) || preset.title }
                  : {}),
                ...(patch.content !== undefined
                  ? { content: patch.content.trim() || preset.content }
                  : {}),
                ...(patch.tags !== undefined
                  ? { tags: normalizeTags(patch.tags) }
                  : {}),
                updatedAt: Date.now(),
              }
            : preset,
        ),
      })),
    deleteCreativeStylePreset: (id) =>
      set((state) => ({
        creativeStylePresets: state.creativeStylePresets.filter(
          (preset) => preset.id !== id,
        ),
      })),
    creativeSubjectProfiles:
      normalizers.normalizeCreativeSubjectProfiles(undefined),
    addCreativeSubjectProfile: (profile) =>
      set((state) => {
        const name = profile.name.trim();
        const description = profile.description.trim();
        if (!name || !description) return state;
        const now = Date.now();
        return {
          creativeSubjectProfiles: [
            {
              id: genId(),
              name: name.slice(0, 80),
              description,
              negativePrompt: profile.negativePrompt?.trim() || undefined,
              createdAt: now,
              updatedAt: now,
            },
            ...state.creativeSubjectProfiles,
          ],
        };
      }),
    updateCreativeSubjectProfile: (id, patch) =>
      set((state) => ({
        creativeSubjectProfiles: state.creativeSubjectProfiles.map((profile) =>
          profile.id === id
            ? {
                ...profile,
                ...(patch.name !== undefined
                  ? { name: patch.name.trim().slice(0, 80) || profile.name }
                  : {}),
                ...(patch.description !== undefined
                  ? {
                      description:
                        patch.description.trim() || profile.description,
                    }
                  : {}),
                ...(patch.negativePrompt !== undefined
                  ? {
                      negativePrompt: patch.negativePrompt.trim() || undefined,
                    }
                  : {}),
                updatedAt: Date.now(),
              }
            : profile,
        ),
      })),
    deleteCreativeSubjectProfile: (id) =>
      set((state) => ({
        creativeSubjectProfiles: state.creativeSubjectProfiles.filter(
          (profile) => profile.id !== id,
        ),
      })),
    creativeNegativePresets:
      normalizers.normalizeCreativeNegativePresets(undefined),
    addCreativeNegativePreset: (preset) =>
      set((state) => {
        const title = preset.title.trim();
        const content = preset.content.trim();
        if (!title || !content) return state;
        const now = Date.now();
        return {
          creativeNegativePresets: [
            {
              id: genId(),
              title: title.slice(0, 80),
              content,
              createdAt: now,
              updatedAt: now,
            },
            ...state.creativeNegativePresets,
          ],
        };
      }),
    updateCreativeNegativePreset: (id, patch) =>
      set((state) => ({
        creativeNegativePresets: state.creativeNegativePresets.map((preset) =>
          preset.id === id
            ? {
                ...preset,
                ...(patch.title !== undefined
                  ? { title: patch.title.trim().slice(0, 80) || preset.title }
                  : {}),
                ...(patch.content !== undefined
                  ? { content: patch.content.trim() || preset.content }
                  : {}),
                updatedAt: Date.now(),
              }
            : preset,
        ),
      })),
    deleteCreativeNegativePreset: (id) =>
      set((state) => ({
        creativeNegativePresets: state.creativeNegativePresets.filter(
          (preset) => preset.id !== id,
        ),
      })),
    utilityPanelOpen: false,
    setUtilityPanelOpen: (utilityPanelOpen) => set({ utilityPanelOpen }),
    agentDiagnosticLogs: [],
    addAgentDiagnosticLog: (log) =>
      set((state) => ({
        agentDiagnosticLogs: [
          {
            id: genId(),
            createdAt: log.createdAt ?? Date.now(),
            ...log,
          },
          ...state.agentDiagnosticLogs,
        ].slice(0, 80),
      })),
    clearAgentDiagnosticLogs: () => set({ agentDiagnosticLogs: [] }),
  });
}

function normalizeTags(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tags = Array.from(
    new Set(
      value
        .map(String)
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ).slice(0, 12);
  return tags.length > 0 ? tags : undefined;
}
