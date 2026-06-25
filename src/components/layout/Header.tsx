import { useState } from 'react'
import { useStore } from '../../store'
import { useTooltip } from '../../hooks/useTooltip'
import { dismissAllTooltips } from '../../lib/ui/tooltipDismiss'
import ViewportTooltip from '../common/ViewportTooltip'
import HelpModal from '../common/HelpModal'
import { HelpCircleIcon, SettingsIcon, TrashIcon } from '../common/icons'

export default function Header() {
  const appMode = useStore((s) => s.appMode)
  const activeAgentConversationId = useStore((s) => s.activeAgentConversationId)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const setUtilityPanelOpen = useStore((s) => s.setUtilityPanelOpen)
  const clearAgentConversation = useStore((s) => s.clearAgentConversation)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const activeFavoriteCollectionId = useStore((s) => s.activeFavoriteCollectionId)
  const [showHelp, setShowHelp] = useState(false)
  const clearTooltip = useTooltip()
  const helpTooltip = useTooltip()
  const utilityTooltip = useTooltip()
  const settingsTooltip = useTooltip()
  const title = appMode === 'agent' ? 'Agent 工作台' : appMode === 'video' ? '视频创作台' : '画廊工作台'
  const subtitle = appMode === 'agent'
    ? '对话式生图 · 多轮引用前图'
    : appMode === 'video'
      ? '视频生成 · 支持参考素材'
      : '释放灵感，生成你的下一张作品'

  return (
    <>
      <header data-no-drag-select className="cy-topbar safe-area-top">
        <div className="cy-topbar-inner">
          <div className="cy-topbar-title">
            <span>{title}</span>
            <p>{subtitle}</p>
          </div>

          <div className="cy-topbar-actions">
            {appMode === 'agent' && activeAgentConversationId && (
              <div className="relative" {...clearTooltip.handlers}>
                <button
                  type="button"
                  onClick={() => {
                    dismissAllTooltips()
                    setConfirmDialog({
                      title: '清空对话',
                      message: '确定要清空当前 Agent 对话吗？会保留当前会话标题，但会删除其中全部消息和轮次。',
                      action: () => clearAgentConversation(activeAgentConversationId),
                    })
                  }}
                  className="cy-icon-button"
                  aria-label="清空当前对话"
                >
                  <TrashIcon className="h-5 w-5" />
                </button>
                <ViewportTooltip visible={clearTooltip.visible} className="whitespace-nowrap">
                  清空当前对话
                </ViewportTooltip>
              </div>
            )}

            <div className="relative" {...utilityTooltip.handlers}>
              <button
                type="button"
                onClick={() => {
                  dismissAllTooltips()
                  setUtilityPanelOpen(true)
                }}
                className="cy-icon-button"
                aria-label="Tools"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                  <path d="M4 7h16" />
                  <path d="M7 12h10" />
                  <path d="M10 17h4" />
                  <path d="M6 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
                  <path d="M18 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
                </svg>
              </button>
              <ViewportTooltip visible={utilityTooltip.visible} className="whitespace-nowrap">
                Tools
              </ViewportTooltip>
            </div>

            <div className="relative" {...helpTooltip.handlers}>
              <button
                type="button"
                onClick={() => {
                  dismissAllTooltips()
                  setShowHelp(true)
                }}
                className="cy-icon-button"
                aria-label="Help"
              >
                <HelpCircleIcon className="h-5 w-5" />
              </button>
              <ViewportTooltip visible={helpTooltip.visible} className="whitespace-nowrap">
                Help
              </ViewportTooltip>
            </div>

            <div className="relative" {...settingsTooltip.handlers}>
              <button type="button" onClick={() => setShowSettings(true)} className="cy-icon-button" aria-label="Settings">
                <SettingsIcon className="h-5 w-5" />
              </button>
              <ViewportTooltip visible={settingsTooltip.visible} className="whitespace-nowrap">
                Settings
              </ViewportTooltip>
            </div>
          </div>
        </div>
      </header>

      {showHelp && (
        <HelpModal
          appMode={appMode}
          isFavoriteCollectionOverview={filterFavorite && !activeFavoriteCollectionId}
          onClose={() => setShowHelp(false)}
        />
      )}
    </>
  )
}
