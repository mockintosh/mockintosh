import { describe, expect, it } from "vitest";
import { addSystemMessage, fetchWithInstructions } from "./agentInstructions";

describe("host instructions for fx's terminal", () => {
  const request = { prompt: [{ role: "system", content: "fx" }, { role: "system", content: "turn" }, { role: "user", content: [] }], tools: [] };

  it("adds a system message after fx's own", () => {
    const out = JSON.parse(addSystemMessage(JSON.stringify(request), "Mockintosh")) as typeof request;
    expect(out.prompt.map((m) => m.content)).toEqual(["fx", "turn", "Mockintosh", []]);
  });

  it("works on bytes and leaves anything else alone", () => {
    const bytes = addSystemMessage(new TextEncoder().encode(JSON.stringify(request)), "M");
    expect(JSON.parse(new TextDecoder().decode(bytes)).prompt[2]).toEqual({ role: "system", content: "M" });
    expect(addSystemMessage("not json", "M")).toBe("not json");
    expect(addSystemMessage('{"models":[]}', "M")).toBe('{"models":[]}');
  });

  it("rewrites what goes through fetch", async () => {
    const sent: unknown[] = [];
    const fetch = fetchWithInstructions(async (_url: string, init?: never) => sent.push((init as { body: string } | undefined)?.body), "M");
    await fetch("https://gateway", { method: "POST", body: JSON.stringify(request) } as never);
    await fetch("https://gateway/models");
    expect(JSON.parse(sent[0] as string).prompt).toHaveLength(4);
    expect(sent[1]).toBeUndefined();
  });
});
