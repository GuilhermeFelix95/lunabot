/** Mensagem trocada entre a interface e o agente. */
export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
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
    typeof candidate.content === "string"
  );
}
