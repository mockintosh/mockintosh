import { createSignal, flush, For, Show } from "solid-js";
import { describe, expect, it } from "vitest";
import { newBitMap } from "@mockintosh/quickdraw/bits";
import { createUI } from "../src/ui";

function names(ui: ReturnType<typeof createUI>): string[] {
  return ui.inspect().map((n) => n.name ?? "").filter((n) => n && n !== "root");
}

describe("dynamic children keep their written order", () => {
  it("paints a <Show> after a <For> that started empty", () => {
    const ui = createUI({ screen: newBitMap(100, 100) });
    const [items, setItems] = createSignal<{ id: string }[]>([]);
    const [draft, setDraft] = createSignal<{ id: string } | null>(null);
    ui.render(() => (
      <box width={100} height={100} semantic={{ name: "root" }}>
        <For each={items()} keyed={(el) => el.id}>
          {(el) => <box semantic={{ name: `item-${el().id}` }} width={1} height={1} />}
        </For>
        <Show when={draft()}>{(d) => <box semantic={{ name: `draft-${d().id}` }} width={1} height={1} />}</Show>
      </box>
    ));
    ui.frame();
    setItems([{ id: "a" }]);
    flush();
    setDraft({ id: "1" });
    flush();
    ui.frame();
    expect(names(ui)).toEqual(["item-a", "draft-1"]);

    setItems([]);
    flush();
    setItems([{ id: "b" }, { id: "c" }]);
    flush();
    ui.frame();
    expect(names(ui)).toEqual(["item-b", "item-c", "draft-1"]);
  });

  it("adds no gap for slots that render nothing", () => {
    const ui = createUI({ screen: newBitMap(100, 20) });
    const [on] = createSignal(false);
    ui.render(() => (
      <box width={100} height={20} flexDirection="row" gap={10} semantic={{ name: "root" }}>
        <box semantic={{ name: "first" }} width={5} height={5} />
        <For each={[] as string[]}>{() => <box width={5} height={5} />}</For>
        <Show when={on()}>
          <box width={5} height={5} />
        </Show>
        <box semantic={{ name: "last" }} width={5} height={5} />
      </box>
    ));
    ui.frame();
    const at = (name: string) => ui.inspect().find((n) => n.name === name)!.bounds.x;
    expect(at("last") - at("first")).toBe(15);
  });
});
