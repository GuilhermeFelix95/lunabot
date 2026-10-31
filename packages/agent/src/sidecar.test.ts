import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent, CliStatus } from "@lunabot/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AiProvider, ProviderEvent, SendOptions } from "./provider.ts";
import { runSidecar } from "./sidecar.ts";
import { SqliteChatStore } from "./store/sqlite-chat-store.ts";

const SESSION_ID = "123e4567-e89b-42d3-a456-426614174000";
const POLL_INTERVAL_MS = 2;
const POLL_LIMIT = 500;

/** Provedor de teste: responde sozinho, espera o cancelamento ou falha, conforme o modo. */
class ScriptedProvider implements AiProvider {
  readonly calls: { prompt: string; sessionId: string | undefined }[] = [];
  mode: "reply" | "wait" | "throw" = "reply";

  getStatus(): Promise<CliStatus> {
    return Promise.resolve({ state: "ready" });
  }

  async *send(options: SendOptions): AsyncGenerator<ProviderEvent> {
    this.calls.push({ prompt: options.prompt, sessionId: options.sessionId });
    if (this.mode === "throw") {
      throw new Error("quebrou");
    }
    yield { type: "session", sessionId: SESSION_ID };
    yield { type: "delta", text: "olá" };
    if (this.mode === "wait") {
      await new Promise<void>((resolve) => {
        options.signal.addEventListener("abort", () => resolve(), {
          once: true,
        });
      });
      yield { type: "cancelled" };
      return;
    }
    yield { type: "done" };
  }
}

/** Fila de linhas de entrada que o teste alimenta quando quiser. */
function createInputQueue() {
  const items: string[] = [];
  let closed = false;
  let wake: (() => void) | undefined;
  const notify = (): void => {
    wake?.();
    wake = undefined;
  };
  return {
    push(value: unknown): void {
      items.push(typeof value === "string" ? value : JSON.stringify(value));
      notify();
    },
    end(): void {
      closed = true;
      notify();
    },
    async *lines(): AsyncGenerator<string> {
      for (;;) {
        const item = items.shift();
        if (item !== undefined) {
          yield item;
        } else if (closed) {
          return;
        } else {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        }
      }
    },
  };
}

let directory: string;
let store: SqliteChatStore;
let provider: ScriptedProvider;
let output: AgentEvent[];
let input: ReturnType<typeof createInputQueue>;
let running: Promise<void>;

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < POLL_LIMIT; attempt++) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error("Tempo esgotado esperando um evento do sidecar.");
}

function eventsFor(requestId: string): AgentEvent[] {
  return output.filter(
    (event) => "requestId" in event && event.requestId === requestId,
  );
}

function startedConversationId(requestId: string): string {
  const started = eventsFor(requestId).find((e) => e.type === "chat.started");
  return started?.type === "chat.started" ? started.conversationId : "";
}

async function finish(): Promise<void> {
  input.end();
  await running;
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "lunabot-sidecar-"));
  store = new SqliteChatStore(join(directory, "sidecar.db"));
  provider = new ScriptedProvider();
  output = [];
  input = createInputQueue();
  running = runSidecar(
    input.lines(),
    (line) => {
      output.push(JSON.parse(line) as AgentEvent);
    },
    { provider, store },
  );
});

afterEach(async () => {
  await finish().catch(() => undefined);
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("runSidecar", () => {
  it("responde o status do CLI", async () => {
    input.push({ type: "status.get", requestId: "s1" });
    await finish();

    expect(output).toEqual([
      { type: "status", requestId: "s1", cli: { state: "ready" } },
    ]);
  });

  it("cria uma conversa, faz streaming, persiste o histórico e guarda a sessão", async () => {
    input.push({
      type: "chat.send",
      requestId: "c1",
      conversationId: null,
      text: "oi",
    });
    await waitFor(() => eventsFor("c1").some((e) => e.type === "chat.done"));
    input.push({ type: "history.latest", requestId: "h1" });
    await finish();

    const conversationId = startedConversationId("c1");
    expect(eventsFor("c1").map((e) => e.type)).toEqual([
      "chat.started",
      "chat.delta",
      "chat.done",
    ]);
    expect(store.getConversation(conversationId)?.claudeSessionId).toBe(
      SESSION_ID,
    );
    expect(output.at(-1)).toEqual({
      type: "history",
      requestId: "h1",
      conversation: {
        id: conversationId,
        messages: [
          expect.objectContaining({ role: "user", content: "oi" }),
          expect.objectContaining({ role: "assistant", content: "olá" }),
        ],
      },
    });
  });

  it("continua a conversa reaproveitando a sessão guardada do CLI", async () => {
    input.push({
      type: "chat.send",
      requestId: "c1",
      conversationId: null,
      text: "um",
    });
    await waitFor(() => eventsFor("c1").some((e) => e.type === "chat.done"));
    const conversationId = startedConversationId("c1");

    input.push({
      type: "chat.send",
      requestId: "c2",
      conversationId,
      text: "dois",
    });
    await waitFor(() => eventsFor("c2").some((e) => e.type === "chat.done"));
    await finish();

    expect(provider.calls.map((call) => call.sessionId)).toEqual([
      undefined,
      SESSION_ID,
    ]);
  });

  it("responde protocol.error a uma linha que não é JSON e segue atendendo", async () => {
    input.push("isto não é json");
    input.push({ type: "status.get", requestId: "s1" });
    await finish();

    expect(output[0]).toMatchObject({ type: "protocol.error" });
    expect(output[1]).toMatchObject({ type: "status", requestId: "s1" });
  });

  it("responde protocol.error a uma requisição com campos inválidos", async () => {
    input.push({
      type: "chat.send",
      requestId: "c1",
      conversationId: null,
      text: "",
    });
    await finish();

    expect(output).toEqual([
      expect.objectContaining({ type: "protocol.error" }),
    ]);
  });

  it("responde conversation-not-found para uma conversa que não existe", async () => {
    input.push({
      type: "chat.send",
      requestId: "c1",
      conversationId: "nao-existe",
      text: "oi",
    });
    await finish();

    expect(output).toEqual([
      {
        type: "chat.error",
        requestId: "c1",
        code: "conversation-not-found",
        message: "Conversa não encontrada.",
      },
    ]);
  });

  it("cancela um chat em andamento e responde chat.cancelled", async () => {
    provider.mode = "wait";
    input.push({
      type: "chat.send",
      requestId: "c1",
      conversationId: null,
      text: "oi",
    });
    await waitFor(() => eventsFor("c1").some((e) => e.type === "chat.delta"));

    input.push({ type: "chat.cancel", requestId: "c1" });
    await waitFor(() =>
      eventsFor("c1").some((e) => e.type === "chat.cancelled"),
    );
    await finish();

    expect(eventsFor("c1").at(-1)).toEqual({
      type: "chat.cancelled",
      requestId: "c1",
    });
  });

  it("recusa um segundo envio enquanto outro chat está ativo", async () => {
    provider.mode = "wait";
    input.push({
      type: "chat.send",
      requestId: "c1",
      conversationId: null,
      text: "oi",
    });
    await waitFor(() => eventsFor("c1").some((e) => e.type === "chat.delta"));

    input.push({
      type: "chat.send",
      requestId: "c2",
      conversationId: null,
      text: "outro",
    });
    await waitFor(() => eventsFor("c2").length > 0);
    input.push({ type: "chat.cancel", requestId: "c1" });
    await finish();

    expect(eventsFor("c2")).toEqual([
      expect.objectContaining({ type: "chat.error", code: "busy" }),
    ]);
  });

  it("responde protocol.error ao cancelar um requestId que não está ativo", async () => {
    input.push({ type: "chat.cancel", requestId: "naoexiste" });
    await finish();

    expect(output).toEqual([
      expect.objectContaining({ type: "protocol.error" }),
    ]);
  });

  it("converte uma falha inesperada do provedor em chat.error interno", async () => {
    provider.mode = "throw";
    input.push({
      type: "chat.send",
      requestId: "c1",
      conversationId: null,
      text: "oi",
    });
    await finish();

    expect(eventsFor("c1").at(-1)).toEqual({
      type: "chat.error",
      requestId: "c1",
      code: "internal",
      message: "Erro interno: quebrou",
    });
  });
});
