import type { StoreApi } from "zustand/vanilla";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import type { AppState } from "../types";
import type { ExportData, InputImage, TaskRecord } from "../../types";
import { DEFAULT_PARAMS } from "../../types";
import {
  DEFAULT_SETTINGS,
  mergeImportedSettings,
} from "../../lib/api/apiProfiles";
import {
  clearAgentConversations as dbClearAgentConversations,
  clearImages,
  clearTasks as dbClearTasks,
  clearVideoRecords,
  getAllImages,
  getAllTasks,
  getAllVideoRecords,
  getImageThumbnail,
  storeImage,
} from "../../lib/storage/db";
import {
  cacheImage,
  cacheThumbnail,
  clearImageCaches,
  scheduleThumbnailBackfill,
} from "../../lib/storage/imageCache";
import {
  normalizeCreativeNegativePresets,
  normalizeCreativeStylePresets,
  normalizeCreativeSubjectProfiles,
} from "../../lib/creative/creativeAssets";
import {
  addVideoRecordsToArchive,
  importVideoRecordsFromArchive,
  stripVideoRecordPayloads,
} from "../../lib/video/videoArchive";
import {
  addImageToArchive,
  addTaskMetadataToArchive,
  addThumbnailToArchive,
  formatExportFileTime,
  getImageCreatedAtFallbacks,
  importImagesFromArchive,
  mergeImportedAgentConversationState,
  mergeImportedCreativeAssets,
  mergeImportedFavoriteState,
  mergeImportedPromptTemplates,
  type ZipFiles,
} from "../../lib/storage/dataArchive";
import { getPersistableAgentConversations } from "../../lib/agent/agentConversationStorage";

export interface ClearOptions {
  clearConfig?: boolean;
  clearTasks?: boolean;
}

export interface ExportOptions {
  exportConfig?: boolean;
  exportTasks?: boolean;
}

export interface ImportOptions {
  importConfig?: boolean;
  importTasks?: boolean;
}

type DataLifecycleStore = Pick<StoreApi<AppState>, "getState" | "setState">;

type DataLifecycleDependencies = {
  store: DataLifecycleStore;
  putTask: (task: TaskRecord) => Promise<IDBValidKey>;
  replaceStoredAgentConversations: (
    conversations: AppState["agentConversations"],
  ) => Promise<void>;
  skipSupportPromptForImportedData: (tasks: TaskRecord[]) => void;
};

export async function clearDataAction(
  { store }: DataLifecycleDependencies,
  options: ClearOptions = { clearConfig: true, clearTasks: true },
) {
  const {
    setTasks,
    clearInputImages,
    clearMaskDraft,
    setSettings,
    setParams,
    showToast,
  } = store.getState();

  if (options.clearTasks) {
    await dbClearTasks();
    await clearVideoRecords();
    await dbClearAgentConversations();
    await clearImages();
    clearImageCaches();
    setTasks([]);
    store.setState({
      agentConversations: [],
      activeAgentConversationId: null,
      seriesReferenceImage: null,
      seriesReferenceHistory: [],
      seriesReferenceSlots: { person: null, product: null, style: null },
      supportPromptOpen: false,
      supportPromptSkippedForImportedData: false,
    });
    clearInputImages();
    clearMaskDraft();
  }

  if (options.clearConfig) {
    store.setState({
      dismissedCodexCliPrompts: [],
      supportPromptDismissed: false,
      creativeStylePresets: normalizeCreativeStylePresets(undefined),
      creativeSubjectProfiles: normalizeCreativeSubjectProfiles(undefined),
      creativeNegativePresets: normalizeCreativeNegativePresets(undefined),
    });
    setSettings({ ...DEFAULT_SETTINGS });
    setParams({ ...DEFAULT_PARAMS });
  }

  showToast("所选数据已清空", "success");
}

export async function exportDataAction(
  { store }: DataLifecycleDependencies,
  options: ExportOptions = { exportConfig: true, exportTasks: true },
) {
  try {
    const tasks = options.exportTasks ? await getAllTasks() : [];
    const images = options.exportTasks ? await getAllImages() : [];
    const videoRecords = options.exportTasks ? await getAllVideoRecords() : [];
    const {
      settings,
      agentConversations,
      favoriteCollections,
      defaultFavoriteCollectionId,
      promptTemplates,
      creativeStylePresets,
      creativeSubjectProfiles,
      creativeNegativePresets,
    } = store.getState();
    const exportedAt = Date.now();
    const imageCreatedAtFallback = options.exportTasks
      ? getImageCreatedAtFallbacks(tasks)
      : new Map<string, number>();

    const imageFiles: ExportData["imageFiles"] = {};
    const thumbnailFiles: NonNullable<ExportData["thumbnailFiles"]> = {};
    const zipFiles: ZipFiles = {};

    if (options.exportTasks) {
      for (const img of images) {
        const createdAt =
          img.createdAt ?? imageCreatedAtFallback.get(img.id) ?? exportedAt;
        addImageToArchive(img, zipFiles, imageFiles, createdAt);

        const thumbnail = await getImageThumbnail(img.id);
        if (thumbnail?.thumbnailDataUrl) {
          addThumbnailToArchive(
            img.id,
            thumbnail,
            zipFiles,
            imageFiles,
            thumbnailFiles,
            createdAt,
          );
          cacheThumbnail(img.id, {
            dataUrl: thumbnail.thumbnailDataUrl,
            width: thumbnail.width,
            height: thumbnail.height,
            thumbnailVersion: thumbnail.thumbnailVersion,
          });
        }
      }

      for (const task of tasks) {
        addTaskMetadataToArchive(task, zipFiles);
      }
    }
    const videoFiles = options.exportTasks
      ? addVideoRecordsToArchive(videoRecords, zipFiles)
      : {};

    const manifest: ExportData = {
      version: 3,
      exportedAt: new Date(exportedAt).toISOString(),
    };

    if (options.exportConfig) {
      manifest.settings = settings;
      manifest.promptTemplates = promptTemplates;
      manifest.creativeStylePresets = creativeStylePresets;
      manifest.creativeSubjectProfiles = creativeSubjectProfiles;
      manifest.creativeNegativePresets = creativeNegativePresets;
    }
    if (options.exportTasks) {
      manifest.tasks = tasks;
      manifest.videoRecords = stripVideoRecordPayloads(videoRecords);
      manifest.favoriteCollections = favoriteCollections;
      manifest.defaultFavoriteCollectionId = defaultFavoriteCollectionId;
      manifest.agentConversations =
        getPersistableAgentConversations(agentConversations);
      manifest.imageFiles = imageFiles;
      manifest.thumbnailFiles = thumbnailFiles;
      manifest.videoFiles = videoFiles;
    }

    zipFiles["manifest.json"] = [
      strToU8(JSON.stringify(manifest, null, 2)),
      { mtime: new Date(exportedAt) },
    ];

    const zipped = zipSync(zipFiles, { level: 6 });
    const blob = new Blob([zipped.buffer as ArrayBuffer], {
      type: "application/zip",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gpt-image-playground-backup_${formatExportFileTime(new Date(exportedAt))}.zip`;
    a.click();
    URL.revokeObjectURL(url);
    store.getState().showToast("数据已导出", "success");
  } catch (e) {
    store
      .getState()
      .showToast(
        `导出失败：${e instanceof Error ? e.message : String(e)}`,
        "error",
      );
  }
}

export async function importDataAction(
  {
    store,
    putTask,
    replaceStoredAgentConversations,
    skipSupportPromptForImportedData,
  }: DataLifecycleDependencies,
  file: File,
  options: ImportOptions = { importConfig: true, importTasks: true },
): Promise<boolean> {
  try {
    const buffer = await file.arrayBuffer();
    const unzipped = unzipSync(new Uint8Array(buffer));

    const manifestBytes = unzipped["manifest.json"];
    if (!manifestBytes) throw new Error("ZIP 中缺少 manifest.json");

    const data: ExportData = JSON.parse(strFromU8(manifestBytes));

    if (options.importTasks && (data.tasks || data.videoRecords)) {
      const importedImageIds = await importImagesFromArchive(data, unzipped, {
        cacheImage,
        cacheThumbnail,
      });

      for (const task of data.tasks ?? []) {
        await putTask(task);
      }

      await importVideoRecordsFromArchive(
        data.videoRecords,
        data.videoFiles,
        unzipped,
      );

      const tasks = await getAllTasks();
      const state = store.getState();
      const normalizedFavorites = mergeImportedFavoriteState(
        tasks,
        state.favoriteCollections,
        state.defaultFavoriteCollectionId,
        data,
      );
      store.setState({
        tasks: normalizedFavorites.tasks,
        favoriteCollections: normalizedFavorites.collections,
        defaultFavoriteCollectionId:
          normalizedFavorites.defaultFavoriteCollectionId,
      });
      if (normalizedFavorites.changed)
        await Promise.all(
          normalizedFavorites.tasks.map((task) => putTask(task)),
        );
      store.setState((state) =>
        mergeImportedAgentConversationState(
          state.agentConversations,
          state.activeAgentConversationId,
          data,
        ),
      );
      await replaceStoredAgentConversations(
        store.getState().agentConversations,
      );
      skipSupportPromptForImportedData(tasks);
      scheduleThumbnailBackfill(importedImageIds);
    }

    if (options.importConfig && data.settings) {
      const state = store.getState();
      state.setSettings(mergeImportedSettings(state.settings, data.settings));
    }

    if (options.importConfig && data.promptTemplates) {
      const state = store.getState();
      store.setState({
        promptTemplates: mergeImportedPromptTemplates(
          state.promptTemplates,
          data.promptTemplates,
        ),
      });
    }

    if (
      options.importConfig &&
      (data.creativeStylePresets ||
        data.creativeSubjectProfiles ||
        data.creativeNegativePresets)
    ) {
      const state = store.getState();
      store.setState(mergeImportedCreativeAssets(state, data));
    }

    let msg = "数据已成功导入";
    if (options.importTasks && (data.tasks || data.videoRecords)) {
      const taskCount = data.tasks?.length ?? 0;
      const videoCount = data.videoRecords?.length ?? 0;
      msg = `已导入 ${taskCount} 个图片任务、${videoCount} 条视频记录`;
    } else if (options.importConfig && data.settings) {
      msg = "配置已成功导入";
    }

    store.getState().showToast(msg, "success");
    return true;
  } catch (e) {
    store
      .getState()
      .showToast(
        `导入失败：${e instanceof Error ? e.message : String(e)}`,
        "error",
      );
    return false;
  }
}

export async function addImageFromFileAction(
  { store }: DataLifecycleDependencies,
  file: File,
): Promise<void> {
  const image = await createInputImageFromFileAction(file);
  if (!image) return;
  store.getState().addInputImage(image);
}

export async function createInputImageFromFileAction(
  file: File,
): Promise<InputImage | null> {
  if (!file.type.startsWith("image/")) return null;
  const dataUrl = await fileToDataUrl(file);
  const id = await storeImage(dataUrl, "upload");
  cacheImage(id, dataUrl);
  return { id, dataUrl };
}

export async function addImageFromUrlAction(
  { store }: DataLifecycleDependencies,
  src: string,
): Promise<void> {
  const res = await fetch(src);
  const blob = await res.blob();
  if (!blob.type.startsWith("image/")) throw new Error("不是有效的图片");
  const dataUrl = await blobToDataUrl(blob);
  const id = await storeImage(dataUrl, "upload");
  cacheImage(id, dataUrl);
  store.getState().addInputImage({ id, dataUrl });
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
