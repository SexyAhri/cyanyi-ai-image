import type { StateCreator } from "zustand";
import type { InputImage } from "../../types";
import { DEFAULT_PARAMS } from "../../types";
import { dismissAllTooltips } from "../../lib/ui/tooltipDismiss";
import { remapImageMentionsForOrder } from "../../lib/gallery/promptImageMentions";
import { syncActiveInputDraft } from "../../lib/storage/inputDrafts";
import { addSeriesReferenceToHistory } from "../../lib/gallery/seriesReferences";
import type { AppState } from "../types";

export type InputSlice = Pick<
  AppState,
  | "prompt"
  | "setPrompt"
  | "inputImages"
  | "addInputImage"
  | "replaceInputImage"
  | "removeInputImage"
  | "clearInputImages"
  | "setInputImages"
  | "moveInputImage"
  | "maskDraft"
  | "setMaskDraft"
  | "clearMaskDraft"
  | "maskEditorImageId"
  | "setMaskEditorImageId"
  | "galleryInputDraft"
  | "seriesReferenceImage"
  | "setSeriesReferenceImage"
  | "seriesReferenceHistory"
  | "removeSeriesReferenceHistoryItem"
  | "seriesReferenceSlots"
  | "setSeriesReferenceSlot"
  | "setSeriesReferenceFromSlot"
  | "params"
  | "setParams"
  | "reusedTaskApiProfileId"
  | "reusedTaskApiProfileName"
  | "reusedTaskApiProfileMissing"
  | "setReusedTaskApiProfile"
>;

export function createInputSlice(options: {
  deleteCachedImage: (imageId: string) => void;
  deleteImageIfUnreferenced: (imageId: string) => void | Promise<void>;
}): StateCreator<AppState, [], [], InputSlice> {
  return (set) => ({
    prompt: "",
    setPrompt: (prompt) => set((state) => syncActiveInputDraft(state, { prompt })),
    inputImages: [],
    addInputImage: (img) =>
      set((state) => {
        if (state.inputImages.find((item) => item.id === img.id)) return state;
        return syncActiveInputDraft(state, {
          inputImages: [...state.inputImages, img],
        });
      }),
    replaceInputImage: (idx, img) => {
      let removedImageId: string | null = null;
      set((state) => {
        if (idx < 0 || idx >= state.inputImages.length) return state;
        const previous = state.inputImages[idx];
        if (!previous || previous.id === img.id) return state;
        if (
          state.inputImages.some(
            (item, itemIdx) => itemIdx !== idx && item.id === img.id,
          )
        )
          return state;
        removedImageId = previous.id;
        const inputImages = state.inputImages.map((item, itemIdx) =>
          itemIdx === idx ? img : item,
        );
        const shouldClearMask = previous.id === state.maskDraft?.targetImageId;
        return syncActiveInputDraft(state, {
          inputImages,
          prompt: remapImageMentionsForOrder(
            state.prompt,
            state.inputImages,
            inputImages,
            { [previous.id]: img.id },
          ),
          ...(shouldClearMask ? { maskDraft: null, maskEditorImageId: null } : {}),
        });
      });
      if (removedImageId) void options.deleteImageIfUnreferenced(removedImageId);
    },
    removeInputImage: (idx) =>
      set((state) => {
        const removed = state.inputImages[idx];
        const inputImages = state.inputImages.filter((_, i) => i !== idx);
        const shouldClearMask = removed?.id === state.maskDraft?.targetImageId;
        return syncActiveInputDraft(state, {
          inputImages,
          prompt: remapImageMentionsForOrder(
            state.prompt,
            state.inputImages,
            inputImages,
          ),
          ...(shouldClearMask ? { maskDraft: null, maskEditorImageId: null } : {}),
        });
      }),
    clearInputImages: () =>
      set((state) => {
        for (const img of state.inputImages) options.deleteCachedImage(img.id);
        return syncActiveInputDraft(state, {
          inputImages: [],
          prompt: remapImageMentionsForOrder(state.prompt, state.inputImages, []),
          maskDraft: null,
          maskEditorImageId: null,
        });
      }),
    setInputImages: (imgs, optionsArg) =>
      set((state) => {
        const inputImages = orderImagesWithMaskFirst(
          imgs,
          state.maskDraft?.targetImageId,
        );
        const shouldClearMask =
          Boolean(state.maskDraft) &&
          !inputImages.some((img) => img.id === state.maskDraft?.targetImageId);
        return syncActiveInputDraft(state, {
          inputImages,
          prompt: remapImageMentionsForOrder(
            state.prompt,
            state.inputImages,
            inputImages,
            optionsArg?.equivalentImageIds,
          ),
          ...(shouldClearMask ? { maskDraft: null, maskEditorImageId: null } : {}),
        });
      }),
    moveInputImage: (fromIdx, toIdx) =>
      set((state) => {
        const images = [...state.inputImages];
        if (fromIdx < 0 || fromIdx >= images.length) return state;
        const maskTargetImageId = state.maskDraft?.targetImageId;
        if (maskTargetImageId && images[fromIdx]?.id === maskTargetImageId)
          return state;
        const minTargetIdx =
          maskTargetImageId && images.some((img) => img.id === maskTargetImageId)
            ? 1
            : 0;
        const targetIdx = Math.max(minTargetIdx, Math.min(images.length, toIdx));
        const insertIdx = fromIdx < targetIdx ? targetIdx - 1 : targetIdx;
        if (insertIdx === fromIdx) return state;
        const [moved] = images.splice(fromIdx, 1);
        images.splice(insertIdx, 0, moved);
        return syncActiveInputDraft(state, {
          inputImages: images,
          prompt: remapImageMentionsForOrder(
            state.prompt,
            state.inputImages,
            images,
          ),
        });
      }),
    maskDraft: null,
    setMaskDraft: (maskDraft) =>
      set((state) => {
        const inputImages = orderImagesWithMaskFirst(
          state.inputImages,
          maskDraft?.targetImageId,
        );
        return syncActiveInputDraft(state, {
          maskDraft,
          inputImages,
          prompt: remapImageMentionsForOrder(
            state.prompt,
            state.inputImages,
            inputImages,
          ),
        });
      }),
    clearMaskDraft: () =>
      set((state) => syncActiveInputDraft(state, { maskDraft: null })),
    maskEditorImageId: null,
    setMaskEditorImageId: (maskEditorImageId) => {
      if (maskEditorImageId) dismissAllTooltips();
      set((state) => syncActiveInputDraft(state, { maskEditorImageId }));
    },
    galleryInputDraft: null,
    seriesReferenceImage: null,
    setSeriesReferenceImage: (seriesReferenceImage) =>
      set((state) => ({
        seriesReferenceImage,
        seriesReferenceHistory: seriesReferenceImage
          ? addSeriesReferenceToHistory(
              state.seriesReferenceHistory,
              seriesReferenceImage,
            )
          : state.seriesReferenceHistory,
      })),
    seriesReferenceHistory: [],
    removeSeriesReferenceHistoryItem: (imageId) =>
      set((state) => ({
        seriesReferenceHistory: state.seriesReferenceHistory.filter(
          (item) => item.id !== imageId,
        ),
        seriesReferenceImage:
          state.seriesReferenceImage?.id === imageId
            ? null
            : state.seriesReferenceImage,
        seriesReferenceSlots: {
          person:
            state.seriesReferenceSlots.person?.id === imageId
              ? null
              : state.seriesReferenceSlots.person,
          product:
            state.seriesReferenceSlots.product?.id === imageId
              ? null
              : state.seriesReferenceSlots.product,
          style:
            state.seriesReferenceSlots.style?.id === imageId
              ? null
              : state.seriesReferenceSlots.style,
        },
      })),
    seriesReferenceSlots: { person: null, product: null, style: null },
    setSeriesReferenceSlot: (slot, image) =>
      set((state) => ({
        seriesReferenceSlots: {
          ...state.seriesReferenceSlots,
          [slot]: image,
        },
        seriesReferenceHistory: image
          ? addSeriesReferenceToHistory(state.seriesReferenceHistory, image)
          : state.seriesReferenceHistory,
      })),
    setSeriesReferenceFromSlot: (slot) =>
      set((state) => {
        const image = state.seriesReferenceSlots[slot];
        if (!image) return {};
        return {
          seriesReferenceImage: image,
          seriesReferenceHistory: addSeriesReferenceToHistory(
            state.seriesReferenceHistory,
            image,
          ),
        };
      }),
    params: { ...DEFAULT_PARAMS },
    setParams: (patch) =>
      set((state) => ({ params: { ...state.params, ...patch } })),
    reusedTaskApiProfileId: null,
    reusedTaskApiProfileName: null,
    reusedTaskApiProfileMissing: false,
    setReusedTaskApiProfile: (
      reusedTaskApiProfileId,
      reusedTaskApiProfileMissing = false,
      reusedTaskApiProfileName = null,
    ) =>
      set({
        reusedTaskApiProfileId,
        reusedTaskApiProfileName,
        reusedTaskApiProfileMissing,
      }),
  });
}

function orderImagesWithMaskFirst(
  images: InputImage[],
  maskTargetImageId: string | null | undefined,
) {
  if (!maskTargetImageId) return images;
  const maskIdx = images.findIndex((img) => img.id === maskTargetImageId);
  if (maskIdx <= 0) return images;
  const next = [...images];
  const [maskImage] = next.splice(maskIdx, 1);
  next.unshift(maskImage);
  return next;
}
