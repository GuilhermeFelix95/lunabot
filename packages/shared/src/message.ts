/**
 * Situação de uma resposta do assistente. `complete` é a resposta inteira.
 * `cancelled` e `error` guardam o texto parcial de uma resposta interrompida.
 */
export const MESSAGE_STATUSES = ["complete", "cancelled", "error"] as const;

export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

/** Mensagem trocada entre a interface e o agente. Ausente significa `complete`. */
export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  status?: MessageStatus;
}

function isMessageStatus(value: unknown): value is MessageStatus {
  return (
    typeof value === "string" &&
    (MESSAGE_STATUSES as readonly string[]).includes(value)
  );
}

/** Valida o formato de um valor desconhecido antes de tratá-lo como `Message`. */
export function isMessage(value: unknown): value is Message {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    (candidate.role === "user" || candidate.role === "assistant") &&
    typeof candidate.content === "string" &&
    (candidate.status === undefined || isMessageStatus(candidate.status))
  );
}
