import { useState, type KeyboardEvent } from "react";
import { MAX_PROMPT_LENGTH } from "@lunabot/shared";

interface ComposerProps {
  busy: boolean;
  onSend(text: string): void;
  onCancel(): void;
}

export function Composer({ busy, onSend, onCancel }: ComposerProps) {
  const [text, setText] = useState("");
  const trimmed = text.trim();
  const tooLong = text.length > MAX_PROMPT_LENGTH;
  const canSend = !busy && trimmed.length > 0 && !tooLong;

  function submit() {
    if (!canSend) {
      return;
    }
    onSend(trimmed);
    setText("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <textarea
        aria-label="Mensagem"
        placeholder="Escreva uma mensagem. Enter envia, Shift+Enter quebra a linha."
        rows={3}
        value={text}
        disabled={busy}
        onChange={(event) => setText(event.currentTarget.value)}
        onKeyDown={handleKeyDown}
      />
      <div className="composer-actions">
        {tooLong && (
          <p className="hint error-text">
            Mensagem muito longa: o limite é {MAX_PROMPT_LENGTH} caracteres.
          </p>
        )}
        {busy ? (
          <button type="button" onClick={onCancel}>
            Cancelar
          </button>
        ) : (
          <button type="submit" disabled={!canSend}>
            Enviar
          </button>
        )}
      </div>
    </form>
  );
}
