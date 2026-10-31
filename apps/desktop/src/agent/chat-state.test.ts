import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@lunabot/shared";
import {
  chatReducer,
  describeCliStatus,
  initialChatState,
  type ChatState,
} from "./chat-state";

const REQUEST_ID = "req-1";
const CONVERSATION_ID = "conv-1";

function startSending(
  state: ChatState = initialChatState,
  text = "oi",
): ChatState {
  return chatReducer(state, {
    type: "send-started",
    requestId: REQUEST_ID,
    text,
  });
}

function receive(state: ChatState, event: AgentEvent): ChatState {
  return chatReducer(state, { type: "agent-event", event });
}

describe("chatReducer", () => {
  it("mostra a mensagem do usuário ao enviar e marca o chat como ativo", () => {
    const state = startSending();

    expect(state.activeRequestId).toBe(REQUEST_ID);
    expect(state.draft).toBe("");
    expect(state.messages).toEqual([
      { id: `${REQUEST_ID}:user`, role: "user", content: "oi" },
    ]);
  });

  it("acumula o streaming e salva a resposta do assistente ao terminar", () => {
    let state = startSending();
    state = receive(state, {
      type: "chat.started",
      requestId: REQUEST_ID,
      conversationId: CONVERSATION_ID,
    });
    state = receive(state, {
      type: "chat.delta",
      requestId: REQUEST_ID,
      text: "o",
    });
    state = receive(state, {
      type: "chat.delta",
      requestId: REQUEST_ID,
      text: "k",
    });

    expect(state.draft).toBe("ok");
    expect(state.conversationId).toBe(CONVERSATION_ID);

    state = receive(state, { type: "chat.done", requestId: REQUEST_ID });

    expect(state.draft).toBeUndefined();
    expect(state.activeRequestId).toBeUndefined();
    expect(state.messages[state.messages.length - 1]).toEqual({
      id: `${REQUEST_ID}:assistant`,
      role: "assistant",
      content: "ok",
    });
  });

  it("descarta a resposta parcial ao cancelar, sem apagar a mensagem do usuário", () => {
    let state = startSending();
    state = receive(state, {
      type: "chat.delta",
      requestId: REQUEST_ID,
      text: "par",
    });
    state = receive(state, { type: "chat.cancelled", requestId: REQUEST_ID });

    expect(state.draft).toBeUndefined();
    expect(state.activeRequestId).toBeUndefined();
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?.role).toBe("user");
  });

  it("mostra o erro do chat e encerra o envio ativo", () => {
    let state = startSending();
    state = receive(state, {
      type: "chat.error",
      requestId: REQUEST_ID,
      code: "cli-logged-out",
      message: "Sem login.",
    });

    expect(state.error).toBe("Sem login.");
    expect(state.activeRequestId).toBeUndefined();
  });

  it("não deixa a recusa busy de um segundo envio encerrar o chat ativo", () => {
    let state = startSending();
    state = receive(state, {
      type: "chat.error",
      requestId: "req-2",
      code: "busy",
      message: "Já existe uma resposta em andamento.",
    });

    expect(state.error).toBe("Já existe uma resposta em andamento.");
    expect(state.activeRequestId).toBe(REQUEST_ID);
  });

  it("ignora eventos de streaming de outra requisição", () => {
    const state = startSending();
    const next = receive(state, {
      type: "chat.delta",
      requestId: "outra",
      text: "x",
    });

    expect(next).toBe(state);
  });

  it("carrega o histórico recebido ao abrir a tela", () => {
    const state = receive(initialChatState, {
      type: "history",
      requestId: "h1",
      conversation: {
        id: CONVERSATION_ID,
        messages: [{ id: "m1", role: "user", content: "antes" }],
      },
    });

    expect(state.conversationId).toBe(CONVERSATION_ID);
    expect(state.messages).toEqual([
      { id: "m1", role: "user", content: "antes" },
    ]);
  });

  it("limpa a conversa ao iniciar uma nova", () => {
    let state = startSending();
    state = chatReducer(state, { type: "new-conversation" });

    expect(state.messages).toEqual([]);
    expect(state.conversationId).toBeNull();
  });

  it("registra falha de envio e encerra o chat ativo", () => {
    const state = chatReducer(startSending(), {
      type: "send-failed",
      message: "IPC falhou",
    });

    expect(state.error).toBe("IPC falhou");
    expect(state.activeRequestId).toBeUndefined();
  });

  it("registra falha de comando sem encerrar o chat ativo", () => {
    const state = chatReducer(startSending(), {
      type: "request-failed",
      message: "Falha ao cancelar",
    });

    expect(state.error).toBe("Falha ao cancelar");
    expect(state.activeRequestId).toBe(REQUEST_ID);
  });

  it("marca o CLI como erro quando o sidecar termina com código", () => {
    const state = chatReducer(startSending(), { type: "agent-exit", code: 1 });

    expect(state.activeRequestId).toBeUndefined();
    expect(state.status).toEqual({
      state: "error",
      message: "O agente foi encerrado (código 1).",
    });
  });

  it("mostra mensagem sem código quando o sidecar termina por sinal", () => {
    const state = chatReducer(initialChatState, {
      type: "agent-exit",
      code: null,
    });

    expect(state.status).toEqual({
      state: "error",
      message: "O agente foi encerrado.",
    });
  });
});

describe("describeCliStatus", () => {
  it("descreve cada estado do CLI", () => {
    expect(describeCliStatus(undefined).tone).toBe("pending");
    expect(describeCliStatus({ state: "ready" }).tone).toBe("ok");
    expect(describeCliStatus({ state: "logged-out" }).text).toContain(
      "claude auth login",
    );
    expect(describeCliStatus({ state: "missing" }).tone).toBe("error");
    expect(describeCliStatus({ state: "error", message: "Falhou" })).toEqual({
      tone: "error",
      text: "Falhou",
    });
  });
});
