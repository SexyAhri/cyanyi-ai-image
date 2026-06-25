import type { VideoGenerationRecord } from '../../types'
import { statusLabel } from '../../lib/video/videoWorkspaceUtils'

export function VideoHistoryPanel({
  records,
  visibleRecords,
  activeRecord,
  libraryFilter,
  onFilterChange,
  onNew,
  onClearAll,
  onSelect,
  onCopyPrompt,
  onRemove,
}: {
  records: VideoGenerationRecord[]
  visibleRecords: VideoGenerationRecord[]
  activeRecord: VideoGenerationRecord | null
  libraryFilter: 'all' | 'video'
  onFilterChange: (filter: 'all' | 'video') => void
  onNew: () => void
  onClearAll: () => void
  onSelect: (id: string) => void
  onCopyPrompt: (record: VideoGenerationRecord) => void
  onRemove: (id: string) => void
}) {
  return (
    <aside className="cy-video-history" data-no-drag-select>
      <div className="cy-video-card-title">
        <span>作品库</span>
        <strong>{records.length}</strong>
      </div>
      <div className="cy-video-history-actions">
        <button type="button" onClick={onNew}>+ 新建</button>
        <button type="button" disabled={!records.length} onClick={onClearAll}>清空记录</button>
      </div>
      <div className="cy-video-history-actions cy-video-filter-actions">
        <button type="button" className={libraryFilter === 'all' ? 'active' : ''} onClick={() => onFilterChange('all')}>全部</button>
        <button type="button" className={libraryFilter === 'video' ? 'active' : ''} onClick={() => onFilterChange('video')}>仅成片</button>
      </div>
      <div className="cy-video-log-list">
        {visibleRecords.map((record) => (
          <div
            key={record.id}
            className={`cy-video-log${activeRecord?.id === record.id ? ' cy-video-log-active' : ''}`}
          >
            <button type="button" className="cy-video-log-main" onClick={() => onSelect(record.id)}>
              <span>{record.prompt || '未命名视频'}</span>
              <small>{statusLabel(record.status)} · {record.config.size} · {record.config.seconds}s</small>
            </button>
            <button type="button" className="cy-video-log-copy" onClick={() => onCopyPrompt(record)}>复制</button>
            <button type="button" className="cy-video-log-copy cy-video-log-delete" onClick={() => onRemove(record.id)}>删除</button>
          </div>
        ))}
        {!visibleRecords.length && <div className="cy-video-empty-small">暂无生成记录</div>}
      </div>
    </aside>
  )
}
