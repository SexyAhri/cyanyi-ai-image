import { useEffect, useMemo, useRef, useState } from 'react'
import { getAllVideoRecords, putVideoRecord, deleteVideoRecord, clearVideoRecords } from '../lib/db'
import { getVideoApiProfile } from '../lib/apiProfiles'
import {
  createVideoConfigFromProfile,
  createVideoGenerationTask,
  pollVideoGenerationTask,
  type VideoGenerationConfig,
} from '../lib/videoApi'
import {
  getSupportedVideoSeconds,
  getVideoModelPreset,
  normalizeVideoSecondsForPreset,
  normalizeVideoSizeForModel,
  VIDEO_MODEL_OPTIONS,
} from '../lib/videoModels'
import { copyTextToClipboard, getClipboardFailureMessage } from '../lib/clipboard'
import { useStore } from '../store'
import type { VideoGenerationRecord } from '../types'
import Select from './Select'

type MediaAsset = {
  id: string
  name: string
  url: string
  type: string
  bytes: number
}

type QueueItem = VideoGenerationRecord & {
  references: string[]
}

const POLL_INTERVAL_MS = 2500
const MAX_POLL_ATTEMPTS = 120

const sizeOptions = [
  { label: '横屏', value: '1280x720' },
  { label: '竖屏', value: '720x1280' },
  { label: '方形', value: '1024x1024' },
  { label: '宽屏', value: '1792x1024' },
  { label: '长图', value: '1024x1792' },
]

const resolutionOptions = [
  { label: '720p', value: '720p' },
  { label: '480p', value: '480p' },
  { label: '1080p', value: '1080p' },
]

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
        <aside className="cy-video-history" data-no-drag-select>
          <div className="cy-video-card-title">
            <span>作品库</span>
            <strong>{records.length}</strong>
          </div>
          <div className="cy-video-history-actions">
            <button type="button" onClick={clearSession}>+ 新建</button>
            <button type="button" disabled={!records.length} onClick={() => void clearAllRecords()}>清空记录</button>
          </div>
          <div className="cy-video-history-actions cy-video-filter-actions">
            <button type="button" className={libraryFilter === 'all' ? 'active' : ''} onClick={() => setLibraryFilter('all')}>全部</button>
            <button type="button" className={libraryFilter === 'video' ? 'active' : ''} onClick={() => setLibraryFilter('video')}>仅成片</button>
          </div>
          <div className="cy-video-log-list">
            {visibleRecords.map((record) => (
              <div
                key={record.id}
                className={`cy-video-log${activeRecord?.id === record.id ? ' cy-video-log-active' : ''}`}
              >
                <button type="button" className="cy-video-log-main" onClick={() => setActiveRecordId(record.id)}>
                  <span>{record.prompt || '未命名视频'}</span>
                  <small>{statusLabel(record.status)} · {record.config.size} · {record.config.seconds}s</small>
                </button>
                <button type="button" className="cy-video-log-copy" onClick={() => void copyPrompt(record)}>复制</button>
                <button type="button" className="cy-video-log-copy cy-video-log-delete" onClick={() => void removeRecord(record.id)}>删除</button>
              </div>
            ))}
            {!visibleRecords.length && <div className="cy-video-empty-small">暂无生成记录</div>}
          </div>
        </aside>

        <div className="cy-video-compose">
          <label className="cy-video-field">
            <div className="cy-video-row-title">
              <span>提示词</span>
            </div>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="描述镜头运动、主体动作、场景氛围和画面风格"
            />
          </label>

          <label className="cy-video-field cy-video-model-field">
            <span>模型</span>
            <Select
              value={model}
              onChange={(value) => setModel(String(value))}
              options={VIDEO_MODEL_OPTIONS.map((item) => ({ label: item, value: item }))}
              className="cy-video-select"
            />
          </label>

          {!modelPreset.hasFixedResolution && (
            <div className="cy-video-option-group">
              <span>清晰度</span>
              <div className="cy-video-pills compact">
                {resolutionOptions.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    className={resolution === item.value ? 'active' : ''}
                    onClick={() => setResolution(item.value)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="cy-video-option-group">
            <span>尺寸</span>
            <div className="cy-video-size-values">
              <span>W <strong>{width}</strong></span>
              <em>→</em>
              <span>H <strong>{height}</strong></span>
            </div>
            <div className="cy-video-size-grid">
              {availableSizeOptions.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={size === item.value ? 'active' : ''}
                  onClick={() => setSize(item.value)}
                >
                  <span>{item.label}</span>
                  <small>{item.value}</small>
                </button>
              ))}
            </div>
          </div>

          {!modelPreset.hasFixedSeconds && (
            <label className="cy-video-field cy-video-seconds-field">
              <span>秒数</span>
              <select value={seconds} onChange={(event) => setSeconds(event.target.value)}>
                {supportedSeconds.map((item) => <option key={item} value={item}>{item}s</option>)}
              </select>
            </label>
          )}

          {modelPreset.supportsReferenceImages && (
            <div className="cy-video-option-group">
              <div className="cy-video-row-title">
                <span>参考图</span>
                <div className="cy-video-inline-actions">
                  <button type="button" onClick={() => void addReferencesFromClipboard()}>剪贴板</button>
                  <button type="button" onClick={() => fileInputRef.current?.click()}>上传</button>
                </div>
              </div>
              <div className="cy-video-references">
                {references.map((item, index) => (
                  <div key={item} className="cy-video-reference">
                    <img src={item} alt={`参考图 ${index + 1}`} />
                    <button type="button" onClick={() => setReferences((items) => items.filter((_, i) => i !== index))}>删除</button>
                  </div>
                ))}
                {!references.length && <div className="cy-video-empty-ref">暂无参考图，最多 9 张</div>}
              </div>
            </div>
          )}

          {modelPreset.supportsReferenceVideo && (
            <MediaDrop
              title="参考视频"
              emptyText="暂无参考视频，最多 3 个"
              assets={videoReferences}
              onUpload={() => videoInputRef.current?.click()}
              onRemove={(id) => setVideoReferences((items) => removeMediaAsset(items, id))}
            />
          )}

          {modelPreset.supportsReferenceAudio && (
            <MediaDrop
              title="参考音频"
              emptyText="暂无参考音频，最多 3 个，mp3/wav，单个 15MB 内"
              assets={audioReferences}
              onUpload={() => audioInputRef.current?.click()}
              onRemove={(id) => setAudioReferences((items) => removeMediaAsset(items, id))}
            />
          )}

          <div className="cy-video-submit-row">
            <button type="button" className="cy-video-generate" disabled={!canSubmit} onClick={submit}>
              {hasRunningTask ? '加入队列' : '开始生成视频'}
            </button>
            {hasRunningTask && (
              <button type="button" className="cy-video-cancel" onClick={cancelCurrent}>
                取消当前
              </button>
            )}
          </div>
        </div>

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
                <button type="button" onClick={() => downloadVideo(activeRecord)}>下载</button>
                <button type="button" onClick={() => reuseRecord(activeRecord)}>复用参数</button>
              </div>
            </div>
          ) : activeRecord?.status === 'failed' || activeRecord?.status === 'cancelled' ? (
            <div className="cy-video-failed-card">
              <div className="cy-video-failed-body">
                <strong>{activeRecord.status === 'cancelled' ? '已取消' : '生成失败'}</strong>
                <p>{activeRecord.error || '请检查模型、权限或参数后重试。'}</p>
              </div>
              <div className="cy-video-failed-footer">
                <button type="button" onClick={() => reuseRecord(activeRecord)}>复用参数</button>
                <button type="button" onClick={() => retryRecord(activeRecord)}>重试</button>
              </div>
            </div>
          ) : activeRecord?.status === 'running' || hasRunningTask ? (
            <div className="cy-video-pending">
              <div />
              <span>{activeRecord?.status === 'queued' ? '任务已排队，等待前一个视频完成' : '视频生成中，通常需要几十秒到几分钟'}</span>
            </div>
          ) : (
            <div className="cy-video-empty">
              <VideoEmptyIcon />
              <span>还没有生成视频</span>
            </div>
          )}
        </section>
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

function MediaDrop({
  title,
  emptyText,
  assets,
  onUpload,
  onRemove,
}: {
  title: string
  emptyText: string
  assets: MediaAsset[]
  onUpload: () => void
  onRemove: (id: string) => void
}) {
  return (
    <div className="cy-video-option-group">
      <div className="cy-video-row-title">
        <span>{title}</span>
        <button type="button" onClick={onUpload}>上传</button>
      </div>
      <div className="cy-video-media-drop">
        {assets.map((asset) => (
          <div key={asset.id} className="cy-video-media-item">
            {asset.type.startsWith('video/') ? (
              <video src={asset.url} muted preload="metadata" />
            ) : (
              <div className="cy-video-audio-preview">
                <span>♪</span>
                <audio src={asset.url} controls preload="metadata" />
              </div>
            )}
            <div>
              <span>{asset.name}</span>
              <small>{formatBytes(asset.bytes)}</small>
            </div>
            <button type="button" onClick={() => onRemove(asset.id)}>删除</button>
          </div>
        ))}
        {!assets.length && <span>{emptyText}</span>}
      </div>
    </div>
  )
}

function VideoEmptyIcon() {
  return (
    <svg className="cy-video-empty-icon" viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <path d="M22 22h20a4 4 0 0 1 4 4v12a4 4 0 0 1-4 4H22a4 4 0 0 1-4-4V26a4 4 0 0 1 4-4Z" stroke="currentColor" strokeWidth="4" />
      <path d="m46 29 8-5v16l-8-5V29Z" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" />
    </svg>
  )
}

function stripTransientVideoUrl(record: VideoGenerationRecord): VideoGenerationRecord {
  if (!record.video?.remoteUrl?.startsWith('blob:')) return record
  return {
    ...record,
    video: {
      ...record.video,
      remoteUrl: undefined,
    },
  }
}

function removeMediaAsset(items: MediaAsset[], id: string) {
  const removed = items.find((item) => item.id === id)
  if (removed) URL.revokeObjectURL(removed.url)
  return items.filter((item) => item.id !== id)
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('参考图读取失败'))
    reader.readAsDataURL(file)
  })
}

function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = window.setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      window.clearTimeout(timer)
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    }, { once: true })
  })
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function statusLabel(status: VideoGenerationRecord['status']) {
  if (status === 'success') return '成功'
  if (status === 'failed') return '失败'
  if (status === 'cancelled') return '已取消'
  if (status === 'queued') return '排队中'
  return '生成中'
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`
}
