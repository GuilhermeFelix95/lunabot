import { describe, expect, it } from "vitest";
import { parseAgentLine, parseExitCode } from "./parse-agent-line";

describe("parseAgentLine", () => {
  it("devolve o evento quando a linha segue o protocolo", () => {
    const line = JSON.stringify({
      type: "chat.delta",
      requestId: "r1",
      text: "oi",
    });

    expect(parseAgentLine(line)).toEqual({
      type: "chat.delta",
      requestId: "r1",
      text: "oi",
    });
  });

  it("transforma linha que não é JSON em protocol.error", () => {
    expect(parseAgentLine("não é json")).toEqual({
      type: "protocol.error",
      message: "Evento inválido recebido do agente.",
    });
  });

  it("transforma evento com formato inválido em protocol.error", () => {
    const line = JSON.stringify({ type: "chat.delta", requestId: "r1" });

    expect(parseAgentLine(line)).toMatchObject({ type: "protocol.error" });
  });
});

describe("parseExitCode", () => {
  it("aceita código inteiro e rejeita qualquer outro valor", () => {
    expect(parseExitCode(3)).toBe(3);
    expect(parseExitCode(null)).toBeNull();
    expect(parseExitCode(1.5)).toBeNull();
    expect(parseExitCode("1")).toBeNull();
  });
});
