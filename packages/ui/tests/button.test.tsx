import { describe, expect, it } from "vitest";
import { newBitMap } from "@mockintosh/quickdraw/bits";
import { createUI } from "../src/ui";
import { Button } from "../src/widgets/Button";
import { DialogButton } from "../src/widgets/DialogButton";

describe("Button", () => {
  it("defaults to a 16px face plus the 1px shadow slot", () => {
    const ui = createUI({ screen: newBitMap(200, 80) });
    ui.render(() => <Button name="ok" label="OK" onClick={() => {}} />);
    ui.frame();
    expect(ui.inspect().find((n) => n.name === "ok")!.bounds.height).toBe(17);
  });

  it("ring sits outside the face and adds the CDEF inset", () => {
    const ui = createUI({ screen: newBitMap(200, 80) });
    ui.render(() => (
      <Button name="ok" label="OK" height={20} ring onClick={() => {}} />
    ));
    ui.frame();
    expect(ui.inspect().find((n) => n.name === "ok")!.bounds.height).toBe(29);
  });

  it("shadow reserves a 1px slot and press does not change the box size", () => {
    const ui = createUI({ screen: newBitMap(200, 80) });
    ui.render(() => <Button name="ok" label="OK" shadow onClick={() => {}} />);
    ui.frame();
    const rest = ui.inspect().find((n) => n.name === "ok")!.bounds;
    expect(rest.height).toBe(17);
    ui.dispatchPointer("mousedown", rest.x + 4, rest.y + 4);
    ui.frame();
    expect(ui.inspect().find((n) => n.name === "ok")!.bounds.height).toBe(17);
  });

  it("fires on every click, including the second down of a double-click", () => {
    let n = 0;
    const ui = createUI({ screen: newBitMap(200, 80) });
    ui.render(() => <Button name="ok" label="OK" onClick={() => { n += 1; }} />);
    ui.frame();
    const { x, y } = ui.inspect().find((node) => node.name === "ok")!.bounds;
    const cx = x + 4;
    const cy = y + 4;
    ui.dispatchPointer("mousedown", cx, cy);
    ui.dispatchPointer("mouseup", cx, cy);
    ui.dispatchPointer("mousedown", cx, cy);
    ui.dispatchPointer("dblclick", cx, cy);
    ui.dispatchPointer("mouseup", cx, cy);
    expect(n).toBe(2);
  });
});

describe("DialogButton", () => {
  it("lines the default face up with its neighbours, the ring overhanging", () => {
    const ui = createUI({ screen: newBitMap(300, 80) });
    ui.render(() => (
      <box padding={10} flexDirection="row" gap={16}>
        <DialogButton name="cancel" label="Cancel" onClick={() => {}} />
        <DialogButton name="erase" label="Erase" default onClick={() => {}} />
      </box>
    ));
    ui.frame();
    const nodes = ui.inspect();
    const cancel = nodes.find((n) => n.name === "cancel")!.bounds;
    const erase = nodes.find((n) => n.name === "erase")!.bounds;
    // No shadow slot: the face is the whole 20px.
    expect(cancel).toMatchObject({ y: 10, height: 20 });
    // The ring is 4px outside the face on every side.
    expect(erase).toMatchObject({ x: cancel.x + cancel.width + 16 - 4, y: 6, height: 28 });
  });

  it("keeps a fixed width on the face when stretched in a column", () => {
    const ui = createUI({ screen: newBitMap(300, 120) });
    ui.render(() => (
      <box padding={10} flexDirection="column" gap={8} alignItems="stretch">
        <DialogButton name="print" label="Print" width={70} default onClick={() => {}} />
        <DialogButton name="cancel" label="Cancel" width={70} onClick={() => {}} />
      </box>
    ));
    ui.frame();
    const nodes = ui.inspect();
    const print = nodes.find((n) => n.name === "print")!.bounds;
    const cancel = nodes.find((n) => n.name === "cancel")!.bounds;
    expect(cancel).toMatchObject({ x: 10, y: 10 + 20 + 8, width: 70 });
    expect(print).toMatchObject({ x: 6, y: 6, width: 78, height: 28 });
  });
});
