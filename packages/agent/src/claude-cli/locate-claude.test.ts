import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findClaudeExecutable } from "./locate-claude.ts";

// O teste fora do Windows usa caminhos POSIX, então `existsSync` é simulado.
// Caminhos com `C:` quebrariam o delimitador `:` do PATH POSIX.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: vi.fn(actual.existsSync) };
});

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lunabot-locate-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function touch(directory: string, fileName: string): string {
  mkdirSync(directory, { recursive: true });
  const file = join(directory, fileName);
  writeFileSync(file, "");
  return file;
}

describe("findClaudeExecutable", () => {
  it("encontra claude.exe no PATH do Windows", () => {
    const bin = join(root, "bin");
    const expected = touch(bin, "claude.exe");

    expect(findClaudeExecutable(bin, "win32")).toBe(expected);
  });

  it("ignora claude.cmd no Windows, pois não pode ser executado sem shell", () => {
    const bin = join(root, "npm");
    touch(bin, "claude.cmd");

    expect(findClaudeExecutable(bin, "win32")).toBeUndefined();
  });

  it("usa a primeira pasta do PATH que contém o executável", () => {
    const first = join(root, "first");
    const second = join(root, "second");
    const expected = touch(first, "claude.exe");
    touch(second, "claude.exe");

    expect(findClaudeExecutable([first, second].join(";"), "win32")).toBe(
      expected,
    );
  });

  it("ignora entradas vazias no PATH", () => {
    const bin = join(root, "bin");
    const expected = touch(bin, "claude.exe");

    expect(findClaudeExecutable(`;;${bin};`, "win32")).toBe(expected);
  });

  it("retorna undefined quando o CLI não está em nenhuma pasta", () => {
    expect(findClaudeExecutable(join(root, "vazio"), "win32")).toBeUndefined();
    expect(findClaudeExecutable(undefined, "win32")).toBeUndefined();
  });

  it("procura `claude` sem extensão fora do Windows", () => {
    vi.mocked(existsSync).mockReturnValueOnce(true);

    expect(findClaudeExecutable("/opt/claude/bin", "linux")).toBe(
      "/opt/claude/bin/claude",
    );
    expect(existsSync).toHaveBeenCalledWith("/opt/claude/bin/claude");
  });
});
