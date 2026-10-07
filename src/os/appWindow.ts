/**
 * Builds the `OSWindow` record for a window an app opens — the `NewWindow`
 * of this shell. The app's `defineApp` supplies the defaults, a `WindowSpec`
 * overrides them, and the screen decides where the window may go.
 */

import type { WindowSpec } from "@mockintosh/sdk";
import type { SolidApp } from "./apps";
import { fullScreenBounds, type OSWindow, type WindowBounds, type WindowComponent } from "./state";
import { windowDefinition } from "./windowKinds";
import { windowTotalHeight } from "./windowGeometry";

/** Gap kept between a window and the screen edge, as `openApp` always has. */
const SCREEN_MARGIN = 3;
/** Offset between successive windows opened without an explicit position. */
const STAGGER = 16;

export interface AppWindowEnvironment {
  screen: { width: number; height: number };
  menubarHeight: number;
  /** How many windows are open; staggers the default position. */
  openWindowCount: number;
}

export function buildAppWindow<P extends Record<string, unknown>>(
  app: SolidApp,
  spec: WindowSpec<P>,
  env: AppWindowEnvironment
): OSWindow {
  const kind = spec.kind ?? app.windowKind ?? "document";
  const props: Record<string, unknown> = spec.props ?? {};
  const scrollable = spec.scrollable ?? app.scrollable ?? false;
  const resizable = spec.resizable ?? app.resizable ?? false;
  const minSize = spec.minSize ?? app.minSize;
  const title = spec.title ?? (typeof props.title === "string" ? props.title : app.title);
  // Stored height is content height, so reserve the title/frame/scrollbar
  // before fitting either normal or zoomed bounds to the desktop.
  const chromeHeight = windowTotalHeight({ kind, title, scrollable, height: 0 });

  // The gray region: the desktop minus a margin, as the zoom box's standard state.
  const standardBounds: WindowBounds = {
    x: SCREEN_MARGIN,
    y: env.menubarHeight + SCREEN_MARGIN,
    width: env.screen.width - 2 * SCREEN_MARGIN,
    height: Math.max(0, env.screen.height - env.menubarHeight - 2 * SCREEN_MARGIN - chromeHeight),
  };

  let bounds: WindowBounds;
  const def = windowDefinition(kind);
  if (def.coversScreen || def.backdrop) {
    bounds = fullScreenBounds(env.screen);
  } else {
    const size = spec.size ?? app.defaultSize;
    const width = Math.min(size.width, standardBounds.width);
    const height = Math.min(size.height, standardBounds.height);
    const n = env.openWindowCount % 6;
    const wanted = spec.position ?? (def.modal
      ? {
          // Alert() places the dBoxProc window in the upper centre.
          x: Math.floor((env.screen.width - width) / 2),
          y: env.menubarHeight + 40,
        }
      : {
          x: 20 + n * STAGGER,
          y: env.menubarHeight + 20 + n * STAGGER,
        });
    bounds = {
      x: Math.max(SCREEN_MARGIN, Math.min(wanted.x, env.screen.width - width - SCREEN_MARGIN)),
      y: Math.max(
        env.menubarHeight + SCREEN_MARGIN,
        Math.min(wanted.y, env.screen.height - height - chromeHeight - SCREEN_MARGIN)
      ),
      width,
      height,
    };
  }

  return {
    id: `${app.id}-${Date.now()}-${env.openWindowCount}`,
    appId: app.id,
    title,
    ...bounds,
    kind,
    // A spec's component is typed for its own props; the window store keeps
    // the erased form, and `WindowContent` spreads `props` back into it.
    Component: spec.Component as WindowComponent | undefined,
    props,
    scrollY: 0,
    scrollX: 0,
    contentHeight: scrollable ? Math.max(bounds.height, 200) : bounds.height,
    // Nothing overflows sideways until the content reports its size.
    contentWidth: 0,
    scrollable,
    resizable,
    growBox: spec.growBox ?? app.growBox,
    movable: spec.movable,
    onGoAway: spec.onGoAway,
    modal: spec.modal,
    minWidth: minSize?.width,
    minHeight: minSize?.height,
    standardBounds,
    userBounds: { ...bounds },
  };
}
