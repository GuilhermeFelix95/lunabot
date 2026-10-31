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

/**
 * Intervalo mínimo entre gravações do rascunho enquanto a resposta chega.
 * Limita a escrita no SQLite sem perder mais que meio segundo de texto se o processo cair.
 */
export const DRAFT_FLUSH_INTERVAL_MS = 500;

/** Status da linha do rascunho enquanto a resposta não terminou. Ficará assim se o processo cair. */
const DRAFT_STATUS: MessageStatus = "error";

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

interface ReplyRecorder {
  /** Acrescenta um trecho da resposta e agenda a gravação do rascunho. */
  append(delta: string): void;
  /** Grava o texto final com o status de término. Chamadas seguintes são ignoradas. */
  finish(status: MessageStatus): void;
}

/**
 * Grava a resposta do assistente enquanto ela chega. A linha nasce no primeiro delta
 * com `DRAFT_STATUS` e é atualizada na mesma linha no fim, sem duplicar a mensagem.
 */
function createReplyRecorder(
  store: ChatStore,
  conversationId: string,
): ReplyRecorder {
  let text = "";
  let messageId: string | undefined;
  let flushTimer: NodeJS.Timeout | undefined;
  let finished = false;

  const cancelFlush = (): void => {
    if (flushTimer !== undefined) {
      clearTimeout(flushTimer);
      flushTimer = undefined;
    }
  };
  const flush = (): void => {
    flushTimer = undefined;
    if (messageId !== undefined) {
      store.updateMessage(messageId, text, DRAFT_STATUS);
    }
  };

  return {
    append(delta) {
      text += delta;
      if (messageId === undefined) {
        messageId = store.appendMessage(
          conversationId,
          "assistant",
          text,
          DRAFT_STATUS,
        );
      } else if (flushTimer === undefined) {
        flushTimer = setTimeout(flush, DRAFT_FLUSH_INTERVAL_MS);
      }
    },
    finish(status) {
      if (finished) {
        return;
      }
      finished = true;
      cancelFlush();
      if (messageId !== undefined) {
        store.updateMessage(messageId, text, status);
      } else if (status === "complete") {
        // Resposta concluída sem nenhum delta: grava a mensagem vazia, como antes.
        store.appendMessage(conversationId, "assistant", text, status);
      }
    },
  };
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

  let reply: ReplyRecorder | undefined;

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

    deps.store.appendMessage(conversation.id, "user", request.text);
    reply = createReplyRecorder(deps.store, conversation.id);
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
          reply.append(event.text);
          emit({
            type: "chat.delta",
            requestId: request.requestId,
            text: event.text,
          });
          break;
        case "done":
          reply.finish("complete");
          emit({ type: "chat.done", requestId: request.requestId });
          break;
        case "cancelled":
          reply.finish("cancelled");
          emit({ type: "chat.cancelled", requestId: request.requestId });
          break;
        case "error":
          reply.finish("error");
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
    reply?.finish("error");
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
 * Quando a entrada termina, cancela o chat ativo. Retorna quando todas as requisições acabam.
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

  // Sem stdin não há quem receba a resposta: o chat ativo é cancelado e o CLI filho é encerrado.
  state.activeChat?.controller.abort();
  await Promise.all(pending);
}
