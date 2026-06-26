import { beforeEach, describe, expect, it, vi } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { DEFAULT_PARAMS } from '../types'
import { createDefaultGrokProfile, createDefaultOpenAIProfile, DEFAULT_RESPONSES_MODEL, DEFAULT_SETTINGS, normalizeSettings } from '../lib/api/apiProfiles'
import type { AgentConversation, ExportData, StoredImage, StoredImageThumbnail, TaskRecord, VideoGenerationRecord } from '../types'
import { getSelectedImageMentionLabel } from '../lib/gallery/promptImageMentions'
vi.mock('../lib/storage/db', () => {
  const tasks = new Map<string, TaskRecord>()
  const images = new Map<string, StoredImage>()
  const thumbnails = new Map<string, StoredImageThumbnail>()
  const agentConversations = new Map<string, AgentConversation>()
  const videoRecords = new Map<string, VideoGenerationRecord>()
  let imageSeq = 0

  return {
    CURRENT_THUMBNAIL_VERSION: 2,
    getAllTasks: async () => [...tasks.values()],
    putTask: async (task: TaskRecord) => {
      tasks.set(task.id, task)
      return task.id
    },
    deleteTask: async (id: string) => {
      tasks.delete(id)
    },
    clearTasks: async () => {
      tasks.clear()
    },
    getAllAgentConversations: async () => [...agentConversations.values()],
    putAgentConversation: async (conversation: AgentConversation) => {
      agentConversations.set(conversation.id, conversation)
      return conversation.id
    },
    deleteAgentConversation: async (id: string) => {
      agentConversations.delete(id)
    },
    clearAgentConversations: async () => {
      agentConversations.clear()
    },
    getAllVideoRecords: async () => [...videoRecords.values()],
    putVideoRecord: async (record: VideoGenerationRecord) => {
      videoRecords.set(record.id, record)
      return record.id
    },
    deleteVideoRecord: async (id: string) => {
      videoRecords.delete(id)
    },
    clearVideoRecords: async () => {
      videoRecords.clear()
    },
    replaceVideoRecords: async (records: VideoGenerationRecord[]) => {
      videoRecords.clear()
      for (const record of records) videoRecords.set(record.id, record)
    },
    replaceAgentConversations: async (conversations: AgentConversation[]) => {
      agentConversations.clear()
      for (const conversation of conversations) agentConversations.set(conversation.id, conversation)
    },
    getImage: async (id: string) => images.get(id),
    getImageThumbnail: async (id: string) => thumbnails.get(id),
    getStoredFreshImageThumbnail: async (id: string) => thumbnails.get(id),
    getAllImageIds: async () => [...images.keys()],
    getAllImages: async () => [...images.values()],
    putImage: async (image: StoredImage) => {
      images.set(image.id, image)
      return image.id
    },
    putImageThumbnail: async (thumbnail: StoredImageThumbnail) => {
      thumbnails.set(thumbnail.id, thumbnail)
      return thumbnail.id
    },
    deleteImage: async (id: string) => {
      images.delete(id)
      thumbnails.delete(id)
    },
    clearImages: async () => {
      images.clear()
      thumbnails.clear()
    },
    storeImage: async (dataUrl: string, source: StoredImage['source'] = 'upload') => {
      const id = `stored-image-${++imageSeq}`
      images.set(id, { id, dataUrl, source, createdAt: Date.now() })
      return id
    },
  }
})
vi.mock('../lib/api/api', () => ({
  callImageApi: vi.fn(async () => ({
    images: [],
    actualParams: {},
    actualParamsList: [],
    revisedPrompts: [],
  })),
}))
vi.mock('../lib/gallery/transparentImage', () => ({
  GREEN_KEY_COLOR: '#00FF00',
  MAGENTA_KEY_COLOR: '#FF00FF',
  createTransparentOutputMeta: vi.fn((prompt: string) => ({
    transparentOutput: true,
    effectivePrompt: `transparent:${prompt}`,
  })),
  getTransparentRequestParams: vi.fn((params: typeof DEFAULT_PARAMS) => ({
    ...params,
    output_format: 'png',
    output_compression: null,
    transparent_output: true,
  })),
  removeKeyedBackgroundFromDataUrl: vi.fn(async (dataUrl: string) => `transparent:${dataUrl}`),
}))
vi.mock('../lib/agent/agentApi', () => ({
  callAgentConversationTitleApi: vi.fn(async () => '标题'),
  callAgentResponsesApi: vi.fn(() => new Promise(() => {})),
  callBatchImageSingle: vi.fn(async (opts: { batchItemId: string; prompt: string }) => ({
    batchItemId: opts.batchItemId,
    image: { dataUrl: 'data:image/png;base64,batch-output', revisedPrompt: opts.prompt },
    error: null,
  })),
  parseSingleImageCallArguments: vi.fn((args: string) => {
    try {
      const parsed = JSON.parse(args) as { prompt?: string }
      const prompt = typeof parsed.prompt === 'string' ? parsed.prompt.trim() : ''
      return prompt ? { prompt } : null
    } catch {
      return null
    }
  }),
  parseBatchImageCallArguments: vi.fn((args: string) => {
    try {
      const parsed = JSON.parse(args) as { images?: Array<{ id?: string; prompt?: string }> }
      return parsed.images?.map((item, index) => ({
        id: item.id || `image_${index + 1}`,
        prompt: item.prompt || '',
      })) ?? null
    } catch {
      return null
    }
  }),
  parseVideoCallArguments: vi.fn((args: string) => {
    try {
      const parsed = JSON.parse(args) as { prompt?: string; seconds?: string; size?: string; resolution?: string }
      const prompt = typeof parsed.prompt === 'string' ? parsed.prompt.trim() : ''
      return prompt
        ? {
            prompt,
            ...(typeof parsed.seconds === 'string' ? { seconds: parsed.seconds } : {}),
            ...(typeof parsed.size === 'string' ? { size: parsed.size } : {}),
            ...(typeof parsed.resolution === 'string' ? { resolution: parsed.resolution } : {}),
          }
        : null
    } catch {
      return null
    }
  }),
}))
vi.mock('../lib/video/videoApi', async () => {
  const actual = await vi.importActual<typeof import('../lib/video/videoApi')>('../lib/video/videoApi')
  return {
    ...actual,
    createVideoGenerationTask: vi.fn(async () => ({
      id: 'video-task-a',
      model: 'grok-imagine-video',
    })),
    pollVideoGenerationTask: vi.fn(async () => ({
      status: 'completed',
      video: {
        url: 'https://example.com/video.mp4',
        dataUrl: 'data:video/mp4;base64,dmRlbw==',
        mimeType: 'video/mp4',
        bytes: 4,
      },
    })),
  }
})
import { clearAgentConversations, clearImages, clearTasks, clearVideoRecords, getAllAgentConversations, getAllTasks, getAllVideoRecords, getImage, putAgentConversation, putImage, putTask as putDbTask } from '../lib/storage/db'
import { callAgentResponsesApi, callBatchImageSingle } from '../lib/agent/agentApi'
import { createVideoGenerationTask, pollVideoGenerationTask } from '../lib/video/videoApi'
import { removeKeyedBackgroundFromDataUrl } from '../lib/gallery/transparentImage'
import { cleanStaleAgentInputDrafts, clearData, clearFailedTasks, deleteAgentRoundFromConversation, deleteFavoriteCollection, editOutputs, getActiveAgentRounds, getErrorToastMessage, getPersistedState, getTaskApiProfile, importData, initStore, markInterruptedOpenAIRunningTasks, migratePersistedState, regenerateAgentAssistantMessage, remapAgentRoundMentionsForPathChange, removeTask, retryTask, reuseConfig, sanitizeProviderErrorMessage, submitAgentMessage, submitTask, taskMatchesFilterStatus, taskMatchesSearchQuery, useStore } from '../store'

const imageA = { id: 'image-a', dataUrl: 'data:image/png;base64,a' }
const imageB = { id: 'image-b', dataUrl: 'data:image/png;base64,b' }

describe('error toast messages', () => {
  it('drops long error detail after the failure title', () => {
    expect(getErrorToastMessage('Agent 请求失败：接口拒绝了很长的提示词内容')).toBe('Agent 请求失败')
  })

  it('uses a generic message for long raw errors without a title', () => {
    expect(getErrorToastMessage(`invalid request ${'x'.repeat(90)}`)).toBe('操作失败，请查看详情')
  })
})

describe('provider error sanitizing', () => {
  it('hides model, group, and request id from channel errors', () => {
    const message = sanitizeProviderErrorMessage(
      'No available channel for model gpt-image-1.5 under group gpt-绘图 (distributor) (request id: 202606181013249028361862q61vxqwpLnRqM9A)',
    )

    expect(message).toBe('当前模型暂不可用，请稍后重试或切换模型。')
    expect(message).not.toContain('gpt-image-1.5')
    expect(message).not.toContain('request id')
  })

  it('hides balance and charge details from billing errors', () => {
    const message = sanitizeProviderErrorMessage(
      'Request error occurred: 预扣费额度失败, 用户剩余额度: $0.165064, 需要预扣费额度: $0.250000 (request id: 202606180514207889501072q61vxgwWfim6LnDP)',
    )

    expect(message).toBe('当前接口暂时无法完成请求，请稍后重试或切换 API 配置。')
    expect(message).not.toContain('余额')
    expect(message).not.toContain('$0.165064')
  })
})

function agentConversation(overrides: Partial<AgentConversation> = {}): AgentConversation {
  return {
    id: 'conversation-a',
    title: '新对话',
    activeRoundId: null,
    createdAt: 1,
    updatedAt: 1,
    rounds: [],
    messages: [],
    ...overrides,
  }
}

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task-a',
    prompt: 'prompt',
    params: { ...DEFAULT_PARAMS },
    inputImageIds: [],
    maskTargetImageId: null,
    maskImageId: null,
    outputImages: [],
    status: 'done',
    error: null,
    createdAt: 1,
    finishedAt: 2,
    elapsed: 1,
    ...overrides,
  }
}

function importFile(data: ExportData): File {
  const zipped = zipSync({ 'manifest.json': strToU8(JSON.stringify(data)) })
  const buffer = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength)
  return { arrayBuffer: async () => buffer } as File
}

describe('favorite collection deletion', () => {
  const collectionA = { id: 'collection-a', name: '收藏夹 A', createdAt: 1, updatedAt: 1 }
  const collectionB = { id: 'collection-b', name: '收藏夹 B', createdAt: 1, updatedAt: 1 }

  beforeEach(async () => {
    await clearTasks()
    await clearImages()
    useStore.setState({
      tasks: [],
      favoriteCollections: [collectionA, collectionB],
      defaultFavoriteCollectionId: collectionA.id,
      activeFavoriteCollectionId: collectionA.id,
      selectedFavoriteCollectionIds: [collectionA.id],
      selectedTaskIds: [],
      inputImages: [],
      galleryInputDraft: null,
      agentConversations: [],
      showToast: vi.fn(),
    })
  })

  it('keeps tasks that are still referenced by another collection when deleting collection tasks', async () => {
    const sharedTask = task({
      id: 'shared-task',
      isFavorite: true,
      favoriteCollectionIds: [collectionA.id, collectionB.id],
    })
    const collectionOnlyTask = task({
      id: 'collection-only-task',
      isFavorite: true,
      favoriteCollectionIds: [collectionA.id],
    })
    useStore.setState({ tasks: [sharedTask, collectionOnlyTask] })
    await putDbTask(sharedTask)
    await putDbTask(collectionOnlyTask)

    await deleteFavoriteCollection(collectionA.id, true)

    const state = useStore.getState()
    expect(state.favoriteCollections.map((collection) => collection.id)).toEqual([collectionB.id])
    expect(state.activeFavoriteCollectionId).toBeNull()
    expect(state.selectedFavoriteCollectionIds).toEqual([])
    expect(state.tasks).toHaveLength(1)
    expect(state.tasks[0]).toMatchObject({
      id: sharedTask.id,
      isFavorite: true,
      favoriteCollectionIds: [collectionB.id],
    })
    expect((await getAllTasks()).map((item) => item.id)).toEqual([sharedTask.id])
  })
})

describe('mask draft lifecycle in store actions', () => {
  beforeEach(() => {
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key' },
      prompt: 'prompt',
      inputImages: [],
      seriesReferenceImage: null,
      maskDraft: null,
      maskEditorImageId: null,
      params: { ...DEFAULT_PARAMS },
      tasks: [],
      detailTaskId: null,
      lightboxImageId: null,
      lightboxImageList: [],
      showSettings: false,
      toast: null,
      confirmDialog: null,
      showToast: vi.fn(),
      setConfirmDialog: vi.fn(),
    })
  })

  it('preserves an existing mask when quick edit-output adds outputs as references', async () => {
    const maskDraft = {
      targetImageId: imageA.id,
      maskDataUrl: 'data:image/png;base64,mask',
      updatedAt: 1,
    }
    useStore.setState({
      inputImages: [imageA],
      maskDraft,
    })

    await editOutputs(task({ outputImages: [imageA.id] }))

    expect(useStore.getState().maskDraft).toEqual(maskDraft)
  })

  it('clears an invalid mask draft when submit cannot find the mask target image', async () => {
    useStore.setState({
      inputImages: [imageA],
      maskDraft: {
        targetImageId: 'missing-image',
        maskDataUrl: 'data:image/png;base64,mask',
        updatedAt: 1,
      },
    })

    await submitTask()

    expect(useStore.getState().maskDraft).toBeNull()
  })

  it('shows a submitted toast after creating a gallery task', async () => {
    await submitTask()

    const state = useStore.getState()
    expect(state.tasks).toHaveLength(1)
    expect(state.showToast).toHaveBeenCalledWith('任务已提交', 'success')
  })

  it('adds the series reference image to gallery submissions without changing visible input images', async () => {
    const { callImageApi } = await import('../lib/api/api')
    vi.mocked(callImageApi).mockClear()
    await putImage({ ...imageA, source: 'upload', createdAt: 1 })
    await putImage({ ...imageB, source: 'upload', createdAt: 1 })
    useStore.setState({
      inputImages: [imageA],
      seriesReferenceImage: {
        id: imageB.id,
        dataUrl: imageB.dataUrl,
        sourceTaskId: 'task-b',
        createdAt: 1,
      },
    })

    await submitTask()
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    expect(callImageApi).toHaveBeenCalledWith(expect.objectContaining({
      inputImageDataUrls: [imageB.dataUrl, imageA.dataUrl],
    }))
    expect(useStore.getState().inputImages).toEqual([imageA])
    expect(useStore.getState().tasks[0].inputImageIds).toEqual([imageB.id, imageA.id])
  })

  it('auto retries transient network failures without opening the detail modal', async () => {
    vi.useFakeTimers()
    const { callImageApi } = await import('../lib/api/api')
    vi.mocked(callImageApi).mockClear()
    vi.mocked(callImageApi)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({
        images: ['data:image/png;base64,retried'],
        actualParams: {},
        actualParamsList: [{}],
        revisedPrompts: [],
      })

    try {
      await submitTask()
      await Promise.resolve()
      await Promise.resolve()

      const retrying = useStore.getState().tasks[0]
      expect(retrying).toMatchObject({
        status: 'running',
        error: null,
        queued: true,
        autoRetryCount: 1,
        autoRetryReason: '网络连接中断',
      })
      expect(useStore.getState().detailTaskId).toBeNull()

      await vi.advanceTimersByTimeAsync(3_000)
      await Promise.resolve()

      const completed = useStore.getState().tasks[0]
      expect(callImageApi).toHaveBeenCalledTimes(2)
      expect(completed.status).toBe('done')
      expect(completed.error).toBeNull()
      expect(completed.autoRetryNextAt).toBeUndefined()
      expect(useStore.getState().detailTaskId).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('stores transparent background output after local post-processing', async () => {
    const { callImageApi } = await import('../lib/api/api')
    vi.mocked(callImageApi).mockClear()
    vi.mocked(removeKeyedBackgroundFromDataUrl).mockClear()
    vi.mocked(callImageApi).mockResolvedValueOnce({
      images: ['data:image/png;base64,generated'],
      actualParams: { output_format: 'png' },
      actualParamsList: [{ output_format: 'png' }],
      revisedPrompts: [],
    })
    useStore.setState({
      prompt: '单主体贴纸素材',
      params: {
        ...DEFAULT_PARAMS,
        output_format: 'png',
        output_compression: null,
        transparent_output: true,
      },
    })

    await submitTask()
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    expect(callImageApi).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining('transparent:单主体贴纸素材'),
      params: expect.objectContaining({
        output_format: 'png',
        output_compression: null,
        transparent_output: true,
      }),
    }))
    expect(callImageApi).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining('Global consistency requirements'),
    }))
    expect(removeKeyedBackgroundFromDataUrl).toHaveBeenCalledWith('data:image/png;base64,generated')
    const [task] = useStore.getState().tasks
    expect(task).toMatchObject({
      prompt: '单主体贴纸素材',
      transparentOutput: true,
      transparentPrompt: expect.stringContaining('transparent:单主体贴纸素材'),
      status: 'done',
    })
    expect(task.transparentPrompt).toContain('Global consistency requirements')
    expect(task.transparentOriginalImages).toHaveLength(1)
    const outputImage = await getImage(task.outputImages[0])
    const originalImage = await getImage(task.transparentOriginalImages![0])
    expect(outputImage?.dataUrl).toBe('transparent:data:image/png;base64,generated')
    expect(originalImage?.dataUrl).toBe('data:image/png;base64,generated')
    await clearTasks()
    await clearImages()
  })

  it('falls back to the original output when transparent post-processing fails', async () => {
    const { callImageApi } = await import('../lib/api/api')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(callImageApi).mockClear()
    vi.mocked(removeKeyedBackgroundFromDataUrl).mockClear()
    vi.mocked(removeKeyedBackgroundFromDataUrl).mockRejectedValueOnce(new Error('post-process failed'))
    vi.mocked(callImageApi).mockResolvedValueOnce({
      images: ['data:image/png;base64,generated'],
      actualParams: { output_format: 'png' },
      actualParamsList: [{ output_format: 'png' }],
      revisedPrompts: [],
    })
    useStore.setState({
      prompt: '单主体贴纸素材',
      params: {
        ...DEFAULT_PARAMS,
        output_format: 'png',
        output_compression: null,
        transparent_output: true,
      },
    })

    await submitTask()
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    const [task] = useStore.getState().tasks
    expect(task).toMatchObject({
      transparentOutput: true,
      status: 'done',
    })
    expect(task.transparentOriginalImages).toEqual([''])
    const outputImage = await getImage(task.outputImages[0])
    expect(outputImage?.dataUrl).toBe('data:image/png;base64,generated')
    warnSpy.mockRestore()
    await clearTasks()
    await clearImages()
  })

  it('preserves selected image mentions when replacing a mask target with an equivalent image id', () => {
    const replacement = { id: 'image-a-replacement', dataUrl: imageA.dataUrl }
    const prompt = `参考 ${getSelectedImageMentionLabel(0)} 生成`
    useStore.setState({
      prompt,
      inputImages: [imageA, imageB],
    })

    useStore.getState().setInputImages([replacement, imageB], {
      equivalentImageIds: { [imageA.id]: replacement.id },
    })

    const state = useStore.getState()
    expect(state.inputImages.map((img) => img.id)).toEqual([replacement.id, imageB.id])
    expect(state.prompt).toBe(prompt)
  })
})

describe('interrupted OpenAI running tasks', () => {
  it('marks legacy and OpenAI running tasks as interrupted', () => {
    const now = 10_000
    const legacyRunning = task({ id: 'legacy-running', status: 'running', createdAt: 1_000, finishedAt: null, elapsed: null })
    const openAIRunning = task({ id: 'openai-running', apiProvider: 'openai', status: 'running', createdAt: 2_000, finishedAt: null, elapsed: null })
    const grokRunning = task({ id: 'grok-running', apiProvider: 'grok', status: 'running', createdAt: 3_000, finishedAt: null, elapsed: null })
    const customAsyncRunning = task({ id: 'custom-running', apiProvider: 'custom-provider', customTaskId: 'task-1', status: 'running', createdAt: 4_000, finishedAt: null, elapsed: null })
    const doneTask = task({ id: 'done-task', apiProvider: 'openai', status: 'done' })

    const result = markInterruptedOpenAIRunningTasks([legacyRunning, openAIRunning, grokRunning, customAsyncRunning, doneTask], now)

    expect(result.interruptedTasks.map((item) => item.id)).toEqual(['legacy-running', 'openai-running', 'grok-running'])
    expect(result.tasks.find((item) => item.id === 'legacy-running')).toMatchObject({
      status: 'error',
      error: expect.stringContaining('请求中断'),
      finishedAt: now,
      elapsed: 9_000,
    })
    expect(result.tasks.find((item) => item.id === 'openai-running')).toMatchObject({
      status: 'error',
      error: expect.stringContaining('请求中断'),
      finishedAt: now,
      elapsed: 8_000,
    })
    expect(result.tasks.find((item) => item.id === 'grok-running')).toMatchObject({ status: 'error', finishedAt: now, elapsed: 7_000 })
    expect(result.tasks.find((item) => item.id === 'custom-running')).toEqual(customAsyncRunning)
    expect(result.tasks.find((item) => item.id === 'done-task')).toEqual(doneTask)
  })
})

describe('input persistence setting', () => {
  beforeEach(() => {
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS },
      appMode: 'gallery',
      prompt: 'prompt',
      inputImages: [imageA],
      galleryInputDraft: null,
      seriesReferenceImage: null,
      dismissedCodexCliPrompts: [],
    })
  })

  it('persists input when restart input restore is enabled', () => {
    const persisted = getPersistedState(useStore.getState())

    expect(persisted.prompt).toBe('prompt')
    expect(persisted.inputImages).toEqual([{ id: imageA.id, dataUrl: '' }])
  })

  it('omits input when restart input restore is disabled', () => {
    useStore.setState({ settings: { ...DEFAULT_SETTINGS, persistInputOnRestart: false } })

    const persisted = getPersistedState(useStore.getState())

    expect(persisted).not.toHaveProperty('prompt')
    expect(persisted).not.toHaveProperty('inputImages')
  })

  it('writes empty input when persisted input is cleared', () => {
    useStore.setState({ prompt: '', inputImages: [] })

    const persisted = getPersistedState(useStore.getState())

    expect(persisted.prompt).toBe('')
    expect(persisted.inputImages).toEqual([])
  })

  it('persists the series reference image without the image payload', () => {
    useStore.setState({
      seriesReferenceImage: {
        id: imageB.id,
        dataUrl: imageB.dataUrl,
        sourceTaskId: 'task-b',
        createdAt: 1,
      },
    })

    const persisted = getPersistedState(useStore.getState())

    expect(persisted.seriesReferenceImage).toEqual({
      id: imageB.id,
      dataUrl: '',
      sourceTaskId: 'task-b',
      createdAt: 1,
    })
  })

  it('keeps five recent series references and persists slots without image payloads', () => {
    for (let i = 1; i <= 6; i += 1) {
      useStore.getState().setSeriesReferenceImage({
        id: `series-${i}`,
        dataUrl: `data:image/png;base64,series-${i}`,
        label: `Reference ${i}`,
        createdAt: i,
      })
    }
    useStore.getState().setSeriesReferenceSlot('person', {
      id: imageB.id,
      dataUrl: imageB.dataUrl,
      label: '固定人物',
      createdAt: 1,
    })

    const current = useStore.getState()
    const persisted = getPersistedState(current)

    expect(current.seriesReferenceHistory.map((item) => item.id)).toEqual([
      imageB.id,
      'series-6',
      'series-5',
      'series-4',
      'series-3',
    ])
    expect(persisted.seriesReferenceHistory?.[0]).toMatchObject({
      id: imageB.id,
      dataUrl: '',
      label: '固定人物',
    })
    expect(persisted.seriesReferenceSlots?.person).toEqual({
      id: imageB.id,
      dataUrl: '',
      label: '固定人物',
      createdAt: 1,
    })
  })
})

describe('creative assets', () => {
  beforeEach(() => {
    useStore.setState({
      creativeStylePresets: [],
      creativeSubjectProfiles: [],
      creativeNegativePresets: [],
      creativeAssetsOpen: false,
      showToast: vi.fn(),
    })
  })

  it('adds and persists creative assets', () => {
    const state = useStore.getState()
    state.addCreativeStylePreset({ title: 'Style A', content: 'cinematic light', tags: ['film'] })
    state.addCreativeSubjectProfile({ name: 'Hero', description: 'same character', negativePrompt: 'do not change face' })
    state.addCreativeNegativePreset({ title: 'Avoid', content: 'bad hands' })

    const persisted = getPersistedState(useStore.getState())

    expect(persisted.creativeStylePresets?.[0]).toMatchObject({ title: 'Style A', content: 'cinematic light', tags: ['film'] })
    expect(persisted.creativeSubjectProfiles?.[0]).toMatchObject({ name: 'Hero', description: 'same character' })
    expect(persisted.creativeNegativePresets?.[0]).toMatchObject({ title: 'Avoid', content: 'bad hands' })
  })

  it('keeps the creative assets modal transient', () => {
    useStore.setState({ creativeAssetsOpen: true })

    const persisted = getPersistedState(useStore.getState())

    expect(persisted).not.toHaveProperty('creativeAssetsOpen')
  })
})

describe('clear data', () => {
  it('clears the active series reference when task images are cleared', async () => {
    useStore.setState({
      seriesReferenceImage: {
        id: imageB.id,
        dataUrl: imageB.dataUrl,
        sourceTaskId: 'task-b',
        createdAt: 1,
      },
      seriesReferenceHistory: [{
        id: 'history-image',
        dataUrl: 'data:image/png;base64,history',
        createdAt: 2,
      }],
      seriesReferenceSlots: {
        person: {
          id: 'person-image',
          dataUrl: 'data:image/png;base64,person',
          createdAt: 3,
        },
        product: null,
        style: null,
      },
      showToast: vi.fn(),
    })

    await clearData({ clearConfig: false, clearTasks: true })

    expect(useStore.getState().seriesReferenceImage).toBeNull()
    expect(useStore.getState().seriesReferenceHistory).toEqual([])
    expect(useStore.getState().seriesReferenceSlots).toEqual({
      person: null,
      product: null,
      style: null,
    })
  })
})

describe('agent conversation persistence', () => {
  beforeEach(async () => {
    await clearAgentConversations()
  })

  it('omits agent conversations from localStorage state', () => {
    const conversation = agentConversation({
      rounds: [{
        id: 'round-a',
        index: 1,
        parentRoundId: null,
        userMessageId: 'user-a',
        assistantMessageId: 'assistant-a',
        prompt: '画一张图',
        inputImageIds: [],
        outputTaskIds: ['task-a'],
        responseOutput: [
          { type: 'message', content: [{ type: 'output_text', text: '已生成图片。' }] },
          { type: 'image_generation_call', id: 'image-call-a', result: 'large-base64-a' },
          { type: 'image_generation_call', id: 'image-call-b', result: { b64_json: 'large-base64-b', base64: 'large-base64-c', image: 'large-base64-d', data: 'large-base64-e' } },
        ],
        status: 'done',
        error: null,
        createdAt: 1,
        finishedAt: 2,
      }],
      messages: [
        { id: 'user-a', role: 'user', content: '画一张图', roundId: 'round-a', createdAt: 1 },
        { id: 'assistant-a', role: 'assistant', content: '已生成图片。', roundId: 'round-a', outputTaskIds: ['task-a'], createdAt: 2 },
      ],
    })
    useStore.setState({ agentConversations: [conversation] })

    const persisted = getPersistedState(useStore.getState())
    const serializedPersisted = JSON.stringify(persisted)

    expect('agentConversations' in persisted).toBe(false)
    expect(serializedPersisted).not.toContain('image_generation_call')
    expect(serializedPersisted).not.toContain('large-base64')
    expect(JSON.stringify(useStore.getState().agentConversations)).toContain('large-base64-a')
  })

  it('loads agent conversations from IndexedDB and migrates legacy localStorage conversations', async () => {
    const storedConversation = agentConversation({ id: 'stored-conversation', createdAt: 1, updatedAt: 1 })
    const legacyConversation = agentConversation({ id: 'legacy-conversation', createdAt: 2, updatedAt: 2 })
    useStore.setState({ agentConversations: [legacyConversation], activeAgentConversationId: legacyConversation.id })
    await new Promise((resolve) => setTimeout(resolve, 0))
    await putAgentConversation(storedConversation)

    await initStore()

    const state = useStore.getState()
    const stored = await getAllAgentConversations()
    expect(state.agentConversations.map((conversation) => conversation.id)).toEqual(['stored-conversation', 'legacy-conversation'])
    expect(state.activeAgentConversationId).toBe('legacy-conversation')
    expect(stored.map((conversation) => conversation.id)).toEqual(['stored-conversation', 'legacy-conversation'])
  })

  it('strips generated image payloads from legacy task raw payloads during startup migration', async () => {
    await putDbTask(task({
      id: 'legacy-task',
      outputImages: ['image-live'],
      rawResponsePayload: JSON.stringify({
        output: [{ type: 'image_generation_call', id: 'image-call-a', result: 'legacy-task-base64' }],
      }),
    }))

    await initStore()

    const storedTasks = await getAllTasks()
    const serializedStoredTasks = JSON.stringify(storedTasks)
    expect(serializedStoredTasks).toContain('image_generation_call')
    expect(serializedStoredTasks).not.toContain('legacy-task-base64')
  })

  it('keeps agent conversations created while initStore is loading', async () => {
    const legacyConversation = agentConversation({ id: 'legacy-conversation', createdAt: 1, updatedAt: 1 })
    const earlyConversation = agentConversation({ id: 'early-conversation', createdAt: 2, updatedAt: 2 })
    useStore.setState({ agentConversations: [legacyConversation], activeAgentConversationId: legacyConversation.id })

    const initPromise = initStore()
    useStore.setState({ agentConversations: [legacyConversation, earlyConversation], activeAgentConversationId: earlyConversation.id })
    await initPromise

    const state = useStore.getState()
    const stored = await getAllAgentConversations()
    expect(state.agentConversations.map((conversation) => conversation.id)).toEqual(['legacy-conversation', 'early-conversation'])
    expect(state.activeAgentConversationId).toBe('early-conversation')
    expect(stored.map((conversation) => conversation.id)).toEqual(['legacy-conversation', 'early-conversation'])
  })

  it('restores active conversation and draft when localStorage no longer stores conversations', async () => {
    const storedConversation = agentConversation({ id: 'stored-conversation', createdAt: 1, updatedAt: 1 })
    useStore.setState({
      appMode: 'agent',
      agentConversations: [],
      activeAgentConversationId: storedConversation.id,
      agentInputDrafts: {
        [storedConversation.id]: {
          prompt: '未发送草稿',
          inputImages: [],
          maskDraft: null,
          maskEditorImageId: null,
          updatedAt: Date.now(),
        },
      },
      prompt: '',
      inputImages: [],
      maskDraft: null,
      maskEditorImageId: null,
    })
    await putAgentConversation(storedConversation)

    await initStore()

    const state = useStore.getState()
    expect(state.agentConversations.map((conversation) => conversation.id)).toEqual(['stored-conversation'])
    expect(state.activeAgentConversationId).toBe('stored-conversation')
    expect(state.agentInputDrafts['stored-conversation']?.prompt).toBe('未发送草稿')
    expect(state.prompt).toBe('未发送草稿')
  })

  it('strips generated image payloads when migrating old persisted state', () => {
    const migrated = migratePersistedState({
      settings: { ...DEFAULT_SETTINGS },
      agentConversations: [agentConversation({
        rounds: [{
          id: 'round-a',
          index: 1,
          parentRoundId: null,
          userMessageId: 'user-a',
          prompt: '画一张图',
          inputImageIds: [],
          outputTaskIds: ['task-a'],
          responseOutput: [
            { type: 'image_generation_call', id: 'image-call-a', result: 'legacy-base64-a' },
            { type: 'image_generation_call', id: 'image-call-b', result: { b64_json: 'legacy-base64-b', base64: 'legacy-base64-c' } },
          ],
          status: 'done',
          error: null,
          createdAt: 1,
          finishedAt: 2,
        }],
      })],
    })

    const serializedMigrated = JSON.stringify(migrated)
    expect(serializedMigrated).not.toContain('legacy-base64')
    expect(serializedMigrated).toContain('image_generation_call')
  })
})

describe('agent conversation creation', () => {
  beforeEach(() => {
    useStore.setState({
      agentConversations: [],
      activeAgentConversationId: null,
      agentSidebarCollapsed: false,
      agentEditingRoundId: null,
    })
  })

  it('refreshes the latest empty conversation instead of creating another one', () => {
    const olderEmpty = agentConversation({ id: 'older-empty', createdAt: 1_000, updatedAt: 1_000 })
    const latestEmpty = agentConversation({ id: 'latest-empty', createdAt: 2_000, updatedAt: 2_000 })
    const now = vi.spyOn(Date, 'now').mockReturnValue(3_000)
    useStore.setState({
      agentConversations: [olderEmpty, latestEmpty],
      activeAgentConversationId: olderEmpty.id,
      agentSidebarCollapsed: false,
      agentEditingRoundId: 'editing-round',
    })

    const id = useStore.getState().createAgentConversation()

    const state = useStore.getState()
    expect(id).toBe(latestEmpty.id)
    expect(state.activeAgentConversationId).toBe(latestEmpty.id)
    expect(state.agentConversations).toHaveLength(2)
    expect(state.agentConversations.find((item) => item.id === latestEmpty.id)).toMatchObject({
      createdAt: 3_000,
      updatedAt: 3_000,
    })
    expect(state.agentConversations.find((item) => item.id === olderEmpty.id)).toEqual(olderEmpty)
    expect(state.agentSidebarCollapsed).toBe(true)
    expect(state.agentEditingRoundId).toBeNull()
    now.mockRestore()
  })

  it('creates a new conversation when the latest conversation has messages', () => {
    const olderEmpty = agentConversation({ id: 'older-empty', createdAt: 1_000, updatedAt: 1_000 })
    const latestUsed = agentConversation({
      id: 'latest-used',
      activeRoundId: 'round-a',
      createdAt: 2_000,
      updatedAt: 2_000,
      rounds: [{
        id: 'round-a',
        index: 1,
        parentRoundId: null,
        userMessageId: 'message-a',
        prompt: 'prompt',
        inputImageIds: [],
        outputTaskIds: [],
        status: 'done',
        error: null,
        createdAt: 2_000,
        finishedAt: 2_000,
      }],
      messages: [{ id: 'message-a', role: 'user', content: 'prompt', roundId: 'round-a', createdAt: 2_000 }],
    })
    const now = vi.spyOn(Date, 'now').mockReturnValue(3_000)
    useStore.setState({ agentConversations: [olderEmpty, latestUsed], activeAgentConversationId: latestUsed.id })

    const id = useStore.getState().createAgentConversation()

    const state = useStore.getState()
    expect(id).not.toBe(olderEmpty.id)
    expect(id).not.toBe(latestUsed.id)
    expect(state.agentConversations).toHaveLength(3)
    expect(state.agentConversations[state.agentConversations.length - 1]).toMatchObject({ id, createdAt: 3_000, updatedAt: 3_000, messages: [], rounds: [] })
    expect(state.activeAgentConversationId).toBe(id)
    now.mockRestore()
  })
})

describe('agent round deletion', () => {
  it('renumbers later rounds and remaps image mentions after deleting a middle round', () => {
    const conversation = agentConversation({
      activeRoundId: 'round-3',
      rounds: [
        {
          id: 'round-1',
          index: 1,
          parentRoundId: null,
          userMessageId: 'user-1',
          assistantMessageId: 'assistant-1',
          prompt: '第一轮',
          inputImageIds: [],
          outputTaskIds: ['task-1'],
          status: 'done',
          error: null,
          createdAt: 1,
          finishedAt: 2,
        },
        {
          id: 'round-2',
          index: 2,
          parentRoundId: 'round-1',
          userMessageId: 'user-2',
          assistantMessageId: 'assistant-2',
          prompt: '第二轮',
          inputImageIds: [],
          outputTaskIds: ['task-2'],
          status: 'done',
          error: null,
          createdAt: 3,
          finishedAt: 4,
        },
        {
          id: 'round-3',
          index: 3,
          parentRoundId: 'round-2',
          userMessageId: 'user-3',
          assistantMessageId: 'assistant-3',
          prompt: '第三轮',
          inputImageIds: [],
          outputTaskIds: ['task-3'],
          status: 'done',
          error: null,
          createdAt: 5,
          finishedAt: 6,
        },
      ],
      messages: [
        { id: 'user-1', role: 'user', content: '第一轮', roundId: 'round-1', createdAt: 1 },
        { id: 'assistant-1', role: 'assistant', content: '完成', roundId: 'round-1', createdAt: 2 },
        { id: 'user-2', role: 'user', content: '第二轮', roundId: 'round-2', createdAt: 3 },
        { id: 'assistant-2', role: 'assistant', content: '完成', roundId: 'round-2', createdAt: 4 },
        { id: 'user-3', role: 'user', content: '参考 @第1轮图1、@第2轮图1、@第3轮图1', roundId: 'round-3', createdAt: 5 },
        { id: 'assistant-3', role: 'assistant', content: '完成', roundId: 'round-3', createdAt: 6 },
      ],
    })

    const deleted = deleteAgentRoundFromConversation(conversation, 'round-2', 10)

    expect(deleted.rounds.map((round) => ({ id: round.id, index: round.index, parentRoundId: round.parentRoundId }))).toEqual([
      { id: 'round-1', index: 1, parentRoundId: null },
      { id: 'round-3', index: 2, parentRoundId: 'round-1' },
    ])
    expect(deleted.messages.map((message) => message.id)).toEqual(['user-1', 'assistant-1', 'user-3', 'assistant-3'])
    expect(deleted.messages.find((message) => message.id === 'user-3')?.content).toBe('参考 @第1轮图1、@已删除轮次图1、@第2轮图1')
    expect(deleted.activeRoundId).toBe('round-3')
    expect(deleted.updatedAt).toBe(10)
  })

  it('can remap draft mentions using the old and new active paths after deletion', () => {
    const conversation = agentConversation({
      activeRoundId: 'round-3',
      rounds: [
        {
          id: 'round-1',
          index: 1,
          parentRoundId: null,
          userMessageId: 'user-1',
          prompt: '第一轮',
          inputImageIds: [],
          outputTaskIds: ['task-1'],
          status: 'done',
          error: null,
          createdAt: 1,
          finishedAt: 2,
        },
        {
          id: 'round-2',
          index: 2,
          parentRoundId: 'round-1',
          userMessageId: 'user-2',
          prompt: '第二轮',
          inputImageIds: [],
          outputTaskIds: ['task-2'],
          status: 'done',
          error: null,
          createdAt: 3,
          finishedAt: 4,
        },
        {
          id: 'round-3',
          index: 3,
          parentRoundId: 'round-2',
          userMessageId: 'user-3',
          prompt: '第三轮',
          inputImageIds: [],
          outputTaskIds: ['task-3'],
          status: 'done',
          error: null,
          createdAt: 5,
          finishedAt: 6,
        },
      ],
      messages: [],
    })
    const oldPath = getActiveAgentRounds(conversation)
    const deleted = deleteAgentRoundFromConversation(conversation, 'round-2', 10)
    const newPath = getActiveAgentRounds(deleted)

    expect(remapAgentRoundMentionsForPathChange('继续参考 @第1轮图1、@第2轮图1、@第3轮图1', oldPath, newPath))
      .toBe('继续参考 @第1轮图1、@已删除轮次图1、@第2轮图1')
  })
})

describe('data import', () => {
  beforeEach(async () => {
    useStore.setState({
      tasks: [],
      agentConversations: [],
      activeAgentConversationId: null,
      showToast: vi.fn(),
    })
    await clearAgentConversations()
  })

  it('restores favorite collections and default collection when importing task data', async () => {
    await clearTasks()
    const importedCollections = [
      { id: 'imported-collection-a', name: '导入收藏夹 A', createdAt: 1, updatedAt: 1 },
      { id: 'imported-collection-b', name: '导入收藏夹 B', createdAt: 2, updatedAt: 2 },
    ]
    const importedTask = task({
      id: 'imported-favorite-task',
      isFavorite: true,
      favoriteCollectionIds: [importedCollections[1].id],
    })

    const imported = await importData(importFile({
      version: 3,
      exportedAt: new Date(0).toISOString(),
      tasks: [importedTask],
      favoriteCollections: importedCollections,
      defaultFavoriteCollectionId: importedCollections[1].id,
      imageFiles: {},
    }), { importConfig: false, importTasks: true })

    const state = useStore.getState()
    expect(imported).toBe(true)
    expect(state.favoriteCollections).toEqual(expect.arrayContaining(importedCollections))
    expect(state.defaultFavoriteCollectionId).toBe(importedCollections[1].id)
    expect(state.tasks.find((item) => item.id === importedTask.id)).toMatchObject({
      favoriteCollectionIds: [importedCollections[1].id],
      isFavorite: true,
    })
    expect((await getAllTasks()).find((item) => item.id === importedTask.id)).toMatchObject({
      favoriteCollectionIds: [importedCollections[1].id],
      isFavorite: true,
    })
  })

  it('skips empty agent conversations when importing task data', async () => {
    const usedConversation = agentConversation({
      id: 'used-conversation',
      activeRoundId: 'round-a',
      rounds: [{
        id: 'round-a',
        index: 1,
        parentRoundId: null,
        userMessageId: 'message-a',
        prompt: 'prompt',
        inputImageIds: [],
        outputTaskIds: [],
        status: 'done',
        error: null,
        createdAt: 1,
        finishedAt: 2,
      }],
      messages: [{ id: 'message-a', role: 'user', content: 'prompt', roundId: 'round-a', createdAt: 1 }],
    })

    const imported = await importData(importFile({
      version: 3,
      exportedAt: new Date(0).toISOString(),
      tasks: [],
      agentConversations: [
        agentConversation({ id: 'empty-conversation' }),
        usedConversation,
      ],
      imageFiles: {},
    }), { importConfig: false, importTasks: true })

    const state = useStore.getState()
    expect(imported).toBe(true)
    expect(state.agentConversations.map((conversation) => conversation.id)).toEqual(['used-conversation'])
    expect(state.activeAgentConversationId).toBe('used-conversation')
  })

  it('merges imported agent conversations without replacing local conversations', async () => {
    const localConversation = agentConversation({
      id: 'local-conversation',
      title: '本地对话',
      createdAt: 1,
      updatedAt: 1,
    })
    const importedConversation = agentConversation({
      id: 'imported-conversation',
      activeRoundId: 'round-a',
      rounds: [{
        id: 'round-a',
        index: 1,
        parentRoundId: null,
        userMessageId: 'message-a',
        prompt: 'imported prompt',
        inputImageIds: [],
        outputTaskIds: [],
        status: 'done',
        error: null,
        createdAt: 2,
        finishedAt: 3,
      }],
      messages: [{ id: 'message-a', role: 'user', content: 'imported prompt', roundId: 'round-a', createdAt: 2 }],
    })
    useStore.setState({
      agentConversations: [localConversation],
      activeAgentConversationId: localConversation.id,
    })

    const imported = await importData(importFile({
      version: 3,
      exportedAt: new Date(0).toISOString(),
      tasks: [],
      agentConversations: [importedConversation],
      imageFiles: {},
    }), { importConfig: false, importTasks: true })

    const state = useStore.getState()
    expect(imported).toBe(true)
    expect(state.agentConversations.map((conversation) => conversation.id)).toEqual(['local-conversation', 'imported-conversation'])
    expect(state.activeAgentConversationId).toBe('local-conversation')
  })

  it('stores imported legacy agent conversations in IndexedDB without localStorage or image payloads', async () => {
    const importedConversation = agentConversation({
      id: 'legacy-imported-conversation',
      activeRoundId: 'round-a',
      rounds: [{
        id: 'round-a',
        index: 1,
        parentRoundId: null,
        userMessageId: 'message-a',
        prompt: 'imported prompt',
        inputImageIds: [],
        outputTaskIds: ['task-a'],
        responseOutput: [
          { type: 'message', content: [{ type: 'output_text', text: '已生成图片。' }] },
          { type: 'image_generation_call', id: 'image-call-a', result: { base64: 'imported-legacy-base64' } },
        ],
        status: 'done',
        error: null,
        createdAt: 2,
        finishedAt: 3,
      }],
      messages: [{ id: 'message-a', role: 'user', content: 'imported prompt', roundId: 'round-a', createdAt: 2 }],
    })

    const imported = await importData(importFile({
      version: 2,
      exportedAt: new Date(0).toISOString(),
      tasks: [],
      agentConversations: [importedConversation],
      imageFiles: {},
    }), { importConfig: false, importTasks: true })

    const indexedConversations = await getAllAgentConversations()
    const persisted = getPersistedState(useStore.getState())
    const serializedIndexedConversations = JSON.stringify(indexedConversations)
    const serializedPersisted = JSON.stringify(persisted)

    expect(imported).toBe(true)
    expect(indexedConversations.map((conversation) => conversation.id)).toEqual(['legacy-imported-conversation'])
    expect(serializedIndexedConversations).toContain('image_generation_call')
    expect(serializedIndexedConversations).not.toContain('imported-legacy-base64')
    expect('agentConversations' in persisted).toBe(false)
    expect(serializedPersisted).not.toContain('image_generation_call')
    expect(serializedPersisted).not.toContain('imported-legacy-base64')
  })

})

describe('agent draft lifecycle', () => {
  const responsesProfile = createDefaultOpenAIProfile({ id: 'openai-responses', apiKey: 'openai-key', apiMode: 'responses' })
  const draftState = {
    prompt: `参考 ${getSelectedImageMentionLabel(0)} 生成`,
    inputImages: [imageA],
    maskDraft: {
      targetImageId: imageA.id,
      maskDataUrl: 'data:image/png;base64,mask',
      updatedAt: 1,
    },
    maskEditorImageId: imageA.id,
    agentEditingRoundId: 'round-a',
  }

  beforeEach(() => {
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        profiles: [responsesProfile],
        activeProfileId: responsesProfile.id,
      }),
      appMode: 'agent',
      agentConversations: [
        agentConversation({ id: 'conversation-a' }),
        agentConversation({ id: 'conversation-b' }),
      ],
      activeAgentConversationId: 'conversation-a',
      galleryInputDraft: null,
      agentInputDrafts: {},
      agentSidebarCollapsed: false,
      agentAssetPanelCollapsed: false,
      ...draftState,
    })
  })

  it('clears visible input but keeps the agent draft when returning to gallery mode', () => {
    useStore.getState().setAppMode('gallery')

    const state = useStore.getState()
    expect(state.appMode).toBe('gallery')
    expect(state.prompt).toBe('')
    expect(state.inputImages).toEqual([])
    expect(state.maskDraft).toBeNull()
    expect(state.maskEditorImageId).toBeNull()
    expect(state.agentEditingRoundId).toBeNull()
    expect(state.agentInputDrafts['conversation-a']).toMatchObject({
      prompt: draftState.prompt,
      inputImages: draftState.inputImages,
      maskDraft: draftState.maskDraft,
      maskEditorImageId: imageA.id,
    })
  })

  it('restores the agent draft when switching back from gallery mode', () => {
    useStore.getState().setAppMode('gallery')
    useStore.getState().setAppMode('agent')

    const state = useStore.getState()
    expect(state.appMode).toBe('agent')
    expect(state.prompt).toBe(draftState.prompt)
    expect(state.inputImages).toEqual(draftState.inputImages)
    expect(state.maskDraft).toEqual(draftState.maskDraft)
    expect(state.maskEditorImageId).toBe(imageA.id)
    expect(state.agentEditingRoundId).toBeNull()
  })

  it('uses the routed Responses profile when the current profile is Grok', () => {
    const grokProfile = createDefaultGrokProfile({
      id: 'grok-image',
      name: 'Grok Image',
      apiKey: 'grok-key',
    })
    useStore.setState({
      appMode: 'gallery',
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        profiles: [grokProfile, responsesProfile],
        activeProfileId: grokProfile.id,
        agentProfileId: responsesProfile.id,
        agentImageProfileId: grokProfile.id,
      }),
      confirmDialog: null,
    })

    useStore.getState().setAppMode('agent')

    const state = useStore.getState()
    expect(state.appMode).toBe('agent')
    expect(state.confirmDialog).toBeNull()
  })

  it('keeps the gallery draft when switching into agent mode and back', () => {
    const galleryPrompt = `画廊 ${getSelectedImageMentionLabel(0)} 草稿`
    useStore.setState({
      appMode: 'gallery',
      prompt: galleryPrompt,
      inputImages: [imageB],
      maskDraft: null,
      maskEditorImageId: null,
      galleryInputDraft: null,
      agentInputDrafts: {
        'conversation-a': {
          prompt: draftState.prompt,
          inputImages: draftState.inputImages,
          maskDraft: draftState.maskDraft,
          maskEditorImageId: imageA.id,
        },
      },
    })

    useStore.getState().setAppMode('agent')

    let state = useStore.getState()
    expect(state.appMode).toBe('agent')
    expect(state.galleryInputDraft).toMatchObject({ prompt: galleryPrompt, inputImages: [imageB] })
    expect(state.prompt).toBe(draftState.prompt)

    useStore.getState().setAppMode('gallery')

    state = useStore.getState()
    expect(state.appMode).toBe('gallery')
    expect(state.prompt).toBe(galleryPrompt)
    expect(state.inputImages).toEqual([imageB])
  })

  it('persists the gallery draft while agent mode is active', () => {
    const galleryPrompt = 'gallery draft'
    useStore.setState({
      appMode: 'agent',
      galleryInputDraft: {
        prompt: galleryPrompt,
        inputImages: [imageB],
        maskDraft: null,
        maskEditorImageId: null,
      },
    })

    const persisted = getPersistedState(useStore.getState())

    expect(persisted.prompt).toBe(galleryPrompt)
    expect(persisted.inputImages).toEqual([{ id: imageB.id, dataUrl: '' }])
  })

  it('clears stale mentions in the visible input when switching conversations', () => {
    useStore.getState().setActiveAgentConversationId('conversation-b')

    const state = useStore.getState()
    expect(state.activeAgentConversationId).toBe('conversation-b')
    expect(state.prompt).toBe('')
    expect(state.inputImages).toEqual([])
    expect(state.maskDraft).toBeNull()
    expect(state.maskEditorImageId).toBeNull()
    expect(state.agentEditingRoundId).toBeNull()
    expect(state.agentInputDrafts['conversation-a']?.prompt).toBe(draftState.prompt)
  })

  it('restores the previous conversation draft when switching back', () => {
    useStore.getState().setActiveAgentConversationId('conversation-b')
    useStore.getState().setActiveAgentConversationId('conversation-a')

    const state = useStore.getState()
    expect(state.activeAgentConversationId).toBe('conversation-a')
    expect(state.prompt).toBe(draftState.prompt)
    expect(state.inputImages).toEqual(draftState.inputImages)
    expect(state.maskDraft).toEqual(draftState.maskDraft)
    expect(state.maskEditorImageId).toBe(imageA.id)
    expect(state.agentEditingRoundId).toBeNull()
  })

  it('keeps the current draft when selecting the already active conversation', () => {
    useStore.getState().setActiveAgentConversationId('conversation-a')

    const state = useStore.getState()
    expect(state.prompt).toBe(draftState.prompt)
    expect(state.inputImages).toEqual(draftState.inputImages)
    expect(state.maskDraft).toEqual(draftState.maskDraft)
    expect(state.maskEditorImageId).toBe(imageA.id)
  })

  it('persists agent drafts separately from the gallery input draft', () => {
    const persisted = getPersistedState(useStore.getState())

    expect(persisted).not.toHaveProperty('prompt')
    expect(persisted.agentInputDrafts['conversation-a']).toMatchObject({
      prompt: draftState.prompt,
      inputImages: [{ id: imageA.id, dataUrl: '' }],
      maskDraft: draftState.maskDraft,
      maskEditorImageId: imageA.id,
    })
    expect(persisted.agentInputDrafts['conversation-a']?.updatedAt).toEqual(expect.any(Number))
  })

  it('removes stale agent drafts except the last active conversation', () => {
    const now = 10 * 24 * 60 * 60 * 1000
    const staleUpdatedAt = now - 3 * 24 * 60 * 60 * 1000 - 1
    const recentUpdatedAt = now - 3 * 24 * 60 * 60 * 1000
    const activeDraft = { prompt: 'active', inputImages: [], maskDraft: null, maskEditorImageId: null, updatedAt: staleUpdatedAt }
    const staleDraft = { prompt: 'stale', inputImages: [], maskDraft: null, maskEditorImageId: null, updatedAt: staleUpdatedAt }
    const recentDraft = { prompt: 'recent', inputImages: [], maskDraft: null, maskEditorImageId: null, updatedAt: recentUpdatedAt }

    const cleaned = cleanStaleAgentInputDrafts({
      'conversation-a': activeDraft,
      'conversation-b': staleDraft,
      'conversation-c': recentDraft,
    }, 'conversation-a', now)

    expect(cleaned).toEqual({
      'conversation-a': activeDraft,
      'conversation-c': recentDraft,
    })
  })

})

describe('agent context for removed outputs', () => {
  beforeEach(() => {
    const profile = createDefaultOpenAIProfile({
      id: 'responses-profile',
      apiKey: 'test-key',
      apiMode: 'responses',
      model: DEFAULT_RESPONSES_MODEL,
    })
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        apiMode: 'responses',
        model: DEFAULT_RESPONSES_MODEL,
        profiles: [profile],
        activeProfileId: profile.id,
      }),
      prompt: '继续',
      inputImages: [],
      maskDraft: null,
      params: { ...DEFAULT_PARAMS },
      appMode: 'agent',
      tasks: [task({
        id: 'task-live',
        outputImages: ['image-live'],
        sourceMode: 'agent',
        agentRoundId: 'round-a',
        agentToolCallId: 'live-call',
      })],
      agentConversations: [agentConversation({
        id: 'conversation-a',
        activeRoundId: 'round-a',
        rounds: [{
          id: 'round-a',
          index: 1,
          parentRoundId: null,
          userMessageId: 'user-a',
          assistantMessageId: 'assistant-a',
          prompt: '画两张图',
          inputImageIds: [],
          outputTaskIds: ['task-deleted', 'task-live'],
          responseOutput: [
            { type: 'message', content: [{ type: 'output_text', text: '已生成两张图。' }] },
            { type: 'image_generation_call', id: 'deleted-call', result: 'deleted-base64' },
            { type: 'image_generation_call', id: 'live-call', result: 'live-base64' },
          ],
          status: 'done',
          error: null,
          createdAt: 1,
          finishedAt: 2,
        }],
        messages: [
          { id: 'user-a', role: 'user', content: '画两张图', roundId: 'round-a', createdAt: 1 },
          { id: 'assistant-a', role: 'assistant', content: '已生成两张图。', roundId: 'round-a', outputTaskIds: ['task-deleted', 'task-live'], createdAt: 2 },
        ],
      })],
      activeAgentConversationId: 'conversation-a',
      agentEditingRoundId: null,
      showToast: vi.fn(),
    })
    vi.mocked(callAgentResponsesApi).mockClear()
    vi.mocked(callAgentResponsesApi).mockResolvedValue({
      text: 'ok',
      images: [],
      outputItems: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }],
      responseId: 'response-b',
    })
  })

  it('does not send removed image_generation results back to the model', async () => {
    await putImage({ id: 'image-live', dataUrl: 'data:image/png;base64,live-base64' })
    await submitAgentMessage()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const input = vi.mocked(callAgentResponsesApi).mock.calls[0][0].input
    const serializedInput = JSON.stringify(input)
    expect(serializedInput).not.toContain('deleted-base64')
    expect(serializedInput).toContain('live-base64')
    expect(serializedInput).not.toContain('deleted-call')
    expect(serializedInput).not.toContain('live-call')
    expect(serializedInput).not.toContain('image_generation_call')
    expect(serializedInput).toContain('removed_ref')
    expect(serializedInput).toContain('round-1-image-1')
    expect(serializedInput).toContain('round-1-image-2')
    expect(serializedInput).toContain('input_image')
  })

  it('restores stripped image_generation results from task payloads when building context', async () => {
    await putImage({ id: 'image-live', dataUrl: 'data:image/png;base64,live-base64' })
    const rawResponsePayload = JSON.stringify({
      output: [
        { type: 'message', content: [{ type: 'output_text', text: '已生成两张图。' }] },
        { type: 'image_generation_call', id: 'deleted-call', result: 'deleted-base64' },
        { type: 'image_generation_call', id: 'live-call', result: 'live-base64' },
      ],
    }, null, 2)
    useStore.setState((state) => ({
      tasks: [task({
        id: 'task-live',
        outputImages: ['image-live'],
        rawResponsePayload,
        sourceMode: 'agent',
        agentRoundId: 'round-a',
        agentToolCallId: 'live-call',
      })],
      agentConversations: state.agentConversations.map((conversation) => ({
        ...conversation,
        rounds: conversation.rounds.map((round) => round.id === 'round-a'
          ? {
              ...round,
              responseOutput: [
                { type: 'message', content: [{ type: 'output_text', text: '已生成两张图。' }] },
                { type: 'image_generation_call', id: 'deleted-call' },
                { type: 'image_generation_call', id: 'live-call' },
              ],
            }
          : round,
        ),
      })),
    }))

    await submitAgentMessage()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const input = vi.mocked(callAgentResponsesApi).mock.calls[0][0].input
    const serializedInput = JSON.stringify(input)
    expect(serializedInput).toContain('live-base64')
    expect(serializedInput).toContain('input_image')
    expect(serializedInput).not.toContain('deleted-base64')
    expect(serializedInput).not.toContain('live-call')
    expect(serializedInput).not.toContain('image_generation_call')
  })

  it('hydrates stripped task payload image results from stored images when building context', async () => {
    await putImage({ id: 'image-hydrate', dataUrl: 'data:image/png;base64,hydrated-live-base64' })
    const rawResponsePayload = JSON.stringify({
      output: [{ type: 'image_generation_call' }],
    }, null, 2)
    useStore.setState((state) => ({
      tasks: [task({
        id: 'task-live',
        outputImages: ['image-hydrate'],
        rawResponsePayload,
        sourceMode: 'agent',
        agentRoundId: 'round-a',
      })],
      agentConversations: state.agentConversations.map((conversation) => ({
        ...conversation,
        rounds: conversation.rounds.map((round) => round.id === 'round-a'
          ? {
              ...round,
              outputTaskIds: ['task-live'],
              responseOutput: [{ type: 'image_generation_call' }],
            }
          : round,
        ),
      })),
    }))

    await submitAgentMessage()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const input = vi.mocked(callAgentResponsesApi).mock.calls[0][0].input
    const serializedInput = JSON.stringify(input)
    expect(serializedInput).toContain('hydrated-live-base64')
  })

  it('restores stripped image results even when legacy tasks lack tool call ids', async () => {
    await putImage({ id: 'image-legacy', dataUrl: 'data:image/png;base64,legacy-live-base64' })
    const rawResponsePayload = JSON.stringify({
      output: [
        { type: 'message', content: [{ type: 'output_text', text: '已生成图片。' }] },
        { type: 'image_generation_call', result: { base64: 'legacy-live-base64' } },
      ],
    }, null, 2)
    useStore.setState((state) => ({
      tasks: [task({
        id: 'legacy-task-live',
        outputImages: ['image-legacy'],
        rawResponsePayload,
        sourceMode: 'agent',
        agentRoundId: 'round-a',
        agentToolCallId: undefined,
      })],
      agentConversations: state.agentConversations.map((conversation) => ({
        ...conversation,
        rounds: conversation.rounds.map((round) => round.id === 'round-a'
          ? {
              ...round,
              outputTaskIds: ['legacy-task-live'],
              responseOutput: [
                { type: 'message', content: [{ type: 'output_text', text: '已生成图片。' }] },
                { type: 'image_generation_call' },
              ],
            }
          : round,
        ),
      })),
    }))

    await submitAgentMessage()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const input = vi.mocked(callAgentResponsesApi).mock.calls[0][0].input
    const serializedInput = JSON.stringify(input)
    expect(serializedInput).toContain('legacy-live-base64')
    expect(serializedInput).toContain('input_image')
    expect(serializedInput).not.toContain('image_generation_call')
    expect(serializedInput.match(/已生成图片。/g)).toHaveLength(1)
  })

  it('restores all stripped batch image results after restart', async () => {
    await putImage({ id: 'image-batch-1', dataUrl: 'data:image/png;base64,batch-base64-1' })
    await putImage({ id: 'image-batch-2', dataUrl: 'data:image/png;base64,batch-base64-2' })
    const batchOnePayload = JSON.stringify({
      output: [{ type: 'image_generation_call', id: 'batch-call-1', result: 'batch-base64-1' }],
    }, null, 2)
    const batchTwoPayload = JSON.stringify({
      output: [{ type: 'image_generation_call', id: 'batch-call-2', result: 'batch-base64-2' }],
    }, null, 2)
    useStore.setState((state) => ({
      tasks: [
        task({
          id: 'task-batch-1',
          outputImages: ['image-batch-1'],
          rawResponsePayload: batchOnePayload,
          sourceMode: 'agent',
          agentRoundId: 'round-a',
          agentToolCallId: 'batch-call-1',
          agentBatchCallId: 'batch-fc-1',
        }),
        task({
          id: 'task-batch-2',
          outputImages: ['image-batch-2'],
          rawResponsePayload: batchTwoPayload,
          sourceMode: 'agent',
          agentRoundId: 'round-a',
          agentToolCallId: 'batch-call-2',
          agentBatchCallId: 'batch-fc-1',
        }),
      ],
      agentConversations: state.agentConversations.map((conversation) => ({
        ...conversation,
        rounds: conversation.rounds.map((round) => round.id === 'round-a'
          ? {
              ...round,
              outputTaskIds: ['task-batch-1', 'task-batch-2'],
              responseOutput: [
                { type: 'function_call', name: 'generate_image_batch', call_id: 'batch-fc-1', arguments: '{}' },
                { type: 'function_call_output', call_id: 'batch-fc-1', output: '{"images":[{"id":"1","status":"done"},{"id":"2","status":"done"}]}' },
                { type: 'image_generation_call' },
                { type: 'image_generation_call' },
              ],
            }
          : round,
        ),
      })),
    }))

    await submitAgentMessage()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const input = vi.mocked(callAgentResponsesApi).mock.calls[0][0].input
    const serializedInput = JSON.stringify(input)
    expect(serializedInput).toContain('batch-base64-1')
    expect(serializedInput).toContain('batch-base64-2')
    expect(serializedInput).toContain('input_image')
    expect(serializedInput).not.toContain('batch-call-1')
    expect(serializedInput).not.toContain('batch-call-2')
    expect(serializedInput).not.toContain('image_generation_call')
  })

  it('retries Agent requests with reduced image context when the request body is too large', async () => {
    const retryProfile = createDefaultOpenAIProfile({
      id: 'responses-profile-retry',
      apiKey: 'test-key',
      apiMode: 'responses',
      model: DEFAULT_RESPONSES_MODEL,
      streamImages: true,
    })
    const largeBase64 = 'A'.repeat(900_000)
    await putImage({ id: 'image-big-1', dataUrl: `data:image/jpeg;base64,${largeBase64}` })
    await putImage({ id: 'image-big-2', dataUrl: `data:image/jpeg;base64,${largeBase64}` })

    useStore.setState((state) => ({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        apiMode: 'responses',
        model: DEFAULT_RESPONSES_MODEL,
        streamImages: true,
        profiles: [retryProfile],
        activeProfileId: retryProfile.id,
      }),
      prompt: '继续改这两张图',
      inputImages: [
        { id: 'image-big-1', dataUrl: '' },
        { id: 'image-big-2', dataUrl: '' },
      ],
      maskDraft: null,
      params: { ...DEFAULT_PARAMS },
      appMode: 'agent',
      tasks: [],
      streamPreviews: {},
      streamPreviewSlots: {},
      agentConversations: [agentConversation({
        id: 'conversation-retry',
        activeRoundId: null,
        rounds: [],
        messages: [],
      })],
      activeAgentConversationId: 'conversation-retry',
      agentEditingRoundId: null,
      showToast: vi.fn(),
    }))

    vi.mocked(callAgentResponsesApi)
      .mockRejectedValueOnce(new Error('Request body exceeds your tier limit (5MB for tier 0). Please upgrade your plan or split the context.'))
      .mockResolvedValueOnce({
        text: '已自动缩减上下文后继续',
        images: [],
        outputItems: [{ type: 'message', content: [{ type: 'output_text', text: '已自动缩减上下文后继续' }] }],
        responseId: 'response-retry',
      })

    await submitAgentMessage()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(vi.mocked(callAgentResponsesApi)).toHaveBeenCalledTimes(2)
    const firstInput = vi.mocked(callAgentResponsesApi).mock.calls[0][0].input
    const retryInput = vi.mocked(callAgentResponsesApi).mock.calls[1][0].input
    const firstSerialized = JSON.stringify(firstInput)
    const retrySerialized = JSON.stringify(retryInput)

    expect(firstSerialized).toContain('input_image')
    expect(retrySerialized.length).toBeLessThan(firstSerialized.length)
    expect(retrySerialized).not.toContain('input_image')
    expect(useStore.getState().agentContextNotice).toMatchObject({
      conversationId: 'conversation-retry',
      message: expect.stringContaining('5MB'),
    })
  })

  it('scrubs stored agent response payloads when deleting an output task', async () => {
    const rawResponsePayload = JSON.stringify({
      output: [
        { type: 'message', content: [{ type: 'output_text', text: '已生成两张图。' }] },
        { type: 'image_generation_call', id: 'deleted-call', result: 'deleted-base64' },
        { type: 'image_generation_call', id: 'live-call', result: 'live-base64' },
      ],
    }, null, 2)
    const deletedTask = task({
      id: 'task-deleted',
      outputImages: ['image-deleted'],
      rawResponsePayload,
      sourceMode: 'agent',
      agentRoundId: 'round-a',
      agentToolCallId: 'deleted-call',
    })
    const liveTask = task({
      id: 'task-live',
      outputImages: ['image-live'],
      rawResponsePayload,
      sourceMode: 'agent',
      agentRoundId: 'round-a',
      agentToolCallId: 'live-call',
    })
    useStore.setState((state) => ({
      tasks: [deletedTask, liveTask],
      agentConversations: state.agentConversations.map((conversation) => ({
        ...conversation,
        rounds: conversation.rounds.map((round) => round.id === 'round-a'
          ? { ...round, outputTaskIds: ['task-deleted', 'task-live'], responseOutput: JSON.parse(rawResponsePayload).output }
          : round,
        ),
      })),
    }))

    await removeTask(deletedTask)

    const state = useStore.getState()
    const serializedConversations = JSON.stringify(state.agentConversations)
    const remainingTaskPayload = state.tasks.find((item) => item.id === 'task-live')?.rawResponsePayload ?? ''
    expect(serializedConversations).not.toContain('deleted-base64')
    expect(remainingTaskPayload).not.toContain('deleted-base64')
    expect(serializedConversations).toContain('live-base64')
    expect(remainingTaskPayload).toContain('live-base64')
  })

  it('does not corrupt batch task payloads when deleting one of the batch tasks', async () => {
    const batchDeletedPayload = JSON.stringify({
      output: [{ type: 'image_generation_call', id: 'batch-deleted-call', result: 'batch-deleted-base64' }],
    }, null, 2)
    const batchLivePayload = JSON.stringify({
      output: [{ type: 'image_generation_call', id: 'batch-live-call', result: 'batch-live-base64' }],
    }, null, 2)
    const batchDeletedTask = task({
      id: 'batch-task-deleted',
      outputImages: ['batch-img-deleted'],
      rawResponsePayload: batchDeletedPayload,
      sourceMode: 'agent',
      agentRoundId: 'round-a',
      agentToolCallId: 'batch-deleted-call',
      agentBatchCallId: 'batch-fc-1',
    })
    const batchLiveTask = task({
      id: 'batch-task-live',
      outputImages: ['batch-img-live'],
      rawResponsePayload: batchLivePayload,
      sourceMode: 'agent',
      agentRoundId: 'round-a',
      agentToolCallId: 'batch-live-call',
      agentBatchCallId: 'batch-fc-1',
    })
    useStore.setState((state) => ({
      tasks: [batchDeletedTask, batchLiveTask],
      agentConversations: state.agentConversations.map((conversation) => ({
        ...conversation,
        rounds: conversation.rounds.map((round) => round.id === 'round-a'
          ? {
              ...round,
              outputTaskIds: ['batch-task-deleted', 'batch-task-live'],
              responseOutput: [
                { type: 'function_call', name: 'generate_image_batch', call_id: 'batch-fc-1', arguments: '{}' },
                { type: 'function_call_output', call_id: 'batch-fc-1', output: '{"images":[{"id":"1","status":"done"},{"id":"2","status":"done"}]}' },
              ],
            }
          : round,
        ),
      })),
    }))

    await removeTask(batchDeletedTask)

    const state = useStore.getState()
    const liveTaskPayload = state.tasks.find((item) => item.id === 'batch-task-live')?.rawResponsePayload ?? ''
    expect(liveTaskPayload).toContain('batch-live-base64')
    expect(liveTaskPayload).not.toContain('batch-deleted-base64')
    const serializedConversations = JSON.stringify(state.agentConversations)
    expect(serializedConversations).toContain('function_call_output')
    expect(serializedConversations).not.toContain('batch-deleted-base64')
  })

  it('clears only failed gallery tasks', async () => {
    const failedA = task({ id: 'failed-a', status: 'error', error: '生成失败', outputImages: ['failed-image-a'] })
    const failedB = task({ id: 'failed-b', status: 'error', error: '生成失败', outputImages: ['failed-image-b'] })
    const done = task({ id: 'done-task', status: 'done', outputImages: ['done-image'] })
    const running = task({ id: 'running-task', status: 'running', finishedAt: null, elapsed: null })
    useStore.setState({
      tasks: [failedA, done, failedB, running],
      selectedTaskIds: ['failed-a', 'done-task', 'failed-b'],
      showToast: vi.fn(),
    })

    await clearFailedTasks()

    const state = useStore.getState()
    expect(state.tasks.map((item) => item.id)).toEqual(['done-task', 'running-task'])
    expect(state.selectedTaskIds).toEqual(['done-task'])
    expect(state.showToast).toHaveBeenCalledWith('已删除 2 个任务', 'success')
  })

  it('matches partial failures in failed filters and searches error text', () => {
    const partial = task({
      id: 'partial-task',
      status: 'done',
      outputImages: ['done-image-a', 'done-image-b'],
      outputErrors: [{ requestIndex: 2, error: 'Failed to fetch' }],
    })

    expect(taskMatchesFilterStatus(partial, 'error')).toBe(true)
    expect(taskMatchesFilterStatus(partial, 'done')).toBe(true)
    expect(taskMatchesSearchQuery(partial, 'failed to fetch')).toBe(true)
  })

  it('matches task notes and tags when searching tasks', () => {
    const annotated = task({
      note: 'A 客户首版封面',
      tags: ['头像', '商用'],
    })

    expect(taskMatchesSearchQuery(annotated, '首版')).toBe(true)
    expect(taskMatchesSearchQuery(annotated, '商用')).toBe(true)
  })

  it('clears partial failure markers without deleting successful outputs', async () => {
    const partial = task({
      id: 'partial-task',
      status: 'done',
      outputImages: ['done-image-a'],
      outputErrors: [{ requestIndex: 1, error: 'Failed to fetch' }],
    })
    useStore.setState({ tasks: [partial], selectedTaskIds: ['partial-task'], showToast: vi.fn() })

    await clearFailedTasks(['partial-task'])

    const state = useStore.getState()
    expect(state.tasks).toHaveLength(1)
    expect(state.tasks[0]).toMatchObject({ id: 'partial-task', outputImages: ['done-image-a'], outputErrors: undefined })
    expect(state.selectedTaskIds).toEqual([])
    expect(state.showToast).toHaveBeenCalledWith('已清除 1 条部分失败记录', 'success')
  })

  it('keeps failed tasks created after the cleanup snapshot', async () => {
    const failedAtConfirmOpen = task({ id: 'failed-at-confirm-open', status: 'error', error: '生成失败' })
    const failedAfterConfirmOpen = task({ id: 'failed-after-confirm-open', status: 'error', error: '生成失败' })
    useStore.setState({ tasks: [failedAtConfirmOpen] })
    const failedTaskIds = useStore.getState().tasks
      .filter((item) => item.status === 'error')
      .map((item) => item.id)
    useStore.setState({ tasks: [failedAtConfirmOpen, failedAfterConfirmOpen] })

    await clearFailedTasks(failedTaskIds)

    expect(useStore.getState().tasks.map((item) => item.id)).toEqual(['failed-after-confirm-open'])
  })
})

describe('agent built-in image tool failure', () => {
  const responsesProfile = createDefaultOpenAIProfile({
    id: 'responses-profile',
    apiKey: 'test-key',
    apiMode: 'responses',
    model: DEFAULT_RESPONSES_MODEL,
    streamImages: true,
  })
  const videoProfile = createDefaultOpenAIProfile({
    id: 'video-profile',
    apiKey: 'video-key',
    apiMode: 'videos',
    model: 'grok-imagine-video',
    streamImages: true,
  })

  beforeEach(async () => {
    await clearTasks()
    await clearImages()
    await clearAgentConversations()
    vi.mocked(callAgentResponsesApi).mockClear()
    vi.mocked(createVideoGenerationTask).mockClear()
    vi.mocked(pollVideoGenerationTask).mockClear()
    await clearVideoRecords()
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        apiMode: 'responses',
        model: DEFAULT_RESPONSES_MODEL,
        streamImages: true,
        profiles: [responsesProfile, videoProfile],
        activeProfileId: responsesProfile.id,
        videoProfileId: videoProfile.id,
      }),
      prompt: '画一张图',
      inputImages: [],
      maskDraft: null,
      params: { ...DEFAULT_PARAMS },
      appMode: 'agent',
      tasks: [],
      streamPreviews: {},
      streamPreviewSlots: {},
      agentConversations: [agentConversation({
        id: 'conversation-a',
        activeRoundId: null,
        rounds: [],
        messages: [],
      })],
      activeAgentConversationId: 'conversation-a',
      agentEditingRoundId: null,
      showToast: vi.fn(),
    })
  })

  it('keeps retried Agent image tasks attached to the original round and message', async () => {
    const { callImageApi } = await import('../lib/api/api')
    vi.mocked(callImageApi).mockImplementationOnce(() => new Promise(() => {}))
    const failedTask = task({
      id: 'agent-failed-task',
      prompt: '鐢讳竴寮犵尗',
      status: 'error',
      error: 'upstream failed',
      sourceMode: 'agent',
      agentConversationId: 'conversation-a',
      agentRoundId: 'round-a',
      agentMessageId: 'assistant-a',
      agentToolCallId: 'tool-call-a',
      agentToolAction: 'generate',
    })

    useStore.setState({
      tasks: [failedTask],
      agentConversations: [agentConversation({
        id: 'conversation-a',
        activeRoundId: 'round-a',
        rounds: [{
          id: 'round-a',
          index: 1,
          userMessageId: 'user-a',
          assistantMessageId: 'assistant-a',
          prompt: failedTask.prompt,
          inputImageIds: [],
          outputTaskIds: [failedTask.id],
          status: 'error',
          error: failedTask.error,
          createdAt: 1,
          finishedAt: 2,
        }],
        messages: [
          { id: 'user-a', role: 'user', content: failedTask.prompt, roundId: 'round-a', createdAt: 1 },
          { id: 'assistant-a', role: 'assistant', content: '鐢熷浘澶辫触', roundId: 'round-a', outputTaskIds: [failedTask.id], createdAt: 2 },
        ],
      })],
    })

    await retryTask(failedTask)

    const state = useStore.getState()
    const retriedTask = state.tasks[0]
    expect(retriedTask.id).not.toBe(failedTask.id)
    expect(retriedTask).toMatchObject({
      status: 'running',
      sourceMode: 'agent',
      agentConversationId: 'conversation-a',
      agentRoundId: 'round-a',
      agentMessageId: 'assistant-a',
      agentToolCallId: 'tool-call-a',
      parentTaskId: failedTask.id,
    })
    expect(state.agentConversations[0].rounds[0].outputTaskIds).toEqual([
      failedTask.id,
      retriedTask.id,
    ])
    expect(state.agentConversations[0].messages[1].outputTaskIds).toEqual([
      failedTask.id,
      retriedTask.id,
    ])
  })

  it('marks a started built-in image task as error when the stream fails', async () => {
    vi.mocked(callAgentResponsesApi).mockImplementationOnce(async (opts) => {
      await opts.onImageToolStarted?.({ toolCallId: 'ig-fail' })
      await opts.onImagePartialImage?.({
        toolCallId: 'ig-fail',
        image: 'data:image/png;base64,cGFydGlhbA==',
        partialImageIndex: 0,
      })
      throw new Error('image_generation failed')
    })

    await submitAgentMessage()
    for (let i = 0; i < 10 && useStore.getState().tasks[0]?.status !== 'error'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    const state = useStore.getState()
    const failedTask = state.tasks[0]
    expect(failedTask).toMatchObject({
      status: 'error',
      error: 'image_generation failed',
      agentToolCallId: 'ig-fail',
      sourceMode: 'agent',
    })
    expect(state.streamPreviews[failedTask.id]).toBeUndefined()
    expect(state.streamPreviewSlots[failedTask.id]).toBeUndefined()

    const round = state.agentConversations[0].rounds[0]
    expect(round).toMatchObject({
      status: 'error',
      error: 'image_generation failed',
      outputTaskIds: [failedTask.id],
    })
  })

  it('marks a failed built-in image task as error while the Agent stream continues', async () => {
    vi.mocked(callAgentResponsesApi).mockImplementationOnce(async (opts) => {
      await opts.onImageToolStarted?.({ toolCallId: 'ig-fail' })
      await opts.onImagePartialImage?.({
        toolCallId: 'ig-fail',
        image: 'data:image/png;base64,cGFydGlhbA==',
        partialImageIndex: 0,
      })
      await opts.onImageToolFailed?.({ toolCallId: 'ig-fail', error: 'safety rejected' })
      opts.onTextDelta?.('图片失败，但回复继续。')
      return {
        text: '图片失败，但回复继续。',
        images: [],
        outputItems: [{ type: 'message', content: [{ type: 'output_text', text: '图片失败，但回复继续。' }] }],
        responseId: 'response-continued',
      }
    })

    await submitAgentMessage()
    for (let i = 0; i < 10 && useStore.getState().agentConversations[0].rounds[0]?.status !== 'done'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    const state = useStore.getState()
    const failedTask = state.tasks[0]
    expect(failedTask).toMatchObject({
      status: 'error',
      error: 'safety rejected',
      agentToolCallId: 'ig-fail',
      sourceMode: 'agent',
    })
    expect(state.streamPreviews[failedTask.id]).toBeUndefined()
    expect(state.streamPreviewSlots[failedTask.id]).toBeUndefined()

    const round = state.agentConversations[0].rounds[0]
    expect(round).toMatchObject({
      status: 'done',
      error: null,
      outputTaskIds: [failedTask.id],
    })
    expect(state.agentConversations[0].messages.find((message) => message.role === 'assistant')).toMatchObject({
      content: '图片失败，但回复继续。',
      outputTaskIds: [failedTask.id],
    })
  })

  it('stops Agent continuation after repeated image tool failures', async () => {
    vi.mocked(callAgentResponsesApi).mockImplementation(async () => ({
      text: '',
      images: [],
      outputItems: [
        {
          type: 'function_call',
          name: 'generate_image',
          call_id: `image-fc-${vi.mocked(callAgentResponsesApi).mock.calls.length}`,
          arguments: JSON.stringify({ prompt: 'test image' }),
        },
      ],
      responseId: `response-${vi.mocked(callAgentResponsesApi).mock.calls.length}`,
    }))
    vi.mocked(callBatchImageSingle).mockClear()
    vi.mocked(callBatchImageSingle).mockResolvedValue({
      batchItemId: 'image',
      image: null,
      error: 'upstream failed',
    })

    await submitAgentMessage()
    for (let i = 0; i < 20 && vi.mocked(createVideoGenerationTask).mock.calls.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    const state = useStore.getState()
    expect(callBatchImageSingle).toHaveBeenCalledTimes(2)
    expect(callAgentResponsesApi).toHaveBeenCalledTimes(2)
    expect(state.agentConversations[0].rounds[0]).toMatchObject({
      status: 'done',
      error: null,
    })
    expect(state.agentConversations[0].messages.find((message) => message.role === 'assistant')?.content)
      .toContain('API')
  })

  it('keeps generated images successful when the follow-up Agent response is unauthorized', async () => {
    vi.mocked(callAgentResponsesApi)
      .mockResolvedValueOnce({
        text: '',
        images: [],
        outputItems: [{
          type: 'function_call',
          name: 'generate_image',
          call_id: 'image-call',
          arguments: JSON.stringify({ prompt: 'draw product' }),
        }],
        responseId: 'response-before-image',
      })
      .mockRejectedValueOnce(new Error('401 Unauthorized'))
    vi.mocked(callBatchImageSingle).mockClear()
    vi.mocked(callBatchImageSingle).mockImplementationOnce(async (opts) => {
      await opts.onImageToolCompleted?.({
        dataUrl: 'data:image/png;base64,generated',
        revisedPrompt: 'draw product',
      })
      return {
      batchItemId: 'image',
      image: { dataUrl: 'data:image/png;base64,generated', revisedPrompt: 'draw product' },
      error: null,
      }
    })

    await submitAgentMessage()
    for (let i = 0; i < 20 && useStore.getState().agentConversations[0].rounds[0]?.status !== 'done'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    const state = useStore.getState()
    const round = state.agentConversations[0].rounds[0]
    const task = state.tasks[0]
    const assistantMessage = state.agentConversations[0].messages.find((message) => message.role === 'assistant')

    expect(callBatchImageSingle).toHaveBeenCalledTimes(1)
    expect(task).toMatchObject({
      status: 'done',
      sourceMode: 'agent',
      outputImages: expect.any(Array),
    })
    expect(round).toMatchObject({
      status: 'done',
      error: null,
      outputTaskIds: [task.id],
    })
    expect(assistantMessage?.content).toBe('图片已生成。')
    expect(assistantMessage?.content).not.toContain('Unauthorized')
    expect(assistantMessage?.outputTaskIds).toEqual([task.id])
  })

  it('lets Agent answer plain text while keeping media tools available for context', async () => {
    vi.mocked(callBatchImageSingle).mockClear()
    vi.mocked(callAgentResponsesApi).mockResolvedValueOnce({
      text: '可以，我来帮你分析。',
      images: [],
      outputItems: [{ type: 'message', content: [{ type: 'output_text', text: '可以，我来帮你分析。' }] }],
      responseId: 'plain-response',
    })
    useStore.setState({ prompt: '帮我分析一下这个项目还有哪些优化点' })

    await submitAgentMessage()
    for (let i = 0; i < 20 && useStore.getState().agentConversations[0].rounds[0]?.status !== 'done'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    expect(callAgentResponsesApi).toHaveBeenCalledTimes(1)
    expect(callAgentResponsesApi).toHaveBeenCalledWith(expect.objectContaining({
      toolsMode: 'auto',
      allowTextOnlyFallback: true,
    }))
    expect(callBatchImageSingle).not.toHaveBeenCalled()
    expect(useStore.getState().agentConversations[0].messages.find((message) => message.role === 'assistant')?.content)
      .toBe('可以，我来帮你分析。')
  })

  it('falls back to direct Agent image generation when the planning request is temporarily unavailable', async () => {
    vi.mocked(callAgentResponsesApi).mockRejectedValue(new Error('Upstream service temporarily unavailable'))
    vi.mocked(callBatchImageSingle).mockClear()
    vi.mocked(callBatchImageSingle).mockResolvedValue({
      batchItemId: 'image',
      image: { dataUrl: 'data:image/png;base64,direct-output', revisedPrompt: '生成一张测试图片' },
      error: null,
    })
    useStore.setState({ prompt: '生成一张测试图片' })

    await submitAgentMessage()
    for (let i = 0; i < 20 && useStore.getState().agentConversations[0].rounds[0]?.status !== 'done'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    const state = useStore.getState()
    const task = state.tasks[0]
    const assistantMessage = state.agentConversations[0].messages.find((message) => message.role === 'assistant')

    expect(callAgentResponsesApi).toHaveBeenCalledTimes(1)
    expect(callBatchImageSingle).toHaveBeenCalledTimes(1)
    expect(callBatchImageSingle).toHaveBeenCalledWith(expect.objectContaining({
      prompt: '生成一张测试图片',
    }))
    expect(task).toMatchObject({
      status: 'done',
      sourceMode: 'agent',
      outputImages: expect.any(Array),
    })
    expect(assistantMessage?.outputTaskIds).toEqual([task.id])
  })

  it('keeps media tools enabled for referenced follow-up image edits', async () => {
    await putImage(imageA)
    vi.mocked(callBatchImageSingle).mockClear()
    vi.mocked(callAgentResponsesApi).mockResolvedValueOnce({
      text: 'I will prepare the edit.',
      images: [],
      outputItems: [{ type: 'message', content: [{ type: 'output_text', text: 'I will prepare the edit.' }] }],
      responseId: 'edit-response',
    })
    useStore.setState({
      prompt: '@第1轮图1 换一个商品',
      tasks: [
        task({
          id: 'task-round-1',
          outputImages: [imageA.id],
          sourceMode: 'agent',
          agentRoundId: 'round-1',
          agentMessageId: 'assistant-1',
          agentToolCallId: 'image-call-1',
        }),
      ],
      agentConversations: [agentConversation({
        id: 'conversation-a',
        activeRoundId: 'round-1',
        rounds: [{
          id: 'round-1',
          index: 1,
          parentRoundId: null,
          userMessageId: 'user-1',
          assistantMessageId: 'assistant-1',
          prompt: 'draw a product',
          inputImageIds: [],
          outputTaskIds: ['task-round-1'],
          status: 'done',
          error: null,
          createdAt: 1,
          finishedAt: 2,
        }],
        messages: [
          { id: 'user-1', role: 'user', content: 'draw a product', roundId: 'round-1', createdAt: 1 },
          { id: 'assistant-1', role: 'assistant', content: 'done', roundId: 'round-1', outputTaskIds: ['task-round-1'], createdAt: 2 },
        ],
      })],
      activeAgentConversationId: 'conversation-a',
    })

    await submitAgentMessage()
    for (let i = 0; i < 20 && useStore.getState().agentConversations[0].rounds[1]?.status !== 'done'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    expect(callAgentResponsesApi).toHaveBeenCalledTimes(1)
    expect(callAgentResponsesApi).toHaveBeenCalledWith(expect.objectContaining({
      toolsMode: 'auto',
      allowTextOnlyFallback: false,
    }))
    expect(callBatchImageSingle).not.toHaveBeenCalled()
  })

  it('lets Agent generate video with the video API profile and keeps the result when follow-up text fails', async () => {
    vi.mocked(callAgentResponsesApi)
      .mockResolvedValueOnce({
        text: '',
        images: [],
        outputItems: [{
          type: 'function_call',
          name: 'generate_video',
          call_id: 'video-call',
          arguments: JSON.stringify({
            prompt: 'make a product video',
            seconds: '8',
            size: '720x1280',
            resolution: '720p',
          }),
        }],
        responseId: 'response-before-video',
      })
      .mockRejectedValueOnce(new Error('401 Unauthorized'))

    await submitAgentMessage()
    for (let i = 0; i < 20 && useStore.getState().agentConversations[0].rounds[0]?.status !== 'done'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    const state = useStore.getState()
    const round = state.agentConversations[0].rounds[0]
    const assistantMessage = state.agentConversations[0].messages.find((message) => message.role === 'assistant')
    const videoRecords = await getAllVideoRecords()
    const completedVideo = videoRecords.find((record) => record.status === 'success')

    expect(createVideoGenerationTask).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'video-key',
        model: 'grok-imagine-video',
        seconds: '8',
        size: '720x1280',
        resolution: '720p',
      }),
      'make a product video',
      [],
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(pollVideoGenerationTask).toHaveBeenCalledTimes(1)
    expect(completedVideo).toMatchObject({
      prompt: 'make a product video',
      model: 'grok-imagine-video',
      status: 'success',
      video: {
        dataUrl: 'data:video/mp4;base64,dmRlbw==',
        remoteUrl: 'https://example.com/video.mp4',
        mimeType: 'video/mp4',
        bytes: 4,
      },
    })
    expect(round).toMatchObject({
      status: 'done',
      error: null,
      outputVideoRecordIds: [completedVideo?.id],
    })
    expect(assistantMessage).toMatchObject({
      content: '视频已生成，可在视频创作台查看。',
      outputVideoRecordIds: [completedVideo?.id],
    })
    expect(assistantMessage?.content).not.toContain('Unauthorized')
    expect(useStore.getState().showToast).toHaveBeenCalledWith('视频已生成', 'success')
  })

  it('passes current Agent input images as video references', async () => {
    await putImage(imageA)
    useStore.setState({
      inputImages: [{ id: imageA.id, dataUrl: imageA.dataUrl }],
      prompt: '让这个商品动起来',
    })
    vi.mocked(callAgentResponsesApi)
      .mockResolvedValueOnce({
        text: '',
        images: [],
        outputItems: [{
          type: 'function_call',
          name: 'generate_video',
          call_id: 'video-call-with-ref',
          arguments: JSON.stringify({
            prompt: 'make this product rotate slowly',
            seconds: '6',
          }),
        }],
        responseId: 'response-before-video-ref',
      })
      .mockResolvedValueOnce({
        text: 'ok',
        images: [],
        outputItems: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }],
        responseId: 'response-after-video-ref',
      })

    await submitAgentMessage()
    for (let i = 0; i < 20 && useStore.getState().agentConversations[0].rounds[0]?.status !== 'done'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    expect(createVideoGenerationTask).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'video-key' }),
      'make this product rotate slowly',
      [imageA.dataUrl],
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    const completedVideo = (await getAllVideoRecords()).find((record) => record.status === 'success')
    expect(completedVideo).toMatchObject({
      referenceImageIds: [imageA.id],
      referenceImageCount: 1,
    })
  })


})

describe('agent batch reference resolution', () => {
  const responsesProfile = createDefaultOpenAIProfile({
    id: 'responses-profile',
    apiKey: 'test-key',
    apiMode: 'responses',
    model: DEFAULT_RESPONSES_MODEL,
  })

  beforeEach(async () => {
    await clearImages()
    await putImage(imageA)
    await putImage(imageB)
    vi.mocked(callAgentResponsesApi).mockClear()
    vi.mocked(callBatchImageSingle).mockClear()
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        apiMode: 'responses',
        model: DEFAULT_RESPONSES_MODEL,
        profiles: [responsesProfile],
        activeProfileId: responsesProfile.id,
      }),
      prompt: '继续生成',
      inputImages: [],
      maskDraft: null,
      params: { ...DEFAULT_PARAMS },
      appMode: 'agent',
      tasks: [
        task({ id: 'task-branch-a', outputImages: [imageA.id], sourceMode: 'agent', agentRoundId: 'round-2-a' }),
        task({ id: 'task-branch-b', outputImages: [imageB.id], sourceMode: 'agent', agentRoundId: 'round-2-b' }),
      ],
      agentConversations: [agentConversation({
        id: 'conversation-a',
        activeRoundId: 'round-2-b',
        rounds: [
          {
            id: 'round-1',
            index: 1,
            parentRoundId: null,
            userMessageId: 'user-1',
            assistantMessageId: 'assistant-1',
            prompt: '画基础图',
            inputImageIds: [],
            outputTaskIds: [],
            status: 'done',
            error: null,
            createdAt: 1,
            finishedAt: 2,
          },
          {
            id: 'round-2-a',
            index: 2,
            parentRoundId: 'round-1',
            userMessageId: 'user-2-a',
            assistantMessageId: 'assistant-2-a',
            prompt: '分支 A',
            inputImageIds: [],
            outputTaskIds: ['task-branch-a'],
            status: 'done',
            error: null,
            createdAt: 3,
            finishedAt: 4,
          },
          {
            id: 'round-2-b',
            index: 2,
            parentRoundId: 'round-1',
            userMessageId: 'user-2-b',
            assistantMessageId: 'assistant-2-b',
            prompt: '分支 B',
            inputImageIds: [],
            outputTaskIds: ['task-branch-b'],
            status: 'done',
            error: null,
            createdAt: 5,
            finishedAt: 6,
          },
        ],
        messages: [
          { id: 'user-1', role: 'user', content: '画基础图', roundId: 'round-1', createdAt: 1 },
          { id: 'assistant-1', role: 'assistant', content: '完成', roundId: 'round-1', createdAt: 2 },
          { id: 'user-2-a', role: 'user', content: '分支 A', roundId: 'round-2-a', createdAt: 3 },
          { id: 'assistant-2-a', role: 'assistant', content: '完成', roundId: 'round-2-a', outputTaskIds: ['task-branch-a'], createdAt: 4 },
          { id: 'user-2-b', role: 'user', content: '分支 B', roundId: 'round-2-b', createdAt: 5 },
          { id: 'assistant-2-b', role: 'assistant', content: '完成', roundId: 'round-2-b', outputTaskIds: ['task-branch-b'], createdAt: 6 },
        ],
      })],
      activeAgentConversationId: 'conversation-a',
      agentEditingRoundId: null,
      showToast: vi.fn(),
    })
  })

  it('resolves batch references from the active branch path only', async () => {
    vi.mocked(callAgentResponsesApi)
      .mockResolvedValueOnce({
        text: '',
        images: [],
        outputItems: [{
          type: 'function_call',
          name: 'generate_image_batch',
          call_id: 'batch-call',
          arguments: JSON.stringify({
            images: [{
              id: 'next-image',
              prompt: '参考 <ref id="round-2-image-1" /> 生成',
            }],
          }),
        }],
        responseId: 'response-1',
      })
      .mockResolvedValueOnce({
        text: '完成',
        images: [],
        outputItems: [{ type: 'message', content: [{ type: 'output_text', text: '完成' }] }],
        responseId: 'response-2',
      })

    await submitAgentMessage()

    for (let i = 0; i < 5 && vi.mocked(callBatchImageSingle).mock.calls.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    expect(callBatchImageSingle).toHaveBeenCalled()
    const batchArgs = vi.mocked(callBatchImageSingle).mock.calls[0][0]
    expect(batchArgs.referenceImageDataUrls).toEqual([imageB.dataUrl])
    expect(batchArgs.referenceImageDataUrls).not.toContain(imageA.dataUrl)
    expect(batchArgs.referenceIds).toEqual(['round-2-image-1'])
  })

  it('resolves batch references to current round input images', async () => {
    useStore.setState({ inputImages: [imageA] })
    vi.mocked(callAgentResponsesApi)
      .mockResolvedValueOnce({
        text: '',
        images: [],
        outputItems: [{
          type: 'function_call',
          name: 'generate_image_batch',
          call_id: 'batch-call',
          arguments: JSON.stringify({
            images: [{
              id: 'variant-image',
              prompt: '参考 <ref id="round-3-reference-1" /> 生成变体',
            }],
          }),
        }],
        responseId: 'response-1',
      })
      .mockResolvedValueOnce({
        text: '完成',
        images: [],
        outputItems: [{ type: 'message', content: [{ type: 'output_text', text: '完成' }] }],
        responseId: 'response-2',
      })

    await submitAgentMessage()

    for (let i = 0; i < 5 && vi.mocked(callBatchImageSingle).mock.calls.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    expect(callBatchImageSingle).toHaveBeenCalled()
    const batchArgs = vi.mocked(callBatchImageSingle).mock.calls[0][0]
    expect(batchArgs.referenceImageDataUrls).toEqual([imageA.dataUrl])
    expect(batchArgs.referenceIds).toEqual(['round-3-reference-1'])
  })
})

describe('agent assistant regeneration', () => {
  const responsesProfile = createDefaultOpenAIProfile({ id: 'openai-responses', apiKey: 'openai-key', apiMode: 'responses' })

  beforeEach(() => {
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        profiles: [responsesProfile],
        activeProfileId: responsesProfile.id,
        alwaysShowRetryButton: false,
      }),
      params: { ...DEFAULT_PARAMS, n: 4 },
      agentEditingRoundId: 'round-a',
      agentConversations: [
        agentConversation({
          id: 'conversation-a',
          activeRoundId: 'round-a',
          rounds: [{
            id: 'round-a',
            index: 1,
            parentRoundId: null,
            userMessageId: 'user-a',
            assistantMessageId: 'assistant-a',
            prompt: '画一只猫',
            inputImageIds: [imageA.id],
            outputTaskIds: [],
            status: 'done',
            error: null,
            createdAt: 1,
            finishedAt: 2,
          }],
          messages: [
            { id: 'user-a', role: 'user', content: '画一只猫', roundId: 'round-a', inputImageIds: [imageA.id], createdAt: 1 },
            { id: 'assistant-a', role: 'assistant', content: '已完成。', roundId: 'round-a', createdAt: 2 },
          ],
        }),
      ],
      toast: null,
      showToast: vi.fn(),
      setConfirmDialog: vi.fn(),
    })
  })

  it('creates a sibling round from the assistant message regardless of retry setting', async () => {
    await regenerateAgentAssistantMessage('conversation-a', 'round-a')

    const conversation = useStore.getState().agentConversations[0]
    const newRound = conversation.rounds.find((round) => round.id !== 'round-a')
    expect(newRound).toMatchObject({
      index: 1,
      parentRoundId: null,
      prompt: '画一只猫',
      inputImageIds: [imageA.id],
      status: 'running',
      outputTaskIds: [],
    })
    expect(conversation.activeRoundId).toBe(newRound?.id)
    expect(conversation.messages).toContainEqual(expect.objectContaining({
      role: 'user',
      content: '画一只猫',
      roundId: newRound?.id,
      inputImageIds: [imageA.id],
    }))
    expect(useStore.getState().agentEditingRoundId).toBeNull()
  })

  it('overwrites the same round when regenerating an error assistant message', async () => {
    useStore.setState({
      agentConversations: [
        agentConversation({
          id: 'conversation-a',
          activeRoundId: 'round-a',
          rounds: [{
            id: 'round-a',
            index: 1,
            parentRoundId: null,
            userMessageId: 'user-a',
            assistantMessageId: 'assistant-a',
            prompt: '画一只猫',
            inputImageIds: [imageA.id],
            outputTaskIds: ['task-a'],
            status: 'error',
            error: '失败',
            createdAt: 1,
            finishedAt: 2,
          }],
          messages: [
            { id: 'user-a', role: 'user', content: '画一只猫', roundId: 'round-a', inputImageIds: [imageA.id], createdAt: 1 },
            { id: 'assistant-a', role: 'assistant', content: '请求失败：失败', roundId: 'round-a', outputTaskIds: ['task-a'], createdAt: 2 },
          ],
        }),
      ],
    })

    await regenerateAgentAssistantMessage('conversation-a', 'round-a')

    const conversation = useStore.getState().agentConversations[0]
    expect(conversation.rounds).toHaveLength(1)
    expect(conversation.activeRoundId).toBe('round-a')
    expect(conversation.rounds[0]).toMatchObject({
      id: 'round-a',
      status: 'running',
      error: null,
      outputTaskIds: [],
      finishedAt: null,
    })
    expect(conversation.messages.find((message) => message.id === 'assistant-a')).toMatchObject({
      content: '',
      outputTaskIds: [],
    })
  })
})

describe('reused task API profile', () => {
  const openaiProfile = createDefaultOpenAIProfile({ id: 'openai-profile', apiKey: 'openai-key' })
  const grokProfile = createDefaultGrokProfile({ id: 'grok-profile', name: 'Grok 配置', apiKey: 'grok-key' })

  beforeEach(() => {
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        profiles: [openaiProfile, grokProfile],
        activeProfileId: openaiProfile.id,
        reuseTaskApiProfileTemporarily: true,
      }),
      prompt: '',
      inputImages: [],
      maskDraft: null,
      params: { ...DEFAULT_PARAMS },
      tasks: [],
      showSettings: false,
      toast: null,
      reusedTaskApiProfileId: null,
      reusedTaskApiProfileName: null,
      reusedTaskApiProfileMissing: false,
      showToast: vi.fn(),
      setConfirmDialog: vi.fn(),
    })
  })

  it('resolves a task API profile by stored profile id', () => {
    const resolved = getTaskApiProfile(useStore.getState().settings, task({ apiProvider: 'grok', apiProfileId: grokProfile.id }))

    expect(resolved?.id).toBe(grokProfile.id)
  })

  it('does not resolve a task API profile by stored name or model', () => {
    const resolved = getTaskApiProfile(useStore.getState().settings, task({
      apiProvider: 'grok',
      apiProfileName: grokProfile.name,
      apiModel: grokProfile.model,
    }))

    expect(resolved).toBeNull()
  })

  it('reuses the task API profile temporarily without switching the active profile', async () => {
    await reuseConfig(task({
      apiProvider: 'grok',
      apiProfileId: grokProfile.id,
      params: { ...DEFAULT_PARAMS, n: 8, size: 'auto', quality: 'auto' },
    }))

    const state = useStore.getState()
    expect(state.settings.activeProfileId).toBe(openaiProfile.id)
    expect(state.reusedTaskApiProfileId).toBe(grokProfile.id)
    expect(state.params).toMatchObject({ n: 8, size: 'auto', quality: 'auto' })
    expect(state.showToast).toHaveBeenCalledWith('已临时复用该任务的 API 配置「Grok 配置」', 'success')
  })

  it('keeps selected image mentions when reusing a task with different current input images', async () => {
    await clearImages()
    await putImage(imageA)
    await putImage(imageB)
    const taskPrompt = `参考 ${getSelectedImageMentionLabel(1)} 生成`

    useStore.setState({
      prompt: `当前 ${getSelectedImageMentionLabel(1)}`,
      inputImages: [
        { id: 'current-x', dataUrl: 'data:image/png;base64,x' },
        { id: 'current-y', dataUrl: 'data:image/png;base64,y' },
      ],
    })

    await reuseConfig(task({
      apiProvider: 'openai',
      apiProfileId: openaiProfile.id,
      prompt: taskPrompt,
      inputImageIds: [imageA.id, imageB.id],
    }))

    const state = useStore.getState()
    expect(state.inputImages.map((img) => img.id)).toEqual([imageA.id, imageB.id])
    expect(state.prompt).toBe(taskPrompt)
  })

  it('clears temporary reuse when switching current settings to the reused API profile', async () => {
    await reuseConfig(task({ apiProvider: 'grok', apiProfileId: grokProfile.id }))

    useStore.getState().setSettings({ activeProfileId: grokProfile.id })

    const state = useStore.getState()
    expect(state.settings.activeProfileId).toBe(grokProfile.id)
    expect(state.reusedTaskApiProfileId).toBeNull()
    expect(state.reusedTaskApiProfileMissing).toBe(false)
  })

  it('normalizes reused params to the current API profile when temporary reuse is disabled', async () => {
    useStore.setState({
      settings: normalizeSettings({
        ...useStore.getState().settings,
        reuseTaskApiProfileTemporarily: false,
      }),
    })

    await reuseConfig(task({
      apiProvider: 'grok',
      apiProfileId: grokProfile.id,
      params: { ...DEFAULT_PARAMS, n: 8, size: 'auto', quality: 'auto' },
    }))

    const state = useStore.getState()
    expect(state.settings.activeProfileId).toBe(openaiProfile.id)
    expect(state.reusedTaskApiProfileId).toBeNull()
    expect(state.params).toMatchObject({ n: 8, size: 'auto', quality: 'auto' })
  })

  it('asks whether to submit with current API profile when the reused API profile is missing', async () => {
    await reuseConfig(task({ apiProvider: 'grok', apiProfileId: 'missing-profile' }))

    const state = useStore.getState()
    expect(state.tasks).toEqual([])
    expect(state.setConfirmDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: '找不到 API 配置',
      message: '找不到复用任务所使用的 API 配置「未知配置」，要使用当前的 API 配置「默认」提交任务吗？',
      confirmText: '使用当前配置提交',
      cancelText: '放弃提交',
    }))
    expect(state.showSettings).toBe(false)
  })
})
