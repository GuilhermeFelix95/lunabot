import type { ChatErrorCode, CliStatus } from "@lunabot/shared";

/** Evento produzido por um provedor de IA durante um envio de mensagem. */
export type ProviderEvent =
  | { type: "session"; sessionId: string }
  | { type: "delta"; text: string }
  | { type: "done" }
  | { type: "cancelled" }
  | { type: "error"; code: ChatErrorCode; message: string };

export interface SendOptions {
  prompt: string;
  /** Sessão anterior a continuar; `undefined` inicia uma conversa nova. */
  sessionId: string | undefined;
  /** Sinaliza o cancelamento do envio. */
  signal: AbortSignal;
}

/** Contrato de um provedor de IA. Falhas viram eventos `error`, não exceções. */
export interface AiProvider {
  getStatus(): Promise<CliStatus>;
  send(options: SendOptions): AsyncIterable<ProviderEvent>;
}
