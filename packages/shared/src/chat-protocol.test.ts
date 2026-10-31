import { describe, expect, it } from "vitest";
import {
  MAX_ID_LENGTH,
  MAX_PROMPT_LENGTH,
  isAgentEvent,
  isAgentRequest,
  isCliStatus,
} from "./chat-protocol.ts";

describe("isAgentRequest", () => {
  it("aceita um envio de chat com e sem conversa existente", () => {
    expect(
      isAgentRequest({
        type: "chat.send",
        requestId: "r1",
        conversationId: null,
        text: "oi",
      }),
    ).toBe(true);
    expect(
      isAgentRequest({
        type: "chat.send",
        requestId: "r2",
        conversationId: "c1",
        text: "oi",
      }),
    ).toBe(true);
  });

  it("aceita status, cancelamento e histórico", () => {
    expect(isAgentRequest({ type: "status.get", requestId: "r" })).toBe(true);
    expect(isAgentRequest({ type: "chat.cancel", requestId: "r" })).toBe(true);
    expect(isAgentRequest({ type: "history.latest", requestId: "r" })).toBe(
      true,
    );
  });

  it("rejeita texto vazio, texto longo demais ou só espaços", () => {
    const base = { type: "chat.send", requestId: "r", conversationId: null };
    expect(isAgentRequest({ ...base, text: "" })).toBe(false);
    expect(isAgentRequest({ ...base, text: "   " })).toBe(false);
    expect(
      isAgentRequest({ ...base, text: "a".repeat(MAX_PROMPT_LENGTH + 1) }),
    ).toBe(false);
  });

  it("rejeita requestId ausente, vazio ou longo demais", () => {
    expect(isAgentRequest({ type: "status.get" })).toBe(false);
    expect(isAgentRequest({ type: "status.get", requestId: "" })).toBe(false);
    expect(
      isAgentRequest({
        type: "status.get",
        requestId: "x".repeat(MAX_ID_LENGTH + 1),
      }),
    ).toBe(false);
  });

  it("rejeita tipo desconhecido e conversationId com tipo errado", () => {
    expect(isAgentRequest({ type: "shell.exec", requestId: "r" })).toBe(false);
    expect(
      isAgentRequest({
        type: "chat.send",
        requestId: "r",
        conversationId: 42,
        text: "oi",
      }),
    ).toBe(false);
  });
});

describe("isCliStatus", () => {
  it("aceita os estados conhecidos", () => {
    expect(isCliStatus({ state: "missing" })).toBe(true);
    expect(isCliStatus({ state: "logged-out" })).toBe(true);
    expect(isCliStatus({ state: "ready" })).toBe(true);
    expect(isCliStatus({ state: "error", message: "falhou" })).toBe(true);
  });

  it("rejeita estado desconhecido ou erro sem mensagem", () => {
    expect(isCliStatus({ state: "unknown" })).toBe(false);
    expect(isCliStatus({ state: "error" })).toBe(false);
    expect(isCliStatus(null)).toBe(false);
  });
});

describe("isAgentEvent", () => {
  it("aceita eventos de streaming, fim, cancelamento e erro", () => {
    expect(
      isAgentEvent({
        type: "chat.started",
        requestId: "r",
        conversationId: "c",
      }),
    ).toBe(true);
    expect(
      isAgentEvent({ type: "chat.delta", requestId: "r", text: "o" }),
    ).toBe(true);
    expect(isAgentEvent({ type: "chat.done", requestId: "r" })).toBe(true);
    expect(isAgentEvent({ type: "chat.cancelled", requestId: "r" })).toBe(true);
    expect(
      isAgentEvent({
        type: "chat.error",
        requestId: "r",
        code: "cli-missing",
        message: "sem CLI",
      }),
    ).toBe(true);
  });

  it("aceita histórico com mensagens válidas e histórico vazio", () => {
    expect(
      isAgentEvent({
        type: "history",
        requestId: "r",
        conversation: {
          id: "c",
          messages: [{ id: "m", role: "user", content: "oi" }],
        },
      }),
    ).toBe(true);
    expect(
      isAgentEvent({ type: "history", requestId: "r", conversation: null }),
    ).toBe(true);
  });

  it("rejeita histórico com mensagem inválida", () => {
    expect(
      isAgentEvent({
        type: "history",
        requestId: "r",
        conversation: { id: "c", messages: [{ id: "m", role: "system" }] },
      }),
    ).toBe(false);
  });

  it("rejeita código de erro desconhecido e evento sem requestId", () => {
    expect(
      isAgentEvent({
        type: "chat.error",
        requestId: "r",
        code: "explodiu",
        message: "x",
      }),
    ).toBe(false);
    expect(isAgentEvent({ type: "chat.done" })).toBe(false);
  });

  it("aceita protocol.error sem requestId e rejeita tipo desconhecido", () => {
    expect(isAgentEvent({ type: "protocol.error", message: "ruim" })).toBe(
      true,
    );
    expect(isAgentEvent({ type: "algo.novo", requestId: "r" })).toBe(false);
  });
});
