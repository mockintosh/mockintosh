import { Button, For, Popover, TextInput, createSignal, useViewport } from "@mockintosh/ui";
import type { JSX } from "@mockintosh/ui";
import { formatRgb8, parseRgb8, type HostPalette } from "@mockintosh/ui/web";
import { RADIUS_PRESETS, radiusScale, setRadiusScale } from "./hostTheme";
import {
  HOST_PALETTE_PRESETS,
  activePalettePreset,
  hostPalette,
  setHostPalette,
} from "./hostPalette";

function chunk<T>(items: readonly T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

const paletteRows = chunk(HOST_PALETTE_PRESETS, 3);

function HostSettingsPanel(): JSX.Element {
  const vp = useViewport();
  const panelWidth = () => Math.min(268, Math.max(160, vp().width - 24));
  const radius = () => radiusScale();
  const preset = () => activePalettePreset();
  const [inkHex, setInkHex] = createSignal(formatRgb8(hostPalette().foreground));
  const [paperHex, setPaperHex] = createSignal(formatRgb8(hostPalette().background));

  const applyPalette = (next: HostPalette) => {
    setHostPalette(next);
    setInkHex(formatRgb8(next.foreground));
    setPaperHex(formatRgb8(next.background));
  };

  const editInk = (value: string) => {
    setInkHex(value);
    const rgb = parseRgb8(value);
    if (rgb) setHostPalette({ ...hostPalette(), foreground: rgb });
  };

  const editPaper = (value: string) => {
    setPaperHex(value);
    const rgb = parseRgb8(value);
    if (rgb) setHostPalette({ ...hostPalette(), background: rgb });
  };

  return (
    <box flexDirection="column" gap={10} width={panelWidth()}>
      <box flexDirection="column" gap={6}>
        <text font="genova" size={10} nowrap>
          Host Settings
        </text>
        <For each={paletteRows}>
          {(row) => (
            <box flexDirection="row" gap={6}>
              <For each={row}>
                {(item) => (
                  <Button
                    label={item.label}
                    shadow={preset() === item.id}
                    onClick={() => applyPalette(item.palette)}
                  />
                )}
              </For>
            </box>
          )}
        </For>
        <box flexDirection="row" gap={12} alignItems="center">
          <box flexDirection="column" gap={2}>
            <text font="body" nowrap>Foreground</text>
            <TextInput font="mono" width={80} value={inkHex()} onChange={editInk} />
          </box>
          <box flexDirection="column" gap={2}>
            <text font="body" nowrap>Background</text>
            <TextInput font="mono" width={80} value={paperHex()} onChange={editPaper} />
          </box>
        </box>
      </box>
      <box flexDirection="column" gap={6}>
        <text font="genova" size={10} nowrap>
          Radius
        </text>
        <box flexDirection="row" gap={6}>
          <For each={RADIUS_PRESETS}>
            {(item) => (
              <Button
                label={item.label}
                shadow={radius() === item.id}
                onClick={() => setRadiusScale(item.id)}
              />
            )}
          </For>
        </box>
      </box>
    </box>
  );
}

/** Header control. Palette and radius live here so every page can reach them. */
export function SettingsMenu(): JSX.Element {
  const [open, setOpen] = createSignal(false);
  return (
    <Popover
      name="settings"
      open={open()}
      onDismiss={() => setOpen(false)}
      align="end"
      trigger={
        <box
          semantic={{ name: "settings", role: "button", value: String(open()) }}
          paddingLeft={6}
          paddingRight={6}
          paddingTop={3}
          paddingBottom={3}
          background={open() ? 1 : 0}
          tabIndex={0}
          cursor="pointer"
          onClick={() => setOpen(true)}
          onKeyDown={(key: string) => {
            if (key === "Enter" || key === " ") setOpen((on) => !on);
          }}
        >
          <text font="genova" size={10} color={open() ? 0 : 1} nowrap>
            Settings
          </text>
        </box>
      }
    >
      <HostSettingsPanel />
    </Popover>
  );
}
