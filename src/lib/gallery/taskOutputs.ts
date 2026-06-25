import type { TaskParams, TaskRecord } from "../../types";
import { deleteImage, storeImage } from "../storage/db";
import {
  collectStateReferencedImageIds,
  type ImageReferenceState,
} from "./imageReferences";
import { cacheImage, deleteImageCacheEntry } from "../storage/imageCache";
import { removeKeyedBackgroundFromDataUrl } from "./transparentImage";

export function hasActualParams(
  params: Partial<TaskParams> | undefined,
): params is Partial<TaskParams> {
  return Boolean(params && Object.keys(params).length > 0);
}

export function firstActualParams(
  paramsList: Array<Partial<TaskParams> | undefined> | undefined,
): Partial<TaskParams> | undefined {
  return paramsList?.find(hasActualParams);
}

export function mapActualParamsByImage(
  outputIds: string[],
  paramsList: Array<Partial<TaskParams> | undefined> | undefined,
) {
  const mapped = paramsList?.reduce<Record<string, Partial<TaskParams>>>(
    (acc, params, index) => {
      const imgId = outputIds[index];
      if (imgId && hasActualParams(params)) acc[imgId] = params;
      return acc;
    },
    {},
  );
  return mapped && Object.keys(mapped).length > 0 ? mapped : undefined;
}

export async function readImageSizeParam(
  dataUrl: string,
): Promise<Partial<TaskParams> | undefined> {
  if (typeof Image === "undefined") return undefined;

  return new Promise((resolve) => {
    let settled = false;
    const image = new Image();
    const finish = (params: Partial<TaskParams> | undefined) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(params);
    };
    const timer = setTimeout(() => finish(undefined), 2000);
    image.onload = () => {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        finish({ size: `${image.naturalWidth}x${image.naturalHeight}` });
      } else {
        finish(undefined);
      }
    };
    image.onerror = () => finish(undefined);
    image.src = dataUrl;
    if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
      finish({ size: `${image.naturalWidth}x${image.naturalHeight}` });
    }
  });
}

export async function readImageSizeParamsList(
  images: string[],
): Promise<Array<Partial<TaskParams> | undefined>> {
  return Promise.all(images.map((image) => readImageSizeParam(image)));
}

export async function resolveImageSizeParamsList(
  images: string[],
  preferred?: Array<Partial<TaskParams> | undefined>,
): Promise<Array<Partial<TaskParams> | undefined>> {
  if (preferred?.length === images.length && preferred.every(hasActualParams))
    return preferred;
  const fallback = await readImageSizeParamsList(images);
  return images.map((_, index) =>
    hasActualParams(preferred?.[index]) ? preferred?.[index] : fallback[index],
  );
}

export type StoredTaskOutputImages = {
  outputIds: string[];
  outputDataUrls: string[];
  transparentOriginalImageIds?: string[];
};

type DeleteUnreferencedOptions = {
  getReferenceState: () => ImageReferenceState;
};

type PersistStreamPartialOptions = DeleteUnreferencedOptions & {
  getTask: (taskId: string) => TaskRecord | undefined;
  updateTask: (taskId: string, patch: Partial<TaskRecord>) => void;
};

export async function storeTaskOutputImages(
  task: TaskRecord,
  images: string[],
  options: DeleteUnreferencedOptions,
): Promise<StoredTaskOutputImages> {
  const outputIds: string[] = [];
  const outputDataUrls: string[] = [];
  const transparentOriginalImageIds: string[] = [];
  const storedImageIds: string[] = [];

  try {
    for (const dataUrl of images) {
      let outputDataUrl = dataUrl;
      if (task.transparentOutput) {
        const originalImgId = await storeImage(dataUrl, "generated");
        storedImageIds.push(originalImgId);
        cacheImage(originalImgId, dataUrl);

        try {
          outputDataUrl = await removeKeyedBackgroundFromDataUrl(dataUrl);
          transparentOriginalImageIds.push(originalImgId);
        } catch (err) {
          console.warn("透明背景后处理失败，已回退为原始输出", err);
          outputIds.push(originalImgId);
          outputDataUrls.push(dataUrl);
          transparentOriginalImageIds.push("");
          continue;
        }
      }

      const imgId = await storeImage(outputDataUrl, "generated");
      storedImageIds.push(imgId);
      cacheImage(imgId, outputDataUrl);
      outputIds.push(imgId);
      outputDataUrls.push(outputDataUrl);
    }

    return {
      outputIds,
      outputDataUrls,
      transparentOriginalImageIds: transparentOriginalImageIds.length
        ? transparentOriginalImageIds
        : undefined,
    };
  } catch (err) {
    await deleteUnreferencedImageIds(storedImageIds, options);
    throw err;
  }
}

export async function deleteUnreferencedImageIds(
  imageIds: Iterable<string>,
  options: DeleteUnreferencedOptions,
) {
  const candidates = Array.from(new Set(Array.from(imageIds).filter(Boolean)));
  if (candidates.length === 0) return;

  const stillUsed = collectStateReferencedImageIds(options.getReferenceState());

  for (const imgId of candidates) {
    if (stillUsed.has(imgId)) continue;
    await deleteImage(imgId);
    deleteImageCacheEntry(imgId);
  }
}

export async function persistTaskStreamPartialImage(
  taskId: string,
  dataUrl: string,
  options: PersistStreamPartialOptions,
) {
  try {
    const imgId = await storeImage(dataUrl, "generated");
    cacheImage(imgId, dataUrl);

    const latestTask = options.getTask(taskId);
    if (!latestTask || latestTask.status === "done") {
      await deleteUnreferencedImageIds([imgId], options);
      return;
    }

    const currentIds = latestTask.streamPartialImageIds || [];
    if (currentIds.includes(imgId)) return;
    options.updateTask(taskId, {
      streamPartialImageIds: [...currentIds, imgId],
    });
  } catch (err) {
    console.error(err);
  }
}
