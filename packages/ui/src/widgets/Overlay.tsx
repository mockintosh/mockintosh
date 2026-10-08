import { For, Show, createContext, createEffect, createSignal, onCleanup, onSettled, useContext } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import type { CanvasNode } from "../nodes";
import { getFocusManager } from "../focusContext";
import { scrollPaintOffset, scrollPaintOffsetX } from "../scroll";

export type OverlaySide = "bottom" | "top";
/** Which edge of the trigger the panel lines up with, or its middle. */
export type OverlayAlign = "start" | "end" | "center";

export interface OverlayLayer {
  id: number;
  x: number;
  y: number;
  /** Inset from the host's right edge. Set when `align` is `"end"`. */
  right?: number;
  /** `x` is the panel's middle, not its left edge. */
  centered?: boolean;
  /** `y` is where the panel's bottom goes: it hangs above the trigger. */
  above?: boolean;
  /** The left and right the panel must stay between (its trigger's `overlayBounds` box). */
  bounds?: { left: number; right: number };
  modal: boolean;
  role?: string;
  /** `center` fills the host and flex-centers the panel. Default `anchor`. */
  placement?: "anchor" | "center";
  render: () => JSX.Element;
  onDismiss?: () => void;
  onKeyDown?: (key: string) => void;
}

export interface OverlayHostApi {
  show(layer: Omit<OverlayLayer, "id">): number;
  update(id: number, patch: Partial<Omit<OverlayLayer, "id">>): void;
  hide(id: number): void;
}

export const OverlayHostContext = createContext<OverlayHostApi | null>(null);

let dismissTopModal: (() => boolean) | null = null;

/** Escape on a modal overlay, even if focus is still on the trigger. */
export function dismissOverlayModal(): boolean {
  return dismissTopModal?.() ?? false;
}

/** Root layer after the app tree so panels paint in screen space, not inside overflow:scroll. */
export function OverlayHost(props: { children?: JSX.Element }): JSX.Element {
  const [layers, setLayers] = createSignal<OverlayLayer[]>([]);
  const [hostWidth, setHostWidth] = createSignal(0);
  let nextId = 1;

  const api: OverlayHostApi = {
    show(layer) {
      const id = nextId++;
      setLayers((prev) => [...prev, { ...layer, id }]);
      return id;
    },
    update(id, patch) {
      setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    },
    hide(id) {
      setLayers((prev) => prev.filter((l) => l.id !== id));
    },
  };

  const modalTop = () => {
    const list = layers();
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].modal) return list[i];
    }
    return undefined;
  };

  dismissTopModal = () => {
    const top = modalTop();
    if (!top) return false;
    top.onDismiss?.();
    return true;
  };
  onCleanup(() => {
    if (dismissTopModal) dismissTopModal = null;
  });

  return (
    <OverlayHostContext value={api}>
      <box width="100%" height="100%" onLayout={({ width }) => setHostWidth(width)}>
        {props.children}
        <Show when={modalTop()}>
          <box
            semantic={{ name: "overlay-catcher", role: "presentation" }}
            position="absolute"
            left={0}
            top={0}
            width="100%"
            height="100%"
            onMouseDown={() => modalTop()?.onDismiss?.()}
          />
        </Show>
        <For each={layers()}>
          {(layer) => <OverlayLayerView layer={layer} hostWidth={hostWidth()} />}
        </For>
      </box>
    </OverlayHostContext>
  );
}

function overlayKeyDown(layer: OverlayLayer, key: string): void {
  if (key === "Escape") {
    layer.onDismiss?.();
    return;
  }
  layer.onKeyDown?.(key);
}

function focusModal(el: CanvasNode, modal: boolean): void {
  if (!modal) return;
  onSettled(() => {
    try {
      getFocusManager().focus(el);
    } catch {
      /* OverlayHost used outside createUI */
    }
  });
}

/**
 * A panel at its trigger, measured so it can sit above it or centred on it,
 * and moved sideways as far as it must to stay inside its bounds (the
 * trigger's window) or the host: a tooltip near an edge still shows whole.
 */
const OFF_SCREEN = -10000;

function OverlayLayerView(props: { layer: OverlayLayer; hostWidth: number }): JSX.Element {
  const layer = () => props.layer;
  const centered = () => layer().placement === "center";
  const [size, setSize] = createSignal({ width: 0, height: 0 });
  const left = () => {
    const l = layer();
    const x = l.centered ? Math.round(l.x - size().width / 2) : l.x;
    const bounds = l.bounds ?? (props.hostWidth > 0 ? { left: 0, right: props.hostWidth } : null);
    return bounds ? Math.max(bounds.left, Math.min(x, bounds.right - size().width)) : x;
  };
  /** A panel placed by its size waits off screen for one layout, so it never shows in the wrong place. */
  const measuring = () => (layer().above || layer().centered) && size().width === 0;
  const top = () => (measuring() ? OFF_SCREEN : layer().above ? layer().y - size().height : layer().y);
  return (
    <box
      semantic={{ name: "overlay-panel", role: layer().role ?? "dialog" }}
      position="absolute"
      left={centered() ? 0 : layer().right === undefined ? left() : undefined}
      right={centered() ? undefined : layer().right}
      top={centered() ? 0 : top()}
      width={centered() ? "100%" : undefined}
      height={centered() ? "100%" : undefined}
      justifyContent={centered() ? "center" : undefined}
      alignItems={centered() ? "center" : undefined}
      background={centered() ? "checker" : undefined}
      penMode={centered() ? "bic" : undefined}
      tabIndex={layer().modal ? 0 : undefined}
      onClick={() => {
        if (centered()) layer().onDismiss?.();
      }}
      onKeyDown={(key: string) => overlayKeyDown(layer(), key)}
      ref={(el) => focusModal(el, layer().modal)}
      onLayout={({ width, height }) => {
        if (!centered() && (width !== size().width || height !== size().height)) setSize({ width, height });
      }}
    >
      <box onMouseDown={() => {}}>{layer().render()}</box>
    </box>
  );
}

export interface OverlayProps {
  open: boolean;
  onDismiss?: () => void;
  /** Outside click + Escape. Tooltip sets false. Default true. */
  modal?: boolean;
  side?: OverlaySide;
  /** Pixels between the trigger and the panel, on `side`. */
  offset?: number;
  /** `end` hangs the panel from the trigger's right edge; `center` centres it on the trigger. */
  align?: OverlayAlign;
  role?: string;
  onKeyDown?: (key: string) => void;
  trigger: JSX.Element;
  children?: JSX.Element;
}

/** Where `node` is drawn: its layout position less the offsets of the scrolled panes around it. */
function drawnAt(node: CanvasNode): { x: number; y: number } {
  let x = node.layout.x;
  let y = node.layout.y;
  for (let n = node.parent; n; n = n.parent) {
    if (n.style.overflow === "scroll") y -= scrollPaintOffset(n);
    x -= scrollPaintOffsetX(n);
  }
  return { x, y };
}

/** The left and right edges of the nearest `overlayBounds` box around `node`, as drawn. */
function boundsOf(node: CanvasNode): { left: number; right: number } | undefined {
  for (let n = node.parent; n; n = n.parent) {
    if (n.props["overlayBounds"] === true) {
      const at = drawnAt(n);
      return { left: at.x, right: at.x + n.layout.width };
    }
  }
  return undefined;
}

function place(
  node: CanvasNode | null,
  side: OverlaySide,
  offset: number,
  align: OverlayAlign,
): Pick<OverlayLayer, "x" | "y" | "right" | "centered" | "above" | "bounds"> {
  if (!node) return { x: 0, y: 0 };
  const at = drawnAt(node);
  const above = side === "top";
  const y = above ? at.y - offset : at.y + node.layout.height + offset;
  const bounds = boundsOf(node);
  if (align === "end") {
    let root: CanvasNode = node;
    while (root.parent) root = root.parent;
    const triggerRight = at.x + node.layout.width;
    return { x: at.x, y, above, right: Math.max(0, root.layout.width - triggerRight) };
  }
  if (align === "center") return { x: at.x + node.layout.width / 2, y, above, centered: true, bounds };
  return { x: at.x, y, above, bounds };
}

/**
 * Anchored in-window layer. createUI installs OverlayHost so the panel is a
 * sibling of the app tree (escapes overflow:scroll). Without a host, the
 * panel is a local absolute child of the trigger.
 */
export function Overlay(props: OverlayProps): JSX.Element {
  const host = useContext(OverlayHostContext);
  let triggerNode: CanvasNode | null = null;
  let triggerHeight = 0;
  let layerId = 0;

  const side = () => props.side ?? "bottom";
  const offset = () => props.offset ?? 0;
  const modal = () => props.modal !== false;

  createEffect(
    () => ({
      open: props.open,
      modal: props.modal !== false,
      side: props.side ?? "bottom",
      offset: props.offset ?? 0,
      align: props.align ?? "start",
      role: props.role,
      children: props.children,
      onDismiss: props.onDismiss,
      onKeyDown: props.onKeyDown,
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
        ...place(triggerNode, snap.side, snap.offset, snap.align),
        modal: snap.modal,
        role: snap.role,
        render: () => snap.children,
        onDismiss: () => snap.onDismiss?.(),
        onKeyDown: snap.onKeyDown,
      };
      if (layerId === 0) layerId = host.show(next);
      else host.update(layerId, next);
    },
  );

  onCleanup(() => {
    if (host && layerId !== 0) host.hide(layerId);
    layerId = 0;
  });

  return (
    <box
      ref={(el) => {
        triggerNode = el;
        triggerHeight = el.layout.height;
      }}
      alignSelf="flex-start"
      position="relative"
    >
      {props.trigger}
      <Show when={props.open && !host}>
        <box
          semantic={{ name: "overlay-panel", role: props.role ?? "dialog" }}
          position="absolute"
          left={0}
          top={side() === "top" ? undefined : triggerHeight + offset()}
          bottom={side() === "top" ? triggerHeight + offset() : undefined}
          tabIndex={modal() ? 0 : undefined}
          onKeyDown={(key: string) => {
            if (key === "Escape") {
              props.onDismiss?.();
              return;
            }
            props.onKeyDown?.(key);
          }}
        >
          {props.children}
        </box>
      </Show>
    </box>
  );
}
