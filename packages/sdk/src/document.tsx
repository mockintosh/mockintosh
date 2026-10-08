import { Errored, For, Loading, Show, createMemo, createSignal, useContext } from "solid-js";
import type { ImageFrame, JSX, TextRun } from "@mockintosh/ui";
import { Button, Dithered, Menu, TextEditor, TextInput, Tooltip } from "@mockintosh/ui";
import type { FormControl, InlineSegment, LayoutColumn, LayoutNode, TableRow, WebForm } from "@mockintosh/markdown";
import { AppServicesContext } from "./index";

/** One `name=value` pair a submitted form sends, in document order. */
export interface FormField {
  name: string;
  value: string;
}

export interface DocumentViewProps {
  nodes: readonly LayoutNode[];
  /** A link was clicked. `href` is exactly as the document wrote it. */
  onLink?: (href: string) => void;
  /** A form was submitted. `fields` holds the text and hidden controls plus the pressed button. */
  onSubmit?: (form: WebForm, fields: FormField[]) => void;
  /**
   * Pixels for an image `src` that is not a sprite name. Resolve `null` to
   * show the alt text instead.
   */
  loadImage?: (src: string) => Promise<ImageFrame | null>;
}

const FALLBACK_WIDTH = 320;
const BUTTON_WIDTH = 64;
/** `TextEditor`'s line height. */
const TEXTAREA_LINE = 14;
/** Border plus padding on each side of a `box` card. */
const CARD_INSET = 7;
const BLOCK_GAP = 4;

function inlineRuns(segments: readonly InlineSegment[], onLink: ((href: string) => void) | undefined): TextRun[] {
  return segments.map((segment) => {
    if (segment.kind === "bold") return { text: segment.text, bold: true };
    if (segment.kind === "italic") return { text: segment.text, italic: true };
    if (segment.kind === "link") {
      const href = segment.href;
      const run: TextRun = segment.bold ? { text: segment.text, underline: true, bold: true } : { text: segment.text, underline: true };
      return onLink ? { ...run, onClick: () => onLink(href) } : run;
    }
    return { text: segment.text };
  });
}

interface BlockProps {
  node: LayoutNode;
  width: number;
  view: DocumentViewProps;
}

function Block(props: BlockProps): JSX.Element {
  const node = props.node;
  const onLink = props.view.onLink;
  if (node.type === "heading") {
    const href = node.href;
    const runs: TextRun[] = [
      href && onLink ? { text: node.text, underline: true, onClick: () => onLink(href) } : { text: node.text },
    ];
    return node.level === 3
      ? <text font="body" bold wrap align={node.align} runs={runs} />
      : <text font="menu" spacing={1} wrap align={node.align} runs={runs} />;
  }
  if (node.type === "paragraph") {
    return <text font="body" wrap align={node.align} runs={inlineRuns(node.segments, onLink)} />;
  }
  if (node.type === "listItem") {
    return (
      <box flexDirection="row" gap={4} paddingLeft={node.indent * 10}>
        <text font="body" nowrap>{node.marker ?? "•"}</text>
        <text font="body" wrap flexGrow={1} flexShrink={1} runs={inlineRuns(node.segments, onLink)} />
      </box>
    );
  }
  if (node.type === "code") {
    return (
      <box borderColor={1} padding={4}>
        <text font="mono" wrap>{node.text}</text>
      </box>
    );
  }
  if (node.type === "table") {
    return <TableView rows={node.rows} onLink={onLink} />;
  }
  if (node.type === "form") {
    return <FormView form={node.form} width={props.width} onSubmit={props.view.onSubmit} />;
  }
  if (node.type === "hr") {
    return <box height={1} background={1} />;
  }
  if (node.type === "image") {
    return <ImageView node={node} width={props.width} view={props.view} />;
  }
  if (node.type === "bitmap") {
    return (
      <box width={Math.min(node.width, props.width)} height={node.height} overflow="hidden" position="relative">
        <image semantic={{ name: node.alt, role: "image" }} src={{ width: node.width, height: node.height, data: node.data }} width={node.width} height={node.height} />
        <For each={node.tips ?? []}>
          {(tip) => (
            <box position="absolute" left={tip.x} top={tip.y} width={tip.width} height={tip.height}>
              <Tooltip label={tip.label}>
                <box width={tip.width} height={tip.height} />
              </Tooltip>
            </box>
          )}
        </For>
      </box>
    );
  }
  if (node.type === "menu") {
    return <MenuView node={node} view={props.view} />;
  }
  if (node.type === "scroller") {
    return <ScrollerView node={node} width={props.width} view={props.view} />;
  }
  if (node.type === "tabs") {
    return <TabsView node={node} view={props.view} />;
  }
  if (node.type === "spacer") {
    return <box height={node.height} />;
  }
  if (node.type === "box") {
    return (
      <box borderColor={1} borderRadius={node.radius} padding={CARD_INSET - 1} flexDirection="column" gap={BLOCK_GAP}>
        <Blocks nodes={node.nodes} width={props.width - CARD_INSET * 2} view={props.view} />
      </box>
    );
  }
  if (node.type === "columns") {
    return <ColumnsView columns={node.columns} gap={node.gap} minWidth={node.minWidth} center={node.center ?? false} width={props.width} view={props.view} />;
  }
  return <box height={6} />;
}

/** A page's pull-down menu: its label like a link, its items in the UI kit's `Menu`. */
/** Space between page tabs. */
const TAB_GAP = 16;
/** Between a tab's label and the line under the current one. */
const TAB_UNDER = 3;

/** Page tabs over a rule; the current tab's line sits on the rule, so it reads as a 2px border under it. */
function TabsView(props: { node: Extract<LayoutNode, { type: "tabs" }>; view: DocumentViewProps }): JSX.Element {
  return (
    <box flexDirection="column">
      <box flexDirection="row" gap={TAB_GAP}>
        <For each={props.node.items}>
          {(tab) => (
            <box
              flexDirection="column"
              cursor={tab.current ? undefined : "pointer"}
              semantic={{ name: tab.label, role: "tab", value: tab.current ? "current" : undefined }}
              onClick={tab.current ? undefined : () => props.view.onLink?.(tab.href)}
            >
              <text font="body" bold={tab.current} nowrap>{tab.label}</text>
              <box height={TAB_UNDER} />
              <box height={1} background={tab.current ? 1 : 0} />
            </box>
          )}
        </For>
      </box>
      <box height={1} background={1} />
    </box>
  );
}

function MenuView(props: { node: Extract<LayoutNode, { type: "menu" }>; view: DocumentViewProps }): JSX.Element {
  const node = props.node;
  const [open, setOpen] = createSignal(false);
  const choose = (entry: (typeof node.items)[number]) => {
    if ("href" in entry) props.view.onLink?.(entry.href);
    else {
      const fields = entry.form.controls.flatMap((control) => (control.kind === "hidden" ? [{ name: control.name, value: control.value }] : []));
      props.view.onSubmit?.(entry.form, fields);
    }
  };
  const right = node.align === "right";
  return (
    <box flexDirection="row" justifyContent={right ? "flex-end" : node.align === "center" ? "center" : "flex-start"}>
      <Menu
        name={node.label}
        open={open()}
        onDismiss={() => setOpen(false)}
        align={right ? "end" : "start"}
        items={node.items.map((entry) => ({ label: entry.label, onClick: () => choose(entry) }))}
        trigger={
          <box cursor="pointer" semantic={{ name: `${node.label} menu`, role: "button" }} onClick={() => setOpen(!open())}>
            <text font="body" nowrap runs={[{ text: node.label, underline: true }]} />
          </box>
        }
      />
    </box>
  );
}

/** Height of a scroller's bar: a black thumb on the windows' own scroll-track gray, thin enough to stay out of the way. */
const SCROLLER_BAR = 4;
/** The bar's thumb is never narrower than this. */
const SCROLLER_THUMB = 16;

/**
 * A pane that scrolls its content sideways: drag the content, or the
 * thumb on the bar under it, or click the bar to jump. The offset is the
 * view's own, since a document has no window scroll bar to give it.
 */
function ScrollerView(props: { node: Extract<LayoutNode, { type: "scroller" }>; width: number; view: DocumentViewProps }): JSX.Element {
  const node = props.node;
  const visible = () => Math.max(1, Math.min(node.width, props.width));
  const max = () => Math.max(0, node.width - visible());
  /** Null until the reader moves it: then it stays where they put it, whatever the width does. */
  const [moved, setMoved] = createSignal<number | null>(null);
  const offset = () => {
    const at = moved();
    return Math.max(0, Math.min(max(), at ?? (node.start === "end" ? max() : 0)));
  };
  const thumb = () => Math.max(SCROLLER_THUMB, Math.floor((visible() * visible()) / Math.max(1, node.width)));
  const thumbX = () => Math.floor(((visible() - thumb()) * offset()) / Math.max(1, max()));
  let grab: { x: number; offset: number } | null = null;
  const startDrag = (globalX: number) => (grab = { x: globalX, offset: offset() });
  const pan = (globalX: number) => {
    if (grab) setMoved(grab.offset - (globalX - grab.x));
  };
  const slide = (globalX: number) => {
    if (grab) setMoved(grab.offset + ((globalX - grab.x) * max()) / Math.max(1, visible() - thumb()));
  };
  return (
    <box flexDirection="column" gap={3}>
      <box
        width={visible()}
        overflow="scroll"
        scrollOffsetX={offset()}
        onDragStart={(_x, _y, globalX) => startDrag(globalX)}
        onDrag={(_x, _y, globalX) => pan(globalX)}
        onDragEnd={() => (grab = null)}
        onScrollX={(dx) => setMoved(offset() + dx)}
      >
        <box width={node.width} flexDirection="column" gap={BLOCK_GAP}>
          <Blocks nodes={node.nodes} width={node.width} view={props.view} />
        </box>
      </box>
      <Show when={max() > 0}>
        <box
          width={visible()}
          height={SCROLLER_BAR}
          background="gray25"
          position="relative"
          onClick={(x) => setMoved(((x - thumb() / 2) * max()) / Math.max(1, visible() - thumb()))}
        >
          <box
            position="absolute"
            left={thumbX()}
            top={0}
            width={thumb()}
            height={SCROLLER_BAR}
            background={1}
            onDragStart={(_x, _y, globalX) => startDrag(globalX)}
            onDrag={(_x, _y, globalX) => slide(globalX)}
            onDragEnd={() => (grab = null)}
          />
        </box>
      </Show>
    </box>
  );
}

function Blocks(props: { nodes: readonly LayoutNode[]; width: number; view: DocumentViewProps }): JSX.Element {
  return <For each={props.nodes}>{(node) => <Block node={node} width={props.width} view={props.view} />}</For>;
}

/** Fixed-width columns keep their width; the others share what is left. */
function columnWidths(columns: readonly LayoutColumn[], gap: number, width: number): number[] {
  const fixed = columns.reduce((sum, column) => sum + (column.width ?? 0), 0);
  const flexible = columns.filter((column) => column.width === undefined).length;
  const room = Math.max(0, width - fixed - gap * Math.max(0, columns.length - 1));
  return columns.map((column) => column.width ?? Math.floor(room / Math.max(1, flexible)));
}

function ColumnsView(props: {
  columns: readonly LayoutColumn[];
  gap: number;
  minWidth: number;
  center: boolean;
  width: number;
  view: DocumentViewProps;
}): JSX.Element {
  const widths = () => columnWidths(props.columns, props.gap, props.width);
  const stacked = (
    <box flexDirection="column" gap={props.gap}>
      <For each={props.columns}>
        {(column) => (
          <box flexDirection="column" gap={BLOCK_GAP}>
            <Blocks nodes={column.nodes} width={Math.min(props.width, column.width ?? props.width)} view={props.view} />
          </box>
        )}
      </For>
    </box>
  );
  return (
    <Show when={props.width >= props.minWidth} fallback={stacked}>
      <box flexDirection="row" gap={props.gap} alignItems={props.center ? "center" : "flex-start"}>
        <For each={props.columns.map((column, index) => ({ column, index }))}>
          {(entry) => (
            <box flexDirection="column" gap={BLOCK_GAP} width={widths()[entry.index]} flexShrink={0} minWidth={0}>
              <Blocks nodes={entry.column.nodes} width={widths()[entry.index] ?? 0} view={props.view} />
            </box>
          )}
        </For>
      </box>
    </Show>
  );
}

function TableView(props: { rows: readonly TableRow[]; onLink?: (href: string) => void }): JSX.Element {
  return (
    <box flexDirection="column" borderColor={1}>
      <For each={props.rows}>
        {(row) => (
          <box flexDirection="row" gap={6} padding={2}>
            <For each={row.cells}>
              {(cell) => (
                <text
                  font="body"
                  wrap
                  bold={row.header}
                  flexGrow={1}
                  flexShrink={1}
                  flexBasis={0}
                  runs={inlineRuns(cell, props.onLink)}
                />
              )}
            </For>
          </box>
        )}
      </For>
    </box>
  );
}

function FormView(props: { form: WebForm; width: number; onSubmit?: (form: WebForm, fields: FormField[]) => void }): JSX.Element {
  const form = props.form;
  const [values, setValues] = createSignal<Record<number, string>>(
    Object.fromEntries(form.controls.map((control, index) => [index, control.value])),
  );
  const texts = form.controls.filter((control) => control.kind === "text").length;
  const buttons = form.controls.filter((control) => control.kind === "submit").length;
  const inputWidth = () => {
    const room = props.width - buttons * (BUTTON_WIDTH + 4) - Math.max(0, texts - 1) * 4;
    return Math.max(80, Math.floor(room / Math.max(1, texts)));
  };

  function submit(pressed: number | null): void {
    const fields: FormField[] = [];
    form.controls.forEach((control, index) => {
      if (control.kind === "submit") {
        if (index === pressed && control.name) fields.push({ name: control.name, value: control.value });
        return;
      }
      if (control.name) fields.push({ name: control.name, value: values()[index] ?? "" });
    });
    props.onSubmit?.(form, fields);
  }

  const firstButton = form.controls.findIndex((control) => control.kind === "submit");
  const shown = form.controls.map((control, index) => ({ control, index })).filter((entry) => entry.control.kind !== "hidden");
  const view = (entry: { control: FormControl; index: number }, width: () => number) => (
    <FormControlView entry={entry} values={values} setValues={setValues} inputWidth={width()} submit={() => submit(firstButton >= 0 ? firstButton : null)} press={submit} />
  );
  // With several lines to write, fields stack at the page's width and the buttons sit under them.
  if (form.controls.some((control) => control.kind === "textarea")) {
    return (
      <box flexDirection="column" gap={4}>
        <For each={shown.filter((entry) => entry.control.kind !== "submit")}>{(entry) => view(entry, () => props.width)}</For>
        <box flexDirection="row" gap={4} justifyContent="flex-end">
          <For each={shown.filter((entry) => entry.control.kind === "submit")}>{(entry) => view(entry, () => props.width)}</For>
        </box>
      </box>
    );
  }
  const justify = form.align === "right" ? "flex-end" : form.align === "center" ? "center" : "flex-start";
  return (
    <box flexDirection="row" gap={4} alignItems="center" justifyContent={justify}>
      <For each={shown}>{(entry) => view(entry, inputWidth)}</For>
    </box>
  );
}

function FormControlView(props: {
  entry: { control: FormControl; index: number };
  values: () => Record<number, string>;
  setValues: (update: (prev: Record<number, string>) => Record<number, string>) => void;
  inputWidth: number;
  submit: () => void;
  press: (index: number) => void;
}): JSX.Element {
  const { control, index } = props.entry;
  if (control.kind === "text") {
    return (
      <TextInput
        value={props.values()[index] ?? ""}
        placeholder={control.placeholder}
        width={props.inputWidth}
        onChange={(value) => props.setValues((prev) => ({ ...prev, [index]: value }))}
        onSubmit={() => props.submit()}
      />
    );
  }
  if (control.kind === "textarea") {
    return (
      <TextEditor
        name={control.name || undefined}
        value={props.values()[index] ?? ""}
        width={props.inputWidth}
        height={control.rows * TEXTAREA_LINE + 8}
        onChange={(value) => props.setValues((prev) => ({ ...prev, [index]: value }))}
      />
    );
  }
  if (control.kind === "submit") {
    const app = useContext(AppServicesContext);
    const icon = control.icon ? app?.getSprite(control.icon) : undefined;
    const button = <Button label={control.label} icon={icon} onClick={() => props.press(index)} />;
    return control.tooltip ? <Tooltip label={control.tooltip}>{button}</Tooltip> : button;
  }
  return <box />;
}

function ImageView(props: { node: Extract<LayoutNode, { type: "image" }>; width: number; view: DocumentViewProps }): JSX.Element {
  const app = useContext(AppServicesContext);
  if (!app) throw new Error("useApp() must be called inside a Mockintosh app window");
  const node = props.node;
  const alt = () => <text font="body" wrap>{node.alt ? `[${node.alt}]` : "[image]"}</text>;
  const linked = (content: JSX.Element) => {
    const onLink = props.view.onLink;
    const href = node.href;
    if (!href || !onLink) return content;
    return <box cursor="pointer" onClick={() => onLink(href)}>{content}</box>;
  };

  const sprite = app.getSprite(node.src);
  if (sprite) {
    return linked(
      <image
        width={sprite.width}
        height={sprite.height}
        alignSelf={node.align === "center" ? "center" : node.align === "right" ? "flex-end" : "flex-start"}
        src={{ width: sprite.width, height: sprite.height, data: sprite.data, mask: sprite.mask }}
      />,
    );
  }
  const loadImage = props.view.loadImage;
  if (!loadImage) return linked(alt());

  const frame = createMemo(async () => loadImage(node.src));
  const size = () => {
    const loaded = frame();
    if (!loaded || loaded.width <= 0 || loaded.height <= 0) return null;
    const natural = { width: node.width ?? loaded.width, height: node.height ?? (loaded.height * (node.width ?? loaded.width)) / loaded.width };
    const width = Math.max(1, Math.min(natural.width, props.width));
    return { frame: loaded, width, height: Math.max(1, Math.round((natural.height * width) / natural.width)) };
  };
  // A sized picture holds its place while it loads, so the page doesn't jump.
  const pending = () => (node.width && node.height ? <box width={Math.min(node.width, props.width)} height={node.height} /> : alt());
  return linked(
    <Loading fallback={pending()}>
      <Errored fallback={() => alt()}>
        <Show when={size()} fallback={alt()}>
          {(fit) =>
            node.borderRadius ? (
              <box width={fit().width} height={fit().height} borderRadius={node.borderRadius} overflow="hidden">
                <Dithered src={fit().frame} width={fit().width} height={fit().height} />
              </box>
            ) : (
              <Dithered src={fit().frame} width={fit().width} height={fit().height} />
            )}
        </Show>
      </Errored>
    </Loading>,
  );
}

/**
 * Draws a document (`LayoutNode[]`) through the 1-bit layout tree: wrapped
 * paragraphs with clickable links, lists, code, tables, forms and dithered
 * images. `Markdown` is this view over `parseMarkdown`.
 */
export function DocumentView(props: DocumentViewProps): JSX.Element {
  const [width, setWidth] = createSignal(FALLBACK_WIDTH);
  return (
    <box flexDirection="column" gap={4} width="100%" onLayout={(size) => setWidth(size.width)}>
      <For each={props.nodes}>{(node) => <Block node={node} width={width()} view={props} />}</For>
    </box>
  );
}
