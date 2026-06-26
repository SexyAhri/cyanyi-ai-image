import type { VideoGenerationRecord } from '../../types'
import { formatBytes } from '../../lib/video/videoWorkspaceUtils'
import { VideoEmptyIcon } from './VideoMediaDrop'

export function VideoResultPanel({
  activeRecord,
  hasRunningTask,
  elapsedSeconds,
  onDownload,
  onReuse,
  onRetry,
}: {
  activeRecord: VideoGenerationRecord | null
  hasRunningTask: boolean
  elapsedSeconds: number
  onDownload: (record: VideoGenerationRecord) => void
  onReuse: (record: VideoGenerationRecord) => void
  onRetry: (record: VideoGenerationRecord) => void
}) {
  const progress = Math.max(0, Math.min(100, Math.round(
    activeRecord?.status === 'success'
      ? 100
      : activeRecord?.status === 'queued'
        ? 0
        : (activeRecord?.progress ?? 8),
  )))

  return (
    <section className="cy-video-result">
      <div className="cy-video-card-title">
        <span>生成结果</span>
        {hasRunningTask && <strong>生成中 {elapsedSeconds}s</strong>}
      </div>
      {activeRecord?.status === 'success' && activeRecord.video ? (
        <div className="cy-video-preview-card">
          <video src={activeRecord.video.dataUrl || activeRecord.video.remoteUrl} controls />
          <div className="cy-video-preview-meta">
            <span>{formatBytes(activeRecord.video.bytes)}</span>
            <span>{activeRecord.model}</span>
            <button type="button" onClick={() => onDownload(activeRecord)}>下载</button>
            <button type="button" onClick={() => onReuse(activeRecord)}>复用参数</button>
          </div>
        </div>
      ) : activeRecord?.status === 'failed' || activeRecord?.status === 'cancelled' ? (
        <div className="cy-video-failed-card">
          <div className="cy-video-failed-body">
            <strong>{activeRecord.status === 'cancelled' ? '已取消' : '生成失败'}</strong>
            <p>{activeRecord.error || '请检查模型、权限或参数后重试。'}</p>
          </div>
          <div className="cy-video-failed-footer">
            <button type="button" onClick={() => onReuse(activeRecord)}>复用参数</button>
            <button type="button" onClick={() => onRetry(activeRecord)}>重试</button>
          </div>
        </div>
      ) : activeRecord?.status === 'running' || hasRunningTask ? (
        <div className="cy-video-pending">
          <div />
          <span>{activeRecord?.status === 'queued' ? '任务已排队，等待前一个视频完成' : `视频生成中 ${progress}%`}</span>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200/80">
            <div className="h-full rounded-full bg-blue-500 transition-all duration-500" style={{ width: `${Math.max(4, progress)}%` }} />
          </div>
        </div>
      ) : (
        <div className="cy-video-empty">
          <VideoEmptyIcon />
          <span>还没有生成视频</span>
        </div>
      )}
    </section>
  )
}
