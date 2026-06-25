import type { Dispatch, SetStateAction } from 'react'
import type { getVideoModelPreset } from '../../lib/video/videoModels'
import { VIDEO_MODEL_OPTIONS } from '../../lib/video/videoModels'
import {
  removeMediaAsset,
  resolutionOptions,
  type MediaAsset,
} from '../../lib/video/videoWorkspaceUtils'
import Select from '../common/Select'
import { VideoMediaDrop } from './VideoMediaDrop'

type VideoModelPreset = ReturnType<typeof getVideoModelPreset>
type VideoOption = { label: string; value: string }

export function VideoComposePanel({
  prompt,
  model,
  size,
  resolution,
  seconds,
  width,
  height,
  modelPreset,
  availableSizeOptions,
  supportedSeconds,
  references,
  videoReferences,
  audioReferences,
  canSubmit,
  hasRunningTask,
  setPrompt,
  setModel,
  setSize,
  setResolution,
  setSeconds,
  setReferences,
  setVideoReferences,
  setAudioReferences,
  onPasteReferenceImages,
  onUploadReferenceImages,
  onUploadReferenceVideo,
  onUploadReferenceAudio,
  onSubmit,
  onCancelCurrent,
}: {
  prompt: string
  model: string
  size: string
  resolution: string
  seconds: string
  width: string
  height: string
  modelPreset: VideoModelPreset
  availableSizeOptions: VideoOption[]
  supportedSeconds: readonly string[]
  references: string[]
  videoReferences: MediaAsset[]
  audioReferences: MediaAsset[]
  canSubmit: boolean
  hasRunningTask: boolean
  setPrompt: (value: string) => void
  setModel: (value: string) => void
  setSize: (value: string) => void
  setResolution: (value: string) => void
  setSeconds: (value: string) => void
  setReferences: Dispatch<SetStateAction<string[]>>
  setVideoReferences: Dispatch<SetStateAction<MediaAsset[]>>
  setAudioReferences: Dispatch<SetStateAction<MediaAsset[]>>
  onPasteReferenceImages: () => void
  onUploadReferenceImages: () => void
  onUploadReferenceVideo: () => void
  onUploadReferenceAudio: () => void
  onSubmit: () => void
  onCancelCurrent: () => void
}) {
  return (
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
              <button type="button" onClick={onPasteReferenceImages}>剪贴板</button>
              <button type="button" onClick={onUploadReferenceImages}>上传</button>
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
        <VideoMediaDrop
          title="参考视频"
          emptyText="暂无参考视频，最多 3 个"
          assets={videoReferences}
          onUpload={onUploadReferenceVideo}
          onRemove={(id) => setVideoReferences((items) => removeMediaAsset(items, id))}
        />
      )}

      {modelPreset.supportsReferenceAudio && (
        <VideoMediaDrop
          title="参考音频"
          emptyText="暂无参考音频，最多 3 个，mp3/wav，单个 15MB 内"
          assets={audioReferences}
          onUpload={onUploadReferenceAudio}
          onRemove={(id) => setAudioReferences((items) => removeMediaAsset(items, id))}
        />
      )}

      <div className="cy-video-submit-row">
        <button type="button" className="cy-video-generate" disabled={!canSubmit} onClick={onSubmit}>
          {hasRunningTask ? '加入队列' : '开始生成视频'}
        </button>
        {hasRunningTask && (
          <button type="button" className="cy-video-cancel" onClick={onCancelCurrent}>
            取消当前
          </button>
        )}
      </div>
    </div>
  )
}
