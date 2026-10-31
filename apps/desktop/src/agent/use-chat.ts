import { useCallback, useEffect, useReducer } from "react";
import { sendAgentRequest, subscribeToAgent } from "./agent-client";
import { chatReducer, initialChatState, type ChatState } from "./chat-state";

export interface ChatController {
  state: ChatState;
  sendMessage(text: string): void;
  cancel(): void;
  newConversation(): void;
  refreshStatus(): void;
}

function newRequestId(): string {
  return crypto.randomUUID();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useChat(): ChatController {
  const [state, dispatch] = useReducer(chatReducer, initialChatState);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    subscribeToAgent(dispatch)
      .then((dispose) => {
        if (!active) {
          dispose();
          return undefined;
        }
        unsubscribe = dispose;
        return Promise.all([
          sendAgentRequest({ type: "status.get", requestId: newRequestId() }),
          sendAgentRequest({
            type: "history.latest",
            requestId: newRequestId(),
          }),
        ]);
      })
      .catch((error: unknown) => {
        dispatch({ type: "request-failed", message: errorMessage(error) });
      });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const sendMessage = useCallback(
    (text: string) => {
      const requestId = newRequestId();
      dispatch({ type: "send-started", requestId, text });
      sendAgentRequest({
        type: "chat.send",
        requestId,
        conversationId: state.conversationId,
        text,
      }).catch((error: unknown) => {
        dispatch({ type: "send-failed", message: errorMessage(error) });
      });
    },
    [state.conversationId],
  );

  const cancel = useCallback(() => {
    if (state.activeRequestId === undefined) {
      return;
    }
    sendAgentRequest({
      type: "chat.cancel",
      requestId: state.activeRequestId,
    }).catch((error: unknown) => {
      dispatch({ type: "request-failed", message: errorMessage(error) });
    });
  }, [state.activeRequestId]);

  const refreshStatus = useCallback(() => {
    sendAgentRequest({ type: "status.get", requestId: newRequestId() }).catch(
      (error: unknown) => {
        dispatch({ type: "request-failed", message: errorMessage(error) });
      },
    );
  }, []);

  const newConversation = useCallback(() => {
    dispatch({ type: "new-conversation" });
  }, []);

  return { state, sendMessage, cancel, newConversation, refreshStatus };
}
