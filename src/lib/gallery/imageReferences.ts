import type { AgentConversation, InputImage, TaskRecord } from "../../types";
import type { AgentInputDraft } from "../storage/inputDrafts";
import type { SeriesReferenceImage, SeriesReferenceSlot } from "../../types";
import { SERIES_REFERENCE_SLOTS } from "./seriesReferences";

export type ImageReferenceState = {
  tasks: TaskRecord[];
  inputImages: InputImage[];
  galleryInputDraft: AgentInputDraft | null;
  agentInputDrafts: Record<string, AgentInputDraft>;
  agentConversations: AgentConversation[];
  seriesReferenceImage: SeriesReferenceImage | null;
  seriesReferenceHistory: SeriesReferenceImage[];
  seriesReferenceSlots: Record<SeriesReferenceSlot, SeriesReferenceImage | null>;
};

export function collectStateReferencedImageIds(
  state: ImageReferenceState,
): Set<string> {
  const ids = new Set<string>();
  for (const task of state.tasks) addTaskReferencedImageIds(ids, task);
  addAgentReferencedImageIds(
    ids,
    state.agentConversations,
    state.agentInputDrafts,
  );
  addInputImagesReferencedImageIds(ids, state.inputImages);
  addInputDraftReferencedImageIds(ids, state.galleryInputDraft);
  addSeriesReferenceImageIds(
    ids,
    state.seriesReferenceImage,
    state.seriesReferenceHistory,
    state.seriesReferenceSlots,
  );
  return ids;
}

export function isImageReferencedByState(
  state: ImageReferenceState,
  imageId: string,
) {
  return collectStateReferencedImageIds(state).has(imageId);
}

export function addAgentReferencedImageIds(
  target: Set<string>,
  conversations: AgentConversation[],
  inputDrafts: Record<string, AgentInputDraft>,
) {
  for (const conversation of conversations) {
    for (const round of conversation.rounds) {
      for (const id of round.inputImageIds) target.add(id);
      if (round.maskImageId) target.add(round.maskImageId);
    }
    for (const message of conversation.messages) {
      if (message.maskImageId) target.add(message.maskImageId);
    }
  }
  for (const draft of Object.values(inputDrafts)) {
    addInputDraftReferencedImageIds(target, draft);
  }
}

export function addInputDraftReferencedImageIds(
  target: Set<string>,
  draft: AgentInputDraft | null,
) {
  if (!draft) return;
  addInputImagesReferencedImageIds(target, draft.inputImages);
}

export function addInputImagesReferencedImageIds(
  target: Set<string>,
  images: InputImage[],
) {
  for (const img of images) target.add(img.id);
}

export function addTaskReferencedImageIds(
  target: Set<string>,
  task: TaskRecord,
) {
  for (const id of task.inputImageIds || []) target.add(id);
  if (task.maskImageId) target.add(task.maskImageId);
  for (const id of task.outputImages || []) target.add(id);
  for (const id of task.transparentOriginalImages || []) {
    if (id) target.add(id);
  }
  for (const id of task.streamPartialImageIds || []) target.add(id);
}

export function addSeriesReferenceImageIds(
  target: Set<string>,
  seriesReferenceImage: SeriesReferenceImage | null,
  seriesReferenceHistory: SeriesReferenceImage[],
  seriesReferenceSlots: Record<SeriesReferenceSlot, SeriesReferenceImage | null>,
) {
  if (seriesReferenceImage?.id) target.add(seriesReferenceImage.id);
  for (const img of seriesReferenceHistory) target.add(img.id);
  for (const slot of SERIES_REFERENCE_SLOTS) {
    const img = seriesReferenceSlots[slot];
    if (img?.id) target.add(img.id);
  }
}
