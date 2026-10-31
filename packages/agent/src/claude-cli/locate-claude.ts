import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Procura o executável `claude` nas pastas do PATH, sem usar shell.
 *
 * No Windows procura só `claude.exe`. O shim `claude.cmd` (instalação via npm)
 * não pode ser executado sem shell, então é ignorado de propósito.
 * Retorna `undefined` quando o CLI não está instalado.
 */
export function findClaudeExecutable(
  pathValue: string | undefined,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const pathModule = platform === "win32" ? path.win32 : path.posix;
  const fileName = platform === "win32" ? "claude.exe" : "claude";

  for (const directory of (pathValue ?? "").split(pathModule.delimiter)) {
    if (directory === "") {
      continue;
    }
    const candidate = pathModule.join(directory, fileName);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}
