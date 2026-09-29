import { Show } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { Avatar } from "./Avatar";
import { Bubble } from "./Bubble";

export interface MessageProps {
  align?: "start" | "end";
  initials?: string;
  name?: string;
  footer?: string;
  invert?: boolean;
  children: string;
}

/** Row: Avatar + header + Bubble + footer. ChatGippity is the first consumer. */
export function Message(props: MessageProps): JSX.Element {
  const end = () => props.align === "end";
  return (
    <box
      semantic={{ role: "listitem", value: props.children }}
      flexDirection="column"
      gap={2}
      alignItems={end() ? "flex-end" : "flex-start"}
      alignSelf="stretch"
    >
      <Show when={!!props.name}>
        <text font="body" nowrap>{props.name!}</text>
      </Show>
      <box flexDirection="row" gap={6} alignItems="flex-end">
        <Show when={!end()}>
          <Avatar initials={props.initials ?? "G"} size={24} />
        </Show>
        <Bubble align={props.align} invert={props.invert}>
          {props.children}
        </Bubble>
        <Show when={end()}>
          <Avatar initials={props.initials ?? "Y"} size={24} />
        </Show>
      </box>
      <Show when={!!props.footer}>
        <text font="body" nowrap>{props.footer!}</text>
      </Show>
    </box>
  );
}

export interface MessageScrollerProps {
  height: number;
  /** Inner inset. Default 4. */
  padding?: number;
  children?: JSX.Element;
}

/** Thread on a scroll pane that follows new messages while the reader is at the end. */
export function MessageScroller(props: MessageScrollerProps): JSX.Element {
  return (
    <box
      semantic={{ role: "log" }}
      overflow="scroll"
      scrollAnchor="bottom"
      height={props.height}
      flexDirection="column"
      gap={8}
      padding={props.padding ?? 4}
    >
      {props.children}
    </box>
  );
}
