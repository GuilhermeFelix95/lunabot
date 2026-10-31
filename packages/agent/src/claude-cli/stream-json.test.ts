import { describe, expect, it } from "vitest";
import { InvalidStreamLineError, parseStreamLine } from "./stream-json.ts";

const SESSION_ID = "123e4567-e89b-42d3-a456-426614174000";

describe("parseStreamLine", () => {
  it("lê o session_id do evento init", () => {
    const line = JSON.stringify({
      type: "system",
      subtype: "init",
      session_id: SESSION_ID,
    });
    expect(parseStreamLine(line)).toEqual({
      kind: "session",
      sessionId: SESSION_ID,
    });
  });

  it("lê o texto de um text_delta", () => {
    const line = JSON.stringify({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "oi" },
      },
    });
    expect(parseStreamLine(line)).toEqual({ kind: "delta", text: "oi" });
  });

  it("ignora eventos que o LunaBot não usa", () => {
    expect(
      parseStreamLine(JSON.stringify({ type: "rate_limit_event" })),
    ).toEqual({ kind: "ignored" });
    expect(
      parseStreamLine(
        JSON.stringify({
          type: "stream_event",
          event: { type: "message_stop" },
        }),
      ),
    ).toEqual({ kind: "ignored" });
  });

  it("lê o resultado final, com erro e status HTTP quando existirem", () => {
    const line = JSON.stringify({
      type: "result",
      is_error: true,
      result: "Not logged in",
      session_id: SESSION_ID,
      api_error_status: 401,
    });
    expect(parseStreamLine(line)).toEqual({
      kind: "result",
      isError: true,
      text: "Not logged in",
      sessionId: SESSION_ID,
      apiErrorStatus: 401,
    });
  });

  it("rejeita linha que não é JSON", () => {
    expect(() => parseStreamLine("não é json")).toThrow(InvalidStreamLineError);
  });

  it("rejeita valor JSON que não é objeto ou não tem type", () => {
    expect(() => parseStreamLine("[1, 2]")).toThrow(InvalidStreamLineError);
    expect(() => parseStreamLine(JSON.stringify({ texto: "x" }))).toThrow(
      InvalidStreamLineError,
    );
  });

  it("rejeita init sem session_id válido", () => {
    const line = JSON.stringify({
      type: "system",
      subtype: "init",
      session_id: "../../etc",
    });
    expect(() => parseStreamLine(line)).toThrow(InvalidStreamLineError);
  });

  it("rejeita result sem is_error booleano", () => {
    expect(() =>
      parseStreamLine(JSON.stringify({ type: "result", result: "ok" })),
    ).toThrow(InvalidStreamLineError);
  });
});
