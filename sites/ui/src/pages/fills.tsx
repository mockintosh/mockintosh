import { For, ditherGradient, type Fill, type JSX, type PatternName } from "@mockintosh/ui";
import { PageTitle, Preview } from "../layout";

const NAMED: readonly PatternName[] = [
  "gray25",
  "gray50",
  "gray75",
  "checker",
  "darkCheckers",
  "hstripe",
  "vstripe",
  "dstripe",
  "crosshatch",
];

/** A raw 8-byte QuickDraw Pattern (brick). */
const BRICK = new Uint8Array([0xff, 0x80, 0x80, 0x80, 0xff, 0x08, 0x08, 0x08]);

const COMPASS: { label: string; fill: Fill }[] = [
  { label: "n / 0", fill: ditherGradient(0.15, 0.9, "n") },
  { label: "ne / 45", fill: ditherGradient(0.15, 0.9, "ne") },
  { label: "e / 90", fill: ditherGradient(0.15, 0.9, "e") },
  { label: "se / 135", fill: ditherGradient(0.15, 0.9, "se") },
  { label: "s / 180", fill: ditherGradient(0.15, 0.9, "s") },
  { label: "sw / 225", fill: ditherGradient(0.15, 0.9, "sw") },
  { label: "w / 270", fill: ditherGradient(0.15, 0.9, "w") },
  { label: "nw / 315", fill: ditherGradient(0.15, 0.9, "nw") },
];

const CSS_TO: { label: string; fill: Fill }[] = [
  { label: "to top", fill: ditherGradient(0.15, 0.9, "to top") },
  { label: "to right", fill: ditherGradient(0.15, 0.9, "to right") },
  { label: "to bottom", fill: ditherGradient(0.15, 0.9, "to bottom") },
  { label: "to left", fill: ditherGradient(0.15, 0.9, "to left") },
  { label: "to top right", fill: ditherGradient(0.15, 0.9, "to top right") },
  { label: "to bottom right", fill: ditherGradient(0.15, 0.9, "to bottom right") },
  { label: "to bottom left", fill: ditherGradient(0.15, 0.9, "to bottom left") },
  { label: "to top left", fill: ditherGradient(0.15, 0.9, "to top left") },
];

const ANGLES: { label: string; fill: Fill }[] = [
  { label: "0", fill: ditherGradient(0.15, 0.9, 0) },
  { label: "30", fill: ditherGradient(0.15, 0.9, 30) },
  { label: "75", fill: ditherGradient(0.15, 0.9, 75) },
  { label: "110", fill: ditherGradient(0.15, 0.9, 110) },
  { label: "160", fill: ditherGradient(0.15, 0.9, 160) },
  { label: "210", fill: ditherGradient(0.15, 0.9, 210) },
  { label: "255", fill: ditherGradient(0.15, 0.9, 255) },
  { label: "300", fill: ditherGradient(0.15, 0.9, 300) },
];

export function FillsPage(): JSX.Element {
  return (
    <box flexDirection="column" gap={16}>
      <PageTitle
        title="Fills"
        lede="background on a box is a Fill: solid ink, a named 8x8 pattern, raw QuickDraw bits, or a sized dither gradient. text background is ink only."
      />
      <text font="body" wrap selectable>
        Ink is 0 paper or 1 black. Named patterns tile an 8x8. checker and gray50 are the same tile. Gradients are not tiled: ditherGradient rasterizes a 0 to 1 blackness ramp at the laid-out size.
      </text>

      <text font="genova" size={10}>Ink</text>
      <FillRow
        items={[
          { label: "0 paper", fill: 0 },
          { label: "1 ink", fill: 1 },
        ]}
      />

      <text font="genova" size={10}>Named patterns</text>
      <FillRow items={NAMED.map((name) => ({ label: name, fill: name }))} />

      <text font="genova" size={10}>Raw PatternBits</text>
      <text font="body" wrap selectable>
        An 8-byte Uint8Array is a QuickDraw Pattern. Each byte is one row, MSB on the left.
      </text>
      <FillRow items={[{ label: "brick", fill: BRICK }]} />

      <Preview
        code={`<box background={0} />
<box background="gray25" />
<box background={new Uint8Array([
  0xff, 0x80, 0x80, 0x80,
  0xff, 0x08, 0x08, 0x08,
])} />`}
      >
        <box flexDirection="row" gap={8}>
          <box width={48} height={32} borderWidth={1} borderColor={1} background={0} />
          <box width={48} height={32} borderWidth={1} borderColor={1} background="gray25" />
          <box width={48} height={32} borderWidth={1} borderColor={1} background={BRICK} />
        </box>
      </Preview>

      <text font="genova" size={10}>Gradients</text>
      <text font="body" wrap selectable>
        CSS has three families: linear, radial, and conic, plus a repeating form of each. from and to are blackness (0 paper, 1 ink). Headings follow CSS linear-gradient: a compass alias, a to keyword, or degrees (0 is up, clockwise). se, to bottom right, and 135 are the same vector. Bayer is the default dither; pass atkinson for error diffusion.
      </text>
      <Preview
        code={`ditherGradient(0.15, 0.9, "se")
ditherGradient(0.15, 0.9, "to bottom right")
ditherGradient(0.15, 0.9, 135)
ditherGradient({ from: 0.1, to: 0.85, kind: "radial" })
ditherGradient({ from: 0.15, to: 0.85, kind: "conic" })
ditherGradient({ from: 0.2, to: 0.8, direction: "e", repeat: 0.25 })`}
      >
        <box flexDirection="row" gap={8}>
          <box width={48} height={32} borderWidth={1} borderColor={1} background={ditherGradient(0.15, 0.9, "se")} />
          <box width={48} height={32} borderWidth={1} borderColor={1} background={ditherGradient({ from: 0.1, to: 0.85, kind: "radial" })} />
          <box width={48} height={32} borderWidth={1} borderColor={1} background={ditherGradient({ from: 0.15, to: 0.85, kind: "conic" })} />
          <box width={48} height={32} borderWidth={1} borderColor={1} background={ditherGradient({ from: 0.2, to: 0.8, direction: "e", repeat: 0.25 })} />
        </box>
      </Preview>

      <text font="genova" size={10}>Linear compass</text>
      <FillRow items={COMPASS} />

      <text font="genova" size={10}>CSS to keywords</text>
      <FillRow items={CSS_TO} />

      <text font="genova" size={10}>CSS degrees</text>
      <FillRow items={ANGLES} />

      <text font="genova" size={10}>Radial</text>
      <text font="body" wrap selectable>
        Origin is at (default center). shape ellipse fits the box; circle is isotropic.
      </text>
      <FillRow
        items={[
          { label: "center", fill: ditherGradient({ from: 0.1, to: 0.85, kind: "radial" }) },
          { label: "top left", fill: ditherGradient({ from: 0.1, to: 0.85, kind: "radial", at: "top left" }) },
          { label: "circle", fill: ditherGradient({ from: 0.1, to: 0.85, kind: "radial", shape: "circle" }) },
          { label: "ellipse", fill: ditherGradient({ from: 0.1, to: 0.85, kind: "radial", shape: "ellipse" }) },
        ]}
      />

      <text font="genova" size={10}>Conic</text>
      <text font="body" wrap selectable>
        Sweeps clockwise from start (CSS degrees; default 0 up). Numeric direction is the start when start is omitted.
      </text>
      <FillRow
        items={[
          { label: "start 0", fill: ditherGradient({ from: 0.15, to: 0.85, kind: "conic" }) },
          { label: "start 90", fill: ditherGradient({ from: 0.15, to: 0.85, kind: "conic", start: 90 }) },
          { label: "at se", fill: ditherGradient({ from: 0.15, to: 0.85, kind: "conic", at: "se" }) },
          { label: "start 210", fill: ditherGradient({ from: 0.15, to: 0.85, kind: "conic", start: 210 }) },
        ]}
      />

      <text font="genova" size={10}>Repeating</text>
      <text font="body" wrap selectable>
        repeat is the period in the 0 to 1 parameter. 0.25 repeats four times.
      </text>
      <FillRow
        items={[
          { label: "linear 1/4", fill: ditherGradient({ from: 0.15, to: 0.9, direction: "e", repeat: 0.25 }) },
          { label: "radial 1/3", fill: ditherGradient({ from: 0.1, to: 0.85, kind: "radial", repeat: 1 / 3 }) },
          { label: "conic 1/4", fill: ditherGradient({ from: 0.15, to: 0.85, kind: "conic", repeat: 0.25 }) },
          { label: "linear 1/2", fill: ditherGradient({ from: 0.15, to: 0.9, direction: 160, repeat: 0.5 }) },
        ]}
      />

      <text font="genova" size={10}>Dither mode</text>
      <text font="body" wrap selectable>
        Bayer is stable chrome with no error-diffusion fringe. Atkinson walks the error into neighbors.
      </text>
      <FillRow
        items={[
          { label: "bayer", fill: ditherGradient(0.2, 0.85, "se", "bayer") },
          { label: "atkinson", fill: ditherGradient(0.2, 0.85, "se", "atkinson") },
        ]}
      />
    </box>
  );
}

function chunk<T>(items: readonly T[], n: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += n) rows.push(items.slice(i, i + n));
  return rows;
}

function FillRow(props: { items: readonly { label: string; fill: Fill }[] }): JSX.Element {
  return (
    <box flexDirection="column" gap={8}>
      <For each={chunk(props.items, 4)}>
        {(row) => (
          <box flexDirection="row" gap={8}>
            <For each={row}>{(item) => <FillSwatch label={item.label} fill={item.fill} />}</For>
          </box>
        )}
      </For>
    </box>
  );
}

function FillSwatch(props: { label: string; fill: Fill }): JSX.Element {
  return (
    <box flexDirection="column" gap={3} width={64}>
      <box width={64} height={64} borderWidth={1} borderColor={1} background={props.fill} />
      <text font="genova" size={10} wrap>
        {props.label}
      </text>
    </box>
  );
}
