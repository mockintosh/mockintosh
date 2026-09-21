import { For, Show, createEffect, createMemo, createSignal, onSettled } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import {
  Button,
  FONT_TYPES,
  MIME,
  Radio,
  Slider,
  TextInput,
  decodeDeckerFont,
  deckerFontFromDraft,
  draftFromDeckerFont,
  encodeDeckerFont,
  isFontType,
  defineApp,
  useApp,
  type FileDocumentProps,
  type FontRasterMode,
  type FontStrikeDraft,
  type MenubarDefinition,
} from "@mockintosh/sdk";
import {
  blitDraftLines,
  cellsPerRow,
  glyphOf,
  PREVIEW_LINES,
  scaleGlyphToThumb,
  STRIP_BORDER,
  STRIP_GAP,
  STRIP_INK,
  STRIP_PAD,
  STRIP_PANE_PAD,
  stripCellSize,
  stripGlyphs,
  stripInnerWidth,
  toggleDraftPixel,
  uniqueDesktopName,
} from "./foundry/strike";
import { sprites } from "./foundry/icons";

const SIZES = [9, 10, 12, 14, 18, 24, 36, 48] as const;
const MAG = 3;
const DEFAULT_THRESHOLD = 96;
const PREVIEW_PAD = 4;
const STRIP_CELL = stripCellSize(STRIP_INK, STRIP_INK);

function chunk<T>(items: readonly T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n) as T[]);
  return out;
}

type FoundryProps = Partial<FileDocumentProps> & Record<string, unknown>;

function Foundry(props: FoundryProps): JSX.Element {
  const app = useApp();
  const win = app.window;
  const raster = app.fontRaster;

  const [sourceBytes, setSourceBytes] = createSignal<Uint8Array | null>(null);
  const [draft, setDraft] = createSignal<FontStrikeDraft | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const [size, setSize] = createSignal(36);
  const [mode, setMode] = createSignal<FontRasterMode>("hinted");
  const [threshold, setThreshold] = createSignal(DEFAULT_THRESHOLD);
  const [spacing, setSpacing] = createSignal(0);
  const [family, setFamily] = createSignal("untitled");
  const [selected, setSelected] = createSignal("A".charCodeAt(0));
  const [dirty, setDirty] = createSignal(false);
  const [paintRev, setPaintRev] = createSignal(0);
  let rasterGen = 0;

  const modes = () => raster?.modes() ?? [];
  const hintedOk = () => modes().includes("hinted");
  const isFullScreen = () => win.kind() === "fullscreen";

  function toggleFullScreen(): void {
    win.setFullScreen(!isFullScreen());
  }

  const preview = createMemo(() => {
    const d = draft();
    if (!d) return null;
    return blitDraftLines(d, PREVIEW_LINES);
  });

  const selectedGlyph = createMemo(() => {
    const d = draft();
    return d ? glyphOf(d, selected()) : undefined;
  });

  const glyphs = createMemo(() => {
    const d = draft();
    paintRev();
    return d ? stripGlyphs(d) : [];
  });
  const thumbs = createMemo(() => {
    const d = draft();
    if (!d) return [];
    return glyphs().map((g) => ({
      ordinal: g.ordinal,
      pixels: scaleGlyphToThumb(g.pixels, g.width, d.glyphHeight, STRIP_INK, STRIP_INK),
    }));
  });
  const charsPerRow = () => cellsPerRow(stripInnerWidth(win.width()), STRIP_CELL.width);
  const charRows = createMemo(() => chunk(thumbs(), charsPerRow()));
  const previewH = () => Math.min(72, Math.max(48, Math.floor(win.height() * 0.2)));

  function applyDraft(next: FontStrikeDraft, markDirty = false): void {
    setDraft(next);
    setFamily(next.family);
    setPaintRev((n) => n + 1);
    if (markDirty) setDirty(true);
  }

  async function rasterize(bytes: Uint8Array): Promise<void> {
    if (!raster) {
      setError("This Macintosh cannot rasterize TrueType fonts.");
      return;
    }
    const mine = ++rasterGen;
    setBusy(true);
    setError("");
    try {
      const chosen = mode();
      const next = await raster.rasterize(bytes, {
        size: size(),
        mode: chosen === "hinted" && !hintedOk() ? "outline" : chosen,
        threshold: threshold(),
        spacing: spacing(),
      });
      if (mine !== rasterGen) return;
      next.family = family() && family() !== "untitled" ? family() : next.family;
      applyDraft(next);
      setDirty(false);
    } catch (err) {
      if (mine !== rasterGen) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mine === rasterGen) setBusy(false);
    }
  }

  async function loadFile(fileId: string, title?: string): Promise<void> {
    const file = app.fs.file(fileId);
    if (!file) {
      setError("Couldn't open that file.");
      return;
    }
    if (title) win.setTitle(title);
    if (file.type === MIME.deckerFont) {
      const text = await app.fs.readText(fileId);
      if (!text) {
        setError("That strike is empty.");
        return;
      }
      try {
        const font = decodeDeckerFont(text, family());
        const next = draftFromDeckerFont(font, sanitizeOpenName(file.name), font.size ?? font.glyphHeight);
        setSourceBytes(null);
        setSize(next.size);
        applyDraft(next);
        setDirty(false);
        setError("");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
      return;
    }
    const bytes = await app.fs.readBytes(fileId);
    if (!bytes) {
      setError("Couldn't read that font.");
      return;
    }
    setSourceBytes(bytes);
    setFamily(sanitizeOpenName(file.name));
  }

  function sanitizeOpenName(name: string): string {
    const stem = name.replace(/\.(ttf|otf|fnt)$/i, "");
    return stem.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24) || "untitled";
  }

  const desktopFonts = () => {
    const desktop = app.fs.locate("desktop");
    if (!desktop) return [];
    return app.fs.children(desktop.id).filter(
      (n) => n.kind === "file" && (isFontType(n.type) || n.type === MIME.deckerFont),
    );
  };

  async function openDocument(): Promise<void> {
    const files = desktopFonts();
    if (files.length === 0) {
      await app.os.showDialog({
        message: "Drop a TrueType font on this window or the desktop.",
        variant: "note",
      });
      return;
    }
    const choice = await app.os.showDialog({
      message: "Open which font?",
      buttons: [...files.map((f) => f.name), "Cancel"],
      variant: "note",
    });
    if (!choice || choice === "Cancel") return;
    const file = files.find((f) => f.name === choice);
    if (file) await loadFile(file.id, file.name);
  }

  async function chooseSize(): Promise<void> {
    const typed = await app.os.showDialog({
      message: "Strike size (9–72):",
      buttons: ["Cancel", "Set"],
      showInput: true,
      inputDefault: String(size()),
      variant: "note",
    });
    const n = Number(typed);
    if (!Number.isFinite(n)) return;
    setSize(Math.max(9, Math.min(72, Math.round(n))));
  }

  function currentDraft(): FontStrikeDraft | null {
    const d = draft();
    if (!d) return null;
    return { ...d, family: family() || d.family, spacing: spacing() };
  }

  async function installStrike(): Promise<void> {
    const d = currentDraft();
    if (!d) return;
    const packed = encodeDeckerFont(deckerFontFromDraft(d));
    app.fonts.register(d.family, packed, d.size);
    setDirty(false);
    await app.os.showDialog({
      message: `Installed “${d.family}” ${d.size} for this session.`,
      variant: "note",
    });
  }

  async function saveStrike(): Promise<void> {
    const d = currentDraft();
    const desktop = app.fs.locate("desktop");
    if (!d || !desktop) return;
    const packed = encodeDeckerFont(deckerFontFromDraft(d));
    const names = app.fs.children(desktop.id).filter((n) => n.kind === "file").map((n) => n.name);
    const name = uniqueDesktopName(names, `${d.family}-${d.size}.fnt`);
    await app.fs.writeFile(desktop.id, name, packed, { type: MIME.deckerFont });
    setDirty(false);
  }

  async function revert(): Promise<void> {
    const bytes = sourceBytes();
    if (bytes) await rasterize(bytes);
  }

  onSettled(() => {
    if (!hintedOk() && mode() === "hinted") setMode("outline");
    if (typeof props.fileId !== "string") return;
    void loadFile(props.fileId, typeof props.title === "string" ? props.title : undefined);
  });

  createEffect(
    () => ({
      bytes: sourceBytes(),
      size: size(),
      mode: mode(),
      threshold: threshold(),
    }),
    ({ bytes }) => {
      if (!bytes) return;
      void rasterize(bytes);
    },
  );

  createEffect(
    () => ({ track: spacing(), draft: draft() }),
    ({ track, draft: d }) => {
      if (d && d.spacing !== track) setDraft({ ...d, spacing: track });
    },
  );

  createEffect(
    () => {
      const d = draft();
      return {
        hasDraft: !!d,
        dirty: dirty(),
        canRaster: !!sourceBytes() && !!raster,
        hinted: hintedOk(),
        mode: mode(),
        size: size(),
        full: isFullScreen(),
      };
    },
    (s) => {
      const menus: MenubarDefinition[] = [
        {
          label: "File",
          items: [
            { label: "Open…", shortcut: "O", onClick: () => void openDocument() },
            { type: "separator" },
            { label: "Save Strike", shortcut: "S", onClick: () => void saveStrike(), disabled: !s.hasDraft },
            { label: "Install", onClick: () => void installStrike(), disabled: !s.hasDraft },
            { label: "Revert", onClick: () => void revert(), disabled: !s.canRaster },
          ],
        },
        {
          label: "View",
          items: [
            {
              label: s.full ? "Exit Full Screen" : "Full Screen",
              shortcut: "F",
              onClick: toggleFullScreen,
            },
          ],
        },
        {
          label: "Size",
          items: [
            {
              type: "radiogroup",
              value: String(s.size),
              onValueChange: (value) => setSize(Number(value)),
              items: SIZES.map((n) => ({ label: String(n), value: String(n) })),
            },
            { type: "separator" },
            { label: "Other…", onClick: () => void chooseSize() },
          ],
        },
        {
          label: "Raster",
          items: [
            {
              type: "radiogroup",
              value: s.mode,
              onValueChange: (value) => setMode(value as FontRasterMode),
              items: [
                { label: "Hinted", value: "hinted", disabled: !s.hinted },
                { label: "Outline", value: "outline" },
                { label: "2x Majority", value: "x2" },
                { label: "3x Majority", value: "x3" },
              ],
            },
          ],
        },
      ];
      app.setMenus(menus);
    },
  );

  return (
    <box width={win.width()} height={win.height()} flexDirection="column" background={0}>
      <box
        height={previewH()}
        padding={PREVIEW_PAD}
        borderColor={1}
        borderWidth={1}
        overflow="scroll"
      >
        <Show
          when={preview()}
          fallback={
            <text font="body">
              {busy() ? "Rasterizing…" : "Drop a TrueType font on this window or the desktop."}
            </text>
          }
        >
          {(bits) => (
            <bitmap pixels={bits().pixels} width={bits().width} height={bits().height} />
          )}
        </Show>
      </box>
      <box padding={4} flexDirection="column" gap={3}>
        <Show when={error()}>
          <text font="body">{error()}</text>
        </Show>
        <box flexDirection="row" gap={8} alignItems="center">
          <Show when={isFullScreen()}>
            <Button label="Menu Bar" onClick={toggleFullScreen} />
          </Show>
          <Radio
            name="mode-hinted"
            label="Hinted"
            checked={mode() === "hinted"}
            disabled={!hintedOk()}
            onChange={() => setMode("hinted")}
          />
          <Radio name="mode-outline" label="Outline" checked={mode() === "outline"} onChange={() => setMode("outline")} />
          <Radio name="mode-x2" label="2x" checked={mode() === "x2"} onChange={() => setMode("x2")} />
          <Radio name="mode-x3" label="3x" checked={mode() === "x3"} onChange={() => setMode("x3")} />
        </box>
        <box flexDirection="row" gap={6} alignItems="flex-start">
          <box flexDirection="column" gap={3} width={200}>
            <Slider
              name="size"
              label="Size"
              labelWidth={40}
              width={120}
              min={9}
              max={72}
              step={1}
              value={size()}
              onChange={setSize}
            />
            <Slider
              name="threshold"
              label="Thresh"
              labelWidth={40}
              width={120}
              min={16}
              max={200}
              step={4}
              value={threshold()}
              onChange={setThreshold}
            />
            <Slider
              name="spacing"
              label="Track"
              labelWidth={40}
              width={120}
              min={0}
              max={4}
              step={1}
              value={spacing()}
              onChange={setSpacing}
            />
            <box flexDirection="row" gap={4} alignItems="center">
              <text font="body" nowrap>Name</text>
              <TextInput name="family" value={family()} onChange={setFamily} width={120} />
            </box>
          </box>
          <Show when={selectedGlyph() && draft()}>
            <box
              flexGrow={1}
              minWidth={80}
              height={Math.min(120, Math.max(80, (draft()?.glyphHeight ?? 24) * MAG))}
              padding={2}
              borderColor={1}
              borderWidth={1}
              overflow="scroll"
            >
              <raster
                semantic={{ name: "glyph-edit" }}
                width={(selectedGlyph()?.width ?? 1) * MAG}
                height={(draft()?.glyphHeight ?? 1) * MAG}
                revision={paintRev() + selected() * 1000}
                onClick={(x, y) => {
                  const d = draft();
                  if (!d) return;
                  applyDraft(toggleDraftPixel(d, selected(), Math.floor(x / MAG), Math.floor(y / MAG)), true);
                }}
                onPaint={({ setPixel }) => {
                  const d = draft();
                  const g = selectedGlyph();
                  if (!d || !g) return;
                  for (let y = 0; y < d.glyphHeight; y++) {
                    for (let x = 0; x < g.width; x++) {
                      const ink = g.pixels[y * g.width + x] ? 1 : 0;
                      for (let dy = 0; dy < MAG; dy++) {
                        for (let dx = 0; dx < MAG; dx++) setPixel(x * MAG + dx, y * MAG + dy, ink);
                      }
                    }
                  }
                }}
              />
            </box>
          </Show>
        </box>
      </box>
      <Show when={draft()}>
        <box
          flexGrow={1}
          minHeight={STRIP_CELL.height * 3 + STRIP_PANE_PAD * 2}
          padding={STRIP_PANE_PAD}
          overflow="scroll"
          semantic={{ name: "glyph-strip" }}
        >
          <box flexDirection="column" gap={STRIP_GAP} alignItems="flex-start">
            <For each={charRows()}>
              {(row) => (
                <box
                  flexDirection="row"
                  gap={STRIP_GAP}
                  height={STRIP_CELL.height}
                  alignItems="center"
                  alignSelf="flex-start"
                  flexShrink={0}
                >
                  <For each={row}>
                    {(g) => (
                      <box
                        width={STRIP_CELL.width}
                        height={STRIP_CELL.height}
                        padding={STRIP_PAD}
                        borderWidth={STRIP_BORDER}
                        borderColor={selected() === g.ordinal ? 1 : 0}
                        justifyContent="center"
                        alignItems="center"
                        overflow="hidden"
                        flexShrink={0}
                        semantic={{ name: `glyph-${g.ordinal}` }}
                        onClick={() => setSelected(g.ordinal)}
                      >
                        <bitmap pixels={g.pixels} width={STRIP_INK} height={STRIP_INK} />
                      </box>
                    )}
                  </For>
                </box>
              )}
            </For>
          </box>
        </box>
      </Show>
    </box>
  );
}

export default defineApp({
  id: "foundry",
  title: "Foundry",
  icon: "foundry/icon",
  defaultSize: { width: 420, height: 300 },
  minSize: { width: 300, height: 220 },
  resizable: true,
  fileTypes: [...FONT_TYPES, MIME.deckerFont],
  sprites,
  about: {
    version: "1.0",
    description:
      "Applies a font’s existing hints through the host rasterizer. It does not edit Twilight-zone points or emit a new TTF. 24px condensed Garaldes still need pixel toggles; 36px usually survives.",
  },
  Component: Foundry,
});
