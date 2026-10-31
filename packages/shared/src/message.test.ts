import { describe, expect, it } from "vitest";
import { isMessage } from "./message.ts";

describe("isMessage", () => {
  it("aceita uma mensagem com formato válido", () => {
    expect(isMessage({ id: "1", role: "user", content: "oi" })).toBe(true);
  });

  it("rejeita valores que não são objetos", () => {
    expect(isMessage(null)).toBe(false);
    expect(isMessage("texto")).toBe(false);
  });

  it("rejeita papel desconhecido", () => {
    expect(isMessage({ id: "1", role: "system", content: "oi" })).toBe(false);
  });

  it("rejeita id vazio ou conteúdo que não é texto", () => {
    expect(isMessage({ id: "", role: "assistant", content: "oi" })).toBe(false);
    expect(isMessage({ id: "1", role: "assistant", content: 42 })).toBe(false);
  });

  it("aceita os status de resposta interrompida e a ausência de status", () => {
    for (const status of ["complete", "cancelled", "error"]) {
      expect(
        isMessage({ id: "1", role: "assistant", content: "oi", status }),
      ).toBe(true);
    }
    expect(isMessage({ id: "1", role: "assistant", content: "oi" })).toBe(true);
  });

  it("rejeita status desconhecido", () => {
    expect(
      isMessage({
        id: "1",
        role: "assistant",
        content: "oi",
        status: "pending",
      }),
    ).toBe(false);
  });
});
