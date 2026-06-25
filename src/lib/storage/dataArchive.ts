import type {
  AgentConversation,
  CreativeNegativePreset,
  CreativeStylePreset,
  CreativeSubjectProfile,
  ExportData,
  FavoriteCollection,
  PromptTemplate,
  StoredImage,
  StoredImageThumbnail,
  TaskRecord,
} from "../../types";
import {
  mergeImportedAgentConversations,
  normalizeAgentConversations,
} from "../agent/agentConversationStorage";
import { isEmptyAgentConversation } from "../agent/agentConversationLifecycle";
import {
  ensureDefaultFavoriteCollection,
  normalizeFavoriteCollections,
  normalizeLoadedFavoriteState,
  resolveDefaultFavoriteCollectionId,
} from "./favoriteCollections";
import {
  normalizeCreativeNegativePresets,
  normalizeCreativeStylePresets,
  normalizeCreativeSubjectProfiles,
  normalizePromptTemplates,
} from "../creative/creativeAssets";
import { putImage, putImageThumbnail } from "./db";
import { strToU8 } from "fflate";

export type ZipFiles = Record<string, Uint8Array | [Uint8Array, { mtime: Date }]>;

export function dataUrlToBytes(
  dataUrl: string,
  fallbackExt = "bin",
): { ext: string; bytes: Uint8Array } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return { ext: fallbackExt, bytes: new Uint8Array() };

  const [, mime, b64] = match;
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { ext: mimeToExt(mime, fallbackExt), bytes };
}

export function bytesToDataUrl(
  bytes: Uint8Array,
  filePath: string,
  fallbackMime = "application/octet-stream",
): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const mime = extToMime(ext, fallbackMime);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

export function mimeToExt(mime: string | undefined, fallbackExt = "bin") {
  if (!mime) return fallbackExt;
  if (mime === "image/jpeg") return "jpg";
  if (mime === "video/quicktime") return "mov";
  return mime.split("/")[1]?.split("+")[0] || fallbackExt;
}

export function extToMime(
  ext: string,
  fallbackMime = "application/octet-stream",
) {
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    avif: "image/avif",
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    qt: "video/quicktime",
  };
  return map[ext] ?? fallbackMime;
}

export function formatExportFileTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

export function getImageCreatedAtFallbacks(tasks: TaskRecord[]) {
  const imageCreatedAtFallback = new Map<string, number>();
  for (const task of tasks) {
    for (const id of [
      ...(task.inputImageIds || []),
      ...(task.maskImageId ? [task.maskImageId] : []),
      ...(task.outputImages || []),
      ...(task.transparentOriginalImages || []),
      ...(task.streamPartialImageIds || []),
    ]) {
      if (!id) continue;
      const prev = imageCreatedAtFallback.get(id);
      if (prev == null || task.createdAt < prev) {
        imageCreatedAtFallback.set(id, task.createdAt);
      }
    }
  }
  return imageCreatedAtFallback;
}

export function addImageToArchive(
  img: StoredImage,
  zipFiles: ZipFiles,
  imageFiles: NonNullable<ExportData["imageFiles"]>,
  createdAt: number,
) {
  const { ext, bytes } = dataUrlToBytes(img.dataUrl, "png");
  const path = `images/${img.id}.${ext}`;
  imageFiles[img.id] = {
    path,
    createdAt,
    source: img.source,
    width: img.width,
    height: img.height,
  };
  zipFiles[path] = [bytes, { mtime: new Date(createdAt) }];
}

export function addThumbnailToArchive(
  imageId: string,
  thumbnail: StoredImageThumbnail,
  zipFiles: ZipFiles,
  imageFiles: NonNullable<ExportData["imageFiles"]>,
  thumbnailFiles: NonNullable<ExportData["thumbnailFiles"]>,
  createdAt: number,
) {
  const { ext: thumbnailExt, bytes: thumbnailBytes } = dataUrlToBytes(
    thumbnail.thumbnailDataUrl,
    "png",
  );
  const thumbnailPath = `thumbnails/${imageId}.${thumbnailExt}`;
  imageFiles[imageId].width = imageFiles[imageId].width ?? thumbnail.width;
  imageFiles[imageId].height = imageFiles[imageId].height ?? thumbnail.height;
  thumbnailFiles[imageId] = {
    path: thumbnailPath,
    width: thumbnail.width,
    height: thumbnail.height,
    thumbnailVersion: thumbnail.thumbnailVersion,
  };
  zipFiles[thumbnailPath] = [
    thumbnailBytes,
    { mtime: new Date(createdAt) },
  ];
}

export function addTaskMetadataToArchive(task: TaskRecord, zipFiles: ZipFiles) {
  const metadata = {
    id: task.id,
    createdAt: new Date(task.createdAt).toISOString(),
    prompt: task.prompt,
    params: task.params,
    actualParams: task.actualParams,
    apiProvider: task.apiProvider,
    apiProfileName: task.apiProfileName,
    apiMode: task.apiMode,
    apiModel: task.apiModel,
    inputImageIds: task.inputImageIds,
    outputImages: task.outputImages,
    rawImageUrls: task.rawImageUrls,
    revisedPromptByImage: task.revisedPromptByImage,
    tags: task.tags,
    note: task.note,
    seriesBatchId: task.seriesBatchId,
    seriesBatchLabel: task.seriesBatchLabel,
    comparedWithTaskIds: task.comparedWithTaskIds,
  };
  zipFiles[`metadata/task-${task.id}.json`] = [
    strToU8(JSON.stringify(metadata, null, 2)),
    { mtime: new Date(task.createdAt) },
  ];
}

export async function importImagesFromArchive(
  data: ExportData,
  unzipped: Record<string, Uint8Array>,
  options: {
    cacheImage: (id: string, dataUrl: string) => void;
    cacheThumbnail: (
      id: string,
      thumbnail: {
        dataUrl: string;
        width?: number;
        height?: number;
        thumbnailVersion?: number;
      },
    ) => void;
  },
) {
  const importedImageIds: string[] = [];

  for (const [id, info] of Object.entries(data.imageFiles ?? {})) {
    const bytes = unzipped[info.path];
    if (!bytes) continue;
    const dataUrl = bytesToDataUrl(bytes, info.path, "image/png");
    await putImage({
      id,
      dataUrl,
      createdAt: info.createdAt,
      source: info.source,
      width: info.width,
      height: info.height,
    });
    options.cacheImage(id, dataUrl);
    importedImageIds.push(id);
  }

  for (const [id, info] of Object.entries(data.thumbnailFiles ?? {})) {
    const bytes = unzipped[info.path];
    if (!bytes) continue;
    const thumbnailDataUrl = bytesToDataUrl(bytes, info.path, "image/png");
    await putImageThumbnail({
      id,
      thumbnailDataUrl,
      width: info.width,
      height: info.height,
      thumbnailVersion: info.thumbnailVersion,
    });
    options.cacheThumbnail(id, {
      dataUrl: thumbnailDataUrl,
      width: info.width,
      height: info.height,
      thumbnailVersion: info.thumbnailVersion,
    });
  }

  return importedImageIds;
}

export function mergeImportedFavoriteState(
  tasks: TaskRecord[],
  currentCollections: FavoriteCollection[],
  currentDefaultFavoriteCollectionId: string | null,
  data: ExportData,
) {
  const importedCollections = normalizeFavoriteCollections(
    data.favoriteCollections,
  );
  const favoriteCollections = importedCollections.length
    ? ensureDefaultFavoriteCollection(
        normalizeFavoriteCollections([
          ...currentCollections,
          ...importedCollections,
        ]),
      )
    : currentCollections;
  const defaultFavoriteCollectionId = importedCollections.length
    ? resolveDefaultFavoriteCollectionId(
        favoriteCollections,
        data.defaultFavoriteCollectionId,
      )
    : currentDefaultFavoriteCollectionId;
  return normalizeLoadedFavoriteState(
    tasks,
    favoriteCollections,
    defaultFavoriteCollectionId,
  );
}

export function mergeImportedAgentConversationState(
  currentConversations: AgentConversation[],
  currentActiveConversationId: string | null,
  data: ExportData,
) {
  const importedAgentConversations = normalizeAgentConversations(
    data.agentConversations,
  ).filter((conversation) => !isEmptyAgentConversation(conversation));
  const agentConversations = mergeImportedAgentConversations(
    currentConversations,
    importedAgentConversations,
  );
  const activeAgentConversationId =
    currentActiveConversationId &&
    agentConversations.some(
      (conversation) => conversation.id === currentActiveConversationId,
    )
      ? currentActiveConversationId
      : (importedAgentConversations[0]?.id ??
        agentConversations[0]?.id ??
        null);
  return { agentConversations, activeAgentConversationId };
}

export function mergeImportedPromptTemplates(
  current: PromptTemplate[],
  imported: PromptTemplate[] | undefined,
) {
  return normalizePromptTemplates([...current, ...(imported ?? [])]);
}

export function mergeImportedCreativeAssets(
  current: {
    creativeStylePresets: CreativeStylePreset[];
    creativeSubjectProfiles: CreativeSubjectProfile[];
    creativeNegativePresets: CreativeNegativePreset[];
  },
  data: ExportData,
) {
  return {
    creativeStylePresets: normalizeCreativeStylePresets([
      ...current.creativeStylePresets,
      ...(data.creativeStylePresets ?? []),
    ]),
    creativeSubjectProfiles: normalizeCreativeSubjectProfiles([
      ...current.creativeSubjectProfiles,
      ...(data.creativeSubjectProfiles ?? []),
    ]),
    creativeNegativePresets: normalizeCreativeNegativePresets([
      ...current.creativeNegativePresets,
      ...(data.creativeNegativePresets ?? []),
    ]),
  };
}
