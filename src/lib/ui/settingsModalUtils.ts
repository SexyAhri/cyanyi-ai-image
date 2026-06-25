import {
  createDefaultOpenAIProfile,
  DEFAULT_IMAGES_MODEL,
  DEFAULT_SETTINGS,
  findEquivalentApiProfile,
  isOpenAICompatibleProvider,
} from '../api/apiProfiles'
import type { ApiProfile, AppSettings, CustomProviderDefinition, ZipDownloadRoute } from '../../types'

export function newSettingsId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export const ADD_CUSTOM_PROVIDER_VALUE = '__add_custom_provider__'

const COPY_IMPORT_URL_OPTIONS_STORAGE_KEY = 'gpt-image-playground.copy-import-url-options'

export type CallingFormat = 'openai-images' | 'openai-responses' | 'openai-videos' | 'gemini' | 'grok' | 'custom'

export const DEFAULT_COPY_IMPORT_URL_OPTIONS = {
  includeApiKey: false,
  useNewApiAddress: false,
  useNewApiKey: true,
  useNewApiModel: false,
}

export type CopyImportUrlOptions = typeof DEFAULT_COPY_IMPORT_URL_OPTIONS

export const ZIP_DOWNLOAD_ROUTE_OPTIONS: Array<{ route: ZipDownloadRoute; label: string; description: string }> = [
  { route: 'task-selection', label: '任务列表 > 多选', description: '主页或收藏夹详情中框选、Ctrl/⌘ 点选或移动端滑动选中任务后的“下载选中”。' },
  { route: 'favorite-collection-selection', label: '收藏夹列表 > 多选', description: '收藏夹概览页选中一个或多个收藏夹后的“下载选中”。' },
  { route: 'image-context-menu-all', label: '图片右键菜单 > 下载全部', description: '右键图片时下载同一组输出图片。' },
  { route: 'task-detail-all', label: '任务详情 > 下载全部', description: '任务详情弹窗中下载当前任务的所有输出图。' },
  { route: 'task-detail-partial', label: '任务详情 > 下载中间步骤图', description: '任务详情弹窗中下载流式生成保留的中间步骤图。' },
  { route: 'agent-round-all', label: 'Agent 对话轮次 > 下载所有图片', description: 'Agent 对话中下载某轮回复关联的全部图片。' },
]

export function readCopyImportUrlOptions(): CopyImportUrlOptions {
  if (typeof window === 'undefined') return DEFAULT_COPY_IMPORT_URL_OPTIONS

  try {
    const saved = window.localStorage.getItem(COPY_IMPORT_URL_OPTIONS_STORAGE_KEY)
    if (!saved) return DEFAULT_COPY_IMPORT_URL_OPTIONS

    const parsed = JSON.parse(saved) as Partial<CopyImportUrlOptions> | null
    if (!parsed || typeof parsed !== 'object') return DEFAULT_COPY_IMPORT_URL_OPTIONS

    return {
      includeApiKey: false,
      useNewApiAddress: Boolean(parsed.useNewApiAddress),
      useNewApiKey: parsed.useNewApiKey === undefined ? true : Boolean(parsed.useNewApiKey),
      useNewApiModel: Boolean(parsed.useNewApiModel),
    }
  } catch {
    return DEFAULT_COPY_IMPORT_URL_OPTIONS
  }
}

export function saveCopyImportUrlOptions(options: CopyImportUrlOptions) {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(COPY_IMPORT_URL_OPTIONS_STORAGE_KEY, JSON.stringify({
      useNewApiAddress: options.useNewApiAddress,
      useNewApiKey: options.useNewApiKey,
      useNewApiModel: options.useNewApiModel,
    }))
  } catch {
    // localStorage 不可用时只保留当前会话状态。
  }
}

export interface CustomProviderForm {
  json: string
}

const DEFAULT_CUSTOM_PROVIDER_MANIFEST = {
  name: '自定义服务商',
  submit: {
    path: 'images/generations',
    method: 'POST',
    contentType: 'json',
    body: {
      model: '$profile.model',
      prompt: '$prompt',
      size: '$params.size',
      quality: '$params.quality',
      output_format: '$params.output_format',
      moderation: '$params.moderation',
      output_compression: '$params.output_compression',
      n: '$params.n',
    },
    result: {
      imageUrlPaths: ['data.*.url'],
      b64JsonPaths: ['data.*.b64_json'],
    },
  },
  editSubmit: {
    path: 'images/edits',
    method: 'POST',
    contentType: 'multipart',
    body: {
      model: '$profile.model',
      prompt: '$prompt',
      size: '$params.size',
      quality: '$params.quality',
      output_format: '$params.output_format',
      moderation: '$params.moderation',
      output_compression: '$params.output_compression',
      n: '$params.n',
    },
    files: [
      { field: 'image[]', source: 'inputImages', array: true },
      { field: 'mask', source: 'mask' },
    ],
    result: {
      imageUrlPaths: ['data.*.url'],
      b64JsonPaths: ['data.*.b64_json'],
    },
  },
}

export function createDefaultCustomProviderForm(): CustomProviderForm {
  return {
    json: JSON.stringify(DEFAULT_CUSTOM_PROVIDER_MANIFEST, null, 2),
  }
}

export function customProviderToForm(provider: CustomProviderDefinition): CustomProviderForm {
  return {
    json: JSON.stringify({
      name: provider.name,
      submit: provider.submit,
      editSubmit: provider.editSubmit,
      poll: provider.poll,
    }, null, 2),
  }
}

export function customProviderFormToInput(form: CustomProviderForm) {
  return JSON.parse(form.json)
}

export function isPristineNewOpenAIProfile(profile: ApiProfile) {
  const defaultProfile = createDefaultOpenAIProfile({ id: profile.id, name: '新配置' })
  return profile.name === '新配置' &&
    profile.provider === 'openai' &&
    profile.baseUrl === DEFAULT_SETTINGS.baseUrl &&
    profile.apiKey === '' &&
    profile.model === DEFAULT_IMAGES_MODEL &&
    profile.timeout === DEFAULT_SETTINGS.timeout &&
    profile.apiMode === 'images' &&
    profile.codexCli === false &&
    profile.apiProxy === defaultProfile.apiProxy &&
    profile.streamImages === defaultProfile.streamImages &&
    profile.streamPartialImages === defaultProfile.streamPartialImages
}

export function getImportedProfileFromMergedSettings(
  nextSettings: AppSettings,
  previousProfileIds: Set<string>,
  importedSettings: { customProviders: CustomProviderDefinition[], profiles: ApiProfile[] },
) {
  const existingProfile = importedSettings.profiles
    .map((profile) => findEquivalentApiProfile(nextSettings, profile, importedSettings.customProviders))
    .find((profile): profile is ApiProfile => profile != null && previousProfileIds.has(profile.id))
  if (existingProfile) return existingProfile

  return nextSettings.profiles.find((profile) => !previousProfileIds.has(profile.id)) ?? nextSettings.profiles[0]
}

export function isAsyncCustomProvider(provider: CustomProviderDefinition | null | undefined) {
  return Boolean(provider?.poll || provider?.submit.taskIdPath || provider?.editSubmit?.taskIdPath)
}

export function isProfileApiProxyEligible(settings: AppSettings, profile: ApiProfile) {
  if (!isOpenAICompatibleProvider(settings, profile.provider)) return false
  const customProvider = settings.customProviders.find((provider) => provider.id === profile.provider)
  return !isAsyncCustomProvider(customProvider)
}
