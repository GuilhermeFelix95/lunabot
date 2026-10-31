import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { ChatErrorCode, CliStatus } from "@lunabot/shared";
import type { AiProvider, ProviderEvent, SendOptions } from "../provider.ts";
import {
  InvalidStreamLineError,
  parseStreamLine,
  type StreamLine,
} from "./stream-json.ts";

/*
 * Flags do CLI `claude` usados aqui, conferidos na documentação oficial:
 * - Modo não interativo, prompt por stdin: `-p`
 *   https://code.claude.com/docs/en/headless.md (Basic usage)
 * - Saída em streaming: `--output-format stream-json --verbose --include-partial-messages`
 *   https://code.claude.com/docs/en/headless.md (Stream responses)
 *   https://code.claude.com/docs/en/cli-reference.md (--include-partial-messages exige -p e stream-json)
 * - Continuar sessão: `--resume <session_id>`
 *   https://code.claude.com/docs/en/headless.md (Continue conversations)
 * - Desabilitar ferramentas embutidas: `--tools ""`
 *   https://code.claude.com/docs/en/cli-reference.md (--tools: "Use \"\" to disable all")
 * - Desabilitar ferramentas MCP, que `--tools` não cobre: `--disallowedTools mcp__*`
 *   https://code.claude.com/docs/en/cli-reference.md (--disallowedTools)
 * - Status de login: `claude auth status` (JSON; código 0 se logado)
 *   https://code.claude.com/docs/en/cli-reference.md (claude auth)
 *
 * `--bare` NÃO é usado: a documentação diz que ele nunca lê as credenciais OAuth
 * da assinatura, o que impediria o login existente de funcionar.
 */
const CHAT_ARGS = [
  "-p",
  "--output-format",
  "stream-json",
  "--verbose",
  "--include-partial-messages",
] as const;
const DISABLE_TOOLS_ARGS = [
  "--tools",
  "",
  "--disallowedTools",
  "mcp__*",
] as const;
const AUTH_STATUS_ARGS = ["auth", "status", "--json"] as const;

const STATUS_TIMEOUT_MS = 15_000;
const MAX_ERROR_MESSAGE_LENGTH = 500;
const AUTH_HTTP_STATUS_CODES: readonly number[] = [401, 403];
const AUTH_FAILURE_PATTERN =
  /not logged in|please run \/login|invalid api key|authentication|unauthorized/i;

const MESSAGE_CLI_MISSING =
  "O CLI `claude` não foi encontrado no PATH. Instale o Claude Code e reinicie o LunaBot.";
const MESSAGE_CLI_LOGGED_OUT =
  "O CLI `claude` não está logado. Rode `claude auth login` no terminal e tente de novo.";
const MESSAGE_NO_FINAL_RESULT = "O CLI terminou sem enviar o resultado final.";
const MESSAGE_UNEXPECTED_STATUS =
  "Resposta inesperada do CLI ao verificar o login.";
const MESSAGE_STATUS_TIMEOUT = "O CLI demorou demais para responder.";

export interface ClaudeCliOptions {
  /** Caminho do executável `claude`. `undefined` quando o CLI não foi encontrado. */
  command: string | undefined;
  /**
   * Argumentos colocados antes dos do CLI. Usado só nos testes, para executar
   * um script Node falso como se fosse o `claude`.
   */
  baseArgs?: readonly string[];
  /** Pasta de trabalho do CLI. Fica fora do repositório para não carregar projetos. */
  cwd: string;
  /** Variáveis de ambiente do processo. Padrão: as do processo atual, sem acréscimos. */
  env?: NodeJS.ProcessEnv;
}

interface ExitInfo {
  code: number | null;
  spawnError: NodeJS.ErrnoException | undefined;
}

/** Inicia o processo sem shell, com os argumentos em array (sem interpolação). */
function startProcess(
  command: string,
  args: readonly string[],
  options: Pick<ClaudeCliOptions, "cwd" | "env">,
): { child: ChildProcessWithoutNullStreams; exited: Promise<ExitInfo> } {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    shell: false,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const exited = new Promise<ExitInfo>((resolve) => {
    child.once("error", (error: NodeJS.ErrnoException) =>
      resolve({ code: null, spawnError: error }),
    );
    child.once("close", (code) => resolve({ code, spawnError: undefined }));
  });
  return { child, exited };
}

function keepTail(text: string): string {
  return text.slice(-MAX_ERROR_MESSAGE_LENGTH);
}

function isAuthFailure(
  text: string,
  apiErrorStatus: number | undefined,
): boolean {
  return (
    (apiErrorStatus !== undefined &&
      AUTH_HTTP_STATUS_CODES.includes(apiErrorStatus)) ||
    AUTH_FAILURE_PATTERN.test(text)
  );
}

function parseLoggedIn(stdout: string): boolean | undefined {
  try {
    const value: unknown = JSON.parse(stdout);
    if (
      typeof value === "object" &&
      value !== null &&
      "loggedIn" in value &&
      typeof value.loggedIn === "boolean"
    ) {
      return value.loggedIn;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Provedor que conversa com o CLI `claude` instalado e logado pelo usuário.
 * Não lê nem copia arquivos de `~/.claude`: quem usa as credenciais é o próprio CLI.
 */
export class ClaudeCliProvider implements AiProvider {
  private readonly options: ClaudeCliOptions;

  constructor(options: ClaudeCliOptions) {
    this.options = options;
  }

  async getStatus(): Promise<CliStatus> {
    const { command } = this.options;
    if (command === undefined) {
      return { state: "missing" };
    }

    const { child, exited } = startProcess(
      command,
      [...(this.options.baseArgs ?? []), ...AUTH_STATUS_ARGS],
      this.options,
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = keepTail(stderr + chunk);
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, STATUS_TIMEOUT_MS);
    const exit = await exited.finally(() => clearTimeout(timer));

    if (exit.spawnError !== undefined) {
      return exit.spawnError.code === "ENOENT"
        ? { state: "missing" }
        : { state: "error", message: exit.spawnError.message };
    }
    if (timedOut) {
      return { state: "error", message: MESSAGE_STATUS_TIMEOUT };
    }
    const loggedIn = parseLoggedIn(stdout);
    if (loggedIn === undefined) {
      return {
        state: "error",
        message: stderr.trim() || MESSAGE_UNEXPECTED_STATUS,
      };
    }
    return loggedIn ? { state: "ready" } : { state: "logged-out" };
  }

  async *send(options: SendOptions): AsyncGenerator<ProviderEvent> {
    const { command } = this.options;
    if (command === undefined) {
      yield {
        type: "error",
        code: "cli-missing",
        message: MESSAGE_CLI_MISSING,
      };
      return;
    }
    if (options.signal.aborted) {
      yield { type: "cancelled" };
      return;
    }

    const args = [
      ...(this.options.baseArgs ?? []),
      ...CHAT_ARGS,
      ...(options.sessionId === undefined
        ? []
        : ["--resume", options.sessionId]),
      ...DISABLE_TOOLS_ARGS,
    ];
    const { child, exited } = startProcess(command, args, this.options);

    let stderr = "";
    let stdinError: Error | undefined;
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = keepTail(stderr + chunk);
    });
    child.stdin.on("error", (error: Error) => {
      stdinError = error;
    });
    child.stdin.end(options.prompt);

    const onAbort = (): void => {
      child.kill();
    };
    options.signal.addEventListener("abort", onAbort, { once: true });

    const lines = createInterface({
      input: child.stdout,
      crlfDelay: Number.POSITIVE_INFINITY,
    });

    let failure: { code: ChatErrorCode; message: string } | undefined;
    let succeeded = false;
    let sessionId: string | undefined;
    let finished = false;

    try {
      for await (const line of lines) {
        if (line.trim() === "") {
          continue;
        }
        let parsed: StreamLine;
        try {
          parsed = parseStreamLine(line);
        } catch (error) {
          if (!(error instanceof InvalidStreamLineError)) {
            throw error;
          }
          failure = { code: "invalid-output", message: error.message };
          child.kill();
          break;
        }

        const seenSession =
          parsed.kind === "session" || parsed.kind === "result"
            ? parsed.sessionId
            : undefined;
        if (seenSession !== undefined && seenSession !== sessionId) {
          sessionId = seenSession;
          yield { type: "session", sessionId };
        }
        if (parsed.kind === "delta") {
          yield { type: "delta", text: parsed.text };
        }
        if (parsed.kind === "result") {
          if (parsed.isError) {
            failure = isAuthFailure(parsed.text, parsed.apiErrorStatus)
              ? { code: "cli-logged-out", message: MESSAGE_CLI_LOGGED_OUT }
              : {
                  code: "cli-failed",
                  message: parsed.text || "O CLI retornou um erro.",
                };
          } else {
            succeeded = true;
          }
        }
      }
      finished = true;
    } finally {
      options.signal.removeEventListener("abort", onAbort);
      lines.close();
      if (!finished) {
        child.kill();
      }
    }

    const exit = await exited;

    if (options.signal.aborted) {
      yield { type: "cancelled" };
      return;
    }
    if (exit.spawnError !== undefined) {
      yield exit.spawnError.code === "ENOENT"
        ? { type: "error", code: "cli-missing", message: MESSAGE_CLI_MISSING }
        : {
            type: "error",
            code: "cli-failed",
            message: exit.spawnError.message,
          };
      return;
    }
    if (failure !== undefined) {
      yield { type: "error", code: failure.code, message: failure.message };
      return;
    }
    if (stdinError !== undefined) {
      yield {
        type: "error",
        code: "cli-failed",
        message: `Falha ao enviar a mensagem ao CLI: ${stdinError.message}`,
      };
      return;
    }
    if (exit.code !== 0) {
      const detail = stderr.trim() || `código de saída ${String(exit.code)}`;
      yield { type: "error", code: "cli-failed", message: detail };
      return;
    }
    if (!succeeded) {
      yield {
        type: "error",
        code: "invalid-output",
        message: MESSAGE_NO_FINAL_RESULT,
      };
      return;
    }
    yield { type: "done" };
  }
}
