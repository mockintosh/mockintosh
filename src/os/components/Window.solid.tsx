import { Errored, Loading, isPending } from "solid-js";
import { For, Show, createSignal, createMemo } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { useOS } from "../context";
import {
  getActiveAppId,
  getActiveWindowId,
  isAppHidden,
  bringToFront,
  updateOSWindow,
  setWindowOutline,
  getWindowOutline,
  closeOSWindow,
  type OSWindow,
} from "../state";
import { getApp } from "../apps";
import { WindowCtx, type WindowAPI } from "../windowContext";
import { isBlockedByModal } from "../layering";
import { getWindows, setWindowFullScreen } from "../state";
import { windowDefinition } from "../windowKinds";
import { AppServicesContext, WindowSlotsContext, type AppServices } from "@mockintosh/sdk";
import { createAppContext } from "../appContext";
import { mountWindowContent } from "../windowContent";
import { measureText, type PointerCaptureEvent } from "@mockintosh/ui";

import {
  FRAME,
  TITLE_BAR_H,
  SB_W,
  SB_INNER,
  SHADOW,
  CLOSE_SIZE,
  ZOOM_SIZE,
  GROW_SIZE,
  hasGrowBand,
  hasGrowBox,
  hasTitleBar,
  headerBandHeight,
  footerBandHeight,
  windowFrame,
  windowOuterFrame,
  windowHeaderHeight,
  windowTotalHeight,
  windowContentWidth,
  windowInnerWidth,
  titleBarOuterHeight,
  hasZoomBox,
} from "../windowGeometry";

/** Where a hidden app's windows wait: far enough left that no frame or shadow reaches the screen. */
const HIDDEN_LEFT = -100_000;

/** How far inside the desktop's edges a dragged window's grab point must stay (DragWindow's 4px inset). */
const DRAG_INSET = 4;

/** Offsets of the six title-bar stripe lines within the 11px close-box band. */
const TITLE_BAR_STRIPE_ROWS = [0, 2, 4, 6, 8, 10];

interface WindowProps {
  win: OSWindow;
}

export function Window(props: WindowProps): JSX.Element {
  const os = useOS();
  const windowId = props.win.id;
  const minH = props.win.minHeight ?? 60;
  let bandHeader = props.win.headerHeight ?? 0;
  let bandFooter = props.win.footerHeight ?? 0;
  let bodyHeight = props.win.height;
  const isActive = () => getActiveWindowId() === windowId;

  // Close / zoom box press tracking (signals so the sprite re-renders)
  const [closePressed, setClosePressed] = createSignal(false);
  const [zoomPressed, setZoomPressed] = createSignal(false);

  // Drag state — plain variables, no signal needed
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  // Resize state — offset from click point to window bottom-right corner
  let resizeOffsetX = 0;
  let resizeOffsetY = 0;

  // What this kind of window is made of (title bar, boxes, frame, shadow).
  const def = createMemo(() => windowDefinition(props.win.kind));
  /** A palette is on whenever its app is front, even while a document is the key window. */
  const appFront = () => getActiveAppId() === props.win.appId;
  const chromeOn = () => (def().toolPalette ? appFront() : isActive());
  const shown = () => !(def().toolPalette || def().backdrop) || appFront();
  /**
   * A hidden app's windows move off screen rather than unmount, so their
   * content keeps its state until the app is shown again.
   */
  const left = () => (isAppHidden(props.win.appId) ? HIDDEN_LEFT : props.win.x);

  // Outer geometry
  const frame = createMemo(() => windowFrame(props.win));
  const outer = createMemo(() => windowOuterFrame(props.win));
  const headerH = createMemo(() => windowHeaderHeight(props.win));
  const bandH = createMemo(() => headerBandHeight(props.win));
  const footH = createMemo(() => footerBandHeight(props.win));
  const totalH = createMemo(() => windowTotalHeight(props.win));
  const [headerView, setHeaderView] = createSignal<(() => JSX.Element) | null>(null, {
    ownedWrite: true,
  });
  const [footerView, setFooterView] = createSignal<(() => JSX.Element) | null>(null, {
    ownedWrite: true,
  });

  // Interior geometry (inside the outer hairline) — all children use these.
  const innerW = createMemo(() => windowInnerWidth(props.win));
  const innerH = createMemo(() => totalH() - 2 * outer());
  const barInner = createMemo(() => Math.max(0, titleBarOuterHeight(props.win) - FRAME));
  /** 11px close box fills an untitled drag bar; document bars keep the historical inset. */
  const closeTop = createMemo(() =>
    barInner() <= CLOSE_SIZE ? 0 : Math.floor((TITLE_BAR_H - CLOSE_SIZE) / 2) - FRAME,
  );
  const headerInnerH = createMemo(() => headerH() - outer());
  const contentW = createMemo(() => windowContentWidth(props.win));

  const closeSprite = createMemo(() =>
    os.sprites.get(closePressed() ? "chrome/closing" : "chrome/close")
  );
  const zoomSprite  = createMemo(() => os.sprites.get("chrome/zoom"));

  // Title metrics — needed for the white clearance behind the title
  const titleW = createMemo(() => measureText(props.win.title, "menu"));
  const titlePending = () => isPending(() => props.win.props);
  const titleX = createMemo(() => Math.floor((innerW() - titleW()) / 2));

  // Close/zoom boxes and stripes within the title bar interior
  const closeX = 7;
  const zoomX  = createMemo(() => innerW() - 7 - ZOOM_SIZE);
  const zoomY  = Math.floor((TITLE_BAR_H - ZOOM_SIZE) / 2) - FRAME;

  // The vertical scroll bar rises one row so its up arrow's top edge is the
  // rule above it (title-bar separator or header band), not a second line.
  const sbOverlap = createMemo(() => (hasTitleBar(props.win) ? FRAME : 0));
  const sbTop = createMemo(() => headerInnerH() - sbOverlap());

  // The bar runs beside the body only, its down arrow's bottom edge on the
  // line below the body (the horizontal bar's, or a footer's).
  const scrollableBodyH = createMemo(() => props.win.height + sbOverlap() + FRAME);
  /** Top of the horizontal scroll bar, which is also its top line. */
  const hBarTop = createMemo(() => headerInnerH() + props.win.height + footH());

  // Scroll bar tracks: the gray between the arrows, inside the bar's lines
  // and the frame. A thumb at either end sits against the arrow, so their
  // borders make a double line, as in System 6.
  const maxScrollY = createMemo(() => Math.max(0, props.win.contentHeight - props.win.height));
  const vTrackTop = SB_W;
  const vTrackH = createMemo(() => scrollableBodyH() - 2 * SB_W);
  const thumbH = createMemo(() =>
    Math.min(vTrackH(), Math.max(16, Math.floor(scrollableBodyH() * props.win.height / Math.max(1, props.win.contentHeight)))),
  );
  const thumbY = createMemo(() => {
    const ratio = Math.min(1, props.win.scrollY / Math.max(1, maxScrollY()));
    return vTrackTop + Math.floor((vTrackH() - thumbH()) * ratio);
  });

  // The left arrow starts one column into the frame, so the horizontal track
  // starts one column nearer than the vertical one.
  const maxScrollX = createMemo(() => Math.max(0, props.win.contentWidth - contentW()));
  const scrollX = createMemo(() => Math.min(props.win.scrollX, maxScrollX()));
  const hTrackLeft = SB_W - FRAME;
  const hTrackW = createMemo(() => contentW() - SB_INNER - hTrackLeft);
  const hThumbW = createMemo(() =>
    Math.min(hTrackW(), Math.max(16, Math.floor(contentW() * contentW() / Math.max(1, props.win.contentWidth)))),
  );
  const hThumbX = createMemo(() =>
    hTrackLeft + Math.floor((hTrackW() - hThumbW()) * scrollX() / Math.max(1, maxScrollX())),
  );
  function scrollXBy(dx: number): void {
    updateOSWindow(props.win.id, { scrollX: Math.max(0, Math.min(maxScrollX(), scrollX() + dx)) });
  }
  function handleHThumbDrag(gx: number): void {
    const trackX = props.win.x + outer() + hTrackLeft;
    const ratio = Math.max(0, Math.min(1, (gx - trackX - hThumbW() / 2) / Math.max(1, hTrackW() - hThumbW())));
    updateOSWindow(props.win.id, { scrollX: Math.round(ratio * maxScrollX()) });
  }

  function applyBandHeight(field: "headerHeight" | "footerHeight", next: number): void {
    const prev = field === "headerHeight" ? bandHeader : bandFooter;
    if (prev === next) return;
    if (field === "headerHeight") bandHeader = next;
    else bandFooter = next;
    bodyHeight = Math.max(minH, bodyHeight + prev - next);
    updateOSWindow(windowId, { [field]: next, height: bodyHeight });
  }

  function spriteSrc(s: NonNullable<ReturnType<typeof os.sprites.get>>) {
    return { width: s.width, height: s.height, data: s.data, mask: s.mask };
  }

  /**
   * Window activation policy — the single place a press anywhere in this
   * window (chrome or content) is checked before the pressed node reacts:
   *
   * - Behind a modal alert: the press is ignored entirely.
   * - Inactive window: it comes to the front. A press on the title bar then
   *   continues as a drag; anywhere else the press *only* activates (classic
   *   Mac), so content never reacts to the click that focused its window.
   */
  function handleActivationPress(ev: PointerCaptureEvent) {
    if (isBlockedByModal(props.win, getWindows())) {
      ev.preventDefault();
      return;
    }
    // A utility window is used from the document. The press drags the bar or
    // changes a control; it does not take the key window, so both stay active.
    if (def().toolPalette) return;
    // The desk is used from the document too; a press only brings its app forward.
    if (def().backdrop) {
      if (!appFront()) {
        bringToFront(props.win.id);
        ev.preventDefault();
      }
      return;
    }
    if (isActive()) return;
    bringToFront(props.win.id);
    if (!hasTitleBar(props.win) || ev.localY >= TITLE_BAR_H) ev.preventDefault();
  }

  function goAway(): void {
    if (props.win.onGoAway) props.win.onGoAway();
    else os.closeWindow(props.win.id);
  }

  function handleThumbDrag(gx: number, gy: number) {
    const trackY = props.win.y + headerH() - sbOverlap() + vTrackTop;
    const relY   = gy - trackY - thumbH() / 2;
    const ratio  = Math.max(0, Math.min(1, relY / Math.max(1, vTrackH() - thumbH())));
    const maxScroll = maxScrollY();
    updateOSWindow(props.win.id, { scrollY: Math.round(ratio * maxScroll) });
  }

  return (
    <Show when={shown()}>
    <box
      position="absolute"
      left={left()}
      top={props.win.y}
      width={props.win.width + SHADOW}
      height={totalH() + SHADOW}
    >
      {/* ── Drop shadow (offset by 1px, so the corners stay open) ── */}
      <Show when={def().shadow}>
        <box
          position="absolute"
          left={SHADOW}
          top={totalH()}
          width={props.win.width}
          height={SHADOW}
          background={1}
        />
        <box
          position="absolute"
          left={props.win.width}
          top={SHADOW}
          width={SHADOW}
          height={totalH()}
          background={1}
        />
      </Show>

      {/* ── Window body ─────────────────────────────────────────── */}
      <box
        position="absolute"
        left={0}
        top={0}
        width={props.win.width}
        height={totalH()}
        background={0}
        borderColor={1}
        borderWidth={outer()}
        overflow="hidden"
        semantic={{ name: "window", role: "window", windowId: props.win.id }}
        focusScope
        onMouseDownCapture={handleActivationPress}
      >
        {/* ── Inner band (dBoxProc: 2px black inside a 2px white gap) ── */}
        <Show when={(def().innerFrame ?? 0) > 0}>
          <box
            position="absolute"
            left={def().frameGap ?? 0}
            top={def().frameGap ?? 0}
            width={innerW() - 2 * (def().frameGap ?? 0)}
            height={innerH() - 2 * (def().frameGap ?? 0)}
            borderColor={1}
            borderWidth={def().innerFrame}
          />
        </Show>

        {/* ── Title bar ─────────────────────────────────────────── */}
        <Show when={hasTitleBar(props.win)}>
        <box
          position="absolute"
          left={0}
          top={0}
          width={innerW()}
          height={barInner()}
          background={def().titleFill === "gray25" && chromeOn() ? "gray25" : 0}
        >
          {/* Title drag region — MUST be first (lowest hit priority) so that
              close/zoom boxes (rendered later) take precedence on click */}
          <box
            position="absolute"
            left={0}
            top={0}
            width={innerW()}
            height={barInner()}
            semantic={{ name: "titlebar", role: "titlebar" }}
            onMouseDown={(lx, ly) => {
              // The bar sits inside the frame; measure from the window's corner.
              dragOffsetX = lx + windowOuterFrame(props.win);
              dragOffsetY = ly + windowOuterFrame(props.win);
            }}
            onDrag={(_lx, _ly, gx, gy) => {
              if (props.win.movable === false) return;
              const { width } = props.win;
              // Like DragWindow, pin the pointer — not the window — to the desktop
              // inset by 4px, so a window can slide off any edge as long as the
              // spot it was grabbed by stays on screen. At most the window's top
              // frame line goes under the menu bar, sharing its bottom border.
              const px = Math.max(DRAG_INSET, Math.min(gx, os.resolution.width - DRAG_INSET));
              const py = Math.max(os.menubarHeight + DRAG_INSET, Math.min(gy, os.resolution.height - DRAG_INSET));
              const newX = px - dragOffsetX;
              const newY = Math.max(os.menubarHeight - FRAME, py - dragOffsetY);
              setWindowOutline({ x: newX, y: newY, width, height: totalH() });
            }}
            onDragEnd={() => {
              const outline = getWindowOutline();
              if (outline) {
                updateOSWindow(props.win.id, { x: outline.x, y: outline.y });
              }
              setWindowOutline(null);
            }}
          />

          {/* Title bar separator line */}
          <box
            position="absolute"
            left={0}
            top={barInner() - 1}
            width={innerW()}
            height={1}
            background={1}
          />

          {/* Active chrome. A palette uses this while its app is front, stripes only on documents. */}
          <Show when={chromeOn()}>
            {/* Six 1px rules, not a screen-aligned `hstripe` fill: QuickDraw
                patterns tile in screen space, so an 11px band would show 5
                or 6 lines depending on window Y. Classic WDEFs drew fixed
                lines. Utility windows use 25% gray instead. */}
            <Show when={def().titleFill === "stripes"}>
            <For each={TITLE_BAR_STRIPE_ROWS}>
              {(row) => (
                <box
                  position="absolute"
                  left={0}
                  top={closeTop() + row}
                  width={innerW()}
                  height={1}
                  background={1}
                />
              )}
            </For>
            </Show>

            {/* Close box — white clearance, then sprite */}
            <Show when={def().closeBox}>
            <box
              position="absolute"
              left={closeX - 1}
              top={closeTop() - 1}
              width={CLOSE_SIZE + 2}
              height={CLOSE_SIZE + 2}
              background={0}
            />
            <Show
              when={closeSprite()}
              fallback={
                <box
                  position="absolute"
                  left={closeX}
                  top={closeTop()}
                  width={CLOSE_SIZE}
                  height={CLOSE_SIZE}
                  borderColor={1}
                  borderWidth={1}
                  semantic={{ name: "close", role: "button" }}
                  onMouseDown={() => setClosePressed(true)}
                  onMouseUp={(lx, ly) => {
                    const inBox = lx >= 0 && lx < CLOSE_SIZE && ly >= 0 && ly < CLOSE_SIZE;
                    setClosePressed(false);
                    if (inBox) goAway();
                  }}
                />
              }
            >
              {(s) => (
                <image
                  position="absolute"
                  left={closeX}
                  top={closeTop()}
                  width={s().width}
                  height={s().height}
                  src={spriteSrc(s())}
                  semantic={{ name: "close", role: "button" }}
                  onMouseDown={() => setClosePressed(true)}
                  onMouseUp={(lx, ly) => {
                    const inBox = lx >= 0 && lx < CLOSE_SIZE && ly >= 0 && ly < CLOSE_SIZE;
                    setClosePressed(false);
                    if (inBox) goAway();
                  }}
                />
              )}
            </Show>
            </Show>

            {/* Zoom box */}
            <Show when={hasZoomBox(props.win)}>
            <box
              position="absolute"
              left={zoomX() - 1}
              top={zoomY - 1}
              width={ZOOM_SIZE + 2}
              height={ZOOM_SIZE + 2}
              background={0}
            />
            <Show
              when={zoomSprite()}
              fallback={
                <box
                  position="absolute"
                  left={zoomX()}
                  top={zoomY}
                  width={ZOOM_SIZE}
                  height={ZOOM_SIZE}
                  borderColor={1}
                  borderWidth={1}
                  semantic={{ name: "zoom", role: "button" }}
                  onMouseDown={() => setZoomPressed(true)}
                  onMouseUp={() => {
                    setZoomPressed(false);
                    toggleZoom(props.win);
                  }}
                />
              }
            >
              {(s) => (
                <image
                  position="absolute"
                  left={zoomX()}
                  top={zoomY}
                  width={s().width}
                  height={s().height}
                  src={spriteSrc(s())}
                  semantic={{ name: "zoom", role: "button" }}
                  onMouseDown={() => setZoomPressed(true)}
                  onMouseUp={() => {
                    setZoomPressed(false);
                    toggleZoom(props.win);
                  }}
                />
              )}
            </Show>
            </Show>

            {/* White clearance behind title text (titleW + 8, as in the original) */}
            <Show when={props.win.title}>
            <box
              position="absolute"
              left={titleX() - 4}
              top={0}
              width={titleW() + 8}
              height={barInner() - 1}
              background={0}
            />
            </Show>
          </Show>

          {/* Title text — optical middle (cap box), not the full Decker cell, centered
              above the separator line. Untitled palettes omit it. */}
          <Show when={props.win.title}>
          <text
            position="absolute"
            left={0}
            top={0}
            width={innerW()}
            height={barInner() - 1}
            font="menu"
            align="center"
            verticalAlign="middle"
            nowrap
          >
            {titlePending() ? `${props.win.title}…` : props.win.title}
          </text>
          </Show>
        </box>
        </Show>

        {/* ── Scrollable body ───────────────────────────────────── */}
        <box
          position="absolute"
          left={0}
          top={headerInnerH()}
          width={contentW()}
          height={props.win.height}
          overflow="scroll"
          overlayBounds
          scrollOffset={Math.min(props.win.scrollY, maxScrollY())}
          scrollOffsetX={scrollX()}
          onScroll={(dy) => {
            updateOSWindow(props.win.id, { scrollY: Math.max(0, Math.min(maxScrollY(), props.win.scrollY + dy)) });
          }}
          onScrollX={(dx) => scrollXBy(dx)}
        >
          <WindowContent
            win={props.win}
            slots={{
              setHeader: (view, height) => {
                setHeaderView((prev) => (view === null ? null : (prev ?? view)));
                applyBandHeight("headerHeight", height);
              },
              setFooter: (view, height) => {
                setFooterView((prev) => (view === null ? null : (prev ?? view)));
                applyBandHeight("footerHeight", height);
              },
            }}
          />
        </box>

        {/* Header after the body so it wins hit-testing if the two overlap. */}
        <Show when={bandH() > 0}>
          <box
            position="absolute"
            left={0}
            top={barInner()}
            width={innerW()}
            height={bandH()}
            background={0}
          >
            <Show when={headerView()} fallback={<DefaultInfoBar win={props.win} />}>
              {(view) => view()()}
            </Show>
            <box
              position="absolute"
              left={0}
              top={bandH() - 1}
              width={innerW()}
              height={1}
              background={1}
            />
          </box>
        </Show>

        {/* ── Footer band (WindowFooter) ────────────────────────── */}
        <Show when={footH() > 0}>
          <box
            position="absolute"
            left={0}
            top={headerInnerH() + props.win.height}
            width={innerW()}
            height={footH()}
            background={0}
          >
            <box position="absolute" left={0} top={0} width={innerW()} height={1} background={1} />
            <Show when={footerView()}>
              {(view) => view()()}
            </Show>
          </box>
        </Show>

        {/* ── Vertical scrollbar ────────────────────────────────── */}
        {/* The band is SB_W wide including the frame line; its 16px sprites
            overlap the frame by one column and are clipped by it. */}
        <Show when={props.win.scrollable}>
          <box
            position="absolute"
            left={innerW() - SB_INNER}
            top={sbTop()}
            width={SB_W}
            height={scrollableBodyH()}
            background={0}
          >
            {/* Separator between content and scrollbar */}
            <box position="absolute" left={0} top={0} width={1} height={scrollableBodyH()} background={1} />

            {/* Up arrow */}
            <ChromeButton
              sprite={os.sprites.get("chrome/up")}
              left={0}
              top={0}
              size={SB_W}
              onClick={() =>
                updateOSWindow(props.win.id, {
                  scrollY: Math.max(0, props.win.scrollY - 16),
                })
              }
            />

            {/* Track and thumb */}
            <Show when={maxScrollY() > 0}>
              <box
                position="absolute"
                left={1}
                top={vTrackTop}
                width={SB_W - 2}
                height={vTrackH()}
                background="gray25"
              />
              <box
                position="absolute"
                left={1}
                top={thumbY()}
                width={SB_W - 2}
                height={thumbH()}
                background={0}
                borderColor={1}
                borderWidth={1}
                onDrag={(_lx, _ly, gx, gy) => handleThumbDrag(gx, gy)}
              />
            </Show>

            {/* Down arrow */}
            <ChromeButton
              sprite={os.sprites.get("chrome/down")}
              left={0}
              top={scrollableBodyH() - SB_W}
              size={SB_W}
              onClick={() =>
                updateOSWindow(props.win.id, {
                  scrollY: Math.min(maxScrollY(), props.win.scrollY + 16),
                })
              }
            />
          </box>
        </Show>

        {/* ── Horizontal scrollbar ──────────────────────────────── */}
        {/* The left arrow's edge is the frame; the right arrow's is the
            vertical bar's separator. */}
        <Show when={props.win.scrollable}>
          <box
            position="absolute"
            left={0}
            top={hBarTop()}
            width={contentW()}
            height={SB_W}
            background={0}
          >
            <box position="absolute" left={0} top={0} width={contentW()} height={1} background={1} />
            <ChromeButton
              sprite={os.sprites.get("chrome/left")}
              left={-FRAME}
              top={0}
              size={SB_W}
              onClick={() => scrollXBy(-16)}
            />
            <Show when={maxScrollX() > 0}>
              <box
                position="absolute"
                left={hTrackLeft}
                top={1}
                width={hTrackW()}
                height={SB_W - 2}
                background="gray25"
              />
              <box
                position="absolute"
                left={hThumbX()}
                top={1}
                width={hThumbW()}
                height={SB_W - 2}
                background={0}
                borderColor={1}
                borderWidth={1}
                onDrag={(_lx, _ly, gx) => handleHThumbDrag(gx)}
              />
            </Show>
            <ChromeButton
              sprite={os.sprites.get("chrome/right")}
              left={contentW() - SB_INNER}
              top={0}
              size={SB_W}
              onClick={() => scrollXBy(16)}
            />
          </box>
        </Show>

        {/* ── Corner where the scroll bars meet, without a grow box ── */}
        <Show when={props.win.scrollable && !hasGrowBox(props.win)}>
          <box
            position="absolute"
            left={innerW() - SB_INNER}
            top={hBarTop()}
            width={SB_W}
            height={SB_W}
            background={0}
            borderColor={1}
            borderWidth={1}
          />
        </Show>

        {/* ── Empty scroll-bar band for the grow box ─────────────── */}
        {/* A resizable window without scroll bars, as DrawGrowIcon drew it:
            the band runs beside the body, and a footer keeps its full width. */}
        <Show when={hasGrowBand(props.win)}>
          <box
            position="absolute"
            left={innerW() - SB_INNER}
            top={headerInnerH()}
            width={SB_W}
            height={props.win.height}
            background={0}
          >
            <box position="absolute" left={0} top={0} width={1} height={props.win.height} background={1} />
          </box>
        </Show>

        {/* ── Grow box ──────────────────────────────────────────── */}
        <Show when={hasGrowBox(props.win)}>
          <ChromeButton
            sprite={os.sprites.get("chrome/resize")}
            left={innerW() - SB_INNER}
            top={innerH() - SB_INNER}
            size={GROW_SIZE}
            onMouseDown={(lx, ly) => {
              resizeOffsetX = GROW_SIZE - lx;
              resizeOffsetY = GROW_SIZE - ly;
            }}
            onDrag={(_lx, _ly, gx, gy) => {
              const MIN_W = props.win.minWidth  ?? 100;
              const MIN_H = props.win.minHeight ?? 60;
              const newW = Math.max(MIN_W, gx + resizeOffsetX - props.win.x);
              const newTotalH = Math.max(MIN_H + headerH(), gy + resizeOffsetY - props.win.y);
              setWindowOutline({
                x: props.win.x,
                y: props.win.y,
                width: newW,
                height: newTotalH,
              });
            }}
            onDragEnd={() => {
              const outline = getWindowOutline();
              if (outline) {
                const MIN_H = props.win.minHeight ?? 60;
                const newH = outline.height - headerH() - footH() - (props.win.scrollable ? SB_W : frame());
                updateOSWindow(props.win.id, {
                  width: outline.width,
                  height: Math.max(MIN_H, newH),
                });
              }
              setWindowOutline(null);
            }}
          />
        </Show>
      </box>
    </box>
    </Show>
  );
}

// ---------------------------------------------------------------------------
// ChromeButton — a square chrome control drawn from a sprite that carries its
// own border. Falls back to a plain bordered box when the sprite is missing.
// ---------------------------------------------------------------------------

interface ChromeButtonProps {
  sprite: ReturnType<ReturnType<typeof useOS>["sprites"]["get"]>;
  left: number;
  top: number;
  size: number;
  onClick?: () => void;
  onMouseDown?: (lx: number, ly: number) => void;
  onDrag?: (lx: number, ly: number, gx: number, gy: number) => void;
  onDragEnd?: () => void;
}

function ChromeButton(props: ChromeButtonProps): JSX.Element {
  return (
    <Show
      when={props.sprite}
      fallback={
        <box
          position="absolute"
          left={props.left}
          top={props.top}
          width={props.size}
          height={props.size}
          background={0}
          borderColor={1}
          borderWidth={1}
          onClick={props.onClick}
          onMouseDown={props.onMouseDown}
          onDrag={props.onDrag}
          onDragEnd={props.onDragEnd}
        />
      }
    >
      {(s) => (
        <image
          position="absolute"
          left={props.left}
          top={props.top}
          width={props.size}
          height={props.size}
          src={{ width: s().width, height: s().height, data: s().data, mask: s().mask }}
          onClick={props.onClick}
          onMouseDown={props.onMouseDown}
          onDrag={props.onDrag}
          onDragEnd={props.onDragEnd}
        />
      )}
    </Show>
  );
}

// ---------------------------------------------------------------------------
// WindowContent — dispatches to the right content component by window kind
// ---------------------------------------------------------------------------

function toggleZoom(win: OSWindow): void {
  const standard = win.standardBounds ?? {
    x: 3,
    y: 23,
    width: 506,
    height: 296,
  };
  const atStandard =
    win.x === standard.x &&
    win.y === standard.y &&
    win.width === standard.width &&
    win.height === standard.height;
  if (atStandard && win.userBounds) {
    updateOSWindow(win.id, win.userBounds);
  } else {
    updateOSWindow(win.id, {
      userBounds: { x: win.x, y: win.y, width: win.width, height: win.height },
      x: standard.x,
      y: standard.y,
      width: standard.width,
      height: standard.height,
    });
  }
}

function DefaultInfoBar(props: { win: OSWindow }): JSX.Element {
  return (
    <text
      position="absolute"
      left={4}
      top={0}
      width="100%"
      height="100%"
      font="menu"
      verticalAlign="middle"
      nowrap
    >
      {(props.win.infoBar ?? []).join("   ")}
    </text>
  );
}

/** The app's subtree, in a root the OS disposes before the window (see `windowContent.ts`). */
function WindowContentRoot(props: {
  windowId: string;
  onCleanupError(error: unknown): void;
  children: JSX.Element;
}): JSX.Element {
  return mountWindowContent(props.windowId, () => props.children, props.onCleanupError);
}

function WindowContent(props: {
  win: OSWindow;
  slots: import("@mockintosh/sdk").WindowSlots;
}): JSX.Element {
  const os = useOS();
  const windowId = props.win.id;
  /** The window's own component when it was opened with one, else its app's main component. */
  const component = () => props.win.Component ?? getApp(props.win.appId)?.Component;
  const modalFront = () => isBlockedByModal(props.win, getWindows());

  const api: WindowAPI = {
    id: windowId,
    win: props.win,
    width: () => windowContentWidth(props.win),
    height: () => props.win.height,
    isActive: () => getActiveWindowId() === windowId,
    scrollY: () => props.win.scrollY,
    scrollTo: (y) => updateOSWindow(windowId, { scrollY: Math.max(0, Math.round(y)) }),
    kind: () => props.win.kind,
    setTitle: (title) => updateOSWindow(windowId, { title }),
    setContentSize: (width, height) =>
      updateOSWindow(windowId, { contentWidth: width, contentHeight: height }),
    setInfoBar: (items) => updateOSWindow(windowId, { infoBar: items ?? undefined }),
    setMenus: (menus) => updateOSWindow(windowId, { menus }),
    setFullScreen: (on) => setWindowFullScreen(windowId, on, os.resolution),
    close: () => os.closeWindow(windowId),
  };

  // SDK-facing services for this window: the app context plus the window.
  // Provided via context so every window's components see their own instance.
  const services: AppServices = {
    ...createAppContext(os, props.win.appId, {instanceId: props.win.instanceId}),
    window: {
      id: api.id,
      width: api.width,
      height: api.height,
      isActive: api.isActive,
      scrollY: api.scrollY,
      scrollTo: api.scrollTo,
      // The shell's kinds are the SDK's plus `finder-folder`, a document window.
      kind: () => (props.win.kind === "finder-folder" ? "document" : props.win.kind),
      setTitle: api.setTitle,
      setContentSize: api.setContentSize,
      setFullScreen: api.setFullScreen,
      close: api.close,
    },
    setMenus: api.setMenus,
  };

  return (
    <WindowCtx value={api}>
      <AppServicesContext value={services}>
      <WindowSlotsContext value={props.slots}>
      <box width="100%" height="100%" inert={modalFront()}>
        <WindowContentRoot
          windowId={windowId}
          onCleanupError={(error) => {
            console.error(`${props.win.appId}: a cleanup threw while its window closed`, error);
            if (props.win.instanceId) os.instances?.note(props.win.instanceId, error, "cleanup");
          }}
        >
          <Errored fallback={error => {
            const err = error();
            if (props.win.instanceId) os.instances?.fail(props.win.instanceId, err);
            return <text wrap>{`Application failed: ${String(err)}`}</text>;
          }}>
          <Loading fallback={<box width="100%" height="100%" background={0} />}>
          <Show when={component()} keyed>
            {(Comp) => <Comp {...props.win.props} />}
          </Show>
          </Loading>
          </Errored>
        </WindowContentRoot>
      </box>
      </WindowSlotsContext>
      </AppServicesContext>
    </WindowCtx>
  );
}
