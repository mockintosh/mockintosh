import { For, createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import { newBitMap } from "@mockintosh/quickdraw/bits";
import { createUI } from "../src/ui";
import { Attachment } from "../src/widgets/Attachment";
import { Bubble } from "../src/widgets/Bubble";
import { Marker } from "../src/widgets/Marker";
import { Message, MessageScroller } from "../src/widgets/Message";
import { Questionnaire } from "../src/widgets/Questionnaire";

function click(ui: ReturnType<typeof createUI>, name: string): void {
  const node = ui.inspect().find((n) => n.name === name)!;
  ui.dispatchPointer("mousedown", node.bounds.x + 4, node.bounds.y + 4);
  ui.dispatchPointer("mouseup", node.bounds.x + 4, node.bounds.y + 4);
}

describe("chat kit", () => {
  it("keeps wrap text above a bubble in a half-column flex cell", () => {
    const ui = createUI({ screen: newBitMap(400, 200) });
    ui.render(() => (
      <box width={400} flexDirection="row" gap={12}>
        <box flexGrow={1} flexBasis={0} flexShrink={1} minWidth={0} flexDirection="column" gap={4}>
          <text font="body" wrap>
            The sidebar divider is hstripe now, 1-on/1-off like the header.
          </text>
          <Bubble align="end">Add an Agent card on the home page.</Bubble>
        </box>
        <box flexGrow={1} flexBasis={0} flexShrink={1} minWidth={0}>
          <text font="body">People</text>
        </box>
      </box>
    ));
    ui.frame();
    const reply = ui.inspect().find((n) => n.role === "text" && n.text.includes("hstripe"))!;
    const bubble = ui.inspect().find((n) => n.value?.includes("Agent card"))!;
    expect(reply.bounds.y + reply.bounds.height).toBeLessThanOrEqual(bubble.bounds.y);
  });

  it("keeps a wrapping end bubble from overlapping the next line", () => {
    const ui = createUI({ screen: newBitMap(220, 160) });
    ui.render(() => (
      <box width={200} flexDirection="column" gap={4}>
        <Bubble align="end" maxWidth={120}>
          Same treatment for the sidebar please.
        </Bubble>
        <text font="body">The divider is hstripe now.</text>
      </box>
    ));
    ui.frame();
    const bubble = ui.inspect().find((n) => n.value?.includes("sidebar"))!;
    const reply = ui.inspect().find((n) => n.role === "text" && n.text.includes("hstripe"))!;
    expect(bubble.bounds.y + bubble.bounds.height).toBeLessThanOrEqual(reply.bounds.y);
  });

  it("aligns an inverted bubble to the end", () => {
    const ui = createUI({ screen: newBitMap(300, 80) });
    ui.render(() => <Bubble align="end">hello</Bubble>);
    ui.frame();
    const node = ui.inspect().find((n) => n.value === "hello")!;
    expect(node.bounds.x).toBeGreaterThan(40);
  });

  it("lays out a start message with an avatar", () => {
    const ui = createUI({ screen: newBitMap(320, 80) });
    ui.render(() => (
      <Message align="start" initials="G" name="Gippity">
        How can I help?
      </Message>
    ));
    ui.frame();
    expect(ui.inspect().some((n) => n.text.includes("How can I help?"))).toBe(true);
    expect(ui.inspect().some((n) => n.value === "G")).toBe(true);
  });

  it("pins a thread to the last message", () => {
    const ui = createUI({ screen: newBitMap(240, 200) });
    ui.render(() => (
      <MessageScroller height={80}>
        <Message align="start">one</Message>
        <Message align="end">two</Message>
        <Message align="start">three</Message>
      </MessageScroller>
    ));
    ui.frame();
    const last = ui.inspect().find((n) => n.text.includes("three"))!;
    expect(last.bounds.y).toBeLessThan(80);
  });

  it("follows new messages at the end and holds still once scrolled up", () => {
    const [lines, setLines] = createSignal(["one", "two", "three"]);
    const ui = createUI({ screen: newBitMap(240, 200) });
    ui.render(() => (
      <MessageScroller height={80}>
        <For each={lines()}>{(line) => <Message align="start">{line}</Message>}</For>
      </MessageScroller>
    ));
    ui.frame();
    const log = () => ui.inspect().find((n) => n.role === "log")!;
    const visible = (text: string) => {
      const node = ui.inspect().find((n) => n.text === text);
      return !!node && node.bounds.height > 0;
    };

    setLines((all) => [...all, "four"]);
    ui.frame();
    expect(visible("four")).toBe(true);

    ui.dispatchPointer("scroll", log().bounds.x + 10, log().bounds.y + 10, { deltaY: -400 });
    ui.frame();
    expect(visible("one")).toBe(true);
    setLines((all) => [...all, "five"]);
    ui.frame();
    expect(visible("one")).toBe(true);
    expect(visible("five")).toBe(false);

    ui.dispatchPointer("scroll", log().bounds.x + 10, log().bounds.y + 10, { deltaY: 400 });
    setLines((all) => [...all, "six"]);
    ui.frame();
    expect(visible("six")).toBe(true);
  });

  it("does not leave an empty thread scrolled past its only line", () => {
    const [lines, setLines] = createSignal(["one", "two", "three", "four"]);
    const ui = createUI({ screen: newBitMap(240, 200) });
    ui.render(() => (
      <MessageScroller height={80} padding={6}>
        <For each={lines()}>{(line) => <Message align="start">{line}</Message>}</For>
      </MessageScroller>
    ));
    ui.frame();
    setLines(["hello"]);
    ui.frame();
    const log = ui.inspect().find((n) => n.role === "log")!;
    const line = ui.inspect().find((n) => n.text === "hello")!;
    expect(line.bounds.y).toBeGreaterThanOrEqual(log.bounds.y + 6);
  });

  it("renders a separator marker and an uploading attachment", () => {
    let removed = false;
    const ui = createUI({ screen: newBitMap(320, 120) });
    ui.render(() => (
      <box flexDirection="column" gap={6} width={280}>
        <Marker variant="separator">Today</Marker>
        <Attachment
          title="notes.txt"
          description="12 KB"
          state="uploading"
          progress={0.4}
          onRemove={() => {
            removed = true;
          }}
        />
      </box>
    ));
    ui.frame();
    expect(ui.inspect().some((n) => n.text.includes("Today"))).toBe(true);
    expect(ui.inspect().some((n) => n.name === "attach-progress")).toBe(true);
    click(ui, "attach-remove");
    expect(removed).toBe(true);
  });

  it("advances a questionnaire when a choice is picked", () => {
    const [index, setIndex] = createSignal(0);
    const [value, setValue] = createSignal("");
    let done = false;
    const ui = createUI({ screen: newBitMap(320, 200) });
    ui.render(() => (
      <Questionnaire
        index={index()}
        value={value()}
        onChange={setValue}
        onNext={() => setIndex((n) => n + 1)}
        onPrevious={() => setIndex((n) => n - 1)}
        onSubmit={() => {
          done = true;
        }}
        items={[
          {
            name: "kind",
            prompt: "What next?",
            choices: [
              { value: "app", label: "An app" },
              { value: "note", label: "A note" },
            ],
          },
          {
            name: "when",
            prompt: "When?",
            choices: [{ value: "now", label: "Now" }],
          },
        ]}
      />
    ));
    ui.frame();
    click(ui, "kind:app");
    ui.frame();
    expect(value()).toBe("app");
    click(ui, "quiz-next");
    ui.frame();
    expect(index()).toBe(1);
    click(ui, "when:now");
    ui.frame();
    click(ui, "quiz-next");
    expect(done).toBe(true);
  });
});
