import type {
  AgentConversation,
  AppMode,
  InputImage,
  MaskDraft,
} from '../../types'

const AGENT_INPUT_DRAFT_RETENTION_MS = 3 * 24 * 60 * 60 * 1000

export type AgentInputDraft = {
  prompt: string
  inputImages: InputImage[]
  maskDraft: MaskDraft | null
  maskEditorImageId: string | null
  updatedAt?: number
}

type DraftFields = Pick<
  AgentInputDraft,
  'prompt' | 'inputImages' | 'maskDraft' | 'maskEditorImageId'
>

type ActiveDraftState = DraftFields & {
  appMode: AppMode
  activeAgentConversationId: string | null
  agentInputDrafts: Record<string, AgentInputDraft>
  galleryInputDraft: AgentInputDraft | null
}

export function normalizeInputImages(value: unknown): InputImage[] {
  if (!Array.isArray(value)) return []
  return value
    .map((img): InputImage | null => {
      if (!isRecord(img) || typeof img.id !== 'string') return null
      return {
        id: img.id,
        dataUrl: typeof img.dataUrl === 'string' ? img.dataUrl : '',
      }
    })
    .filter((img): img is InputImage => img != null)
}

export function normalizeMaskDraft(value: unknown): MaskDraft | null {
  if (!isRecord(value)) return null
  if (
    typeof value.targetImageId !== 'string' ||
    typeof value.maskDataUrl !== 'string'
  ) {
    return null
  }
  return {
    targetImageId: value.targetImageId,
    maskDataUrl: value.maskDataUrl,
    updatedAt:
      typeof value.updatedAt === 'number' ? value.updatedAt : Date.now(),
  }
}

export function normalizeAgentInputDraft(
  value: unknown,
  fallbackUpdatedAt = Date.now(),
): AgentInputDraft {
  const draft = isRecord(value) ? value : {}
  const updatedAt =
    typeof draft.updatedAt === 'number' && Number.isFinite(draft.updatedAt)
      ? draft.updatedAt
      : fallbackUpdatedAt
  return {
    prompt: typeof draft.prompt === 'string' ? draft.prompt : '',
    inputImages: normalizeInputImages(draft.inputImages),
    maskDraft: normalizeMaskDraft(draft.maskDraft),
    maskEditorImageId:
      typeof draft.maskEditorImageId === 'string'
        ? draft.maskEditorImageId
        : null,
    updatedAt,
  }
}

export function normalizeAgentInputDrafts(
  value: unknown,
  conversations: AgentConversation[],
): Record<string, AgentInputDraft> {
  if (!isRecord(value)) return {}
  const conversationIds = new Set(
    conversations.map((conversation) => conversation.id),
  )
  const drafts: Record<string, AgentInputDraft> = {}
  for (const [conversationId, draft] of Object.entries(value)) {
    if (!conversationIds.has(conversationId)) continue
    const normalized = normalizeAgentInputDraft(draft)
    if (!isEmptyAgentInputDraft(normalized)) {
      drafts[conversationId] = normalized
    }
  }
  return drafts
}

export function normalizeAgentInputDraftsByKey(
  value: unknown,
): Record<string, AgentInputDraft> {
  if (!isRecord(value)) return {}
  const drafts: Record<string, AgentInputDraft> = {}
  for (const [conversationId, draft] of Object.entries(value)) {
    const normalized = normalizeAgentInputDraft(draft)
    if (!isEmptyAgentInputDraft(normalized)) {
      drafts[conversationId] = normalized
    }
  }
  return drafts
}

export function cleanStaleAgentInputDrafts(
  drafts: Record<string, AgentInputDraft>,
  activeConversationId: string | null,
  now = Date.now(),
) {
  const cutoff = now - AGENT_INPUT_DRAFT_RETENTION_MS
  const next: Record<string, AgentInputDraft> = {}
  for (const [conversationId, draft] of Object.entries(drafts)) {
    if (
      conversationId === activeConversationId ||
      (draft.updatedAt ?? now) >= cutoff
    ) {
      next[conversationId] = draft
    }
  }
  return next
}

export function clearInputDraftState(): DraftFields {
  return {
    prompt: '',
    inputImages: [],
    maskDraft: null,
    maskEditorImageId: null,
  }
}

export function copyAgentInputDraft(draft: AgentInputDraft): AgentInputDraft {
  return {
    prompt: draft.prompt,
    inputImages: draft.inputImages.map((img) => ({ ...img })),
    maskDraft: draft.maskDraft ? { ...draft.maskDraft } : null,
    maskEditorImageId: draft.maskEditorImageId,
    updatedAt: draft.updatedAt ?? Date.now(),
  }
}

export function getCurrentAgentInputDraft(state: DraftFields): AgentInputDraft {
  return {
    prompt: state.prompt,
    inputImages: state.inputImages,
    maskDraft: state.maskDraft,
    maskEditorImageId: state.maskEditorImageId,
    updatedAt: Date.now(),
  }
}

export function isEmptyAgentInputDraft(draft: AgentInputDraft) {
  return (
    draft.prompt.length === 0 &&
    draft.inputImages.length === 0 &&
    !draft.maskDraft &&
    !draft.maskEditorImageId
  )
}

export function setAgentInputDraft(
  drafts: Record<string, AgentInputDraft>,
  conversationId: string,
  draft: AgentInputDraft,
) {
  const next = { ...drafts }
  if (isEmptyAgentInputDraft(draft)) {
    delete next[conversationId]
  } else {
    next[conversationId] = copyAgentInputDraft(draft)
  }
  return next
}

export function saveActiveAgentInputDrafts(
  state: Pick<
    ActiveDraftState,
    | 'appMode'
    | 'activeAgentConversationId'
    | 'agentInputDrafts'
    | 'prompt'
    | 'inputImages'
    | 'maskDraft'
    | 'maskEditorImageId'
  >,
) {
  if (state.appMode !== 'agent' || !state.activeAgentConversationId) {
    return state.agentInputDrafts
  }
  return setAgentInputDraft(
    state.agentInputDrafts,
    state.activeAgentConversationId,
    getCurrentAgentInputDraft(state),
  )
}

export function saveGalleryInputDraft(
  state: Pick<
    ActiveDraftState,
    | 'appMode'
    | 'galleryInputDraft'
    | 'prompt'
    | 'inputImages'
    | 'maskDraft'
    | 'maskEditorImageId'
  >,
) {
  if (state.appMode !== 'gallery') return state.galleryInputDraft
  const draft = getCurrentAgentInputDraft(state)
  return isEmptyAgentInputDraft(draft) ? null : copyAgentInputDraft(draft)
}

export function getPersistableGalleryInputDraft(
  state: Parameters<typeof saveGalleryInputDraft>[0],
) {
  return saveGalleryInputDraft(state)
}

export function restoreGalleryInputDraftState(
  draft: AgentInputDraft | null,
): DraftFields {
  if (!draft) return clearInputDraftState()
  return {
    prompt: draft.prompt,
    inputImages: draft.inputImages.map((img) => ({ ...img })),
    maskDraft: draft.maskDraft ? { ...draft.maskDraft } : null,
    maskEditorImageId: draft.maskEditorImageId,
  }
}

export function restoreAgentInputDraftState(
  drafts: Record<string, AgentInputDraft>,
  conversationId: string | null,
): DraftFields {
  const draft = conversationId ? drafts[conversationId] : null
  return restoreGalleryInputDraftState(draft ?? null)
}

export function syncActiveInputDraft<T extends Partial<AgentInputDraft>>(
  state: ActiveDraftState,
  patch: T,
): T & {
  agentInputDrafts?: Record<string, AgentInputDraft>
  galleryInputDraft?: AgentInputDraft | null
} {
  const draft: AgentInputDraft = {
    prompt: patch.prompt ?? state.prompt,
    inputImages: patch.inputImages ?? state.inputImages,
    maskDraft:
      patch.maskDraft !== undefined ? patch.maskDraft : state.maskDraft,
    maskEditorImageId:
      patch.maskEditorImageId !== undefined
        ? patch.maskEditorImageId
        : state.maskEditorImageId,
  }
  if (state.appMode === 'gallery') {
    return {
      ...patch,
      galleryInputDraft: isEmptyAgentInputDraft(draft)
        ? null
        : copyAgentInputDraft(draft),
    }
  }
  if (!state.activeAgentConversationId) return patch
  return {
    ...patch,
    agentInputDrafts: setAgentInputDraft(
      state.agentInputDrafts,
      state.activeAgentConversationId,
      draft,
    ),
  }
}

export function getPersistableAgentInputDrafts(
  state: Pick<
    ActiveDraftState,
    | 'appMode'
    | 'activeAgentConversationId'
    | 'agentInputDrafts'
    | 'prompt'
    | 'inputImages'
    | 'maskDraft'
    | 'maskEditorImageId'
  > & { agentConversations: AgentConversation[] },
) {
  const drafts = saveActiveAgentInputDrafts(state)
  const conversationIds = new Set(
    state.agentConversations.map((conversation) => conversation.id),
  )
  const persistable: Record<string, AgentInputDraft> = {}
  for (const [conversationId, draft] of Object.entries(drafts)) {
    if (!conversationIds.has(conversationId) || isEmptyAgentInputDraft(draft)) {
      continue
    }
    persistable[conversationId] = {
      ...copyAgentInputDraft(draft),
      inputImages: draft.inputImages.map((img) => ({
        id: img.id,
        dataUrl: '',
      })),
    }
  }
  return persistable
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
