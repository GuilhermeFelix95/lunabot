/**
 * Leitura das linhas do `claude -p --output-format stream-json`.
 * Formato documentado em https://code.claude.com/docs/en/headless.md (seção "Stream responses").
 */

/** Resultado da leitura de uma linha. Tipos que o LunaBot não usa viram `ignored`. */
export type StreamLine =
  | { kind: "session"; sessionId: string }
  | { kind: "delta"; text: string }
  | {
      kind: "result";
      isError: boolean;
      text: string;
      sessionId: string | undefined;
      apiErrorStatus: number | undefined;
    }
  | { kind: "ignored" };

export class InvalidStreamLineError extends Error {
  constructor(reason: string, options?: ErrorOptions) {
    super(`Saída inválida do CLI: ${reason}.`, options);
    this.name = "InvalidStreamLineError";
  }
}

type JsonObject = Record<string, unknown>;

const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSessionId(value: unknown): value is string {
  return typeof value === "string" && SESSION_ID_PATTERN.test(value);
}

/**
 * Interpreta uma linha JSON do stream. Lança `InvalidStreamLineError` se a linha
 * não for JSON ou se um evento conhecido vier com campos inválidos.
 */
export function parseStreamLine(line: string): StreamLine {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (error) {
    throw new InvalidStreamLineError("a linha não é JSON", { cause: error });
  }
  if (!isObject(value) || typeof value.type !== "string") {
    throw new InvalidStreamLineError("objeto sem o campo type");
  }

  if (value.type === "system" && value.subtype === "init") {
    if (!isSessionId(value.session_id)) {
      throw new InvalidStreamLineError("evento init sem session_id válido");
    }
    return { kind: "session", sessionId: value.session_id };
  }

  if (value.type === "stream_event") {
    const event = value.event;
    if (
      isObject(event) &&
      event.type === "content_block_delta" &&
      isObject(event.delta) &&
      event.delta.type === "text_delta"
    ) {
      if (typeof event.delta.text !== "string") {
        throw new InvalidStreamLineError("text_delta sem texto");
      }
      return { kind: "delta", text: event.delta.text };
    }
    return { kind: "ignored" };
  }

  if (value.type === "result") {
    if (typeof value.is_error !== "boolean") {
      throw new InvalidStreamLineError("evento result sem is_error");
    }
    return {
      kind: "result",
      isError: value.is_error,
      text: typeof value.result === "string" ? value.result : "",
      sessionId: isSessionId(value.session_id) ? value.session_id : undefined,
      apiErrorStatus:
        typeof value.api_error_status === "number"
          ? value.api_error_status
          : undefined,
    };
  }

  return { kind: "ignored" };
}
