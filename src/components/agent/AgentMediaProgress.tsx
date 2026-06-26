import type { TaskRecord, VideoGenerationRecord } from '../../types'

function progressToneClass(status: 'running' | 'done' | 'error') {
  if (status === 'done') return 'bg-emerald-500'
  if (status === 'error') return 'bg-red-500'
  return 'bg-blue-500'
}

function clampProgress(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

export function AgentMediaProgress({
  imageTasks,
  videoRecords,
}: {
  imageTasks: TaskRecord[]
  videoRecords: VideoGenerationRecord[]
}) {
  const totalImages = imageTasks.length
  const doneImages = imageTasks.filter((task) => task.status === 'done').length
  const failedImages = imageTasks.filter((task) => task.status === 'error').length
  const runningImages = imageTasks.filter((task) => task.status === 'running').length
  const totalVideos = videoRecords.length
  const doneVideos = videoRecords.filter((record) => record.status === 'success').length
  const failedVideos = videoRecords.filter((record) => record.status === 'failed' || record.status === 'cancelled').length
  const runningVideos = videoRecords.filter((record) => record.status === 'running' || record.status === 'queued').length
  const total = totalImages + totalVideos
  if (total === 0) return null

  const failed = failedImages + failedVideos
  const done = doneImages + doneVideos
  const running = runningImages + runningVideos
  const status = failed > 0 && running === 0 ? 'error' : done >= total ? 'done' : 'running'
  const videoProgressSum = videoRecords.reduce((sum, record) => {
    if (record.status === 'success') return sum + 100
    if (record.status === 'failed' || record.status === 'cancelled') return sum
    return sum + clampProgress(record.status === 'queued' ? 0 : (record.progress ?? 8))
  }, 0)
  const percent = Math.max(6, clampProgress((doneImages * 100 + videoProgressSum) / total))
  const detail = [
    totalImages ? `图片 ${doneImages}/${totalImages}${runningImages ? ' 生成中' : ''}${failedImages ? ` 失败 ${failedImages}` : ''}` : '',
    totalVideos ? `视频 ${doneVideos}/${totalVideos}${runningVideos ? ' 生成中' : ''}${failedVideos ? ` 失败 ${failedVideos}` : ''}` : '',
  ].filter(Boolean).join(' · ')

  return (
    <div className="mb-3 rounded-xl border border-blue-100 bg-blue-50/60 px-3 py-2 text-xs text-blue-800 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-100">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <span className="font-medium">
          {status === 'done' ? '媒体生成完成' : status === 'error' ? '媒体生成有失败项' : '媒体生成中'}
        </span>
        <span className="text-[11px] opacity-75">{status === 'running' ? `${percent}%` : `${done}/${total}`}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/80 dark:bg-black/20">
        <div
          className={`h-full rounded-full transition-all duration-500 ${progressToneClass(status)}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="mt-1.5 text-[11px] leading-4 opacity-75">{detail}</div>
    </div>
  )
}
