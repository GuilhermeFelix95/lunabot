import type { Message, MessageStatus } from "@lunabot/shared";

export interface ConversationRecord {
  id: string;
  title: string;
  /** Sessão do CLI `claude` a ser retomada; `undefined` enquanto não houver resposta. */
  claudeSessionId: string | undefined;
}

/** Persistência do histórico de conversas. */
export interface ChatStore {
  createConversation(title: string): ConversationRecord;
  getConversation(id: string): ConversationRecord | undefined;
  findLatestConversation(): ConversationRecord | undefined;
  setClaudeSessionId(conversationId: string, sessionId: string): void;
  /** `status` padrão é `complete`; respostas interrompidas gravam o texto parcial com outro status. */
  appendMessage(
    conversationId: string,
    role: Message["role"],
    content: string,
    status?: MessageStatus,
  ): void;
  listMessages(conversationId: string): Message[];
}
