import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const MAIN_ENTRY = fileURLToPath(new URL("./main.ts", import.meta.url));
const EXIT_TIMEOUT_MS = 10_000;

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "lunabot-main-"));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe("processo do sidecar (main.ts)", () => {
  it("encerra com erro registrado no stderr quando o stdout é fechado pelo leitor", async () => {
    const child = spawn(process.execPath, [MAIN_ENTRY], {
      env: { ...process.env, LUNABOT_DATA_DIR: directory },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    // Simula o leitor que sumiu: a próxima escrita do sidecar falha com EPIPE.
    child.stdout.destroy();
    child.stdin.write(
      `${JSON.stringify({ type: "history.latest", requestId: "h1" })}\n`,
    );

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("O sidecar não encerrou a tempo."));
      }, EXIT_TIMEOUT_MS);
      child.once("exit", (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Falha fatal no sidecar do LunaBot");
  });
});
