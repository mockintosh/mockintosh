import { For, Show, createSignal } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { createPress } from "../primitives/press";
import { fromGrid, type Sprite } from "../sprite";
import { applyMarkdownEdit, type MarkdownEdit } from "./markdownEdits";
import { TextEditor, type TextEditorController } from "./TextEditor";
import { Tooltip } from "./Tooltip";

export interface RichTextEditorProps {
  name?: string;
  value: string;
  onChange(value: string): void;
  width: number;
  /** Height of the writing box, and of the preview in its place. */
  height: number;
  /** Corner radius of the box; the theme's when omitted. */
  borderRadius?: number;
  /**
   * Draws `value` formatted, `width` wide, for the Preview tab. Without it
   * there is no Preview tab: the kit doesn't render Markdown itself.
   */
  preview?: (value: string, width: number) => JSX.Element;
}

const grid = (rows: string[]): Sprite => fromGrid(rows[0]!.length, rows.length, rows);

const ICONS: Record<MarkdownEdit, Sprite> = {
  heading: grid(["#.....#", "#.....#", "#.....#", "#######", "#.....#", "#.....#", "#.....#"]),
  bold: grid(["#####..", "##..##.", "##..##.", "#####..", "##..##.", "##..##.", "#####.."]),
  italic: grid(["...####", "....#..", "...#...", "...#...", "..#....", ".#.....", "####..."]),
  quote: grid(["##..##.", "##..##.", ".#...#.", "#...#.."]),
  code: grid(["..#...#..", ".#.....#.", "#.......#", ".#.....#.", "..#...#.."]),
  link: grid([".###...###.", "#...#.#...#", "#..#####..#", "#...#.#...#", ".###...###."]),
  bullets: grid(["##.######", ".........", "##.######", ".........", "##.######"]),
  numbers: grid([".#..#####", "##.......", ".#..#####", ".#.......", "###.#####"]),
};

const LABELS: Record<MarkdownEdit, string> = {
  heading: "Heading",
  bold: "Bold",
  italic: "Italic",
  quote: "Quote",
  code: "Code",
  link: "Link",
  bullets: "Bulleted list",
  numbers: "Numbered list",
};

/** The toolbar in github.com's order and groups: text, then lists, a rule between. */
const GROUPS: readonly (readonly MarkdownEdit[])[] = [
  ["heading", "bold", "italic", "quote", "code", "link"],
  ["bullets", "numbers"],
];

const TOOL_W = 17;
const TOOL_H = 15;
/** Height of the strip the tabs and toolbar sit in. */
const HEADER_H = 21;
/** Between the outer box and the text box (or the preview). */
const PAD = 6;
const TAB_PAD_X = 10;

/**
 * A toolbar button: its icon, black while pressed, and its name over it when
 * hovered. Out of Tab's order, so Tab goes from the field before straight to
 * the text box.
 */
function Tool(props: { name: string; label: string; icon: Sprite; onClick: () => void }): JSX.Element {
  const press = createPress({ name: props.name, onClick: props.onClick });
  return (
    <Tooltip label={props.label}>
      <box {...press.rootProps()} tabIndex={undefined} width={TOOL_W} height={TOOL_H} background={press.pressed() ? 1 : 0} justifyContent="center" alignItems="center" cursor="pointer">
        <image src={props.icon} width={props.icon.width} height={props.icon.height} mode={press.pressed() ? "inverted" : "normal"} />
      </box>
    </Tooltip>
  );
}

/**
 * One of the Write / Preview tabs, as github.com draws them: the current one
 * open into the box below it (no rule under it, a line at each side that
 * isn't the box's own edge), the other plain on the strip.
 */
function EditorTab(props: { name: string; label: string; current: boolean; first: boolean; onSelect: () => void }): JSX.Element {
  return (
    <box
      semantic={{ name: props.name, role: "tab", value: String(props.current) }}
      height={HEADER_H}
      paddingLeft={TAB_PAD_X}
      paddingRight={TAB_PAD_X}
      flexDirection="row"
      alignItems="center"
      background={0}
      position="relative"
      cursor={props.current ? "default" : "pointer"}
      onClick={() => {
        if (!props.current) props.onSelect();
      }}
    >
      <text font="body" nowrap>{props.label}</text>
      <Show when={props.current}>
        <Show when={!props.first}>
          <box position="absolute" left={0} top={0} width={1} height={HEADER_H} background={1} />
        </Show>
        <box position="absolute" right={0} top={0} width={1} height={HEADER_H} background={1} />
      </Show>
      <Show when={!props.current}>
        <box position="absolute" left={0} bottom={0} width="100%" height={1} background={1} />
      </Show>
    </box>
  );
}

/**
 * A box to write Markdown in, as github.com's comment box: Write and Preview
 * tabs and a toolbar across the top of a rounded box, the current tab open
 * into it; under Write a text box whose toolbar marks the selection up
 * (headings, bold, italic, quotes, code, links and lists), under Preview the
 * text formatted.
 */
export function RichTextEditor(props: RichTextEditorProps): JSX.Element {
  const [tab, setTab] = createSignal<"write" | "preview">("write");
  let editor: TextEditorController | undefined;
  const apply = (edit: MarkdownEdit) => {
    if (!editor) return;
    const next = applyMarkdownEdit(edit, { value: props.value, ...editor.selection() });
    editor.edit(next.value, next.start, next.end);
  };
  const name = (part: string) => (props.name ? `${props.name}:${part}` : part);
  /** Inside the outer border and its padding. */
  const innerWidth = () => props.width - 2 - PAD * 2;
  const tabs = () => (props.preview ? (["write", "preview"] as const) : (["write"] as const));
  return (
    <box width={props.width} borderWidth={1} borderColor={1} borderRadius={props.borderRadius} flexDirection="column" overflow="hidden">
      <box flexDirection="row" height={HEADER_H} alignItems="flex-end">
        <For each={tabs()}>
          {(value, index) => (
            <EditorTab
              name={name(`tabs:${value}`)}
              label={value === "write" ? "Write" : "Preview"}
              current={tab() === value}
              first={index() === 0}
              onSelect={() => setTab(value)}
            />
          )}
        </For>
        {/* The strip's rule runs on past the tabs, under the toolbar. */}
        <box flexGrow={1} height={HEADER_H} flexDirection="row" alignItems="center" justifyContent="flex-end" paddingRight={4} position="relative">
          <Show when={tab() === "write"}>
            <For each={GROUPS}>
              {(group, index) => (
                <>
                  <Show when={index() > 0}>
                    <box width={1} height={TOOL_H - 4} marginLeft={3} marginRight={3} background={1} />
                  </Show>
                  <For each={group}>{(edit) => <Tool name={name(edit)} label={LABELS[edit]} icon={ICONS[edit]} onClick={() => apply(edit)} />}</For>
                </>
              )}
            </For>
          </Show>
          <box position="absolute" left={0} bottom={0} width="100%" height={1} background={1} />
        </box>
      </box>
      <box padding={PAD}>
        <Show
          when={tab() === "preview" && props.preview}
          fallback={
            <TextEditor
              name={props.name}
              value={props.value}
              onChange={props.onChange}
              width={innerWidth()}
              height={props.height}
              borderRadius={props.borderRadius}
              controller={(controller) => {
                editor = controller;
              }}
            />
          }
        >
          {(preview) => (
            <box semantic={{ name: name("preview"), role: "document" }} width={innerWidth()} height={props.height} overflow="scroll" flexDirection="column">
              {props.value.trim() ? preview()(props.value, innerWidth()) : <text font="body" wrap>Nothing to preview.</text>}
            </box>
          )}
        </Show>
      </box>
    </box>
  );
}
