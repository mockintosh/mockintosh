import { describe, expect, it } from "vitest";
import { CHECKPOINT_KEY, TRANSCRIPT_KEY, createConversation } from "./conversation";
import { createMemoryStorage, createScriptedRuntime, type ScriptedTurn } from "./scripted";

function setup(turns: ScriptedTurn[]) {
  const runtime = createScriptedRuntime(turns);
  const storage = createMemoryStorage();
  const conversation = createConversation({
    runtime,
    storage,
    apiKey: "key-1234",
    instructions: "be brief",
    tools: () => [],
  });
  return { runtime, storage, conversation };
}

describe("fx conversation", () => {
  it("streams a reply into one line, marks tool use, and saves the checkpoint and transcript", async () => {
    const { runtime, storage, conversation } = setup([
      {
        steps: [
          { type: "text", delta: "Let me " },
          { type: "text", delta: "look." },
          { type: "tool-start", id: "1", name: "read" },
          { type: "tool-end", id: "1", name: "read", isError: false },
          { type: "tool-start", id: "2", name: "read_lines" },
          { type: "tool-end", id: "2", name: "read_lines", isError: false },
          { type: "tool-start", id: "3", name: "build_submit" },
          { type: "tool-end", id: "3", name: "build_submit", isError: true },
          { type: "text", delta: "Done." },
        ],
      },
    ]);
    const changes: boolean[] = [];
    conversation.onChange(() => changes.push(conversation.busy()));

    await conversation.send("  fix the counter  ");

    expect(runtime.sessions[0]).toMatchObject({ apiKey: "key-1234", instructions: "be brief" });
    expect(runtime.prompts).toEqual(["fix the counter"]);
    expect(conversation.lines()).toEqual([
      { kind: "user", text: "fix the counter" },
      { kind: "assistant", text: "Let me look." },
      { kind: "activity", text: "Reading source" },
      { kind: "activity", text: "Building" },
      { kind: "activity", text: "Building failed", failed: true },
      { kind: "assistant", text: "Done." },
    ]);
    expect(conversation.busy()).toBe(false);
    expect(changes[0]).toBe(true);
    expect(changes.at(-1)).toBe(false);
    expect(new TextDecoder().decode(storage.files.get(CHECKPOINT_KEY))).toBe("checkpoint after 1");
    expect(JSON.parse(new TextDecoder().decode(storage.files.get(TRANSCRIPT_KEY)))).toEqual(conversation.lines());
  });

  it("carries on from what the last launch saved", async () => {
    const first = setup([{ steps: [{ type: "text", delta: "Hello." }] }]);
    await first.conversation.send("hi");
    await first.conversation.close();

    const runtime = createScriptedRuntime([{ steps: [{ type: "text", delta: "Again." }] }]);
    const next = createConversation({
      runtime,
      storage: first.storage,
      apiKey: "key-1234",
      instructions: "be brief",
      tools: () => [],
    });
    await next.restore();
    expect(next.lines().map((line) => line.text)).toEqual(["hi", "Hello."]);
    expect(runtime.sessions).toHaveLength(0);

    await next.send("once more");
    expect(new TextDecoder().decode(runtime.sessions[0]!.checkpoint)).toBe("checkpoint after 1");
    expect(next.lines().map((line) => line.text)).toEqual(["hi", "Hello.", "once more", "Again."]);
  });

  it("keeps what was said when fx quits partway through a reply", async () => {
    const first = setup([
      {
        steps: [
          { type: "text", delta: "First I'll read the source.\n" },
          { type: "tool-start", id: "1", name: "read" },
          { type: "tool-end", id: "1", name: "read", isError: false },
          { type: "text", delta: "Now the half-written" },
        ],
        hold: true,
      },
    ]);
    void first.conversation.send("fix the counter");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(first.conversation.busy()).toBe(true);
    await first.conversation.close();
    first.runtime.release();

    const next = createConversation({
      runtime: createScriptedRuntime([]),
      storage: first.storage,
      apiKey: "key-1234",
      instructions: "be brief",
      tools: () => [],
    });
    await next.restore();
    expect(next.lines()).toEqual([
      { kind: "user", text: "fix the counter" },
      { kind: "assistant", text: "First I'll read the source.\n" },
      { kind: "activity", text: "Reading source" },
      { kind: "assistant", text: "Now the half-written" },
      { kind: "notice", text: "fx was interrupted before it finished." },
    ]);
  });

  it("keeps the thread saved while a reply is still coming", async () => {
    const { conversation, storage, runtime } = setup([
      { steps: [{ type: "text", delta: "Reading.\n" }, { type: "tool-start", id: "1", name: "read" }], hold: true },
    ]);
    void conversation.send("look around");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const saved = JSON.parse(new TextDecoder().decode(storage.files.get(TRANSCRIPT_KEY)));
    expect(saved.map((line: { text: string }) => line.text)).toEqual([
      "look around",
      "Reading.\n",
      "Reading source",
      "fx was interrupted before it finished.",
    ]);
    runtime.release();
  });

  it("stops when cancelled and says so", async () => {
    const { conversation, runtime } = setup([{ steps: [{ type: "text", delta: "Working" }], hold: true }]);
    const sending = conversation.send("build something big");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(conversation.busy()).toBe(true);
    conversation.cancel();
    await sending;
    expect(conversation.lines().at(-1)).toEqual({ kind: "notice", text: "Stopped." });
    expect(conversation.busy()).toBe(false);
    runtime.release();
  });

  it("reports a turn that fails, such as a rejected key", async () => {
    const { conversation } = setup([{ steps: [], fail: "401 Unauthorized" }]);
    await conversation.send("hello");
    expect(conversation.lines().at(-1)).toEqual({ kind: "notice", text: "fx couldn't finish: 401 Unauthorized" });
  });

  it("forgets everything on reset, including what's saved", async () => {
    const { conversation, storage, runtime } = setup([{ steps: [{ type: "text", delta: "Hi." }] }]);
    await conversation.send("hello");
    await conversation.reset();
    expect(conversation.lines()).toEqual([]);
    expect(storage.files.has(CHECKPOINT_KEY)).toBe(false);
    expect(storage.files.has(TRANSCRIPT_KEY)).toBe(false);
    expect(runtime.closed).toBe(1);

    await conversation.send("fresh start");
    expect(runtime.sessions).toHaveLength(2);
    expect(runtime.sessions[1]!.checkpoint).toBeUndefined();
  });
});
