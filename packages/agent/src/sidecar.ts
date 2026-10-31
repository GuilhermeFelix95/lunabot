import {
  isAgentRequest,
  type AgentEvent,
  type AgentRequest,
  type MessageStatus,
} from "@lunabot/shared";
import type { AiProvider } from "./provider.ts";
import type { ChatStore, ConversationRecord } from "./store/chat-store.ts";

/** Tamanho máximo do título de uma conversa, tirado da primeira mensagem. */
const TITLE_MAX_LENGTH = 60;

/** Status de uma resposta que terminou sem concluir. */
type InterruptedStatus = Exclude<MessageStatus, "complete">;

export interface SidecarDeps {
  provider: AiProvider;
  store: ChatStore;
}

interface ActiveChat {
  requestId: string;
  controller: AbortController;
}

interface SidecarState {
  activeChat: ActiveChat | undefined;
}

type Emit = (event: AgentEvent) => void;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Lê uma linha do stdin. Retorna `undefined` se não for JSON válido ou requisição conhecida. */
function parseRequestLine(line: string): AgentRequest | undefined {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  return isAgentRequest(value) ? value : undefined;
}

function resolveConversation(
  store: ChatStore,
  conversationId: string | null,
  text: string,
): ConversationRecord | undefined {
  if (conversationId === null) {
    return store.createConversation(text.trim().slice(0, TITLE_MAX_LENGTH));
  }
  return store.getConversation(conversationId);
}

async function handleChatSend(
  request: Extract<AgentRequest, { type: "chat.send" }>,
  state: SidecarState,
  deps: SidecarDeps,
  emit: Emit,
): Promise<void> {
  if (state.activeChat !== undefined) {
    emit({
      type: "chat.error",
      requestId: request.requestId,
      code: "busy",
      message: "Já existe uma resposta em andamento.",
    });
    return;
  }

  // Marca o chat ativo antes de qualquer `await`, para que um segundo envio
  // que chegue logo em seguida receba "busy".
  const controller = new AbortController();
  state.activeChat = { requestId: request.requestId, controller };

  // Texto recebido até agora. Se a resposta for interrompida, ele é gravado com o status correspondente.
  let assistantText = "";
  let conversationId: string | undefined;
  let replyRecorded = false;
  const recordInterruptedReply = (status: InterruptedStatus): void => {
    replyRecorded = true;
    if (conversationId !== undefined && assistantText !== "") {
      deps.store.appendMessage(
        conversationId,
        "assistant",
        assistantText,
        status,
      );
    }
  };

  try {
    const conversation = resolveConversation(
      deps.store,
      request.conversationId,
      request.text,
    );
    if (conversation === undefined) {
      emit({
        type: "chat.error",
        requestId: request.requestId,
        code: "conversation-not-found",
        message: "Conversa não encontrada.",
      });
      return;
    }

    conversationId = conversation.id;
    deps.store.appendMessage(conversation.id, "user", request.text);
    emit({
      type: "chat.started",
      requestId: request.requestId,
      conversationId: conversation.id,
    });

    const events = deps.provider.send({
      prompt: request.text,
      sessionId: conversation.claudeSessionId,
      signal: controller.signal,
    });
    for await (const event of events) {
      switch (event.type) {
        case "session":
          deps.store.setClaudeSessionId(conversation.id, event.sessionId);
          break;
        case "delta":
          assistantText += event.text;
          emit({
            type: "chat.delta",
            requestId: request.requestId,
            text: event.text,
          });
          break;
        case "done":
          replyRecorded = true;
          deps.store.appendMessage(conversation.id, "assistant", assistantText);
          emit({ type: "chat.done", requestId: request.requestId });
          break;
        case "cancelled":
          recordInterruptedReply("cancelled");
          emit({ type: "chat.cancelled", requestId: request.requestId });
          break;
        case "error":
          recordInterruptedReply("error");
          emit({
            type: "chat.error",
            requestId: request.requestId,
            code: event.code,
            message: event.message,
          });
          break;
      }
    }
  } catch (error) {
    if (!replyRecorded) {
      recordInterruptedReply("error");
    }
    emit({
      type: "chat.error",
      requestId: request.requestId,
      code: "internal",
      message: `Erro interno: ${errorMessage(error)}`,
    });
  } finally {
    state.activeChat = undefined;
  }
}

async function handleRequest(
  request: AgentRequest,
  state: SidecarState,
  deps: SidecarDeps,
  emit: Emit,
): Promise<void> {
  switch (request.type) {
    case "status.get": {
      const cli = await deps.provider.getStatus();
      emit({ type: "status", requestId: request.requestId, cli });
      return;
    }
    case "history.latest": {
      const latest = deps.store.findLatestConversation();
      emit({
        type: "history",
        requestId: request.requestId,
        conversation:
          latest === undefined
            ? null
            : {
                id: latest.id,
                messages: deps.store.listMessages(latest.id),
              },
      });
      return;
    }
    case "chat.cancel": {
      if (state.activeChat?.requestId !== request.requestId) {
        emit({
          type: "protocol.error",
          message: "Nenhum chat ativo com este requestId.",
        });
        return;
      }
      state.activeChat.controller.abort();
      return;
    }
    case "chat.send":
      await handleChatSend(request, state, deps, emit);
      return;
  }
}

/**
 * Loop do sidecar: lê uma requisição JSON por linha e escreve eventos JSON por linha.
 * Cada requisição roda sem bloquear a leitura, para que um cancelamento chegue durante o chat.
 * Retorna quando a entrada termina e todas as requisições em andamento acabam.
 */
export async function runSidecar(
  lines: AsyncIterable<string>,
  write: (line: string) => void,
  deps: SidecarDeps,
): Promise<void> {
  const emit: Emit = (event) => write(JSON.stringify(event));
  const state: SidecarState = { activeChat: undefined };
  const pending = new Set<Promise<void>>();

  for await (const line of lines) {
    if (line.trim() === "") {
      continue;
    }
    const request = parseRequestLine(line);
    if (request === undefined) {
      emit({
        type: "protocol.error",
        message:
          "Requisição inválida: esperado um JSON com type e requestId válidos.",
      });
      continue;
    }

    const task = handleRequest(request, state, deps, emit).catch(
      (error: unknown) => {
        emit({
          type: "protocol.error",
          message: `Falha ao processar a requisição: ${errorMessage(error)}`,
        });
      },
    );
    pending.add(task);
    void task.finally(() => pending.delete(task));
  }

  await Promise.all(pending);
}
