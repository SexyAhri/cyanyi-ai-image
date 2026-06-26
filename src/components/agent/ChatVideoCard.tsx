import type { VideoGenerationRecord } from '../../types'
import { formatBytes } from '../../lib/video/videoWorkspaceUtils'
import { DownloadIcon } from '../common/icons'

export function ChatVideoCard({
  record,
  index,
  onDownload,
}: {
  record: VideoGenerationRecord
  index: number
  onDownload: (record: VideoGenerationRecord) => void
}) {
  const videoUrl = record.video?.dataUrl || record.video?.remoteUrl || ''
  const canDownload = Boolean(videoUrl)

  return (
    <div className="mt-4 w-full max-w-md overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-white/[0.08] dark:bg-white/[0.03]" onClick={(e) => e.stopPropagation()}>
      <div className="relative aspect-video bg-gray-950">
        {record.status === 'success' && videoUrl ? (
          <video src={videoUrl} className="h-full w-full object-contain" controls preload="metadata" />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-sm text-gray-300">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10">
              <span className="ml-0.5 h-0 w-0 border-y-[8px] border-l-[13px] border-y-transparent border-l-white/80" />
            </span>
            <span>{record.status === 'failed' ? '视频生成失败' : '视频生成中'}</span>
          </div>
        )}
        <span className="absolute left-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur">
          视频 {index + 1}
        </span>
      </div>

      <div className="space-y-3 p-3">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
          <span className="rounded-full bg-gray-100 px-2 py-1 dark:bg-white/[0.06]">{record.model}</span>
          <span className="rounded-full bg-gray-100 px-2 py-1 dark:bg-white/[0.06]">{record.config.seconds}s</span>
          <span className="rounded-full bg-gray-100 px-2 py-1 dark:bg-white/[0.06]">{record.config.size}</span>
          {record.video?.bytes ? <span>{formatBytes(record.video.bytes)}</span> : null}
        </div>

        {record.prompt && (
          <p className="line-clamp-2 text-xs leading-relaxed text-gray-600 dark:text-gray-300">{record.prompt}</p>
        )}

        <div className="flex items-center justify-between gap-3">
          <span className={`text-xs ${
            record.status === 'success'
              ? 'text-emerald-600 dark:text-emerald-400'
              : record.status === 'failed'
                ? 'text-red-500 dark:text-red-400'
                : 'text-blue-500 dark:text-blue-300'
          }`}>
            {record.status === 'success' ? '已生成' : record.status === 'failed' ? '生成失败' : '生成中'}
          </span>
          <button
            type="button"
            disabled={!canDownload}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              canDownload
                ? 'bg-gray-900 text-white hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200'
                : 'cursor-not-allowed bg-gray-100 text-gray-400 dark:bg-white/[0.05] dark:text-gray-600'
            }`}
            onClick={() => onDownload(record)}
          >
            <DownloadIcon className="h-3.5 w-3.5" />
            下载视频
          </button>
        </div>
      </div>
    </div>
  )
}
