import type { AgentEvent, CliStatus, Message } from "@lunabot/shared";

/** Estado da tela de chat. `draft` é a resposta parcial em streaming, ainda não salva. */
export interface ChatState {
  status: CliStatus | undefined;
  conversationId: string | null;
  messages: Message[];
  draft: string | undefined;
  activeRequestId: string | undefined;
  error: string | undefined;
}

export const initialChatState: ChatState = {
  status: undefined,
  conversationId: null,
  messages: [],
  draft: undefined,
  activeRequestId: undefined,
  error: undefined,
};

export type ChatAction =
  | { type: "agent-event"; event: AgentEvent }
  | { type: "agent-exit"; code: number | null }
  | { type: "send-started"; requestId: string; text: string }
  | { type: "send-failed"; message: string }
  | { type: "request-failed"; message: string }
  | { type: "new-conversation" };

export interface CliStatusView {
  tone: "pending" | "ok" | "warn" | "error";
  text: string;
}

function isActive(state: ChatState, requestId: string): boolean {
  return state.activeRequestId === requestId;
}

/** Encerra o chat ativo e descarta a resposta parcial, que o sidecar não salva. */
function endActiveChat(state: ChatState): ChatState {
  return { ...state, draft: undefined, activeRequestId: undefined };
}

function exitMessage(code: number | null): string {
  return code === null
    ? "O agente foi encerrado."
    : `O agente foi encerrado (código ${code}).`;
}

function applyAgentEvent(state: ChatState, event: AgentEvent): ChatState {
  switch (event.type) {
    case "status":
      return { ...state, status: event.cli };
    case "history":
      return {
        ...state,
        conversationId: event.conversation?.id ?? null,
        messages: event.conversation?.messages ?? [],
      };
    case "protocol.error":
      return { ...state, error: event.message };
    case "chat.started":
      return isActive(state, event.requestId)
        ? { ...state, conversationId: event.conversationId }
        : state;
    case "chat.delta":
      return isActive(state, event.requestId)
        ? { ...state, draft: (state.draft ?? "") + event.text }
        : state;
    case "chat.done":
      if (!isActive(state, event.requestId)) {
        return state;
      }
      return {
        ...endActiveChat(state),
        messages: [
          ...state.messages,
          {
            id: `${event.requestId}:assistant`,
            role: "assistant",
            content: state.draft ?? "",
          },
        ],
      };
    case "chat.cancelled":
      return isActive(state, event.requestId) ? endActiveChat(state) : state;
    case "chat.error":
      // Um erro de um envio recusado (ex.: busy) não encerra o chat que está ativo.
      return isActive(state, event.requestId)
        ? { ...endActiveChat(state), error: event.message }
        : { ...state, error: event.message };
  }
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "agent-event":
      return applyAgentEvent(state, action.event);
    case "agent-exit":
      return {
        ...endActiveChat(state),
        status: { state: "error", message: exitMessage(action.code) },
      };
    case "send-started":
      return {
        ...state,
        activeRequestId: action.requestId,
        draft: "",
        error: undefined,
        messages: [
          ...state.messages,
          {
            id: `${action.requestId}:user`,
            role: "user",
            content: action.text,
          },
        ],
      };
    case "send-failed":
      return { ...endActiveChat(state), error: action.message };
    case "request-failed":
      return { ...state, error: action.message };
    case "new-conversation":
      return {
        ...state,
        conversationId: null,
        messages: [],
        draft: undefined,
        error: undefined,
      };
  }
}

export function describeCliStatus(
  status: CliStatus | undefined,
): CliStatusView {
  if (status === undefined) {
    return { tone: "pending", text: "Verificando o CLI claude…" };
  }
  switch (status.state) {
    case "ready":
      return { tone: "ok", text: "CLI claude conectado" };
    case "logged-out":
      return {
        tone: "warn",
        text: "CLI claude sem login. Rode `claude auth login` no terminal.",
      };
    case "missing":
      return {
        tone: "error",
        text: "CLI claude não encontrado no PATH.",
      };
    case "error":
      return { tone: "error", text: status.message };
  }
}
