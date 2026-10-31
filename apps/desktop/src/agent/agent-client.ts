import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AgentRequest } from "@lunabot/shared";
import { parseAgentLine, parseExitCode } from "./parse-agent-line";
import type { ChatAction } from "./chat-state";

/** Nomes dos eventos emitidos pelo Rust (apps/desktop/src-tauri/src/lib.rs). */
const AGENT_EVENT = "agent-event";
const AGENT_EXIT = "agent-exit";

export function sendAgentRequest(request: AgentRequest): Promise<void> {
  return invoke("agent_send", { request });
}

/** Assina os eventos do sidecar e devolve a função que cancela a assinatura. */
export async function subscribeToAgent(
  dispatch: (action: ChatAction) => void,
): Promise<UnlistenFn> {
  const [unlistenEvent, unlistenExit] = await Promise.all([
    listen<string>(AGENT_EVENT, (message) => {
      dispatch({ type: "agent-event", event: parseAgentLine(message.payload) });
    }),
    listen<unknown>(AGENT_EXIT, (message) => {
      dispatch({ type: "agent-exit", code: parseExitCode(message.payload) });
    }),
  ]);
  return () => {
    unlistenEvent();
    unlistenExit();
  };
}
