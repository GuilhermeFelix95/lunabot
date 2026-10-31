import { renderToStaticMarkup } from "react-dom/server";
import type { Message } from "@lunabot/shared";
import { describe, expect, it } from "vitest";
import { MessageList } from "./MessageList";

const NOTICE = "Resposta interrompida";

function render(messages: Message[]): string {
  return renderToStaticMarkup(
    <MessageList messages={messages} draft={undefined} />,
  );
}

describe("MessageList", () => {
  it("mostra o aviso de resposta interrompida para status cancelled e error", () => {
    const html = render([
      { id: "a", role: "assistant", content: "parcial", status: "cancelled" },
      { id: "b", role: "assistant", content: "outra", status: "error" },
    ]);

    expect(html.split(NOTICE)).toHaveLength(3);
  });

  it("não mostra o aviso para respostas completas ou sem status", () => {
    const html = render([
      { id: "a", role: "assistant", content: "pronta", status: "complete" },
      { id: "b", role: "assistant", content: "antiga" },
    ]);

    expect(html).not.toContain(NOTICE);
  });
});
