import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteChatStore } from "./sqlite-chat-store.ts";

const SESSION_ID = "123e4567-e89b-42d3-a456-426614174000";
/** Intervalo entre gravações para que os timestamps (em ms) não empatem. */
const TIMESTAMP_GAP_MS = 5;

let directory: string;
let store: SqliteChatStore;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "lunabot-store-"));
  store = new SqliteChatStore(join(directory, "test.db"));
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("SqliteChatStore", () => {
  it("cria uma conversa sem sessão do CLI e a encontra pelo id", () => {
    const created = store.createConversation("Primeira pergunta");

    expect(store.getConversation(created.id)).toEqual({
      id: created.id,
      title: "Primeira pergunta",
      claudeSessionId: undefined,
    });
  });

  it("retorna undefined para uma conversa que não existe", () => {
    expect(store.getConversation("inexistente")).toBeUndefined();
  });

  it("guarda o session_id do CLI para continuar a conversa", () => {
    const created = store.createConversation("Título");

    store.setClaudeSessionId(created.id, SESSION_ID);

    expect(store.getConversation(created.id)?.claudeSessionId).toBe(SESSION_ID);
  });

  it("lista as mensagens na ordem em que foram gravadas", () => {
    const created = store.createConversation("Título");

    store.appendMessage(created.id, "user", "primeiro");
    store.appendMessage(created.id, "assistant", "segundo");
    store.appendMessage(created.id, "user", "terceiro");

    expect(
      store.listMessages(created.id).map((message) => message.content),
    ).toEqual(["primeiro", "segundo", "terceiro"]);
    expect(store.listMessages(created.id)[1]?.role).toBe("assistant");
  });

  it("retorna a conversa mais recentemente atualizada", async () => {
    const older = store.createConversation("Antiga");
    await new Promise((resolve) => setTimeout(resolve, TIMESTAMP_GAP_MS));
    store.createConversation("Nova");
    await new Promise((resolve) => setTimeout(resolve, TIMESTAMP_GAP_MS));
    store.appendMessage(older.id, "user", "de novo");

    expect(store.findLatestConversation()?.id).toBe(older.id);
  });

  it("retorna undefined quando não há conversas", () => {
    expect(store.findLatestConversation()).toBeUndefined();
  });

  it("não aceita mensagem com papel desconhecido", () => {
    const created = store.createConversation("Título");

    expect(() =>
      store.appendMessage(created.id, "system" as "user", "x"),
    ).toThrow();
  });
});
