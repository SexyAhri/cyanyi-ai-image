import { lazy, Suspense, useEffect, useState } from 'react'
import { initStore, useStore } from './store'
import { activateFirstImportedProfile, buildSettingsFromUrlParams, clearUrlSettingParams, hasUrlSettingParams } from './lib/urlSettings'
import { isDefaultConfigOnlyEnabled, mergeImportedSettings } from './lib/apiProfiles'
import { getCustomProviderConfigUrl, loadCustomProviderSettingsFromUrl } from './lib/customProviderConfigUrl'
import type { AppSettings } from './types'
import Header from './components/Header'
import SearchBar from './components/SearchBar'
import TaskGrid from './components/TaskGrid'
import InputBar from './components/InputBar'
import ConfirmDialog from './components/ConfirmDialog'
import Toast from './components/Toast'
import AgentWorkspace from './components/AgentWorkspace'
import { useGlobalClickSuppression } from './lib/clickSuppression'

let customProviderConfigUrlImportStarted = false
const LOGO_URL = 'https://img.icons8.com/?size=100&id=eoxMN35Z6JKg&format=png&color=000000'
const DetailModal = lazy(() => import('./components/DetailModal'))
const Lightbox = lazy(() => import('./components/Lightbox'))
const SettingsModal = lazy(() => import('./components/SettingsModal'))
const MaskEditorModal = lazy(() => import('./components/MaskEditorModal'))
const ImageContextMenu = lazy(() => import('./components/ImageContextMenu'))
const SupportPromptModal = lazy(() => import('./components/SupportPromptModal'))
const UtilityPanel = lazy(() => import('./components/UtilityPanel'))
const VideoWorkspace = lazy(() => import('./components/VideoWorkspace'))
const FavoriteCollectionsView = lazy(() => import('./components/FavoriteCollections').then((module) => ({ default: module.FavoriteCollectionsView })))
const FavoriteCollectionPickerModal = lazy(() => import('./components/FavoriteCollections').then((module) => ({ default: module.FavoriteCollectionPickerModal })))
const ManageCollectionsModal = lazy(() => import('./components/FavoriteCollections').then((module) => ({ default: module.ManageCollectionsModal })))

function ImageContextMenuLoader() {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const scheduleIdle = window.requestIdleCallback ?? ((callback: IdleRequestCallback) => window.setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 0 }), 1_000))
    const cancelIdle = window.cancelIdleCallback ?? window.clearTimeout
    const idleId = scheduleIdle(() => setReady(true))
    return () => cancelIdle(idleId)
  }, [])

  return ready ? <ImageContextMenu /> : null
}

export default function App() {
  const setSettings = useStore((s) => s.setSettings)
  const appMode = useStore((s) => s.appMode)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const activeFavoriteCollectionId = useStore((s) => s.activeFavoriteCollectionId)
  const tasks = useStore((s) => s.tasks)
  const setAppMode = useStore((s) => s.setAppMode)
  const setFilterFavorite = useStore((s) => s.setFilterFavorite)
  const setActiveFavoriteCollectionId = useStore((s) => s.setActiveFavoriteCollectionId)
  const detailTaskId = useStore((s) => s.detailTaskId)
  const lightboxImageId = useStore((s) => s.lightboxImageId)
  const showSettings = useStore((s) => s.showSettings)
  const supportPromptOpen = useStore((s) => s.supportPromptOpen)
  const utilityPanelOpen = useStore((s) => s.utilityPanelOpen)
  const favoritePickerTaskIds = useStore((s) => s.favoritePickerTaskIds)
  const isManageCollectionsModalOpen = useStore((s) => s.isManageCollectionsModalOpen)
  const maskEditorImageId = useStore((s) => s.maskEditorImageId)
  useGlobalClickSuppression()

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search)
    const customProviderConfigUrl = getCustomProviderConfigUrl()
    const defaultConfigOnly = isDefaultConfigOnlyEnabled()

    const applyUrlSettings = (baseSettings: Partial<AppSettings>) => {
      const nextSettings = buildSettingsFromUrlParams(baseSettings, searchParams)
      return Object.keys(nextSettings).length ? nextSettings : baseSettings
    }

    const clearAppliedUrlSettings = () => {
      if (!hasUrlSettingParams(searchParams)) return
      clearUrlSettingParams(searchParams)
      const nextSearch = searchParams.toString()
      const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`
      window.history.replaceState(null, '', nextUrl)
    }

    if (customProviderConfigUrl && defaultConfigOnly && !customProviderConfigUrlImportStarted) {
      customProviderConfigUrlImportStarted = true
      void loadCustomProviderSettingsFromUrl(customProviderConfigUrl)
        .then((importedSettings) => {
          const state = useStore.getState()
          const baseSettings = importedSettings
            ? activateFirstImportedProfile(mergeImportedSettings(state.settings, importedSettings), importedSettings)
            : state.settings
          state.setSettings(applyUrlSettings(baseSettings))
          clearAppliedUrlSettings()
        })
        .catch((error) => {
          console.warn('Failed to import custom provider config URL:', error)
          const state = useStore.getState()
          state.setSettings(applyUrlSettings(state.settings))
          clearAppliedUrlSettings()
        })

      initStore()
      return
    }

    const nextSettings = buildSettingsFromUrlParams(useStore.getState().settings, searchParams)
    setSettings(nextSettings)
    clearAppliedUrlSettings()

    if (customProviderConfigUrl && !customProviderConfigUrlImportStarted) {
      customProviderConfigUrlImportStarted = true
      void loadCustomProviderSettingsFromUrl(customProviderConfigUrl)
        .then((importedSettings) => {
          if (!importedSettings) return
          const state = useStore.getState()
          state.setSettings(mergeImportedSettings(state.settings, importedSettings))
        })
        .catch((error) => {
          console.warn('Failed to import custom provider config URL:', error)
        })
    }

    initStore()
  }, [setSettings])

  useEffect(() => {
    const preventPageImageDrag = (e: DragEvent) => {
      if ((e.target as HTMLElement | null)?.closest('img')) e.preventDefault()
    }
    document.addEventListener('dragstart', preventPageImageDrag)
    return () => document.removeEventListener('dragstart', preventPageImageDrag)
  }, [])

  const openGallery = () => {
    setAppMode('gallery')
    setActiveFavoriteCollectionId(null)
    setFilterFavorite(false)
  }

  const openFavorites = () => {
    setAppMode('gallery')
    setActiveFavoriteCollectionId(null)
    setFilterFavorite(true)
  }

  const openAgent = () => {
    setAppMode('agent')
  }

  const openVideo = () => {
    setAppMode('video')
    setActiveFavoriteCollectionId(null)
    setFilterFavorite(false)
  }

  const isGalleryView = appMode === 'gallery' && !filterFavorite
  const isFavoriteView = appMode === 'gallery' && filterFavorite

  return (
    <>
      <div className="cy-app-shell">
        <aside className="cy-sidebar" data-no-drag-select>
          <a href="/" className="cy-sidebar-brand" aria-label="CyanYi AI">
            <span className="cy-sidebar-logo">
              <img src={LOGO_URL} alt="" />
            </span>
            <span>
              <span className="cy-sidebar-title">CyanYi AI</span>
              <span className="cy-sidebar-subtitle">Image Studio</span>
            </span>
          </a>

          <nav className="cy-sidebar-nav" aria-label="Main">
            <button type="button" className={`cy-sidebar-link${isGalleryView ? ' cy-sidebar-link-active' : ''}`} onClick={openGallery} aria-current={isGalleryView ? 'page' : undefined}>
              <span className="cy-sidebar-link-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <rect x="3" y="4" width="18" height="16" rx="3" />
                  <path d="m7 15 3-3 3 3 2-2 2 2" />
                  <path d="M15 8h.01" />
                </svg>
              </span>
              画廊
            </button>
            <button type="button" className={`cy-sidebar-link${appMode === 'agent' ? ' cy-sidebar-link-active' : ''}`} onClick={openAgent} aria-current={appMode === 'agent' ? 'page' : undefined}>
              <span className="cy-sidebar-link-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M5 6h14M5 12h14M5 18h8" />
                </svg>
              </span>
              Agent
            </button>
            <button type="button" className={`cy-sidebar-link${appMode === 'video' ? ' cy-sidebar-link-active' : ''}`} onClick={openVideo} aria-current={appMode === 'video' ? 'page' : undefined}>
              <span className="cy-sidebar-link-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <rect x="3" y="5" width="18" height="14" rx="3" />
                  <path d="m10 9 5 3-5 3V9Z" />
                </svg>
              </span>
              视频
            </button>
            <button type="button" className={`cy-sidebar-link${isFavoriteView ? ' cy-sidebar-link-active' : ''}`} onClick={openFavorites} aria-current={isFavoriteView ? 'page' : undefined}>
              <span className="cy-sidebar-link-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill={isFavoriteView ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8">
                  <path d="m12 3 2.7 5.48 6.05.88-4.38 4.27 1.03 6.02L12 16.8l-5.4 2.85 1.03-6.02-4.38-4.27 6.05-.88L12 3Z" />
                </svg>
              </span>
              收藏
            </button>
            <a
              href="https://ai.cyanyi.com/"
              className="cy-sidebar-link"
              target="_blank"
              rel="noreferrer"
              title="打开 CyanYI 中转"
            >
              <span className="cy-sidebar-link-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M14 5h5v5" />
                  <path d="M10 14 19 5" />
                  <path d="M19 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4" />
                </svg>
              </span>
              CyanYI 中转
            </a>
          </nav>

          <div className="cy-sidebar-card">
            <div className="cy-sidebar-card-label">当前视图</div>
            <div className="cy-sidebar-card-value">{appMode === 'agent' ? 'Agent 工作台' : appMode === 'video' ? '视频创作台' : isFavoriteView ? '收藏' : '画廊'}</div>
            <div className="cy-sidebar-card-meta">{appMode === 'agent' ? '对话式生图' : appMode === 'video' ? '视频生成' : `任务 ${tasks.length}`}</div>
          </div>
        </aside>

        <div className="cy-workspace">
          <Header />
          <main data-home-main data-drag-select-surface className={`cy-main${appMode === 'agent' ? ' cy-main-agent' : ''}${appMode === 'video' ? ' cy-main-video' : ''}`}>
            {appMode === 'agent' ? (
              <AgentWorkspace />
            ) : appMode === 'video' ? (
              <Suspense fallback={null}>
                <VideoWorkspace />
              </Suspense>
            ) : (
              <section className="cy-content-panel">
                <div className="cy-panel-heading" data-no-drag-select>
                  <div>
                    <p className="cy-panel-kicker">Image Generation</p>
                    <h1>AI 图像创作</h1>
                  </div>
                </div>
                <SearchBar showFavoriteControls={false} />
                {filterFavorite && !activeFavoriteCollectionId ? (
                  <Suspense fallback={null}>
                    <FavoriteCollectionsView />
                  </Suspense>
                ) : <TaskGrid />}
              </section>
            )}
          </main>
        </div>
      </div>
      {appMode !== 'video' && <InputBar />}
      <ConfirmDialog />
      <Toast />
      <Suspense fallback={null}>
        {detailTaskId && <DetailModal />}
        {lightboxImageId && <Lightbox />}
        {showSettings && <SettingsModal />}
        {utilityPanelOpen && <UtilityPanel />}
        {supportPromptOpen && <SupportPromptModal />}
        {favoritePickerTaskIds && <FavoriteCollectionPickerModal />}
        {isManageCollectionsModalOpen && <ManageCollectionsModal />}
        {maskEditorImageId && <MaskEditorModal />}
        <ImageContextMenuLoader />
      </Suspense>
    </>
  )
}
