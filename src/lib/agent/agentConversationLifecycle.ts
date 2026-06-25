import type { AgentConversation } from "../../types";
import { genId } from "../shared/id";

export function createEmptyAgentConversation(
  now = Date.now(),
): AgentConversation {
  return {
    id: genId(),
    title: "新对话",
    activeRoundId: null,
    createdAt: now,
    updatedAt: now,
    rounds: [],
    messages: [],
  };
}

export function isEmptyAgentConversation(conversation: AgentConversation) {
  return (
    conversation.rounds.length === 0 &&
    conversation.messages.length === 0 &&
    !conversation.activeRoundId
  );
}

export function getLatestAgentConversation(conversations: AgentConversation[]) {
  return conversations.reduce<AgentConversation | null>(
    (latest, conversation) => {
      if (!latest) return conversation;
      if (conversation.updatedAt !== latest.updatedAt)
        return conversation.updatedAt > latest.updatedAt
          ? conversation
          : latest;
      return conversation.createdAt > latest.createdAt ? conversation : latest;
    },
    null,
  );
}
