import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteChatStore } from "./sqlite-chat-store.ts";

const SESSION_ID = "123e4567-e89b-42d3-a456-426614174000";
/** Intervalo entre gravações para que os timestamps (em ms) não empatem. */
const TIMESTAMP_GAP_MS = 5;
/** Versão do esquema gravada em `PRAGMA user_version` após todas as migrações. */
const CURRENT_SCHEMA_VERSION = 2;

/** Esquema anterior à coluna `status`, como estava nos bancos já existentes. */
const LEGACY_SCHEMA = `
  PRAGMA foreign_keys = ON;
  CREATE TABLE conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    claude_session_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;
`;

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

describe("migração do esquema", () => {
  it("migra um banco antigo sem a coluna status preservando as mensagens", () => {
    const filePath = join(directory, "legacy.db");
    const legacy = new DatabaseSync(filePath);
    legacy.exec(LEGACY_SCHEMA);
    legacy.exec(`
      INSERT INTO conversations (id, title, claude_session_id, created_at, updated_at)
        VALUES ('conv-antiga', 'Antiga', NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      INSERT INTO messages (id, conversation_id, role, content, created_at)
        VALUES ('m1', 'conv-antiga', 'user', 'pergunta antiga', '2026-01-01T00:00:00.000Z'),
               ('m2', 'conv-antiga', 'assistant', 'resposta antiga', '2026-01-01T00:00:01.000Z');
    `);
    legacy.close();

    const migrated = new SqliteChatStore(filePath);
    try {
      expect(migrated.listMessages("conv-antiga")).toEqual([
        {
          id: "m1",
          role: "user",
          content: "pergunta antiga",
          status: "complete",
        },
        {
          id: "m2",
          role: "assistant",
          content: "resposta antiga",
          status: "complete",
        },
      ]);
    } finally {
      migrated.close();
    }

    const reopened = new DatabaseSync(filePath);
    try {
      expect(reopened.prepare("PRAGMA user_version").get()).toEqual({
        user_version: CURRENT_SCHEMA_VERSION,
      });
    } finally {
      reopened.close();
    }
  });

  it("cria um banco novo já na versão atual e reabre sem migrar de novo", () => {
    const filePath = join(directory, "fresh.db");
    new SqliteChatStore(filePath).close();
    const reopened = new SqliteChatStore(filePath);
    reopened.close();

    const db = new DatabaseSync(filePath);
    try {
      expect(db.prepare("PRAGMA user_version").get()).toEqual({
        user_version: CURRENT_SCHEMA_VERSION,
      });
    } finally {
      db.close();
    }
  });
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

  it("grava e lista o status da resposta interrompida", () => {
    const created = store.createConversation("Título");

    store.appendMessage(created.id, "user", "pergunta");
    store.appendMessage(created.id, "assistant", "parcial", "cancelled");

    expect(store.listMessages(created.id).map((m) => m.status)).toEqual([
      "complete",
      "cancelled",
    ]);
  });

  it("retorna o id da mensagem gravada", () => {
    const created = store.createConversation("Título");

    const id = store.appendMessage(created.id, "assistant", "parcial", "error");

    expect(store.listMessages(created.id)).toEqual([
      { id, role: "assistant", content: "parcial", status: "error" },
    ]);
  });

  it("atualiza texto e status de uma mensagem já gravada, sem criar outra", () => {
    const created = store.createConversation("Título");
    const id = store.appendMessage(created.id, "assistant", "olá", "error");

    store.updateMessage(id, "olá mundo", "complete");

    expect(store.listMessages(created.id)).toEqual([
      { id, role: "assistant", content: "olá mundo", status: "complete" },
    ]);
  });

  it("recusa atualizar uma mensagem que não existe", () => {
    const created = store.createConversation("Título");
    store.appendMessage(created.id, "assistant", "olá", "error");

    expect(() =>
      store.updateMessage("id-inexistente", "x", "complete"),
    ).toThrow("Mensagem não encontrada");
  });

  it("não aceita status desconhecido no banco", () => {
    const created = store.createConversation("Título");

    expect(() =>
      store.appendMessage(created.id, "assistant", "x", "pending" as "error"),
    ).toThrow();
  });
});
