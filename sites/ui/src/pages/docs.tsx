import {
  BULLET,
  Button,
  CHECK_MARK,
  COMMAND_KEY,
  For,
  Show,
  defaultFontSize,
  listFontSizes,
  listFonts,
  type JSX,
} from "@mockintosh/ui";
import { PageTitle } from "../layout";
import { cursorMode, setSiteCursors } from "../cursorHost";
import { FillsPage } from "./fills";

interface FontFaceNote {
  name: string;
  source: string;
}

/** Preferred specimen order. Faces not listed here still appear via `listFonts`. */
const FACE_ORDER = [
  "body",
  "menu",
  "mono",
  "chicane",
  "genova",
  "newark",
  "monoco",
  "vence",
  "londinium",
  "athene",
  "sanfrisco",
  "taranto",
  "kairos",
  "losalamos",
] as const;

const FACE_SOURCE: Readonly<Record<string, string>> = {
  body: "Alias for genova 9. Default <text> face.",
  menu: "Alias for chicane 12. Classic system UI face.",
  mono: "Alias for monoco 9. Fixed-width.",
  chicane: "System font. Native 12.",
  genova: "Application font. Native 9 10 12 14 18 20 24.",
  newark: "Serif. Native 9 10 12 14 18 20 24.",
  monoco: "Monospace. Native 9 12.",
  vence: "Script. Native 14.",
  londinium: "Blackletter. Native 18.",
  athene: "Slab. Native 18.",
  sanfrisco: "Ransom-note. Native 18.",
  taranto: "Slab. Native 9 12 14 18 24. Removed after System 6.",
  kairos: "Dingbats. Native 18. z is the dogcow.",
  losalamos: "Handwriting. Native 12 24.",
};

const SYMBOL_FACES = new Set(["body", "menu", "mono", "genova", "chicane"]);

const PANGRAM = "The quick brown fox jumps over the lazy dog.";
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ  abcdefghijklmnopqrstuvwxyz";
const FIGURES = "0123456789  !?@#$%&*()[]{}";
const SYMBOLS = `${COMMAND_KEY}  ${CHECK_MARK}  ${BULLET}`;

function chunk<T>(items: readonly T[], n: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += n) rows.push(items.slice(i, i + n));
  return rows;
}

function catalogFaces(): FontFaceNote[] {
  const registered = listFonts();
  const seen = new Set<string>();
  const notes: FontFaceNote[] = [];
  for (const name of [...FACE_ORDER, ...registered]) {
    if (seen.has(name) || !registered.includes(name)) continue;
    seen.add(name);
    notes.push({
      name,
      source: FACE_SOURCE[name] ?? "Registered face.",
    });
  }
  return notes;
}

export function IntroductionPage(): JSX.Element {
  return (
    <box flexDirection="column" gap={16}>
      <PageTitle
        title="Introduction"
        lede="A 1-bit UI kit for Solid. Host elements and widgets paint a packed framebuffer — the same pixels as a Macintosh, without the chrome."
      />
      <text font="body" wrap selectable>
        Import the engine. Compose widgets from five host tags: box, text, image, raster, and bitmap. A new look is a new widget or a prop, not a new tag.
      </text>
      <text font="body" wrap selectable>
        Mockintosh apps keep importing through @mockintosh/sdk. This site is the kit catalog — ui.mockintosh.com.
      </text>
    </box>
  );
}

export function InstallationPage(): JSX.Element {
  return (
    <box flexDirection="column" gap={16}>
      <PageTitle
        title="Installation"
        lede="The kit is @mockintosh/ui. The default web host is mountCanvasUI."
      />
      <text font="genova" size={10}>Package</text>
      <text font="body" wrap selectable>
        npm install @mockintosh/ui solid-js
      </text>
      <text font="genova" size={10}>Mount a canvas</text>
      <text font="body" wrap selectable>
        {"mountCanvasUI({ root, size: { mode: \"viewport\", scale: 2 }, component: () => <App /> })"}
      </text>
      <text font="body" wrap selectable>
        JSX compiles through @mockintosh/ui (universal renderer). Set jsxImportSource to @mockintosh/ui. Widgets and host elements share that runtime — there is no HTML inside the framebuffer.
      </text>
    </box>
  );
}

export function StylingPage(): JSX.Element {
  return (
    <box flexDirection="column" gap={16}>
      <PageTitle
        title="Styling"
        lede="Look is props on the widget, forwarded to the host box. Radius is the one theme token: none / sm / md / lg, like shadcn."
      />
      <text font="body" wrap selectable>
        {"Button defaults to a 16px face with a 1px drop shadow in the body font. The face uses the theme radius (md); pass borderRadius to override. Cards and avatars use lg, inputs md, badges sm. createUI({ theme: { radius: \"md\" } }) or host.setTheme({ radius: \"lg\" }) sets the scale. Pass font, bold, italic, height, shadow (window-style 1px L), or ring (CDEF default ring outside the face). On <text>, bold, italic, outline, and shadow are Font Manager synthesis and combine. Button shadow also turns on depress: while pressed the face slides 1px into the shadow slot. Pass shadow={false} for a flat face, or depress={false} to keep a static shadow. cursor is a name (pointer, text, watch), not a CSS string. Button leaves the host arrow; Checkbox defaults to pointer; TextInput, TextEditor, and selectable text default to text. The web host maps names to CSS keywords, or to Macintosh 1-bit faces when cursors is \"mac\". Pass cursorFaces to replace any face, or cursors=\"none\" when the OS paints QuickDraw cursors. Box background is a Fill: see Fills."}
      </text>
    </box>
  );
}

export function FontsPage(): JSX.Element {
  const faces = catalogFaces();
  return (
    <box flexDirection="column" gap={16}>
      <PageTitle
        title="Fonts"
        lede={'Pass font and an optional native size. body / menu / mono stay as aliases. bold, italic, outline, and shadow are Font Manager synthesis and combine freely.'}
      />
      <text font="body" wrap selectable>
        City families ship every bitmap size Apple published for that face. size picks a strike; a missing size snaps to the nearest native one. Third-party fonts such as Lisa and Geist come from the font library in the App Store.
      </text>
      <box flexDirection="column" gap={3}>
        <text font="genova" size={12}>
          Plain text
        </text>
        <text font="genova" size={12} bold>
          Bold
        </text>
        <text font="genova" size={12} italic>
          Italic
        </text>
        <text font="genova" size={12} outline>
          Outline
        </text>
        <text font="genova" size={12} shadow>
          Shadow
        </text>
        <text font="genova" size={12} shadow outline>
          Shadow Outline
        </text>
        <text font="genova" size={12} shadow outline bold>
          Shadow Outline Bold
        </text>
        <text font="genova" size={12} shadow outline bold italic>
          Shadow Outline Bold Italic
        </text>
      </box>
      <box flexDirection="column" gap={6}>
        <For each={faces}>
          {(face) => (
            <box flexDirection="row" gap={16} alignItems="flex-end">
              <text font={face.name} size={defaultFontSize(face.name)}>
                {face.name}
              </text>
              <text font={face.name} size={defaultFontSize(face.name)} bold>
                {`${face.name} bold`}
              </text>
              <text font={face.name} size={defaultFontSize(face.name)} italic>
                {`${face.name} italic`}
              </text>
              <text font={face.name} size={defaultFontSize(face.name)} outline>
                {`${face.name} outline`}
              </text>
              <text font={face.name} size={defaultFontSize(face.name)} shadow>
                {`${face.name} shadow`}
              </text>
            </box>
          )}
        </For>
      </box>
      <For each={faces}>{(face) => <FontCard face={face} />}</For>
    </box>
  );
}

function FontCard(props: { face: FontFaceNote }): JSX.Element {
  const sizes = listFontSizes(props.face.name);
  const def = defaultFontSize(props.face.name);
  return (
    <box borderColor={1} borderWidth={1} background={0}>
      <box padding={12} flexDirection="column" gap={8}>
        <text font={props.face.name} size={def}>
          {props.face.name}
        </text>
        <text font="body" wrap selectable>
          {props.face.source}
        </text>
        <box flexDirection="column" gap={4}>
          <For each={chunk(sizes, 5)}>
            {(row) => (
              <box flexDirection="row" gap={10} alignItems="flex-end">
                <For each={row}>
                  {(size) => (
                    <text font={props.face.name} size={size}>
                      {String(size)}
                    </text>
                  )}
                </For>
              </box>
            )}
          </For>
        </box>
        <text font={props.face.name} size={def} wrap selectable>
          {PANGRAM}
        </text>
        <text font={props.face.name} size={def} bold wrap selectable>
          {PANGRAM}
        </text>
        <text font={props.face.name} size={def} italic wrap selectable>
          {PANGRAM}
        </text>
        <text font={props.face.name} size={def} outline wrap selectable>
          {PANGRAM}
        </text>
        <text font={props.face.name} size={def} shadow wrap selectable>
          {PANGRAM}
        </text>
        <text font={props.face.name} size={def} wrap selectable>
          {LETTERS}
        </text>
        <text font={props.face.name} size={def} wrap selectable>
          {FIGURES}
        </text>
        <Show when={SYMBOL_FACES.has(props.face.name)}>
          <text font={props.face.name} size={def} selectable>
            {SYMBOLS}
          </text>
        </Show>
      </box>
      <box height={1} background={1} />
      <box padding={12} flexDirection="column" gap={1}>
        <text font="mono" selectable>{`<text font="${props.face.name}">`}</text>
        <text font="mono" selectable>{`<text font="${props.face.name}" size={${def}}>`}</text>
        <text font="mono" selectable>{`<text font="${props.face.name}" bold>`}</text>
        <text font="mono" selectable>{`<text font="${props.face.name}" italic>`}</text>
        <text font="mono" selectable>{`<text font="${props.face.name}" outline>`}</text>
        <text font="mono" selectable>{`<text font="${props.face.name}" shadow>`}</text>
      </box>
    </box>
  );
}

export function HostElementsPage(): JSX.Element {
  return (
    <box flexDirection="column" gap={16}>
      <PageTitle
        title="Host elements"
        lede="The engine measures and paints five lowercase tags. Everything else is a Solid widget."
      />
      <text font="body" wrap selectable>
        box — flex layout, borders, ink, pointer, and focus. text wraps to its box; pass nowrap for a single line. selectable is opt-in. image / raster / bitmap — pixels. Button, TextInput, Dithered, and the rest compose these. Do not add a draw case for a new look. The web host can recolor ink and paper through mountCanvasUI palette / host.setPalette — that is presentation, not a theme.
      </text>
    </box>
  );
}

export function CursorsPage(): JSX.Element {
  return (
    <box flexDirection="column" gap={16}>
      <PageTitle
        title="Cursors"
        lede="Widgets name a cursor. The host presents it — CSS keywords, 1-bit Macintosh faces, or the OS compositor. Phones have no pointer, so the catalog uses cursors: none."
      />
      <Button
        label={cursorMode() === "mac" ? "Using Mac faces" : "Using CSS keywords"}
        onClick={() => setSiteCursors(cursorMode() === "mac" ? "css" : "mac")}
      />
      <text font="body" wrap selectable>
        {"mountCanvasUI({ cursors: \"mac\" }) paints System 7.5.3-style faces (arrow, iBeam, watch, plus, hand) into the framebuffer. cursors: \"css\" uses platform keywords. The header toggle switches live via host.setCursors. Replace a face with cursorFaces: { pointer: { sprite, hotSpot } }."}
      </text>
      <box flexDirection="column" gap={8}>
        <box flexDirection="row" gap={8}>
          <CursorSwatch name="arrow" />
          <CursorSwatch name="pointer" />
          <CursorSwatch name="text" />
          <CursorSwatch name="watch" />
        </box>
        <box flexDirection="row" gap={8}>
          <CursorSwatch name="cross" />
          <CursorSwatch name="plus" />
          <CursorSwatch name="grab" />
          <CursorSwatch name="grabbing" />
        </box>
      </box>
    </box>
  );
}

function CursorSwatch(props: { name: "arrow" | "pointer" | "text" | "watch" | "cross" | "plus" | "grab" | "grabbing" }): JSX.Element {
  return (
    <box
      cursor={props.name}
      width={72}
      height={28}
      borderWidth={1}
      borderColor={1}
      justifyContent="center"
      alignItems="center"
    >
      <text font="body">{props.name}</text>
    </box>
  );
}

export const DOC_PAGES: Record<string, () => JSX.Element> = {
  introduction: IntroductionPage,
  installation: InstallationPage,
  styling: StylingPage,
  theming: StylingPage,
  fills: FillsPage,
  fonts: FontsPage,
  "host-elements": HostElementsPage,
  cursors: CursorsPage,
};
