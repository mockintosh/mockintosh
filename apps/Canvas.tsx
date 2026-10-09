import { For, Show, createEffect, createMemo, createSignal, onCleanup, onSettled } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { fontLineHeight, layoutText, requireFont } from "@mockintosh/ui";
import {
  defineApp,
  EditableText,
  measureText,
  MAX_NAME_LENGTH,
  MIME,
  useApp,
  type MenubarItemDef,
} from "@mockintosh/sdk";
import {
  ALL_RESIZE_HANDLES,
  allocateId,
  bringToFront,
  cornerRadius,
  duplicateElement,
  emptyDocument,
  HANDLE_SIZE,
  handlePosition,
  MAX_TEXT_SIZE,
  MIN_TEXT_SIZE,
  lineEndpoints,
  lineFrame,
  normalizeFrame,
  parseDocument,
  replaceElement,
  resizeElement,
  sendToBack,
  type CanvasDocument,
  type CanvasElement,
  type CanvasFont,
  type FillStyle,
  type Frame,
  type Handle,
  type ResizeHandle,
  type ShapeElement,
  type TextElement,
} from "./canvas/document";
import { boxFill, lineHitMask, ovalHitMask, paintLine, paintOval } from "./canvas/draw";
import { rasterizeCanvas } from "./canvas/raster";
import { sprites, TOOL_ICONS } from "./canvas/icons";
import { matchingPageSize, pageSize, pageSizeLabel, type PageSizeId } from "./canvas/page";
import {
  FILL_LABEL,
  TOOL_GRID,
  type ToolId,
} from "./canvas/tools";
import { drawableFont, effectiveSize, fontFamilyOf, fontLabel, fontMenu, sizeChoices } from "./canvas/fonts";

const TOOLS_W = 37;
const CELL = 16;
const FOOT_H = 17;
const UNDO_LIMIT = 32;
const DEFAULT_NAME = "Untitled";
const DEFAULT_SHAPE = { width: 48, height: 32 };
const PASTEBOARD = "gray25";
const PAGE_MARGIN = 12;
const PAGE_SHADOW = 1;
const PAGE_BORDER = 1;
const FILLS: FillStyle[] = ["none", "white", "black", "gray25", "gray50", "gray75"];

/** Id of the shape shown while a drawing tool is being dragged; never part of the document. */
const DRAFT_ID = "draft";

/** A locked tool stays chosen after it draws; an unlocked one hands back to Selection. */
type ToolButtonState = "off" | "on" | "locked";

/** Row under every tool icon where a locked tool shows a dotted bar. */
const LOCK_ROW = CELL - 2;

function ToolButton(props: {
  id: ToolId;
  state: ToolButtonState;
  onSelect: () => void;
  onLock: () => void;
}): JSX.Element {
  const icon = TOOL_ICONS[props.id];
  return (
    <box
      width={CELL}
      height={CELL}
      semantic={{ name: `tool-${props.id}`, role: "button", value: props.state }}
      onMouseDown={props.onSelect}
      onDoubleClick={props.onLock}
    >
      <raster
        width={CELL}
        height={CELL}
        revision={props.state === "off" ? 0 : props.state === "on" ? 1 : 2}
        onPaint={(surface) => {
          const inverted = props.state !== "off";
          for (let y = 0; y < CELL; y++) {
            for (let x = 0; x < CELL; x++) {
              let ink: 0 | 1 = icon.data[y * CELL + x] ? 1 : 0;
              if (props.state === "locked" && y === LOCK_ROW && x >= 2 && x < CELL - 2 && x % 2 === 0) ink = 1;
              surface.setPixel(x, y, inverted ? (ink ? 0 : 1) : ink);
            }
          }
        }}
      />
    </box>
  );
}

function CanvasApp(props: Record<string, unknown>): JSX.Element {
  const app = useApp();
  const win = app.window;
  const { print } = app;

  const [doc, setDoc] = createSignal<CanvasDocument>(emptyDocument(), { ownedWrite: true });
  const [tool, setTool] = createSignal<ToolId>("select");
  const [toolLocked, setToolLocked] = createSignal(false);
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [dirty, setDirty] = createSignal(false);
  const [canUndo, setCanUndo] = createSignal(false);
  const [canRedo, setCanRedo] = createSignal(false);
  const [fill, setFill] = createSignal<FillStyle>("none");
  const [stroke, setStroke] = createSignal(true);
  const [font, setFont] = createSignal<CanvasFont>("body");
  /** Size for new text; undefined draws at the font's default. */
  const [size, setSize] = createSignal<number | undefined>(undefined);
  // Every family: built in, from System Folder › Fonts, or installed by Foundry. Live.
  const [families, setFamilies] = createSignal(app.fonts.list());
  onCleanup(app.fonts.onChange(() => setFamilies(app.fonts.list())));
  const [fileId, setFileId] = createSignal<string | undefined>(
    typeof props.fileId === "string" ? props.fileId : undefined,
  );
  const [fileName, setFileName] = createSignal<string | undefined>(
    typeof props.title === "string" ? props.title : undefined,
  );
  const [draft, setDraft] = createSignal<CanvasElement | null>(null);

  const undoStack: CanvasDocument[] = [];
  const redoStack: CanvasDocument[] = [];

  let move: { orig: CanvasElement; gx: number; gy: number } | null = null;
  let resize: { handle: Handle; orig: CanvasElement; gx: number; gy: number } | null = null;
  let creating: { tool: Exclude<ToolId, "select">; x0: number; y0: number } | null = null;

  const elements = () => doc().elements;
  const selected = () => elements().find((el) => el.id === selectedId()) ?? null;
  const artW = () => doc().width;
  const artH = () => doc().height;
  const viewW = () => Math.max(8, win.width() - TOOLS_W);
  const viewH = () => Math.max(8, win.height() - FOOT_H);
  /** The page, its frame, and its shadow. */
  const pageW = () => artW() + PAGE_BORDER * 2 + PAGE_SHADOW;
  const pageH = () => artH() + PAGE_BORDER * 2 + PAGE_SHADOW;
  /**
   * Gray area the page sits on: centered on an axis where it fits, a margin's
   * width from the start where it doesn't, so its top-left corner stays in reach.
   */
  const pasteW = () => Math.max(viewW(), pageW() + PAGE_MARGIN * 2);
  const pasteH = () => Math.max(viewH(), pageH() + PAGE_MARGIN * 2);

  function kept(elements: CanvasElement[]): CanvasDocument {
    const cur = doc();
    return { version: 1, width: cur.width, height: cur.height, elements };
  }

  createEffect(
    () => ({ dirty: dirty(), name: fileName() ?? DEFAULT_NAME }),
    ({ dirty: isDirty, name }) => win.setTitle(isDirty ? `${name} •` : name),
  );

  function replaceDoc(next: CanvasDocument): void {
    setDoc(next);
  }

  function pushUndo(): void {
    undoStack.push(doc());
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack.length = 0;
    setCanUndo(true);
    setCanRedo(false);
  }

  function undo(): void {
    const prev = undoStack.pop();
    if (!prev) return;
    redoStack.push(doc());
    replaceDoc(prev);
    setCanUndo(undoStack.length > 0);
    setCanRedo(true);
    setEditingId(null);
    setDirty(true);
  }

  function redo(): void {
    const next = redoStack.pop();
    if (!next) return;
    undoStack.push(doc());
    replaceDoc(next);
    setCanUndo(true);
    setCanRedo(redoStack.length > 0);
    setEditingId(null);
    setDirty(true);
  }

  function markDirty(): void {
    setDirty(true);
  }

  function selectElement(el: CanvasElement | null): void {
    setEditingId(null);
    setSelectedId(el?.id ?? null);
    if (el && el.type !== "text") {
      setFill(el.fill);
      setStroke(el.stroke);
    }
    if (el?.type === "text") {
      setFont(el.font);
      setSize(el.size);
    }
  }

  function updateElement(id: string, update: (el: CanvasElement) => CanvasElement): void {
    replaceDoc(kept(replaceElement(elements(), id, update)));
    markDirty();
  }

  function chooseTool(id: ToolId, lock: boolean): void {
    setTool(id);
    setToolLocked(lock && id !== "select");
    setEditingId(null);
  }

  /** Drawing tools are one-shot unless locked, as in MacDraw, Figma, and Sketch. */
  function toolUsed(): void {
    if (!toolLocked()) setTool("select");
  }

  function commitElements(next: CanvasElement[], selectId: string | null): void {
    replaceDoc(kept(next));
    setSelectedId(selectId);
    markDirty();
  }

  function addElement(el: CanvasElement, editText: boolean): void {
    commitElements([...elements(), el], el.id);
    if (el.type !== "text") {
      setFill(el.fill);
      setStroke(el.stroke);
    }
    if (editText && el.type === "text") setEditingId(el.id);
  }

  function defaultTextSize(): { width: number; height: number } {
    const face = drawableFont(font());
    return {
      width: Math.max(48, measureText("Text", face, {}, size()) + 8),
      height: fontLineHeight(face, size()) + 4,
    };
  }

  function newShape(
    type: Exclude<ToolId, "select">,
    frame: Frame & { reverse?: boolean },
    id: string = allocateId(elements()),
  ): CanvasElement {
    if (type === "text") {
      return {
        id,
        type: "text",
        x: frame.x,
        y: frame.y,
        width: frame.width,
        height: frame.height,
        text: "Text",
        font: font(),
        ...(size() === undefined ? {} : { size: size() }),
        align: "left",
      };
    }
    const el: ShapeElement = {
      id,
      type,
      ...frame,
      fill: type === "line" ? "none" : fill(),
      stroke: type === "line" ? true : stroke() || fill() === "none",
    };
    return el;
  }

  function finishCreate(x1: number, y1: number): void {
    if (!creating) return;
    const { tool: t, x0, y0 } = creating;
    creating = null;
    setDraft(null);
    const dragged = Math.abs(x1 - x0) > 2 || Math.abs(y1 - y0) > 2;
    if (t === "line" && !dragged) return;
    let el: CanvasElement;
    if (!dragged) {
      const size = t === "text" ? defaultTextSize() : DEFAULT_SHAPE;
      el = newShape(t, { x: Math.round(x0), y: Math.round(y0), ...size });
    } else {
      el = draggedShape(t, x0, y0, x1, y1);
      if (t !== "text" && t !== "line" && (el.width < 4 || el.height < 4)) return;
    }
    pushUndo();
    addElement(el, t === "text");
    toolUsed();
  }

  /** The shape a drag from (`x0`, `y0`) to (`x1`, `y1`) makes with tool `t`. */
  function draggedShape(
    t: Exclude<ToolId, "select">,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    id?: string,
  ): CanvasElement {
    return newShape(t, t === "line" ? lineFrame(x0, y0, x1, y1) : normalizeFrame(x0, y0, x1, y1), id);
  }

  function artboardDown(lx: number, ly: number): void {
    const t = tool();
    if (t === "select") {
      selectElement(null);
      return;
    }
    selectElement(null);
    creating = { tool: t, x0: lx, y0: ly };
    setDraft(null);
  }

  function artboardDrag(lx: number, ly: number): void {
    if (!creating) return;
    setDraft(draggedShape(creating.tool, creating.x0, creating.y0, lx, ly, DRAFT_ID));
  }

  function artboardUp(lx: number, ly: number): void {
    if (!creating) return;
    finishCreate(lx, ly);
  }

  function startMove(el: CanvasElement, gx: number, gy: number): void {
    if (tool() !== "select" || editingId()) return;
    pushUndo();
    move = { orig: el, gx, gy };
    resize = null;
  }

  function onMove(gx: number, gy: number): void {
    const m = move;
    if (!m) return;
    const x = m.orig.x + Math.round(gx - m.gx);
    const y = m.orig.y + Math.round(gy - m.gy);
    updateElement(m.orig.id, (el) => ({ ...el, x, y }));
  }

  function startResize(el: CanvasElement, handle: Handle, gx: number, gy: number): void {
    pushUndo();
    resize = { handle, orig: el, gx, gy };
    move = null;
  }

  function onResize(gx: number, gy: number): void {
    const r = resize;
    if (!r) return;
    const next = resizeElement(r.orig, r.handle, Math.round(gx - r.gx), Math.round(gy - r.gy));
    updateElement(r.orig.id, () => next);
  }

  function endGesture(): void {
    move = null;
    resize = null;
  }

  function deleteSelected(): void {
    const id = selectedId();
    if (!id || editingId()) return;
    pushUndo();
    commitElements(elements().filter((el) => el.id !== id), null);
  }

  function duplicateSelected(): void {
    const el = selected();
    if (!el) return;
    pushUndo();
    const copy = duplicateElement(el, allocateId(elements()));
    addElement(copy, false);
  }

  function applyFill(next: FillStyle): void {
    setFill(next);
    const el = selected();
    if (!el || el.type === "text") return;
    pushUndo();
    updateElement(el.id, () => ({ ...el, fill: next, stroke: el.stroke || next === "none" }));
  }

  function applyStroke(on: boolean): void {
    setStroke(on);
    const el = selected();
    if (!el || el.type === "text" || el.type === "line") return;
    pushUndo();
    updateElement(el.id, () => ({ ...el, stroke: on || el.fill === "none" }));
  }

  function applyFont(next: CanvasFont): void {
    setFont(next);
    const el = selected();
    if (!el || el.type !== "text") return;
    pushUndo();
    updateElement(el.id, () => fitText({ ...el, font: next }));
  }

  async function chooseSize(current: number): Promise<void> {
    const typed = await app.os.showDialog({
      message: `Font size (${MIN_TEXT_SIZE}–${MAX_TEXT_SIZE}):`,
      buttons: ["Cancel", "OK"],
      showInput: true,
      inputDefault: String(current),
      variant: "note",
    });
    const n = Math.round(Number(typed));
    if (typed && Number.isFinite(n)) applySize(Math.max(MIN_TEXT_SIZE, Math.min(MAX_TEXT_SIZE, n)));
  }

  function applySize(next: number): void {
    setSize(next);
    const el = selected();
    if (!el || el.type !== "text") return;
    pushUndo();
    updateElement(el.id, () => fitText({ ...el, size: next }));
  }

  /** Grow a text box to fit its text in a new font or size, never shrinking it. */
  function fitText(el: TextElement): TextElement {
    const face = requireFont(drawableFont(el.font), el.size);
    const width = Math.max(el.width, Math.min(layoutText(face, el.text).width, artW() - el.x));
    const height = Math.max(el.height, layoutText(face, el.text, width).height, fontLineHeight(drawableFont(el.font), el.size) + 4);
    return { ...el, width, height };
  }

  function applyAlign(next: TextElement["align"]): void {
    const el = selected();
    if (!el || el.type !== "text") return;
    pushUndo();
    updateElement(el.id, () => ({ ...el, align: next }));
  }

  function beginEdit(el: TextElement): void {
    if (editingId() === el.id) return;
    pushUndo();
    setSelectedId(el.id);
    setEditingId(el.id);
    setFont(el.font);
    setSize(el.size);
  }

  /** Leaving a text box with nothing in it removes it, as in Figma and Sketch. */
  function endEdit(id: string): void {
    if (editingId() !== id) return;
    setEditingId(null);
    const el = elements().find((e) => e.id === id);
    if (el?.type === "text" && el.text.trim() === "") {
      commitElements(elements().filter((e) => e.id !== id), null);
    }
  }

  /** Typing grows the box to fit — wider up to the page edge, then taller — and never shrinks it. */
  function onTextChange(id: string, value: string): void {
    updateElement(id, (el) => {
      if (el.type !== "text") return el;
      const font = requireFont(drawableFont(el.font), el.size);
      const width = Math.max(el.width, Math.min(layoutText(font, value).width, artW() - el.x));
      const height = Math.max(el.height, layoutText(font, value, width).height);
      return { ...el, text: value, width, height };
    });
  }

  function handleKey(key: string, modifiers: { shift: boolean }): void {
    if (editingId()) return;
    if (key === "Backspace" || key === "Delete") {
      deleteSelected();
      return;
    }
    if (key === "Escape") {
      if (tool() !== "select") chooseTool("select", false);
      else selectElement(null);
      return;
    }
    const el = selected();
    if (!el) return;
    const step = modifiers.shift ? 8 : 1;
    const nudge: Record<string, { dx: number; dy: number }> = {
      ArrowLeft: { dx: -step, dy: 0 },
      ArrowRight: { dx: step, dy: 0 },
      ArrowUp: { dx: 0, dy: -step },
      ArrowDown: { dx: 0, dy: step },
    };
    const by = nudge[key];
    if (!by) return;
    pushUndo();
    updateElement(el.id, () => ({ ...el, x: el.x + by.dx, y: el.y + by.dy }));
  }

  function desktopCanvases() {
    const desktop = app.fs.locate("desktop");
    if (!desktop) return [];
    return app.fs.children(desktop.id).filter((n) => n.kind === "file" && n.type === MIME.canvas);
  }

  async function confirmDiscard(): Promise<boolean> {
    if (!dirty()) return true;
    const choice = await app.os.showDialog({
      message: "Save changes before continuing?",
      buttons: ["Cancel", "Don't Save", "Save"],
      variant: "caution",
    });
    if (choice === "Save") {
      await save();
      return !dirty();
    }
    return choice === "Don't Save";
  }

  async function quitApp(): Promise<void> {
    if (await confirmDiscard()) app.quit();
  }

  async function loadFile(id: string, name: string): Promise<void> {
    try {
      const raw = await app.fs.readJSON(id);
      const next = parseDocument(raw);
      replaceDoc(next);
      setFileId(id);
      setFileName(name);
      setDirty(false);
      undoStack.length = 0;
      redoStack.length = 0;
      setCanUndo(false);
      setCanRedo(false);
      setSelectedId(null);
      setEditingId(null);
    } catch (err) {
      await app.os.showDialog({
        message: `Couldn't read "${name}": ${err instanceof Error ? err.message : String(err)}`,
        variant: "note",
      });
    }
  }

  async function writeNamed(name: string): Promise<void> {
    const existing = fileId() ? app.fs.file(fileId()!) : undefined;
    const desktop = app.fs.locate("desktop");
    const parentId = existing?.parentId ?? desktop?.id;
    if (!parentId) return;
    const file = await app.fs.writeJSON(parentId, name, doc(), {
      type: MIME.canvas,
      attributes: { icon: "canvas/document" },
    });
    setFileId(file.id);
    setFileName(name);
    setDirty(false);
  }

  async function saveAs(): Promise<void> {
    const name = await app.os.showDialog({
      message: "Save canvas as:",
      buttons: ["Cancel", "Save"],
      showInput: true,
      inputDefault: fileName() ?? DEFAULT_NAME,
      inputMaxLength: MAX_NAME_LENGTH,
      variant: "note",
    });
    const trimmed = name?.trim();
    if (!trimmed) return;
    try {
      await writeNamed(trimmed);
    } catch (err) {
      await app.os.showDialog({
        message: `Couldn't save: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  async function save(): Promise<void> {
    if (fileId() && fileName()) {
      try {
        await writeNamed(fileName()!);
      } catch (err) {
        await app.os.showDialog({
          message: `Couldn't save: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      return;
    }
    await saveAs();
  }

  async function newDocument(): Promise<void> {
    if (!(await confirmDiscard())) return;
    replaceDoc(emptyDocument());
    undoStack.length = 0;
    redoStack.length = 0;
    setCanUndo(false);
    setCanRedo(false);
    setFileId(undefined);
    setFileName(undefined);
    setDirty(false);
    setSelectedId(null);
    setEditingId(null);
  }

  async function openDocument(): Promise<void> {
    if (!(await confirmDiscard())) return;
    const files = desktopCanvases();
    if (files.length === 0) {
      await app.os.showDialog({ message: "No Canvas documents on the desktop.", variant: "note" });
      return;
    }
    if (files.length <= 6) {
      const choice = await app.os.showDialog({
        message: "Open which canvas?",
        buttons: [...files.map((f) => f.name), "Cancel"],
        variant: "note",
      });
      if (!choice || choice === "Cancel") return;
      const file = files.find((f) => f.name === choice);
      if (file) await loadFile(file.id, file.name);
      return;
    }
    const typed = await app.os.showDialog({
      message: "Name of a Canvas document on the desktop:",
      buttons: ["Cancel", "Open"],
      showInput: true,
      variant: "note",
    });
    const name = typed?.trim();
    if (!name) return;
    const file = files.find((f) => f.name === name);
    if (!file) {
      await app.os.showDialog({ message: `"${name}" isn't on the desktop.`, variant: "note" });
      return;
    }
    await loadFile(file.id, file.name);
  }

  function setPageSize(id: PageSizeId): void {
    const size = pageSize(id, print?.paperWidth ?? 576);
    const cur = doc();
    if (cur.width === size.width && cur.height === size.height) return;
    pushUndo();
    replaceDoc({ version: 1, width: size.width, height: size.height, elements: cur.elements.slice() });
    markDirty();
  }

  async function printDocument(): Promise<void> {
    if (!print) return;
    const page = rasterizeCanvas(doc(), artW(), artH());
    try {
      await print.printPicture(page);
    } catch (err) {
      await app.os.showDialog({
        message: `Couldn't print: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  onSettled(() => {
    if (typeof props.fileId !== "string") return;
    void loadFile(props.fileId, typeof props.title === "string" ? props.title : DEFAULT_NAME);
  });

  createEffect(
    () => {
      const el = selected();
      return {
        dirty: dirty(),
        fileId: fileId(),
        canUndo: canUndo(),
        canRedo: canRedo(),
        hasSel: !!el,
        isText: el?.type === "text",
        isShape: !!el && el.type !== "text",
        editing: editingId() !== null,
        font: el?.type === "text" ? el.font : font(),
        size: effectiveSize(el?.type === "text" ? el.font : font(), el?.type === "text" ? el.size : size()),
        sizes: sizeChoices(el?.type === "text" ? el.font : font(), families()),
        scalable: families().some((f) => f.scalable && f.name === fontFamilyOf(el?.type === "text" ? el.font : font())),
        align: el?.type === "text" ? el.align : "left",
        fill: el && el.type !== "text" ? el.fill : fill(),
        stroke: el && el.type !== "text" ? el.stroke : stroke(),
        pageW: doc().width,
        pageH: doc().height,
        paper: print?.paperWidth,
        families: families(),
      };
    },
    (s) => {
      const fileItems: MenubarItemDef[] = [
        { label: "New", shortcut: "N", onClick: () => void newDocument() },
        { label: "Open…", shortcut: "O", onClick: () => void openDocument() },
        { type: "separator" },
        { label: "Save", shortcut: "S", onClick: () => void save(), disabled: !s.dirty && !!s.fileId },
        { label: "Save As…", onClick: () => void saveAs() },
      ];
      if (print) {
        fileItems.push({ type: "separator" }, { label: "Print…", shortcut: "P", onClick: () => void printDocument() });
      }
      fileItems.push({ type: "separator" }, { label: "Quit", shortcut: "Q", onClick: () => void quitApp() });
      app.setMenus([
        { label: "File", items: fileItems },
        {
          label: "Edit",
          items: [
            { label: "Undo", shortcut: "Z", disabled: !s.canUndo, onClick: undo },
            { label: "Redo", shortcut: "⇧Z", disabled: !s.canRedo, onClick: redo },
            { type: "separator" },
            { label: "Duplicate", shortcut: "D", disabled: !s.hasSel, onClick: duplicateSelected },
            { label: "Clear", disabled: !s.hasSel || s.editing, onClick: deleteSelected },
          ],
        },
        {
          label: "Arrange",
          items: [
            { label: "Bring to Front", disabled: !s.hasSel, onClick: () => {
              const id = selectedId();
              if (!id) return;
              pushUndo();
              commitElements(bringToFront(elements(), id), id);
            } },
            { label: "Send to Back", disabled: !s.hasSel, onClick: () => {
              const id = selectedId();
              if (!id) return;
              pushUndo();
              commitElements(sendToBack(elements(), id), id);
            } },
          ],
        },
        {
          label: "Page Size",
          items: [
            {
              type: "radiogroup",
              value: matchingPageSize({ width: doc().width, height: doc().height }, print?.paperWidth ?? 576, print ? ["square", "wide", "printer", "lying"] : ["square", "wide"]) ?? "wide",
              onValueChange: (value) => setPageSize(value as PageSizeId),
              items: (print ? ["square", "wide", "printer", "lying"] : ["square", "wide"]).map((id) => ({
                label: pageSizeLabel(id as PageSizeId, pageSize(id as PageSizeId, print?.paperWidth ?? 576)),
                value: id,
              })),
            },
          ],
        },
        {
          label: "Font",
          items: [
            {
              type: "radiogroup",
              value: fontFamilyOf(s.font),
              onValueChange: (v) => applyFont(v as CanvasFont),
              items: fontMenu(s.families).map((f) => ({ label: f.displayName, value: f.name })),
            },
            { type: "separator" },
            {
              type: "radiogroup",
              value: s.align,
              onValueChange: (v) => applyAlign(v as TextElement["align"]),
              items: [
                { label: "Left", value: "left", disabled: !s.isText },
                { label: "Center", value: "center", disabled: !s.isText },
                { label: "Right", value: "right", disabled: !s.isText },
              ],
            },
          ],
        },
        {
          label: "Size",
          items: [
            {
              type: "radiogroup",
              value: String(s.size),
              onValueChange: (v) => applySize(Number(v)),
              items: [...new Set([...s.sizes, s.size])]
                .sort((a, b) => a - b)
                .map((n) => ({ label: `${n} point`, value: String(n) })),
            },
            ...(s.scalable
              ? ([
                  { type: "separator" },
                  { label: "Other…", onClick: () => void chooseSize(s.size) },
                ] satisfies MenubarItemDef[])
              : []),
          ],
        },
        {
          label: "Style",
          items: [
            {
              type: "radiogroup",
              value: s.fill,
              onValueChange: (v) => applyFill(v as FillStyle),
              items: FILLS.map((value) => ({ label: FILL_LABEL[value], value, disabled: !s.isShape && !!s.hasSel })),
            },
            { type: "separator" },
            {
              type: "radiogroup",
              value: s.stroke ? "on" : "off",
              onValueChange: (v) => applyStroke(v === "on"),
              items: [
                { label: "Frame", value: "on", disabled: !s.isShape },
                { label: "No Frame", value: "off", disabled: !s.isShape },
              ],
            },
          ],
        },
      ]);
    },
  );

  /** One object on the page. A `preview` is the shape a drawing tool is dragging out: it ignores the pointer. */
  function ElementView(props: { el: CanvasElement; preview?: boolean }): JSX.Element {
    const el = () => props.el;
    const semanticName = () => (props.preview ? DRAFT_ID : `el-${el().id}`);
    // Rasters paint outside any reactive scope; a new element object means new pixels.
    let paints = 0;
    const revision = createMemo(() => {
      el();
      return ++paints;
    });
    const selectable = () => tool() === "select" && editingId() !== props.el.id;
    const isText = () => el().type === "text";
    const shape = () => el() as ShapeElement;
    const textEl = () => el() as TextElement;

    const pointer = () => {
      if (props.preview) return {};
      const t = tool();
      if (t === "text" && isText()) {
        return {
          onClick: () => {
            beginEdit(textEl());
            toolUsed();
          },
        };
      }
      if (t !== "select") return {};
      return {
        onMouseDown: () => selectElement(el()),
        onDoubleClick: () => {
          if (isText()) beginEdit(textEl());
        },
        onDragStart: (_lx: number, _ly: number, gx: number, gy: number) => {
          if (selectable()) startMove(el(), gx, gy);
        },
        onDrag: (_lx: number, _ly: number, gx: number, gy: number) => onMove(gx, gy),
        onDragEnd: () => endGesture(),
      };
    };

    return (
      <Show
        when={isText()}
        fallback={
          <Show
            when={shape().type === "rect" || shape().type === "roundrect"}
            fallback={
              <box
                position="absolute"
                left={el().x}
                top={el().y}
                width={el().width}
                height={el().height}
                hitMask={shape().type === "line" ? lineHitMask(shape()) : ovalHitMask(el().width, el().height)}
                semantic={{ name: semanticName(), role: "img", value: el().type }}
                inert={props.preview}
                {...pointer()}
              >
                <raster
                  width={el().width}
                  height={el().height}
                  revision={revision()}
                  onPaint={(surface) => {
                    if (shape().type === "line") paintLine(surface, shape());
                    else paintOval(surface, shape());
                  }}
                />
              </box>
            }
          >
            <box
              position="absolute"
              left={el().x}
              top={el().y}
              width={el().width}
              height={el().height}
              background={boxFill(shape().fill)}
              borderWidth={shape().stroke ? 1 : 0}
              borderColor={shape().stroke ? 1 : undefined}
              borderRadius={shape().type === "roundrect" ? cornerRadius(el()) : undefined}
              semantic={{ name: semanticName(), role: "img", value: el().type }}
              inert={props.preview}
              {...pointer()}
            />
          </Show>
        }
      >
        <box
          position="absolute"
          left={el().x}
          top={el().y}
          width={el().width}
          height={el().height}
          overflow="hidden"
          semantic={{ name: `el-${el().id}`, role: "text", value: textEl().text }}
          {...pointer()}
        >
          <Show
            when={editingId() === el().id}
            fallback={
              <text font={drawableFont(textEl().font)} size={textEl().size} align={textEl().align} wrap>
                {textEl().text}
              </text>
            }
          >
            <EditableText
              name={`text-${el().id}`}
              value={textEl().text}
              font={drawableFont(textEl().font)}
              size={textEl().size}
              align={textEl().align}
              width={el().width}
              height={el().height}
              autoFocus
              selectAllOnFocus
              onChange={(value) => onTextChange(el().id, value)}
              onCancel={() => endEdit(el().id)}
              onBlur={() => endEdit(el().id)}
            />
          </Show>
        </box>
      </Show>
    );
  }

  /**
   * Selection frame and handles. Drawn after the page and its frame, outside the
   * page's clip, so they stay on top and reachable even for an object on or past the edge.
   */
  function SelectionChrome(): JSX.Element {
    return (
      <Show when={editingId() === null ? selected() : null}>
        {(sel) => {
          const node = () => sel();
          const handles = () => {
            const e = node();
            if (e.type === "line") return ["start", "end"] as Handle[];
            return ALL_RESIZE_HANDLES as Handle[];
          };
          const pos = (handle: Handle) => {
            const e = node();
            if (e.type === "line" && (handle === "start" || handle === "end")) {
              const ends = lineEndpoints(e);
              return handle === "start" ? { x: ends.x0, y: ends.y0 } : { x: ends.x1, y: ends.y1 };
            }
            return handlePosition(e, handle as ResizeHandle);
          };
          const half = Math.floor(HANDLE_SIZE / 2);
          return (
            <box
              position="absolute"
              left={PAGE_BORDER}
              top={PAGE_BORDER}
              width={artW()}
              height={artH()}
            >
              <box
                position="absolute"
                left={node().x - 1}
                top={node().y - 1}
                width={node().width + 2}
                height={node().height + 2}
                borderWidth={1}
                borderColor={1}
                borderStyle="dotted"
              />
              <For each={handles()}>
                {(handle) => (
                  <box
                    position="absolute"
                    left={pos(handle).x - half}
                    top={pos(handle).y - half}
                    width={HANDLE_SIZE}
                    height={HANDLE_SIZE}
                    background={0}
                    borderWidth={1}
                    borderColor={1}
                    semantic={{ name: `handle-${handle}`, role: "button" }}
                    onMouseDown={() => {
                      const e = node();
                      selectElement(e);
                    }}
                    onDragStart={(_lx, _ly, gx, gy) => startResize(node(), handle, gx, gy)}
                    onDrag={(_lx, _ly, gx, gy) => onResize(gx, gy)}
                    onDragEnd={() => endGesture()}
                  />
                )}
              </For>
            </box>
          );
        }}
      </Show>
    );
  }

  const status = () => {
    const el = selected();
    if (!el) return `${elements().length} object${elements().length === 1 ? "" : "s"}`;
    if (el.type === "text") return `${fontLabel(el.font, families())} ${effectiveSize(el.font, el.size)} text`;
    return `${el.width} x ${el.height}`;
  };

  return (
    <box width={win.width()} height={win.height()} flexDirection="row" background={0}>
      <box
        width={TOOLS_W - 1}
        height={win.height()}
        padding={2}
        flexDirection="column"
        gap={1}
        background={0}
      >
        <For each={TOOL_GRID}>
          {(row) => (
            <box flexDirection="row" gap={1}>
              <For each={row}>
                {(id) => (
                  <ToolButton
                    id={id}
                    state={tool() !== id ? "off" : toolLocked() ? "locked" : "on"}
                    onSelect={() => chooseTool(id, false)}
                    onLock={() => chooseTool(id, true)}
                  />
                )}
              </For>
            </box>
          )}
        </For>
      </box>
      <box width={1} height={win.height()} background={1} />
      <box flexGrow={1} height={win.height()} flexDirection="column">
        <box width={viewW()} height={viewH()} overflow="scroll" background={0}>
        <box
          width={pasteW()}
          height={pasteH()}
          justifyContent="center"
          alignItems="center"
          background={PASTEBOARD}
          tabIndex={0}
          autoFocus
          semantic={{ name: "pasteboard", role: "group" }}
          onMouseDown={() => {
            if (tool() === "select") selectElement(null);
          }}
          onKeyDown={(key, mods) => handleKey(key, mods)}
        >
        <box width={pageW()} height={pageH()} position="relative">
        <box
          position="absolute"
          left={PAGE_SHADOW}
          top={PAGE_SHADOW}
          width={artW() + PAGE_BORDER * 2}
          height={artH() + PAGE_BORDER * 2}
          background={1}
        />
        <box
          position="absolute"
          left={0}
          top={0}
          width={artW() + PAGE_BORDER * 2}
          height={artH() + PAGE_BORDER * 2}
          borderWidth={PAGE_BORDER}
          borderColor={1}
          background={0}
        >
        <box
          width={artW()}
          height={artH()}
          position="relative"
          overflow="hidden"
          background={0}
          semantic={{ name: "artboard", role: "canvas" }}
          onMouseDown={artboardDown}
          onDrag={artboardDrag}
          onMouseUp={artboardUp}
        >
          <For each={elements()} keyed={(el) => el.id}>
            {(el) => <ElementView el={el()} />}
          </For>
          <Show when={draft()}>
            {(d) => (
              <Show when={d().type === "text"} fallback={<ElementView el={d()} preview />}>
                <box
                  position="absolute"
                  left={d().x}
                  top={d().y}
                  width={d().width}
                  height={d().height}
                  borderWidth={1}
                  borderColor={1}
                  borderStyle="dotted"
                  inert
                />
              </Show>
            )}
          </Show>
        </box>
        </box>
        <SelectionChrome />
        </box>
        </box>
        </box>
        <box height={1} background={1} />
        <box
          height={FOOT_H - 1}
          flexDirection="row"
          alignItems="center"
          padding={2}
          gap={3}
          background={0}
        >
          <For each={FILLS}>
            {(style) => (
              <box
                width={10}
                height={10}
                background={style === "none" ? 0 : boxFill(style)}
                borderColor={1}
                borderWidth={fill() === style ? 1 : 0}
                semantic={{ name: `fill-${style}`, role: "button", value: fill() === style ? "on" : "off" }}
                onClick={() => applyFill(style)}
              />
            )}
          </For>
          <text font="body">{status()}</text>
        </box>
      </box>
    </box>
  );
}

export default defineApp({
  id: "canvas",
  title: "Canvas",
  icon: "canvas/icon",
  smallIcon: "canvas/icon-16x16",
  about: {
    version: "1.0",
    description: "Draw with objects — move, resize, and edit shapes and text without flattening to a bitmap.",
  },
  defaultSize: { width: 480, height: 276 },
  minSize: { width: 280, height: 140 },
  resizable: true,
  scrollable: false,
  fileTypes: [MIME.canvas],
  sprites,
  Component: CanvasApp,
  onOpen(app, props) {
    app.openWindow({
      props,
      position: { x: 16, y: 28 },
    });
  },
});
