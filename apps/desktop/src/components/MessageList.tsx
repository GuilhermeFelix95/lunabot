import type { Message } from "@lunabot/shared";

interface MessageListProps {
  messages: Message[];
  /** Resposta do assistente ainda em streaming; `undefined` quando não há resposta em andamento. */
  draft: string | undefined;
}

export function MessageList({ messages, draft }: MessageListProps) {
  const isEmpty = messages.length === 0 && draft === undefined;

  return (
    <div className="messages" role="log" aria-live="polite">
      {isEmpty && <p className="empty">Nenhuma mensagem ainda.</p>}
      {messages.map((message) => (
        <div key={message.id} className={`message message-${message.role}`}>
          <p>{message.content}</p>
        </div>
      ))}
      {draft !== undefined && (
        <div className="message message-assistant message-streaming">
          <p>{draft === "" ? "Respondendo…" : draft}</p>
        </div>
      )}
    </div>
  );
}
