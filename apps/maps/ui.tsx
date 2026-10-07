/**
 * The pieces Maps' floating panels are made of: a panel over the map, its
 * close box, the app's own icons, a list that scrolls by the wheel, and
 * text broken into lines ahead of time so every row's height is known.
 */
import { Show, createMemo, createSignal, measureText, useApp } from "@mockintosh/sdk";
import type { JSX } from "@mockintosh/ui";

/** Space between the map's edge and what floats over it. */
export const MARGIN = 6;
export const FIELD_H = 18;

/** `text` broken into lines no wider than `width` in `font`, at spaces where it can be. */
export function wrapped(text: string, width: number, font: string): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (measureText(candidate, font) <= width || !line) line = candidate;
    else {
      lines.push(line);
      line = word;
    }
    // A word wider than the line is cut where it must be.
    while (measureText(line, font) > width && line.length > 1) {
      let cut = line.length - 1;
      while (cut > 1 && measureText(line.slice(0, cut), font) > width) cut--;
      lines.push(line.slice(0, cut));
      line = line.slice(cut);
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** `text` cut to fit `width` in `font`, ending in an ellipsis when it had to be cut. */
export function fitted(text: string, width: number, font: string): string {
  if (measureText(text, font) <= width) return text;
  let cut = text;
  while (cut.length > 0 && measureText(`${cut}…`, font) > width) cut = cut.slice(0, -1);
  return cut ? `${cut.trimEnd()}…` : "";
}

/** One of the app's sprites (`icons.ts`), by name. */
export function Icon(props: { name: string }): JSX.Element {
  const app = useApp();
  const sprite = createMemo(() => app.getSprite(props.name));
  return (
    <Show when={sprite()}>
      {(s) => <image width={s().width} height={s().height} src={s()} />}
    </Show>
  );
}

/** A white box with a shadow, floating over the map at (left, top). */
export function Panel(props: {
  name: string;
  left: number;
  top: number;
  width: number;
  height?: number;
  children?: JSX.Element;
}): JSX.Element {
  return (
    <box
      position="absolute"
      left={props.left}
      top={props.top}
      width={props.width}
      height={props.height}
      borderWidth={1}
      borderColor={1}
      shadow
      background={0}
      flexDirection="column"
      overflow="hidden"
      semantic={{ name: props.name, role: "group" }}
    >
      {props.children}
    </box>
  );
}

/** Closes a panel: an X, white on black while pressed. */
export function CloseBox(props: { name: string; left: number; top: number; onClick: () => void }): JSX.Element {
  const [pressed, setPressed] = createSignal(false);
  return (
    <box
      position="absolute"
      left={props.left}
      top={props.top}
      width={11}
      height={11}
      alignItems="center"
      justifyContent="center"
      background={pressed() ? 1 : 0}
      cursor="pointer"
      semantic={{ name: props.name, role: "button" }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
      onClick={props.onClick}
    >
      <Icon name={pressed() ? "maps/close-pressed" : "maps/close"} />
    </box>
  );
}

/**
 * Rows `height` tall in all, of which `view` show, scrolled by the wheel:
 * the owner lays the rows out, so the list knows how far it goes. A bar at
 * the right says how far down it is.
 */
export function ScrollArea(props: {
  name: string;
  width: number;
  view: number;
  height: number;
  scroll: number;
  onScroll: (scroll: number) => void;
  children?: JSX.Element;
}): JSX.Element {
  const max = () => Math.max(0, props.height - props.view);
  const thumb = () => Math.max(12, Math.round((props.view * props.view) / Math.max(1, props.height)));
  return (
    <box
      width={props.width}
      height={props.view}
      overflow="hidden"
      semantic={{ name: props.name, role: "list" }}
      onScroll={(dy) => props.onScroll(Math.max(0, Math.min(max(), props.scroll + Math.sign(dy) * Math.max(24, Math.min(Math.abs(dy), props.view / 2)))))}
    >
      <box position="absolute" left={0} top={-Math.min(props.scroll, max())} width={props.width} height={props.height}>
        {props.children}
      </box>
      <Show when={max() > 0}>
        <box
          position="absolute"
          left={props.width - 3}
          top={Math.round((Math.min(props.scroll, max()) / max()) * (props.view - thumb()))}
          width={2}
          height={thumb()}
          background={1}
        />
      </Show>
    </box>
  );
}
