import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ProviderEvent } from "../provider.ts";
import { ClaudeCliProvider } from "./claude-cli-provider.ts";

const FAKE_CLI = fileURLToPath(
  new URL("../../test-fixtures/fake-claude.mjs", import.meta.url),
);
const SESSION_ID = "123e4567-e89b-42d3-a456-426614174000";

function fakeProvider(scenario: string): ClaudeCliProvider {
  return new ClaudeCliProvider({
    command: process.execPath,
    baseArgs: [FAKE_CLI],
    cwd: tmpdir(),
    env: { ...process.env, FAKE_CLAUDE_SCENARIO: scenario },
  });
}

async function collect(
  events: AsyncIterable<ProviderEvent>,
): Promise<ProviderEvent[]> {
  const received: ProviderEvent[] = [];
  for await (const event of events) {
    received.push(event);
  }
  return received;
}

function send(
  provider: ClaudeCliProvider,
  options: { sessionId?: string; signal?: AbortSignal } = {},
): AsyncIterable<ProviderEvent> {
  return provider.send({
    prompt: "responda apenas: ok",
    sessionId: options.sessionId,
    signal: options.signal ?? new AbortController().signal,
  });
}

describe("ClaudeCliProvider.send", () => {
  it("emite sessão, deltas e fim em um stream feliz", async () => {
    const events = await collect(send(fakeProvider("happy")));

    expect(events).toEqual([
      { type: "session", sessionId: SESSION_ID },
      { type: "delta", text: "o" },
      { type: "delta", text: "k" },
      { type: "done" },
    ]);
  });

  it("passa os flags seguros, o prompt por stdin e o --resume da sessão", async () => {
    const events = await collect(
      send(fakeProvider("echo-args"), { sessionId: SESSION_ID }),
    );
    const echoed = events
      .filter((event) => event.type === "delta")
      .map((event) => event.text)
      .join("");
    const { args, prompt } = JSON.parse(echoed) as {
      args: string[];
      prompt: string;
    };

    expect(prompt).toBe("responda apenas: ok");
    expect(args).toEqual(
      expect.arrayContaining([
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--resume",
        SESSION_ID,
        "--tools",
        "--disallowedTools",
        "mcp__*",
      ]),
    );
    expect(args).not.toContain("--bare");
    expect(args[args.indexOf("--tools") + 1]).toBe("");
  });

  it("classifica erro de autenticação vindo do resultado do CLI", async () => {
    const events = await collect(send(fakeProvider("auth-error")));

    expect(events.at(-1)).toMatchObject({
      type: "error",
      code: "cli-logged-out",
    });
    expect(events.some((event) => event.type === "done")).toBe(false);
  });

  it("classifica erro de autenticação pelo status HTTP 401", async () => {
    const events = await collect(send(fakeProvider("api-auth-status")));

    expect(events).toEqual([
      { type: "session", sessionId: SESSION_ID },
      expect.objectContaining({ type: "error", code: "cli-logged-out" }),
    ]);
  });

  it("retorna cli-missing quando o executável não existe", async () => {
    const provider = new ClaudeCliProvider({
      command: "C:\\caminho\\que\\nao\\existe\\claude.exe",
      cwd: tmpdir(),
    });

    const events = await collect(send(provider));

    expect(events).toEqual([
      expect.objectContaining({ type: "error", code: "cli-missing" }),
    ]);
  });

  it("retorna cli-missing quando não há caminho para o CLI", async () => {
    const provider = new ClaudeCliProvider({
      command: undefined,
      cwd: tmpdir(),
    });

    const events = await collect(send(provider));

    expect(events).toEqual([
      expect.objectContaining({ type: "error", code: "cli-missing" }),
    ]);
  });

  it("retorna invalid-output ao receber uma linha que não é JSON", async () => {
    const events = await collect(send(fakeProvider("invalid-line")));

    expect(events).toEqual([
      { type: "session", sessionId: SESSION_ID },
      expect.objectContaining({ type: "error", code: "invalid-output" }),
    ]);
    expect(events.some((event) => event.type === "done")).toBe(false);
  });

  it("retorna cli-failed com o stderr quando o código de saída é diferente de zero", async () => {
    const events = await collect(send(fakeProvider("exit-code")));

    expect(events).toEqual([
      expect.objectContaining({
        type: "error",
        code: "cli-failed",
        message: expect.stringContaining("falha simulada") as unknown,
      }),
    ]);
  });

  it("retorna invalid-output quando o CLI termina sem resultado final", async () => {
    const events = await collect(send(fakeProvider("no-result")));

    expect(events.at(-1)).toMatchObject({
      type: "error",
      code: "invalid-output",
    });
  });

  it("emite cancelled ao abortar um envio em andamento", async () => {
    const controller = new AbortController();
    const iterator = send(fakeProvider("hang"), {
      signal: controller.signal,
    })[Symbol.asyncIterator]();

    expect(await iterator.next()).toEqual({
      done: false,
      value: { type: "session", sessionId: SESSION_ID },
    });
    expect(await iterator.next()).toEqual({
      done: false,
      value: { type: "delta", text: "parcial" },
    });

    controller.abort();

    expect(await iterator.next()).toEqual({
      done: false,
      value: { type: "cancelled" },
    });
    expect((await iterator.next()).done).toBe(true);
  });

  it("emite cancelled sem iniciar o CLI quando o sinal já está abortado", async () => {
    const controller = new AbortController();
    controller.abort();

    const events = await collect(
      send(fakeProvider("happy"), { signal: controller.signal }),
    );

    expect(events).toEqual([{ type: "cancelled" }]);
  });
});

describe("ClaudeCliProvider.getStatus", () => {
  it("retorna ready quando o CLI reporta login", async () => {
    expect(await fakeProvider("happy").getStatus()).toEqual({ state: "ready" });
  });

  it("retorna logged-out quando o CLI reporta que não há login", async () => {
    expect(await fakeProvider("logged-out").getStatus()).toEqual({
      state: "logged-out",
    });
  });

  it("retorna missing quando o CLI não existe", async () => {
    const provider = new ClaudeCliProvider({
      command: "C:\\caminho\\que\\nao\\existe\\claude.exe",
      cwd: tmpdir(),
    });

    expect(await provider.getStatus()).toEqual({ state: "missing" });
  });

  it("retorna missing quando não há caminho para o CLI", async () => {
    const provider = new ClaudeCliProvider({
      command: undefined,
      cwd: tmpdir(),
    });

    expect(await provider.getStatus()).toEqual({ state: "missing" });
  });
});
