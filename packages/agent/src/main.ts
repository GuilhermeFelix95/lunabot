import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { ClaudeCliProvider } from "./claude-cli/claude-cli-provider.ts";
import { findClaudeExecutable } from "./claude-cli/locate-claude.ts";
import { runSidecar } from "./sidecar.ts";
import { SqliteChatStore } from "./store/sqlite-chat-store.ts";

/** Nome do arquivo do banco dentro da pasta de dados recebida em `LUNABOT_DATA_DIR`. */
const DATABASE_FILE_NAME = "lunabot.db";

/**
 * Entry point do sidecar. Lê requisições JSON por linha no stdin e escreve eventos
 * JSON por linha no stdout. Logs e falhas fatais vão para o stderr.
 */
async function main(): Promise<void> {
  const dataDir = process.env.LUNABOT_DATA_DIR;
  if (dataDir === undefined || dataDir.trim() === "") {
    throw new Error("A variável LUNABOT_DATA_DIR não está definida.");
  }
  mkdirSync(dataDir, { recursive: true });

  const store = new SqliteChatStore(join(dataDir, DATABASE_FILE_NAME));
  try {
    const provider = new ClaudeCliProvider({
      command: findClaudeExecutable(process.env.PATH),
      cwd: dataDir,
    });
    const lines = createInterface({
      input: process.stdin,
      crlfDelay: Number.POSITIVE_INFINITY,
    });
    // Se o leitor do stdout sumir, a escrita falha (EPIPE). Fecha a entrada para o sidecar
    // cancelar o chat ativo e terminar, e o erro é relançado para sair com código diferente de zero.
    let stdoutError: Error | undefined;
    process.stdout.on("error", (error: Error) => {
      stdoutError = error;
      lines.close();
    });
    await runSidecar(lines, (line) => process.stdout.write(`${line}\n`), {
      provider,
      store,
    });
    if (stdoutError !== undefined) {
      throw stdoutError;
    }
  } finally {
    store.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Falha fatal no sidecar do LunaBot: ${message}\n`);
  process.exitCode = 1;
});
