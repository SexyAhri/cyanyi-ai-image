import { formatBytes, type MediaAsset } from '../../lib/video/videoWorkspaceUtils'

export function VideoMediaDrop({
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

export function VideoEmptyIcon() {
  return (
    <svg className="cy-video-empty-icon" viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <path d="M22 22h20a4 4 0 0 1 4 4v12a4 4 0 0 1-4 4H22a4 4 0 0 1-4-4V26a4 4 0 0 1 4-4Z" stroke="currentColor" strokeWidth="4" />
      <path d="m46 29 8-5v16l-8-5V29Z" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" />
    </svg>
  )
}
