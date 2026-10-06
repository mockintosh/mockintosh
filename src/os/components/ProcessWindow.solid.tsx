/**
 * The content of an OS window whose app runs in a process: the latest picture
 * the worker drew for it, with the window's input sent back. The window's
 * services (`useApp()`) are the OS's own for this window; the process answers
 * the app's calls with them.
 */
import { createEffect, createSignal, onCleanup, untrack, useContext } from "solid-js";
import { CopyBits, srcCopy } from "@mockintosh/quickdraw";
import { heldModifiers, type CursorSpec, type JSX, type Modifiers } from "@mockintosh/ui";
import { WindowSlotsContext, useApp, type MenubarDefinition } from "@mockintosh/sdk";
import { useWindow } from "../windowContext";
import type { AppProcess } from "../process/host";
import type { KeyKind, PointerKind, WindowState } from "../process/protocol";
import type { WindowComponent } from "../state";

export function ProcessWindow(props: { process: AppProcess; windowKey: string; stats?: boolean }): JSX.Element {
  const app = useApp();
  const win = app.window;
  /** The window record: a scrollable window's document height lives there. */
  const osWin = useWindow().win;
  const proc = props.process;
  const key = props.windowKey;
  const host = proc.windows.get(key);
  const [revision, setRevision] = createSignal(0, { ownedWrite: true });
  const [cursor, setCursor] = createSignal<CursorSpec | undefined>(host?.cursor, { ownedWrite: true });
  const [menus, setMenus] = createSignal<MenubarDefinition[]>(host?.menus ?? [], { ownedWrite: true });
  const [bands, setBands] = createSignal(host?.bands ?? { header: 0, footer: 0 }, { ownedWrite: true });
  const slots = useContext(WindowSlotsContext);
  let lastX = 0;
  let lastY = 0;

  if (host) {
    host.changed = (what) => {
      if (what === "frame") setRevision((r) => r + 1);
      else if (what === "cursor") setCursor(() => host.cursor);
      else if (what === "bands") setBands(host.bands);
      else setMenus(host.menus);
    };
  }

  const state = (): WindowState => ({
    width: win.width(),
    height: win.height(),
    active: win.isActive(),
    kind: win.kind(),
    scrollY: win.scrollY(),
  });
  /** Where the visible part of a scrollable window's document starts; the worker draws only that part. */
  const viewTop = () => (osWin.scrollable ? Math.min(win.scrollY(), Math.max(0, osWin.contentHeight - win.height())) : 0);
  proc.attach(key, app, untrack(state));
  onCleanup(() => proc.detach(key));
  createEffect(state, (next) => proc.send({ t: "window.state", key, state: next }));

  const statsMenu: MenubarDefinition = {
    label: "Worker",
    items: [
      {
        label: "Performance…",
        onClick: () => {
          const s = proc.stats;
          const lines = [
            `First picture ${s.firstPictureMs === null ? "—" : `${s.firstPictureMs.toFixed(0)} ms`} after start`,
            `${s.frames} frames, ${((host?.frameBytes ?? 0) / 1024).toFixed(1)} KB each`,
            `Worker draw: ${s.worker.summary()}`,
            `Main blit: ${s.blit.summary()}`,
            `Input to screen: ${s.latency.summary()}`,
            ...(s.audio.count > 0 ? [`Audio chunk: ${s.audio.summary()}`] : []),
          ];
          void app.os.showDialog({ message: lines.join("\n"), variant: "note" });
        },
      },
      {
        label: "Reset Counters",
        onClick: () => {
          const s = proc.stats;
          s.worker.reset();
          s.blit.reset();
          s.latency.reset();
          s.audio.reset();
          s.frames = 0;
        },
      },
    ],
  };
  createEffect(menus, (list) => app.setMenus(props.stats ? [...list, statsMenu] : list));

  function pointer(kind: PointerKind, x: number, y: number, deltaY?: number): void {
    lastX = x;
    lastY = y;
    proc.input({ t: "pointer", key, kind, x, y, deltaY, modifiers: heldModifiers() });
  }

  function keyEvent(kind: KeyKind, value: string, modifiers: Modifiers): void {
    proc.input({ t: "key", key, kind, value, modifiers });
  }

  /**
   * Rows `[top, top + height)` of the worker's picture, with input sent back
   * at those rows. The picture is header, body and footer, top to bottom.
   * Every slice takes focus when clicked, so typing reaches a field the app
   * keeps in its header or footer; the worker decides which control gets it.
   */
  const slice = (
    top: () => number,
    height: () => number,
    options: { body?: boolean; position?: "absolute"; y?: () => number } = {},
  ) => (
    <raster
      position={options.position}
      left={0}
      top={options.y?.()}
      width={win.width()}
      height={height()}
      revision={revision()}
      cursor={cursor()}
      tabIndex={0}
      autoFocus={options.body}
      semantic={options.body ? { name: "app-process", role: "canvas" } : undefined}
      onPaint={(surface) => {
        const start = app.scheduler.now();
        const frame = host?.frame;
        const { x, y, width, height: rows } = surface.rect;
        const from = top();
        // Clearing goes pixel by pixel; only a picture that doesn't cover the raster (mid-resize) needs it.
        if (!frame || frame.bounds.right < width || frame.bounds.bottom < from + rows) surface.fill(0);
        if (frame) {
          const w = frame.bounds.right;
          const h = Math.max(0, Math.min(rows, frame.bounds.bottom - from));
          CopyBits(frame, surface.port.portBits, { top: from, left: 0, bottom: from + h, right: w }, { top: y, left: x, bottom: y + h, right: x + w }, srcCopy, null);
        }
        if (!options.body) return;
        const end = app.scheduler.now();
        proc.stats.blit.add(end - start);
        const painted = host?.frameSeq ?? 0;
        for (const [seq, at] of proc.sentAt) {
          if (seq > painted) continue;
          proc.stats.latency.add(end - at);
          proc.sentAt.delete(seq);
        }
      }}
      onMouseDown={(x, y) => pointer("mousedown", x, top() + y)}
      onDoubleClick={(x, y) => pointer("dblclick", x, top() + y)}
      onMouseMove={(x, y) => pointer("mousemove", x, top() + y)}
      onDrag={(x, y) => pointer("mousemove", x, top() + y)}
      onMouseUp={(x, y) => pointer("mouseup", x, top() + y)}
      // A scrollable window's wheel scrolls the window, as the OS does for any app.
      onScroll={options.body && osWin.scrollable ? undefined : (deltaY) => pointer("scroll", lastX, lastY, deltaY)}
      onKeyDown={(k, mods) => keyEvent("keydown", k, mods)}
      onKeyUp={(k, mods) => keyEvent("keyup", k, mods)}
      onKeyPress={(ch) => keyEvent("keypress", ch, heldModifiers())}
    />
  );

  // The app's WindowHeader / WindowFooter become the window's own bands, so
  // the OS's scrollbar starts below the header, as for any app.
  createEffect(
    () => bands(),
    ({ header, footer }) => {
      slots?.setHeader(header > 0 ? () => slice(() => 0, () => bands().header) : null, header);
      slots?.setFooter(footer > 0 ? () => slice(() => bands().header + win.height(), () => bands().footer) : null, footer);
    },
  );

  onCleanup(() => {
    slots?.setHeader(null, 0);
    slots?.setFooter(null, 0);
  });

  const picture = slice(() => bands().header, () => win.height(), {
    body: true,
    position: osWin.scrollable ? "absolute" : undefined,
    y: viewTop,
  });
  // The OS scrolls the window's body over the whole document; the picture rides at the visible part.
  return osWin.scrollable ? (
    <box width={win.width()} height={Math.max(osWin.contentHeight, win.height())} position="relative">
      {picture}
    </box>
  ) : (
    picture
  );
}

/** The component the OS window for process window `key` mounts. */
export function processWindowComponent(process: AppProcess, key: string, stats: boolean): WindowComponent {
  return () => <ProcessWindow process={process} windowKey={key} stats={stats} />;
}
