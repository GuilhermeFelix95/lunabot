import type { CliStatus } from "@lunabot/shared";
import { describeCliStatus } from "../agent/chat-state";

interface StatusIndicatorProps {
  status: CliStatus | undefined;
  onRefresh(): void;
}

export function StatusIndicator({ status, onRefresh }: StatusIndicatorProps) {
  const { tone, text } = describeCliStatus(status);

  return (
    <div className="status">
      <span className={`status-dot status-${tone}`} aria-hidden="true" />
      <span role="status">{text}</span>
      <button type="button" onClick={onRefresh}>
        Atualizar
      </button>
    </div>
  );
}
