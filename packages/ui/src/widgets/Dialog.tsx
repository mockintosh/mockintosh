import { Show, createEffect, onCleanup, useContext } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { OverlayHostContext } from "./Overlay";
import { useRadius } from "../theme";

export interface DialogProps {
  name?: string;
  open: boolean;
  onDismiss: () => void;
  title?: string;
  description?: string;
  width?: number;
  trigger?: JSX.Element;
  children?: JSX.Element;
}

/** Title line. Geneva 10, like other chrome labels. */
export function DialogTitle(props: { children: string }): JSX.Element {
  return (
    <text font="genova" size={10} nowrap>
      {props.children}
    </text>
  );
}

/** Body copy under the title. */
export function DialogDescription(props: { children: string }): JSX.Element {
  return (
    <text font="body" wrap>
      {props.children}
    </text>
  );
}

/** Button row. Packs to the end. */
export function DialogFooter(props: { children?: JSX.Element }): JSX.Element {
  return (
    <box flexDirection="row" gap={8} justifyContent="flex-end" alignItems="center">
      {props.children}
    </box>
  );
}

/**
 * Centered in-window modal. Parent owns `open`. Dismiss is click outside
 * or Escape. Not an OS alert — apps that need Finder Dialog Manager use
 * `showDialog`.
 */
export function Dialog(props: DialogProps): JSX.Element {
  const host = useContext(OverlayHostContext);
  const radius = useRadius("lg");
  let layerId = 0;

  createEffect(
    () => ({
      open: props.open,
      name: props.name,
      title: props.title,
      description: props.description,
      width: props.width,
      children: props.children,
      onDismiss: props.onDismiss,
      radius: radius(),
    }),
    (snap) => {
      if (!host) return;
      if (!snap.open) {
        if (layerId !== 0) {
          host.hide(layerId);
          layerId = 0;
        }
        return;
      }
      const next = {
        x: 0,
        y: 0,
        modal: true,
        placement: "center" as const,
        role: "dialog",
        render: () => (
          <box
            semantic={{ name: snap.name ?? "dialog", role: "dialog" }}
            width={snap.width ?? 220}
            padding={12}
            borderColor={1}
            borderWidth={1}
            borderRadius={snap.radius}
            background={0}
            flexDirection="column"
            gap={10}
            shadow
          >
            <Show when={snap.title !== undefined}>
              <DialogTitle>{snap.title!}</DialogTitle>
            </Show>
            <Show when={snap.description !== undefined}>
              <DialogDescription>{snap.description!}</DialogDescription>
            </Show>
            {snap.children}
          </box>
        ),
        onDismiss: () => snap.onDismiss(),
      };
      if (layerId === 0) layerId = host.show(next);
      else host.update(layerId, next);
    },
  );

  onCleanup(() => {
    if (host && layerId !== 0) host.hide(layerId);
    layerId = 0;
  });

  return <box alignSelf="flex-start">{props.trigger}</box>;
}
