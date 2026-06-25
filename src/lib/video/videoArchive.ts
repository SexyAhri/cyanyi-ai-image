import type { ExportData, VideoGenerationRecord } from "../../types";
import { bytesToDataUrl, dataUrlToBytes } from "../storage/dataArchive";
import { putVideoRecord } from "../storage/db";

type ZipFiles = Record<string, Uint8Array | [Uint8Array, { mtime: Date }]>;

export function addVideoRecordsToArchive(
  videoRecords: VideoGenerationRecord[],
  zipFiles: ZipFiles,
): NonNullable<ExportData["videoFiles"]> {
  const videoFiles: NonNullable<ExportData["videoFiles"]> = {};

  for (const record of videoRecords) {
    const videoDataUrl = record.video?.dataUrl;
    if (!videoDataUrl) continue;
    const { ext, bytes } = dataUrlToBytes(videoDataUrl);
    const path = `videos/${record.id}.${ext}`;
    videoFiles[record.id] = {
      path,
      mimeType: record.video?.mimeType,
      bytes: record.video?.bytes ?? bytes.byteLength,
      createdAt: record.createdAt,
    };
    zipFiles[path] = [bytes, { mtime: new Date(record.createdAt) }];
  }

  return videoFiles;
}

export function stripVideoRecordPayloads(
  videoRecords: VideoGenerationRecord[],
): VideoGenerationRecord[] {
  return videoRecords.map((record) =>
    record.video?.dataUrl
      ? { ...record, video: { ...record.video, dataUrl: undefined } }
      : record,
  );
}

export async function importVideoRecordsFromArchive(
  videoRecords: VideoGenerationRecord[] | undefined,
  videoFiles: ExportData["videoFiles"] | undefined,
  unzipped: Record<string, Uint8Array>,
) {
  for (const record of videoRecords ?? []) {
    const videoFile = videoFiles?.[record.id];
    const videoBytes = videoFile ? unzipped[videoFile.path] : undefined;
    await putVideoRecord({
      ...record,
      video: record.video
        ? {
            ...record.video,
            dataUrl:
              record.video.dataUrl ??
              (videoBytes && videoFile
                ? bytesToDataUrl(videoBytes, videoFile.path, "video/mp4")
                : undefined),
            mimeType: record.video.mimeType || videoFile?.mimeType || "video/mp4",
            bytes:
              record.video.bytes ||
              videoFile?.bytes ||
              videoBytes?.byteLength ||
              0,
          }
        : undefined,
    });
  }
}
