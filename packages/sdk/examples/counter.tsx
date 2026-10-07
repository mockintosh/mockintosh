import {
  defineApp,
  useApp,
  Button,
  createSignal,
  createEffect,
  fromGrid,
  type Sprite,
} from "@mockintosh/sdk";

export const sprites: Record<string, Sprite> = {
  "counter/icon": fromGrid(32, 32, [
    "................................",
    ".......########.................",
    "......##########................",
    ".....############...............",
    "....##############..............",
    "...################.............",
    "...################.............",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
    "................................",
  ]),
};

export default defineApp({
  id: "counter",
  title: "Counter",
  icon: "counter/icon",
  defaultSize: { width: 140, height: 100 },
  Component() {
    const app = useApp();
    const [count, setCount] = createSignal(0);
    const [step, setStep] = createSignal(1);

    createEffect(
      () => ({ count: count(), step: step() }),
      ({ count: n, step: s }) => {
      app.setMenus([
        {
          label: "File",
          items: [{ label: "Quit", shortcut: "Q", onClick: () => app.quit() }],
        },
        {
          label: "Counter",
          items: [
            { label: "Reset", shortcut: "R", disabled: n === 0, onClick: () => setCount(0) },
            { type: "separator" },
            {
              type: "radiogroup",
              value: String(s),
              onValueChange: (v) => setStep(Number(v)),
              items: [
                { label: "Step by 1", value: "1" },
                { label: "Step by 10", value: "10" },
              ],
            },
          ],
        },
      ]);
      },
    );

    return (
      <box padding={8} flexDirection="column" gap={8} background={0}>
        <text font="menu" spacing={1} align="center">
          Counter
        </text>
        <text font="menu" spacing={1} align="center">
          {String(count())}
        </text>
        <box flexDirection="row" gap={8} justifyContent="center">
          <Button label={`- ${step()}`} onClick={() => setCount((c) => c - step())} />
          <Button label={`+ ${step()}`} onClick={() => setCount((c) => c + step())} />
        </box>
      </box>
    );
  },
});
