import { isAgentEvent, type AgentEvent } from "@lunabot/shared";

const INVALID_EVENT_MESSAGE = "Evento inválido recebido do agente.";

/** Converte uma linha do stdout do sidecar em evento. Linha inválida vira `protocol.error`. */
export function parseAgentLine(line: string): AgentEvent {
  const value = parseJson(line);
  if (isAgentEvent(value)) {
    return value;
  }
  return { type: "protocol.error", message: INVALID_EVENT_MESSAGE };
}

/** Lê o código de saída do sidecar. Qualquer outro valor vira `null`. */
export function parseExitCode(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function parseJson(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    // Linha que não é JSON é tratada pelo chamador como evento inválido.
    return undefined;
  }
}
