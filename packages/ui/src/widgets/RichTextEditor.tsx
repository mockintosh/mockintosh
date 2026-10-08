import { For, Show, createSignal } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { createPress } from "../primitives/press";
import { fromGrid, type Sprite } from "../sprite";
import { applyMarkdownEdit, type MarkdownEdit } from "./markdownEdits";
import { Tabs } from "./Tabs";
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

/** The toolbar, as github.com's comment box has it: each button's edit, name and icon. */
const TOOLS: ReadonlyArray<{ edit: MarkdownEdit; label: string; icon: Sprite }> = [
  { edit: "heading", label: "Heading", icon: grid(["#.....#", "#.....#", "#.....#", "#######", "#.....#", "#.....#", "#.....#"]) },
  { edit: "bold", label: "Bold", icon: grid(["#####..", "##..##.", "##..##.", "#####..", "##..##.", "##..##.", "#####.."]) },
  { edit: "italic", label: "Italic", icon: grid(["...####", "....#..", "...#...", "...#...", "..#....", ".#.....", "####..."]) },
  { edit: "code", label: "Code", icon: grid(["..#...#..", ".#.....#.", "#.......#", ".#.....#.", "..#...#.."]) },
  { edit: "link", label: "Link", icon: grid([".###...###.", "#...#.#...#", "#..#####..#", "#...#.#...#", ".###...###."]) },
  { edit: "quote", label: "Quote", icon: grid(["##..##.", "##..##.", ".#...#.", "#...#.."]) },
  { edit: "bullets", label: "Bulleted list", icon: grid(["##.######", ".........", "##.######", ".........", "##.######"]) },
  { edit: "numbers", label: "Numbered list", icon: grid([".#..#####", "##.......", ".#..#####", ".#.......", "###.#####"]) },
];

const TOOL_W = 17;
const TOOL_H = 15;

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
 * A box to write Markdown in, as github.com's comment box: a toolbar that
 * marks the selection up (headings, bold, italic, code, links, quotes and
 * lists), and Write and Preview tabs, Preview showing it formatted.
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
  return (
    <box flexDirection="column" width={props.width} gap={4}>
      <box position="relative" width={props.width}>
        <Tabs
          name={name("tabs")}
          untabbable
          value={tab()}
          onChange={(value) => setTab(value === "preview" ? "preview" : "write")}
          items={props.preview ? [{ value: "write", label: "Write" }, { value: "preview", label: "Preview" }] : [{ value: "write", label: "Write" }]}
        />
        <Show when={tab() === "write"}>
          <box position="absolute" right={0} top={1} flexDirection="row" gap={1}>
            <For each={TOOLS}>{(tool) => <Tool name={name(tool.edit)} label={tool.label} icon={tool.icon} onClick={() => apply(tool.edit)} />}</For>
          </box>
        </Show>
      </box>
      <Show
        when={tab() === "preview" && props.preview}
        fallback={
          <TextEditor
            name={props.name}
            value={props.value}
            onChange={props.onChange}
            width={props.width}
            height={props.height}
            borderRadius={props.borderRadius}
            controller={(controller) => {
              editor = controller;
            }}
          />
        }
      >
        {(preview) => (
          <box
            semantic={{ name: name("preview"), role: "document" }}
            width={props.width}
            height={props.height}
            borderWidth={1}
            borderColor={1}
            borderRadius={props.borderRadius}
            padding={5}
            overflow="scroll"
            flexDirection="column"
          >
            {props.value.trim() ? preview()(props.value, props.width - 12) : <text font="body" wrap>Nothing to preview.</text>}
          </box>
        )}
      </Show>
    </box>
  );
}
