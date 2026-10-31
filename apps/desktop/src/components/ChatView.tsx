import { useChat } from "../agent/use-chat";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import { StatusIndicator } from "./StatusIndicator";

export function ChatView() {
  const { state, sendMessage, cancel, newConversation, refreshStatus } =
    useChat();
  const busy = state.activeRequestId !== undefined;

  return (
    <div className="app">
      <header className="app-header">
        <h1>LunaBot</h1>
        <StatusIndicator status={state.status} onRefresh={refreshStatus} />
        <button type="button" onClick={newConversation} disabled={busy}>
          Nova conversa
        </button>
      </header>

      <MessageList messages={state.messages} draft={state.draft} />

      {state.error !== undefined && (
        <p className="error-banner" role="alert">
          {state.error}
        </p>
      )}

      <Composer busy={busy} onSend={sendMessage} onCancel={cancel} />
    </div>
  );
}
