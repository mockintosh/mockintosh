import { createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import { getBit, newBitMap } from "@mockintosh/quickdraw/bits";
import { createUI } from "../src/ui";
import { Button } from "../src/widgets/Button";
import { Dialog } from "../src/widgets/Dialog";
import { Menu } from "../src/widgets/Menu";
import { Popover } from "../src/widgets/Popover";
import { Select } from "../src/widgets/Select";
import { Tooltip } from "../src/widgets/Tooltip";

const OPTIONS = [
  { value: "a", label: "Apple" },
  { value: "b", label: "Pear" },
] as const;

/** Frames until `onLayout` measurements (delivered in microtasks) have been laid out. */
async function settle(ui: ReturnType<typeof createUI>): Promise<void> {
  for (let i = 0; i < 4; i++) {
    ui.frame();
    await Promise.resolve();
  }
  ui.frame();
}

function click(ui: ReturnType<typeof createUI>, name: string): void {
  const node = ui.inspect().find((n) => n.name === name)!;
  ui.dispatchPointer("mousedown", node.bounds.x + 4, node.bounds.y + 4);
  ui.dispatchPointer("mouseup", node.bounds.x + 4, node.bounds.y + 4);
  ui.frame();
}

describe("Select", () => {
  it("opens a list and picks an option without toggling off", () => {
    const [value, setValue] = createSignal("a");
    const ui = createUI({ screen: newBitMap(240, 160) });
    ui.render(() => (
      <Select name="fruit" value={value()} onChange={setValue} options={OPTIONS} />
    ));
    ui.frame();
    click(ui, "fruit");
    expect(ui.inspect().some((n) => n.name === "fruit:b")).toBe(true);
    click(ui, "fruit:b");
    expect(value()).toBe("b");
    expect(ui.inspect().some((n) => n.name === "overlay-panel")).toBe(false);
    expect(ui.inspect().find((n) => n.name === "fruit")!.text.includes("Pear")).toBe(true);
  });

  it("dismisses on the catcher and on Escape", () => {
    const ui = createUI({ screen: newBitMap(240, 160) });
    ui.render(() => (
      <Select name="fruit" value="a" onChange={() => {}} options={OPTIONS} />
    ));
    ui.frame();
    click(ui, "fruit");
    const catcher = ui.inspect().find((n) => n.name === "overlay-catcher")!;
    ui.dispatchPointer("mousedown", catcher.bounds.x + 2, catcher.bounds.y + 2);
    ui.dispatchPointer("mouseup", catcher.bounds.x + 2, catcher.bounds.y + 2);
    ui.frame();
    expect(ui.inspect().some((n) => n.name === "overlay-panel")).toBe(false);

    click(ui, "fruit");
    ui.dispatchKeyboard("keydown", "Escape");
    ui.frame();
    expect(ui.inspect().some((n) => n.name === "overlay-panel")).toBe(false);
  });

  it("paints the list outside an overflow:scroll ancestor", () => {
    const ui = createUI({ screen: newBitMap(240, 160) });
    ui.render(() => (
      <box overflow="scroll" height={20} width={200}>
        <box height={80} padding={2}>
          <Select name="fruit" value="a" onChange={() => {}} options={OPTIONS} />
        </box>
      </box>
    ));
    ui.frame();
    click(ui, "fruit");
    const panel = ui.inspect().find((n) => n.name === "overlay-panel")!;
    expect(panel.bounds.height).toBeGreaterThan(20);
  });
});

describe("Tooltip", () => {
  it("shows a caption while the pointer is over the trigger", () => {
    const ui = createUI({ screen: newBitMap(240, 80) });
    ui.render(() => (
      <box padding={20}>
        <Tooltip label="Save the file">
          <box
            semantic={{ name: "save" }}
            width={40}
            height={16}
            onClick={() => {}}
          >
            <text font="body">Save</text>
          </box>
        </Tooltip>
      </box>
    ));
    ui.frame();
    const save = ui.inspect().find((n) => n.name === "save")!;
    ui.dispatchPointer("mousemove", save.bounds.x + 4, save.bounds.y + 4);
    ui.frame();
    expect(ui.inspect().some((n) => n.name === "tooltip")).toBe(true);
    ui.dispatchPointer("mousemove", 2, 2);
    ui.frame();
    expect(ui.inspect().some((n) => n.name === "tooltip")).toBe(false);
  });

  it("closes when its trigger moves out from under a still pointer, as a scrolled window's content does", () => {
    const ui = createUI({ screen: newBitMap(240, 120) });
    // The window's scroll, as the OS gives it to a worker app: the content moves, the pointer doesn't.
    const [scrolled, setScrolled] = createSignal(0);
    ui.render(() => (
      <box width={240} height={120} overflow="hidden" position="relative">
        <box position="absolute" left={0} top={20 - scrolled()} width={240}>
          <Tooltip label="Save the file">
            <box semantic={{ name: "save" }} width={40} height={16}>
              <text font="body">Save</text>
            </box>
          </Tooltip>
        </box>
      </box>
    ));
    ui.frame();
    const save = ui.inspect().find((n) => n.name === "save")!;
    ui.dispatchPointer("mousemove", save.bounds.x + 4, save.bounds.y + 4);
    ui.frame();
    expect(ui.inspect().some((n) => n.name === "tooltip")).toBe(true);

    setScrolled(30);
    ui.frame();
    expect(ui.inspect().some((n) => n.name === "tooltip")).toBe(false);

    // Scrolled back under the pointer, it shows again.
    setScrolled(0);
    ui.frame();
    expect(ui.inspect().some((n) => n.name === "tooltip")).toBe(true);
  });

  it("closes when the wheel scrolls its pane out from under the pointer", () => {
    const ui = createUI({ screen: newBitMap(240, 80) });
    ui.render(() => (
      <box width={240} height={60} overflow="scroll">
        <box height={8} />
        <Tooltip label="Save the file">
          <box semantic={{ name: "save" }} width={40} height={16}>
            <text font="body">Save</text>
          </box>
        </Tooltip>
        <box height={200} />
      </box>
    ));
    ui.frame();
    const save = ui.inspect().find((n) => n.name === "save")!;
    const at = { x: save.bounds.x + 4, y: save.bounds.y + 4 };
    ui.dispatchPointer("mousemove", at.x, at.y);
    ui.frame();
    expect(ui.inspect().some((n) => n.name === "tooltip")).toBe(true);
    ui.dispatchPointer("scroll", at.x, at.y, { deltaY: 40 });
    ui.frame();
    expect(ui.inspect().some((n) => n.name === "tooltip")).toBe(false);
  });
});

describe("Tooltip in a scrolled pane", () => {
  it("hangs the caption over the trigger where it is drawn, not where it would be unscrolled", async () => {
    const ui = createUI({ screen: newBitMap(240, 80) });
    ui.render(() => (
      <box padding={20}>
        <box overflow="scroll" width={100} height={40} scrollOffsetX={40}>
          <box width={300} height={40} flexDirection="row">
            <box width={60} />
            <Tooltip label="Day">
              <box semantic={{ name: "day" }} width={8} height={8} onClick={() => {}} />
            </Tooltip>
          </box>
        </box>
      </box>
    ));
    ui.frame();
    const day = ui.inspect().find((n) => n.name === "day")!;
    // 20 padding + 60 in, less 40 scrolled: drawn at x 40.
    expect(day.bounds.x).toBe(40);
    ui.dispatchPointer("mousemove", day.bounds.x + 2, day.bounds.y + 2);
    await settle(ui);
    const panel = ui.inspect().find((n) => n.name === "overlay-panel")!;
    // Centred on the day where it is drawn, its bottom 1px above it.
    expect(Math.abs(panel.bounds.x + panel.bounds.width / 2 - (day.bounds.x + 4))).toBeLessThanOrEqual(1);
    expect(panel.bounds.y + panel.bounds.height).toBe(day.bounds.y - 1);
  });
});

describe("Tooltip at the edge", () => {
  it("moves left to stay on screen when its trigger is near the right edge", async () => {
    const ui = createUI({ screen: newBitMap(120, 60) });
    ui.render(() => (
      <box width={120} height={60} flexDirection="row" justifyContent="flex-end" paddingTop={30}>
        <Tooltip label="2 contributions on October 4, 2026">
          <box semantic={{ name: "day" }} width={8} height={8} onClick={() => {}} />
        </Tooltip>
      </box>
    ));
    ui.frame();
    const day = ui.inspect().find((n) => n.name === "day")!;
    ui.dispatchPointer("mousemove", day.bounds.x + 2, day.bounds.y + 2);
    await settle(ui);
    const panel = ui.inspect().find((n) => n.name === "overlay-panel")!;
    expect(panel.bounds.width).toBeGreaterThan(60);
    expect(panel.bounds.x + panel.bounds.width).toBeLessThanOrEqual(120);
    expect(panel.bounds.x).toBeGreaterThanOrEqual(0);
  });
});

describe("Popover", () => {
  it("opens from the trigger and dismisses outside", () => {
    const [open, setOpen] = createSignal(false);
    const ui = createUI({ screen: newBitMap(240, 160) });
    ui.render(() => (
      <Popover
        open={open()}
        onDismiss={() => setOpen(false)}
        trigger={<Button name="more" label="More" onClick={() => setOpen(true)} />}
      >
        <text font="body">notes</text>
      </Popover>
    ));
    ui.frame();
    click(ui, "more");
    expect(ui.inspect().some((n) => n.name === "popover")).toBe(true);
    const catcher = ui.inspect().find((n) => n.name === "overlay-catcher")!;
    ui.dispatchPointer("mousedown", catcher.bounds.x + 2, catcher.bounds.y + 2);
    ui.frame();
    expect(ui.inspect().some((n) => n.name === "popover")).toBe(false);
  });
});

describe("Dialog", () => {
  it("opens centered and dismisses on Escape", () => {
    const [open, setOpen] = createSignal(false);
    const ui = createUI({ screen: newBitMap(240, 160) });
    ui.render(() => (
      <box flexDirection="column">
        <box width={8} height={8} background={1} />
        <Dialog
          open={open()}
          onDismiss={() => setOpen(false)}
          title="Edit profile"
          trigger={<Button name="edit" label="Edit" onClick={() => setOpen(true)} />}
        >
          <text font="body">Name is local.</text>
        </Dialog>
      </box>
    ));
    ui.frame();
    click(ui, "edit");
    const panel = ui.inspect().find((n) => n.name === "dialog")!;
    expect(panel.role).toBe("dialog");
    expect(panel.text.includes("Edit profile")).toBe(true);
    expect(panel.bounds.x).toBeGreaterThan(0);
    expect(panel.bounds.y).toBeGreaterThan(0);
    expect(getBit(ui.port.portBits, 0, 0)).toBe(0);
    expect(getBit(ui.port.portBits, 1, 0)).toBe(1);

    ui.dispatchKeyboard("keydown", "Escape");
    ui.frame();
    expect(ui.inspect().some((n) => n.name === "dialog")).toBe(false);
  });

  it("dismisses when clicking the dimmed chrome", () => {
    const [open, setOpen] = createSignal(false);
    const ui = createUI({ screen: newBitMap(240, 160) });
    ui.render(() => (
      <Dialog
        open={open()}
        onDismiss={() => setOpen(false)}
        title="Edit profile"
        trigger={<Button name="edit" label="Edit" onClick={() => setOpen(true)} />}
      >
        <text font="body">Name is local.</text>
      </Dialog>
    ));
    ui.frame();
    click(ui, "edit");
    ui.dispatchPointer("mousedown", 2, 2);
    ui.dispatchPointer("mouseup", 2, 2);
    ui.frame();
    expect(ui.inspect().some((n) => n.name === "dialog")).toBe(false);
  });

  it("keeps the panel open when clicking inside it", () => {
    const [open, setOpen] = createSignal(false);
    const ui = createUI({ screen: newBitMap(240, 160) });
    ui.render(() => (
      <Dialog
        open={open()}
        onDismiss={() => setOpen(false)}
        title="Edit profile"
        trigger={<Button name="edit" label="Edit" onClick={() => setOpen(true)} />}
      >
        <text font="body">Name is local.</text>
      </Dialog>
    ));
    ui.frame();
    click(ui, "edit");
    const panel = ui.inspect().find((n) => n.name === "dialog")!;
    ui.dispatchPointer("mousedown", panel.bounds.x + 8, panel.bounds.y + 8);
    ui.frame();
    expect(ui.inspect().some((n) => n.name === "dialog")).toBe(true);
  });
});

describe("Menu", () => {
  it("runs an item then closes", () => {
    const [open, setOpen] = createSignal(false);
    let cut = false;
    const ui = createUI({ screen: newBitMap(240, 160) });
    ui.render(() => (
      <Menu
        name="edit"
        open={open()}
        onDismiss={() => setOpen(false)}
        trigger={<Button name="edit-btn" label="Edit" onClick={() => setOpen(true)} />}
        items={[
          {
            id: "cut",
            label: "Cut",
            onClick: () => {
              cut = true;
            },
          },
          { id: "copy", label: "Copy" },
        ]}
      />
    ));
    ui.frame();
    click(ui, "edit-btn");
    click(ui, "edit:cut");
    expect(cut).toBe(true);
    expect(ui.inspect().some((n) => n.name === "overlay-panel")).toBe(false);
  });

  it("hangs 1px below its trigger", () => {
    const [open, setOpen] = createSignal(false);
    const ui = createUI({ screen: newBitMap(240, 160) });
    ui.render(() => (
      <box padding={10}>
        <Menu name="edit" open={open()} onDismiss={() => {}} trigger={<box semantic={{ name: "trigger" }} width={20} height={10} />} items={[{ label: "Cut" }]} />
      </box>
    ));
    ui.frame();
    setOpen(true);
    ui.frame();
    const trigger = ui.inspect().find((n) => n.name === "trigger")!;
    const menu = ui.inspect().find((n) => n.name === "edit" && n.role === "menu")!;
    expect(menu.bounds.y).toBe(trigger.bounds.y + trigger.bounds.height + 1);
  });

  it("inverts the item under the pointer, as the menu bar does, but never a disabled one", () => {
    const ui = createUI({ screen: newBitMap(240, 160) });
    ui.render(() => (
      <Menu
        name="edit"
        open
        onDismiss={() => {}}
        trigger={<box width={20} height={10} />}
        items={[
          { id: "cut", label: "Cut" },
          { id: "paste", label: "Paste", disabled: true },
        ]}
      />
    ));
    ui.frame();
    // A pixel in an item's left padding: paper, or ink when the item is lit.
    const padding = (name: string) => {
      const item = ui.inspect().find((n) => n.name === name)!;
      return { x: item.bounds.x + 2, y: item.bounds.y + 2 };
    };
    const lit = (name: string) => getBit(ui.port.portBits, padding(name).x, padding(name).y) === 1;
    expect(lit("edit:cut")).toBe(false);
    ui.dispatchPointer("mousemove", padding("edit:cut").x, padding("edit:cut").y);
    ui.frame();
    expect(lit("edit:cut")).toBe(true);
    ui.dispatchPointer("mousemove", padding("edit:paste").x, padding("edit:paste").y);
    ui.frame();
    expect(lit("edit:cut")).toBe(false);
    expect(lit("edit:paste")).toBe(false);
  });
});
