import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  MESSAGE_STATUSES,
  type Message,
  type MessageStatus,
} from "@lunabot/shared";
import type { ChatStore, ConversationRecord } from "./chat-store.ts";

/**
 * Histórico em SQLite com o módulo nativo `node:sqlite` do Node 24.
 * Documentação: https://nodejs.org/docs/latest-v24.x/api/sqlite.html
 * (Stability 1.2, release candidate; sem flag desde o Node 22.13.)
 * Migrações versionadas com `PRAGMA user_version`:
 * https://www.sqlite.org/pragma.html#pragma_user_version
 */

const BUSY_TIMEOUT_MS = 5_000;

const PRAGMAS = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
`;

/**
 * Migrações em ordem. A posição `i` leva o banco da versão `i` para `i + 1`.
 * Não altere migrações já publicadas; para mudar o esquema, acrescente uma nova.
 */
const MIGRATIONS: readonly string[] = [
  // v1: tabelas iniciais. IF NOT EXISTS cobre bancos criados antes do versionamento.
  `
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    claude_session_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;
  `,
  // v2: situação da mensagem. Bancos antigos ganham 'complete' em todas as linhas.
  `
  ALTER TABLE messages ADD COLUMN status TEXT NOT NULL DEFAULT 'complete'
    CHECK (status IN ('complete', 'cancelled', 'error'));
  `,
];

interface ConversationRow {
  id: string;
  title: string;
  claude_session_id: string | null;
}

interface MessageRow {
  id: string;
  role: string;
  content: string;
  status: string;
}

interface UserVersionRow {
  user_version: number;
}

function isConversationRow(row: unknown): row is ConversationRow {
  return (
    typeof row === "object" &&
    row !== null &&
    "id" in row &&
    typeof row.id === "string" &&
    "title" in row &&
    typeof row.title === "string" &&
    "claude_session_id" in row &&
    (row.claude_session_id === null ||
      typeof row.claude_session_id === "string")
  );
}

function isMessageRow(row: unknown): row is MessageRow {
  return (
    typeof row === "object" &&
    row !== null &&
    "id" in row &&
    typeof row.id === "string" &&
    "role" in row &&
    typeof row.role === "string" &&
    "content" in row &&
    typeof row.content === "string" &&
    "status" in row &&
    typeof row.status === "string"
  );
}

function isUserVersionRow(row: unknown): row is UserVersionRow {
  return (
    typeof row === "object" &&
    row !== null &&
    "user_version" in row &&
    typeof row.user_version === "number"
  );
}

/** Aplica as migrações pendentes, cada uma em sua transação. Falha interrompe a abertura. */
function migrate(db: DatabaseSync): void {
  const row: unknown = db.prepare("PRAGMA user_version").get();
  if (!isUserVersionRow(row)) {
    throw new Error("Não foi possível ler a versão do esquema do banco.");
  }
  const current = row.user_version;
  if (current > MIGRATIONS.length) {
    throw new Error(
      `Banco em versão ${current}, mais nova que a suportada (${MIGRATIONS.length}).`,
    );
  }
  for (let version = current; version < MIGRATIONS.length; version++) {
    const sql = MIGRATIONS[version];
    if (sql === undefined) {
      throw new Error(`Migração ${version + 1} não encontrada.`);
    }
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}

/** Converte uma linha do banco e falha se ela não tiver o formato esperado. */
function toConversation(row: unknown): ConversationRecord {
  if (!isConversationRow(row)) {
    throw new Error("Linha de conversa malformada no banco de dados.");
  }
  return {
    id: row.id,
    title: row.title,
    claudeSessionId: row.claude_session_id ?? undefined,
  };
}

function toRole(value: string): Message["role"] {
  if (value === "user" || value === "assistant") {
    return value;
  }
  throw new Error(`Papel de mensagem desconhecido no banco: ${value}`);
}

function toMessageStatus(value: string): MessageStatus {
  const status = MESSAGE_STATUSES.find((known) => known === value);
  if (status === undefined) {
    throw new Error(`Status de mensagem desconhecido no banco: ${value}`);
  }
  return status;
}

export class SqliteChatStore implements ChatStore {
  private readonly db: DatabaseSync;

  constructor(filePath: string) {
    this.db = new DatabaseSync(filePath, { timeout: BUSY_TIMEOUT_MS });
    this.db.exec(PRAGMAS);
    migrate(this.db);
  }

  close(): void {
    this.db.close();
  }

  createConversation(title: string): ConversationRecord {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO conversations (id, title, claude_session_id, created_at, updated_at) VALUES (?, ?, NULL, ?, ?)",
      )
      .run(id, title, now, now);
    return { id, title, claudeSessionId: undefined };
  }

  getConversation(id: string): ConversationRecord | undefined {
    const row: unknown = this.db
      .prepare(
        "SELECT id, title, claude_session_id FROM conversations WHERE id = ?",
      )
      .get(id);
    return row === undefined ? undefined : toConversation(row);
  }

  findLatestConversation(): ConversationRecord | undefined {
    const row: unknown = this.db
      .prepare(
        "SELECT id, title, claude_session_id FROM conversations ORDER BY updated_at DESC, rowid DESC LIMIT 1",
      )
      .get();
    return row === undefined ? undefined : toConversation(row);
  }

  setClaudeSessionId(conversationId: string, sessionId: string): void {
    this.db
      .prepare("UPDATE conversations SET claude_session_id = ? WHERE id = ?")
      .run(sessionId, conversationId);
  }

  appendMessage(
    conversationId: string,
    role: Message["role"],
    content: string,
    status: MessageStatus = "complete",
  ): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO messages (id, conversation_id, role, content, created_at, status) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(randomUUID(), conversationId, role, content, now, status);
    this.db
      .prepare("UPDATE conversations SET updated_at = ? WHERE id = ?")
      .run(now, conversationId);
  }

  listMessages(conversationId: string): Message[] {
    const rows: unknown[] = this.db
      .prepare(
        "SELECT id, role, content, status FROM messages WHERE conversation_id = ? ORDER BY rowid",
      )
      .all(conversationId);
    return rows.map((row) => {
      if (!isMessageRow(row)) {
        throw new Error("Linha de mensagem malformada no banco de dados.");
      }
      return {
        id: row.id,
        role: toRole(row.role),
        content: row.content,
        status: toMessageStatus(row.status),
      };
    });
  }
}
