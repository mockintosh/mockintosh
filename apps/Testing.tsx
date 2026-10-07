import type { JSX } from "@mockintosh/ui";
import { Button, Checkbox, TextInput, createEffect, createSignal } from "@mockintosh/ui";
import { defineApp, useApp } from "@mockintosh/sdk";

function Testing(_props: Record<string, unknown>): JSX.Element {
  const app = useApp();
  const win = app.window;
  createEffect(() => true, () => {
    app.setMenus([
      { label: "File", items: [{ label: "Quit", shortcut: "Q", onClick: () => app.quit() }] },
    ]);
  });
  const [count, setCount] = createSignal(0);
  const [checked, setChecked] = createSignal(false);
  const [name, setName] = createSignal("System 7");

  return (
    <box
      width={win.width()}
      height={win.height()}
      padding={10}
      flexDirection="column"
      gap={8}
      overflow="scroll"
      background={0}
    >
      <text font="menu" spacing={1}>@mockintosh/ui gallery</text>
      <text font="pixel">Geist Pixel</text>
      <text font="body">{`Signals: ${count()}  ${checked() ? "on" : "off"}  ${name()}`}</text>
      <box flexDirection="row" gap={8}>
        <Button label="Increment" onClick={() => setCount((c) => c + 1)} />
        <Button label="Reset" onClick={() => setCount(0)} />
      </box>
      <Checkbox label="Enable dither" checked={checked()} onChange={setChecked} />
      <TextInput value={name()} onChange={setName} width={160} />
      <box flexDirection="row" gap={4}>
        <box width={16} height={16} background={1} />
        <box width={16} height={16} background="gray75" borderColor={1} borderWidth={1} />
        <box width={16} height={16} background="gray50" borderColor={1} borderWidth={1} />
        <box width={16} height={16} background="gray25" borderColor={1} borderWidth={1} />
      </box>
      <raster
        width={80}
        height={24}
        onPaint={({ rect, setPixel }) => {
          for (let y = 0; y < rect.height; y++) {
            for (let x = 0; x < rect.width; x++) {
              setPixel(x, y, (x + y + count()) % 4 === 0 ? 1 : 0);
            }
          }
        }}
      />
    </box>
  );
}

export default defineApp({
  id: "testing",
  title: "Testing",
  icon: "icon/computer",
  smallIcon: "icon/computer-16x16",
  defaultSize: { width: 280, height: 250 },
  scrollable: true,
  Component: Testing,
});
