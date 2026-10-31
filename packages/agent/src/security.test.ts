import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Regra de segurança: o LunaBot nunca lê, copia nem referencia os arquivos de
 * credenciais de `~/.claude`. Quem usa o login é o próprio CLI `claude`.
 */
const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SCANNED_DIRECTORIES = [
  "packages/agent/src",
  "apps/desktop/src-tauri/src",
];
const SCANNED_EXTENSIONS = [".ts", ".tsx", ".rs", ".mjs"];
const THIS_FILE = "security.test.ts";

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      return listSourceFiles(fullPath);
    }
    const scanned = SCANNED_EXTENSIONS.some((extension) =>
      entry.name.endsWith(extension),
    );
    return scanned && entry.name !== THIS_FILE ? [fullPath] : [];
  });
}

describe("regra de credenciais", () => {
  const files = SCANNED_DIRECTORIES.flatMap((directory) =>
    listSourceFiles(join(REPOSITORY_ROOT, directory)),
  );

  it("encontra arquivos de código para verificar", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("nenhum código referencia .credentials", () => {
    const offenders = files.filter((file) =>
      readFileSync(file, "utf8").includes(".credentials"),
    );
    expect(offenders).toEqual([]);
  });

  it("nenhum código monta caminhos a partir do diretório pessoal", () => {
    const offenders = files.filter((file) =>
      /\bhomedir\s*\(/.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
