import { useState } from 'react'
import { useStore } from '../store'
import { useTooltip } from '../hooks/useTooltip'
import { dismissAllTooltips } from '../lib/tooltipDismiss'
import ViewportTooltip from './ViewportTooltip'
import HelpModal from './HelpModal'
import { HelpCircleIcon, SettingsIcon } from './icons'

export default function Header() {
  const appMode = useStore((s) => s.appMode)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const activeFavoriteCollectionId = useStore((s) => s.activeFavoriteCollectionId)
  const [showHelp, setShowHelp] = useState(false)
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
