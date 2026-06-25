import { useEffect, useMemo, useRef, useState } from 'react'
import { getAllVideoRecords, putVideoRecord, deleteVideoRecord, clearVideoRecords } from '../../lib/storage/db'
import { getVideoApiProfile } from '../../lib/api/apiProfiles'
import {
  createVideoConfigFromProfile,
  createVideoGenerationTask,
  pollVideoGenerationTask,
  type VideoGenerationConfig,
} from '../../lib/video/videoApi'
import {
  getSupportedVideoSeconds,
  getVideoModelPreset,
  normalizeVideoSecondsForPreset,
  normalizeVideoSizeForModel,
} from '../../lib/video/videoModels'
import { copyTextToClipboard, getClipboardFailureMessage } from '../../lib/ui/clipboard'
import {
  MAX_POLL_ATTEMPTS,
  POLL_INTERVAL_MS,
  delay,
  formatBytes,
  isAbortError,
  newId,
  readFileAsDataUrl,
  sizeOptions,
  stripTransientVideoUrl,
  type MediaAsset,
} from '../../lib/video/videoWorkspaceUtils'
import { useStore } from '../../store'
import type { VideoGenerationRecord } from '../../types'
import { VideoComposePanel } from './VideoComposePanel'
import { VideoHistoryPanel } from './VideoHistoryPanel'
import { VideoResultPanel } from './VideoResultPanel'

type QueueItem = VideoGenerationRecord & {
  references: string[]
}

export default function VideoWorkspace() {
  const settings = useStore((s) => s.settings)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const showToast = useStore((s) => s.showToast)
  const activeProfile = useMemo(() => getVideoApiProfile(settings), [settings])
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState(() => activeProfile.model)
  const [size, setSize] = useState('1280x720')
  const [resolution, setResolution] = useState('720p')
  const [seconds, setSeconds] = useState('6')
  const [references, setReferences] = useState<string[]>([])
  const [videoReferences, setVideoReferences] = useState<MediaAsset[]>([])
  const [audioReferences, setAudioReferences] = useState<MediaAsset[]>([])
  const [records, setRecords] = useState<VideoGenerationRecord[]>([])
  const [activeRecordId, setActiveRecordId] = useState<string | null>(null)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [libraryFilter, setLibraryFilter] = useState<'all' | 'video'>('all')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)
  const audioInputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const queueRef = useRef<QueueItem[]>([])
  const startedAtRef = useRef(0)

  const modelPreset = useMemo(() => getVideoModelPreset(model), [model])
  const supportedSizes = modelPreset.supportedSizes ?? sizeOptions.map((item) => item.value)
  const supportedSeconds = useMemo(() => getSupportedVideoSeconds(model), [model])
  const availableSizeOptions = useMemo(
    () => sizeOptions.filter((item) => supportedSizes.includes(item.value)),
    [supportedSizes],
  )
  const selectedSize = sizeOptions.find((item) => item.value === size) ?? sizeOptions[0]
  const [width, height] = selectedSize.value.split('x')
  const activeRecord = records.find((item) => item.id === activeRecordId) ?? records[0] ?? null
  const visibleRecords = libraryFilter === 'video'
    ? records.filter((item) => item.status === 'success' && item.video)
    : records
  const hasRunningTask = Boolean(runningId)
  const config = useMemo(() => createVideoConfigFromProfile(activeProfile, {
    model,
    size,
    resolution,
    seconds,
  }), [activeProfile, model, resolution, seconds, size])
  const canSubmit = Boolean(prompt.trim()) && Boolean(model.trim())

  useEffect(() => {
    let cancelled = false
    void getAllVideoRecords()
      .then((items) => {
        if (cancelled) return
        const sorted = items
          .map((item) => item.status === 'running' ? { ...item, status: 'failed' as const, error: '上次生成被中断，请重新生成。' } : item)
          .sort((a, b) => b.createdAt - a.createdAt)
        setRecords(sorted)
        setActiveRecordId((current) => current ?? sorted[0]?.id ?? null)
      })
      .catch(() => showToast('视频记录读取失败', 'error'))
    return () => {
      cancelled = true
    }
  }, [showToast])

  useEffect(() => {
    setModel((current) => current.trim() ? current : activeProfile.model)
  }, [activeProfile.model])

  useEffect(() => {
    setSize((current) => normalizeVideoSizeForModel(model, current))
    setSeconds((current) => normalizeVideoSecondsForPreset(model, current))
  }, [model])

  useEffect(() => {
    if (!hasRunningTask) return
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.max(0, Math.floor((performance.now() - startedAtRef.current) / 1000)))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [hasRunningTask])

  useEffect(() => () => {
    abortRef.current?.abort()
    for (const item of [...videoReferences, ...audioReferences]) URL.revokeObjectURL(item.url)
  }, [audioReferences, videoReferences])

  const runtimeConfig = (record: VideoGenerationRecord): VideoGenerationConfig => ({
    ...record.config,
    apiKey: activeProfile.apiKey,
  })

  const persistRecord = async (record: VideoGenerationRecord) => {
    await putVideoRecord(stripTransientVideoUrl(record))
  }

  const updateRecord = (id: string, patch: Partial<VideoGenerationRecord>) => {
    setRecords((items) => {
      const next = items.map((item) => item.id === id ? { ...item, ...patch } : item)
      const updated = next.find((item) => item.id === id)
      if (updated) void persistRecord(updated)
      return next
    })
  }

  const createRecord = (status: VideoGenerationRecord['status']): VideoGenerationRecord => ({
    id: newId(),
    createdAt: Date.now(),
    prompt: prompt.trim(),
    model: model.trim(),
    config: {
      baseUrl: config.baseUrl,
      model: config.model,
      size: config.size,
      resolution: config.resolution,
      seconds: config.seconds,
    },
    status,
  })

  const submit = () => {
    if (!prompt.trim()) {
      showToast('请输入视频提示词', 'error')
      return
    }
    if (!activeProfile.baseUrl.trim() || !activeProfile.apiKey.trim()) {
      setShowSettings(true, 'api')
      showToast('请先完善视频 API 配置', 'error')
      return
    }

    const record = createRecord(hasRunningTask ? 'queued' : 'running')
    setRecords((items) => [record, ...items])
    setActiveRecordId(record.id)
    void persistRecord(record)

    const item: QueueItem = { ...record, references: [...references] }
    if (hasRunningTask) {
      queueRef.current.push(item)
      showToast('已加入视频生成队列', 'success')
      return
    }
    void runQueueItem(item)
  }

  const runQueueItem = async (item: QueueItem) => {
    const controller = new AbortController()
    abortRef.current = controller
    startedAtRef.current = performance.now()
    setRunningId(item.id)
    setElapsedSeconds(0)
    updateRecord(item.id, { status: 'running', error: undefined })

    try {
      const task = await createVideoGenerationTask(runtimeConfig(item), item.prompt, item.references, { signal: controller.signal })
      updateRecord(item.id, { task })
      for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
        const state = await pollVideoGenerationTask(runtimeConfig(item), task, { signal: controller.signal })
        if (state.status === 'completed') {
          updateRecord(item.id, {
            status: 'success',
            video: {
              dataUrl: state.video.dataUrl,
              remoteUrl: state.video.url?.startsWith('http') ? state.video.url : undefined,
              mimeType: state.video.mimeType,
              bytes: state.video.bytes,
            },
          })
          showToast('视频生成完成', 'success')
          return
        }
        if (state.status === 'failed') throw new Error(state.error)
        await delay(POLL_INTERVAL_MS, controller.signal)
      }
      throw new Error('视频生成超时，请稍后重试。')
    } catch (error) {
      if (isAbortError(error)) {
        updateRecord(item.id, { status: 'cancelled', error: '已取消生成。' })
        showToast('已取消当前视频生成', 'info')
      } else {
        const message = error instanceof Error ? error.message : '视频生成失败，请稍后重试。'
        updateRecord(item.id, { status: 'failed', error: message })
        showToast(message, 'error')
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setRunningId(null)
      startedAtRef.current = 0
      const next = queueRef.current.shift()
      if (next) void runQueueItem(next)
    }
  }

  const cancelCurrent = () => {
    abortRef.current?.abort()
  }

  const reuseRecord = (record: VideoGenerationRecord) => {
    setPrompt(record.prompt)
    setModel(record.model)
    setSize(record.config.size)
    setResolution(record.config.resolution)
    setSeconds(record.config.seconds)
    setActiveRecordId(record.id)
    showToast('已复用这条记录的参数', 'success')
  }

  const retryRecord = (record: VideoGenerationRecord) => {
    reuseRecord(record)
    const retryItem: QueueItem = {
      ...record,
      id: newId(),
      createdAt: Date.now(),
      status: hasRunningTask ? 'queued' : 'running',
      error: undefined,
      task: undefined,
      video: undefined,
      references: [],
    }
    setRecords((items) => [retryItem, ...items])
    setActiveRecordId(retryItem.id)
    void persistRecord(retryItem)
    if (hasRunningTask) queueRef.current.push(retryItem)
    else void runQueueItem(retryItem)
  }

  const removeRecord = async (id: string) => {
    queueRef.current = queueRef.current.filter((item) => item.id !== id)
    setRecords((items) => items.filter((item) => item.id !== id))
    if (activeRecordId === id) setActiveRecordId(null)
    await deleteVideoRecord(id)
  }

  const clearAllRecords = async () => {
    queueRef.current = []
    setRecords([])
    setActiveRecordId(null)
    await clearVideoRecords()
  }

  const clearSession = () => {
    setPrompt('')
    setReferences([])
    setVideoReferences((items) => {
      items.forEach((item) => URL.revokeObjectURL(item.url))
      return []
    })
    setAudioReferences((items) => {
      items.forEach((item) => URL.revokeObjectURL(item.url))
      return []
    })
    setActiveRecordId(null)
    setElapsedSeconds(0)
  }

  const copyPrompt = async (record: VideoGenerationRecord) => {
    try {
      await copyTextToClipboard(record.prompt)
      showToast('提示词已复制', 'success')
    } catch (error) {
      showToast(getClipboardFailureMessage('复制提示词失败', error), 'error')
    }
  }

  const downloadVideo = (record: VideoGenerationRecord) => {
    const url = record.video?.dataUrl || record.video?.remoteUrl
    if (!url) return
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `video-${new Date(record.createdAt).toISOString().slice(0, 10)}.mp4`
    anchor.click()
  }

  const addReferences = async (files: FileList | null) => {
    const selected = Array.from(files ?? []).filter((file) => file.type.startsWith('image/'))
    if (!selected.length) {
      showToast('请上传图片作为参考图', 'info')
      return
    }
    const next = await Promise.all(selected.slice(0, 9 - references.length).map(readFileAsDataUrl))
    setReferences((items) => [...items, ...next].slice(0, 9))
  }

  const addReferencesFromClipboard = async () => {
    try {
      const items = await navigator.clipboard.read()
      const blobs = await Promise.all(items.flatMap((item) => (
        item.types.filter((type) => type.startsWith('image/')).map((type) => item.getType(type))
      )))
      if (!blobs.length) {
        showToast('剪贴板里没有可读取的图片', 'error')
        return
      }
      const files = blobs.map((blob, index) => new File([blob], `clipboard-${index + 1}.png`, { type: blob.type || 'image/png' }))
      const next = await Promise.all(files.slice(0, 9 - references.length).map(readFileAsDataUrl))
      setReferences((items) => [...items, ...next].slice(0, 9))
      showToast(`已读取 ${next.length} 张参考图`, 'success')
    } catch {
      showToast('剪贴板里没有可读取的图片', 'error')
    }
  }

  const addMediaReferences = (files: FileList | null, kind: 'video' | 'audio') => {
    const selected = Array.from(files ?? []).filter((file) => file.type.startsWith(`${kind}/`))
    if (!selected.length) {
      showToast(kind === 'video' ? '请上传视频文件' : '请上传音频文件', 'info')
      return
    }
    const setter = kind === 'video' ? setVideoReferences : setAudioReferences
    setter((items) => {
      const rest = Math.max(0, 3 - items.length)
      const next = selected.slice(0, rest).map((file) => ({
        id: newId(),
        name: file.name,
        url: URL.createObjectURL(file),
        type: file.type,
        bytes: file.size,
      }))
      return [...items, ...next].slice(0, 3)
    })
  }

  return (
    <section className="cy-video-workspace">
      <div className="cy-video-layout">
        <VideoHistoryPanel
          records={records}
          visibleRecords={visibleRecords}
          activeRecord={activeRecord}
          libraryFilter={libraryFilter}
          onFilterChange={setLibraryFilter}
          onNew={clearSession}
          onClearAll={() => void clearAllRecords()}
          onSelect={setActiveRecordId}
          onCopyPrompt={(record) => void copyPrompt(record)}
          onRemove={(id) => void removeRecord(id)}
        />

        <VideoComposePanel
          prompt={prompt}
          model={model}
          size={size}
          resolution={resolution}
          seconds={seconds}
          width={width}
          height={height}
          modelPreset={modelPreset}
          availableSizeOptions={availableSizeOptions}
          supportedSeconds={supportedSeconds}
          references={references}
          videoReferences={videoReferences}
          audioReferences={audioReferences}
          canSubmit={canSubmit}
          hasRunningTask={hasRunningTask}
          setPrompt={setPrompt}
          setModel={setModel}
          setSize={setSize}
          setResolution={setResolution}
          setSeconds={setSeconds}
          setReferences={setReferences}
          setVideoReferences={setVideoReferences}
          setAudioReferences={setAudioReferences}
          onPasteReferenceImages={() => void addReferencesFromClipboard()}
          onUploadReferenceImages={() => fileInputRef.current?.click()}
          onUploadReferenceVideo={() => videoInputRef.current?.click()}
          onUploadReferenceAudio={() => audioInputRef.current?.click()}
          onSubmit={submit}
          onCancelCurrent={cancelCurrent}
        />

        <VideoResultPanel
          activeRecord={activeRecord}
          hasRunningTask={hasRunningTask}
          elapsedSeconds={elapsedSeconds}
          onDownload={downloadVideo}
          onReuse={reuseRecord}
          onRetry={retryRecord}
        />
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          void addReferences(event.target.files)
          event.target.value = ''
        }}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        multiple
        hidden
        onChange={(event) => {
          addMediaReferences(event.target.files, 'video')
          event.target.value = ''
        }}
      />
      <input
        ref={audioInputRef}
        type="file"
        accept="audio/*"
        multiple
        hidden
        onChange={(event) => {
          addMediaReferences(event.target.files, 'audio')
          event.target.value = ''
        }}
      />
    </section>
  )
}
