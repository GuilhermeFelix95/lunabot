import { isMessage, type Message } from "./message.ts";

/**
 * Protocolo entre a interface (Tauri/React) e o sidecar do agente.
 * Cada linha trocada no stdin/stdout do sidecar é um objeto JSON que segue estes tipos.
 */

/** Tamanho máximo do texto de uma mensagem enviada pela interface. */
export const MAX_PROMPT_LENGTH = 20_000;
/** Tamanho máximo de identificadores (requestId, conversationId). */
export const MAX_ID_LENGTH = 100;

export type CliStatus =
  | { state: "missing" }
  | { state: "logged-out" }
  | { state: "ready" }
  | { state: "error"; message: string };

export type ChatErrorCode =
  | "cli-missing"
  | "cli-logged-out"
  | "cli-failed"
  | "invalid-output"
  | "conversation-not-found"
  | "busy"
  | "internal";

export type AgentRequest =
  | { type: "status.get"; requestId: string }
  | {
      type: "chat.send";
      requestId: string;
      conversationId: string | null;
      text: string;
    }
  | { type: "chat.cancel"; requestId: string }
  | { type: "history.latest"; requestId: string };

export interface ConversationSnapshot {
  id: string;
  messages: Message[];
}

export type AgentEvent =
  | { type: "status"; requestId: string; cli: CliStatus }
  | { type: "chat.started"; requestId: string; conversationId: string }
  | { type: "chat.delta"; requestId: string; text: string }
  | { type: "chat.done"; requestId: string }
  | { type: "chat.cancelled"; requestId: string }
  | {
      type: "chat.error";
      requestId: string;
      code: ChatErrorCode;
      message: string;
    }
  | {
      type: "history";
      requestId: string;
      conversation: ConversationSnapshot | null;
    }
  | { type: "protocol.error"; message: string };

type Record_ = Record<string, unknown>;

function isRecord(value: unknown): value is Record_ {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH
  );
}

function isOptionalConversationId(value: unknown): value is string | null {
  return value === null || isId(value);
}

function isText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= MAX_PROMPT_LENGTH
  );
}

export function isCliStatus(value: unknown): value is CliStatus {
  if (!isRecord(value)) {
    return false;
  }
  switch (value.state) {
    case "missing":
    case "logged-out":
    case "ready":
      return true;
    case "error":
      return typeof value.message === "string";
    default:
      return false;
  }
}

/** Valida uma requisição recebida pelo sidecar antes de executá-la. */
export function isAgentRequest(value: unknown): value is AgentRequest {
  if (!isRecord(value) || !isId(value.requestId)) {
    return false;
  }
  switch (value.type) {
    case "status.get":
    case "history.latest":
    case "chat.cancel":
      return true;
    case "chat.send":
      return (
        isOptionalConversationId(value.conversationId) && isText(value.text)
      );
    default:
      return false;
  }
}

const CHAT_ERROR_CODES: readonly ChatErrorCode[] = [
  "cli-missing",
  "cli-logged-out",
  "cli-failed",
  "invalid-output",
  "conversation-not-found",
  "busy",
  "internal",
];

function isChatErrorCode(value: unknown): value is ChatErrorCode {
  return (
    typeof value === "string" &&
    (CHAT_ERROR_CODES as readonly string[]).includes(value)
  );
}

function isConversationSnapshot(value: unknown): value is ConversationSnapshot {
  return (
    isRecord(value) &&
    isId(value.id) &&
    Array.isArray(value.messages) &&
    value.messages.every(isMessage)
  );
}

/** Valida um evento vindo do sidecar antes de a interface tratá-lo. */
export function isAgentEvent(value: unknown): value is AgentEvent {
  if (!isRecord(value)) {
    return false;
  }
  if (value.type === "protocol.error") {
    return typeof value.message === "string";
  }
  if (!isId(value.requestId)) {
    return false;
  }
  switch (value.type) {
    case "status":
      return isCliStatus(value.cli);
    case "chat.started":
      return isId(value.conversationId);
    case "chat.delta":
      return typeof value.text === "string";
    case "chat.done":
    case "chat.cancelled":
      return true;
    case "chat.error":
      return isChatErrorCode(value.code) && typeof value.message === "string";
    case "history":
      return (
        value.conversation === null ||
        isConversationSnapshot(value.conversation)
      );
    default:
      return false;
  }
}
