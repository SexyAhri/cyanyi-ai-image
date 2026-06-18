import { useState } from 'react'
import { useStore } from '../store'
import { useTooltip } from '../hooks/useTooltip'
import { dismissAllTooltips } from '../lib/tooltipDismiss'
import ViewportTooltip from './ViewportTooltip'
import HelpModal from './HelpModal'
import { HelpCircleIcon, SettingsIcon, TrashIcon } from './icons'

export default function Header() {
  const appMode = useStore((s) => s.appMode)
  const activeAgentConversationId = useStore((s) => s.activeAgentConversationId)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const clearAgentConversation = useStore((s) => s.clearAgentConversation)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const activeFavoriteCollectionId = useStore((s) => s.activeFavoriteCollectionId)
  const [showHelp, setShowHelp] = useState(false)
  const clearTooltip = useTooltip()
  const helpTooltip = useTooltip()
  const settingsTooltip = useTooltip()

  return (
    <>
      <header data-no-drag-select className="cy-topbar safe-area-top">
        <div className="cy-topbar-inner">
          <div className="cy-topbar-title">
            <span>{appMode === 'agent' ? 'Agent 工作台' : '画廊工作台'}</span>
            <p>{appMode === 'agent' ? '对话式生图 · 多轮引用前图' : '释放灵感，生成你的下一张作品'}</p>
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
