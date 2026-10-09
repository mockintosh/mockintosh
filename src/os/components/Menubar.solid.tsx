import { appleMenu, runMenuItem, runRadioItem } from "../kernel/menus";
import { For, Show, createMemo, createSignal } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { measureText, CHECK_MARK, smallIcon, type Sprite } from "@mockintosh/ui";
import { shortcutLabel } from "../shortcuts";
import { getApp } from "../apps";
import { runningAppIds } from "../appSwitcher";
import { useOS } from "../context";
import {
  FINDER_APP_ID,
  activateApp,
  getActiveAppId,
  isAppHidden,
  showAllApps,
  getHighlightedMenuItem,
  getOpenMenuIndex,
  getWindows,
  setHighlightedMenuItem,
  setOpenMenuIndex,
} from "../state";
import type {
  MenubarDefinition,
  MenubarItemDef,
  MenubarActionItem,
  MenubarRadioGroupDef,
  MenubarSubmenuDef,
} from "@mockintosh/sdk";

/** The application menu, on the right. Distinct from the Apple menu (−1). */
const APP_MENU = -2;

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------
// Measured against System 7.5.3. Panel offsets are from the panel's outer
// left edge (its border); rows sit directly inside the border, with no padding.
const MENUBAR_H     = 20;
const TITLE_TOP     = 1;        // a highlighted title leaves the bar's top row white
const TITLE_H       = MENUBAR_H - 1 - TITLE_TOP;
const ITEM_H        = 16;
const ICON_ITEM_H   = 18;       // an application menu row with its 16×16 icon
const SEPARATOR_H   = 16;       // a dotted line through the middle of a blank row
const APPLE_LEFT    = 9;        // the Apple menu's title starts in from the screen's left edge
const APPLE_W       = 24;       // the part of the Apple title that answers the mouse
const APPLE_HILITE_W = 29;      // its highlight, x 9–37
const APPLE_INK     = { x: 10, y: 2 };  // the logo inside the Apple title
const TITLE_EXTRA   = 13;       // a title answers the mouse over its text's width plus this
const TITLE_TEXT_X  = 10;       // the text inside a title
// A highlight is wider than the part of the title that answers the mouse: it
// spills into the next title. File's highlight is x 33–74, but Edit answers
// from x 69, so the last black pixels of File pull down Edit.
const HILITE_AFTER  = 6;
const MENU_FONT     = "menu";
const MARK_X        = 4;        // check mark
const TEXT_X        = 16;       // label, past the mark column
const ICON_X        = 15;       // application menu icon
const ICON_TEXT_X   = 36;       // application menu label, past the icon
const RIGHT_PAD     = 7;        // from the widest row's advance to the panel's outer right edge
const APP_RIGHT_PAD = 9;        // the same, in the application menu
const SHADOW_INSET  = 3;        // the 1px shadow starts this far along from the panel's corners
const SMALL_ICON    = 16;       // ics# — what the application menu shows
const SWITCHER_W    = 34;       // the application menu's title: icon plus its margins
const SWITCHER_GAP  = 6;        // between the application menu's title and the screen's right edge

interface MenubarProps {
  height: number;
  /** Screen y of the bar. Negative while it is sliding in from above a full-screen window. */
  top: number;
  menus: MenubarDefinition[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function menuTitleWidth(label: string): number {
  return measureText(label, MENU_FONT) + TITLE_EXTRA;
}

/** Outer width: the widest row's end, plus the right margin. */
function menuDropdownWidth(items: MenubarItemDef[]): number {
  let max = 0;
  for (const item of items) {
    if ("label" in item && item.label) {
      const shortcut = "shortcut" in item ? (item as MenubarActionItem).shortcut : undefined;
      const sw = shortcut ? measureText(shortcutLabel(shortcut), MENU_FONT) + 16
        : item.type === "submenu" ? SUBMENU_ARROW.width + 16 : 0;
      max = Math.max(max, TEXT_X + measureText(item.label, MENU_FONT) + sw);
    } else if ((item as MenubarRadioGroupDef).type === "radiogroup") {
      for (const ri of (item as MenubarRadioGroupDef).items) {
        max = Math.max(max, TEXT_X + measureText(ri.label, MENU_FONT));
      }
    }
  }
  return max + RIGHT_PAD;
}

/** Outer height: the rows plus the top and bottom border. */
function menuDropdownHeight(items: MenubarItemDef[]): number {
  let h = 2;
  for (const item of items) {
    if ((item as any).type === "separator") {
      h += SEPARATOR_H;
    } else if ((item as MenubarRadioGroupDef).type === "radiogroup") {
      h += (item as MenubarRadioGroupDef).items.length * ITEM_H;
    } else {
      h += ITEM_H;
    }
  }
  return h;
}

/**
 * The Menu Manager's tracking: a menu is down only while the button is. The
 * row under the pointer arms what letting go will do; letting go anywhere
 * else does nothing but close the menu.
 */
let armed: (() => void) | null = null;

function arm(run: (() => void) | null): void {
  armed = run;
}

/** Cumulative x positions of each menu title. */
function computeMenuXOffsets(menus: MenubarDefinition[]): number[] {
  const xs: number[] = [];
  let x = APPLE_LEFT + APPLE_W;
  for (const menu of menus) {
    xs.push(x);
    x += menuTitleWidth(menu.label);
  }
  return xs;
}

// ---------------------------------------------------------------------------
// Apple menu items (static — not part of the per-app menu set)
// ---------------------------------------------------------------------------

export function Menubar(props: MenubarProps): JSX.Element {
  const os = useOS();

  const menuXOffsets = createMemo(() => computeMenuXOffsets(props.menus));

  const running = createMemo(() =>
    runningAppIds(getWindows(), FINDER_APP_ID).map((id) => {
      const app = getApp(id);
      const sprite = os.sprites.get(app?.smallIcon ?? app?.icon ?? "");
      return {
        id,
        title: app?.title ?? (id === FINDER_APP_ID ? "Finder" : id),
        icon: sprite ? smallIcon(sprite) : undefined,
      };
    }),
  );
  const activeIcon = () => running().find((app) => app.id === getActiveAppId())?.icon;
  const switcherX = () => os.resolution.width - SWITCHER_GAP - SWITCHER_W;

  const openIdx   = () => getOpenMenuIndex();
  const openMenu  = () => {
    const idx = openIdx();
    if (idx === -1) return appleMenu(os);
    if (idx === APP_MENU) return null;
    return idx !== null ? props.menus[idx] ?? null : null;
  };
  const openMenuX = () => {
    const idx = openIdx();
    if (idx === -1) return APPLE_LEFT;
    if (idx === APP_MENU) return switcherX();
    return idx !== null ? menuXOffsets()[idx] ?? 0 : 0;
  };

  function pullDown(idx: number) {
    if (openIdx() === idx) return;
    arm(null);
    setOpenMenuIndex(idx);
    setHighlightedMenuItem(null);
  }

  /** Sliding onto another title while the button is down pulls that menu down instead. */
  function slideOnto(idx: number) {
    if (openIdx() !== null) pullDown(idx);
  }

  function closeMenu() {
    arm(null);
    setOpenMenuIndex(null);
    setHighlightedMenuItem(null);
  }

  /** The button came up: the press began on a title, so it gets the release wherever it is. */
  function release() {
    const run = armed;
    closeMenu();
    run?.();
  }

  /** Handlers every title shares: press to pull down, slide across, let go to choose. */
  const titleHandlers = (idx: number) => ({
    onMouseDown: () => pullDown(idx),
    onMouseEnter: () => slideOnto(idx),
    onMouseUp: release,
  });

  /** The highlight behind an open title: its hit rect, widened into the next title. */
  const hilite = () => {
    const idx = openIdx();
    if (idx === null || idx === APP_MENU) return null;
    if (idx === -1) return { left: APPLE_LEFT, width: APPLE_HILITE_W };
    const left = menuXOffsets()[idx];
    const menu = props.menus[idx];
    if (left === undefined || !menu) return null;
    return { left, width: menuTitleWidth(menu.label) + HILITE_AFTER };
  };

  function runItem(item: MenubarActionItem) {
    closeMenu();
    if (!item.disabled && item.onClick) runMenuItem(item);
  }

  const appleSprite = os.sprites.get("eaten_apple");

  return (
    <box
      position="absolute"
      left={0}
      top={props.top}
      width={os.resolution.width}
      height={MENUBAR_H}
      background={0}
      keepsFocus
    >
      {/* Bottom border */}
      <box
        position="absolute"
        left={0}
        top={MENUBAR_H - 1}
        width={os.resolution.width}
        height={1}
        background={1}
      />

      {/* An open title's highlight, under every title so it can spill into the next one. */}
      <Show when={hilite()}>
        {(h) => (
          <box position="absolute" left={h().left} top={TITLE_TOP} width={h().width} height={TITLE_H} background={1} />
        )}
      </Show>

      {/* Apple menu */}
      <box
        position="absolute"
        left={APPLE_LEFT}
        top={TITLE_TOP}
        width={APPLE_W}
        height={TITLE_H}
        semantic={{ name: "Apple", role: "menu" }}
        {...titleHandlers(-1)}
      >
        <Show
          when={appleSprite}
          fallback={
            <text font="menu" nowrap color={openIdx() === -1 ? 0 : 1} verticalAlign="middle">
              {"\uF8FF"}
            </text>
          }
        >
          {(s) => (
            <image
              position="absolute"
              left={APPLE_INK.x}
              top={APPLE_INK.y}
              width={s().width}
              height={s().height}
              src={{ width: s().width, height: s().height, data: s().data, mask: s().mask }}
              mode={openIdx() === -1 ? "inverted" : "normal"}
            />
          )}
        </Show>
      </box>

      {/* Menu titles */}
      <For each={props.menus}>
        {(menu, idx) => {
          const isOpen = () => openIdx() === idx();
          return (
            <box
              position="absolute"
              left={menuXOffsets()[idx()]}
              top={TITLE_TOP}
              width={menuTitleWidth(menu.label)}
              height={TITLE_H}
              paddingLeft={TITLE_TEXT_X}
              justifyContent="center"
              semantic={{ name: menu.label, role: "menu" }}
              onMouseDown={() => pullDown(idx())}
              onMouseEnter={() => slideOnto(idx())}
              onMouseUp={release}
            >
              <text
                font={MENU_FONT}
                verticalAlign="middle"
                color={isOpen() ? 0 : 1}
                nowrap
              >
                {menu.label}
              </text>
            </box>
          );
        }}
        </For>

      {/* Application menu — the front app's 16×16 icon, at the right end. */}
      <box
        position="absolute"
        left={switcherX()}
        top={TITLE_TOP}
        width={SWITCHER_W}
        height={TITLE_H}
        justifyContent="center"
        alignItems="center"
        background={openIdx() === APP_MENU ? 1 : undefined}
        semantic={{ name: "Application", role: "menu" }}
        {...titleHandlers(APP_MENU)}
      >
        <Show when={activeIcon()}>
          {(icon) => (
            <image
              width={SMALL_ICON}
              height={SMALL_ICON}
              src={spriteSrc(icon())}
              mode={openIdx() === APP_MENU ? "inverted" : "normal"}
            />
          )}
        </Show>
      </box>

      <Show when={openIdx() === APP_MENU}>
        <AppMenuDropdown
          apps={running()}
          activeId={getActiveAppId()}
          right={switcherX() + SWITCHER_W}
          onHide={(ids) => os.hideApps(ids, { x: switcherX(), y: TITLE_TOP, width: SWITCHER_W, height: TITLE_H })}
          onClose={closeMenu}
          onChoose={(id) => {
            closeMenu();
            activateApp(id);
          }}
        />
      </Show>

      {/* Open dropdown */}
      <Show when={openMenu() !== null && openIdx() !== null}>
        <MenuDropdown
          menu={openMenu()!}
          x={openMenuX()}
          onClose={closeMenu}
          onRun={runItem}
          screenWidth={os.resolution.width}
          screenBottom={os.resolution.height - props.top}
        />
      </Show>
    </box>
  );
}

// ---------------------------------------------------------------------------
// MenuDropdown
// ---------------------------------------------------------------------------

interface MenuDropdownProps {
  menu: MenubarDefinition;
  x: number;
  screenWidth: number;
  /** Bottom of the screen in menubar coordinates. */
  screenBottom: number;
  onClose: () => void;
  onRun: (item: MenubarActionItem) => void;
}

function MenuDropdown(props: MenuDropdownProps): JSX.Element {
  // Prevent dropdown from going off the right edge
  const left = () => Math.min(props.x, props.screenWidth - menuDropdownWidth(props.menu.items) - 4);

  return (
    <>
      <Show when={props.menu} keyed>
        {(menu) => (
          <MenuPanel
            items={menu.items}
            left={left()}
            top={MENUBAR_H - 1}
            screenWidth={props.screenWidth}
            screenBottom={props.screenBottom}
            highlighted={getHighlightedMenuItem}
            setHighlighted={setHighlightedMenuItem}
            onClose={props.onClose}
            onRun={props.onRun}
          />
        )}
      </Show>
    </>
  );
}

// ---------------------------------------------------------------------------
// MenuPanel — one box of items; submenus open another panel beside it
// ---------------------------------------------------------------------------

interface MenuPanelProps {
  items: MenubarItemDef[];
  left: number;
  top: number;
  screenWidth: number;
  screenBottom: number;
  /** Index of the highlighted row among the panel's selectable rows. */
  highlighted: () => number | null;
  setHighlighted: (index: number | null) => void;
  onClose: () => void;
  onRun: (item: MenubarActionItem) => void;
}

interface OpenSubmenu {
  row: number;
  item: MenubarSubmenuDef;
  left: number;
  top: number;
}

function MenuPanel(props: MenuPanelProps): JSX.Element {
  const w = menuDropdownWidth(props.items);
  const h = menuDropdownHeight(props.items);
  // A panel that would run off the bottom slides up, but never over the menubar.
  const top = Math.max(MENUBAR_H - 1, Math.min(props.top, props.screenBottom - h));
  const left = props.left;

  const highlighted = props.highlighted;
  const [submenu, setSubmenu] = createSignal<OpenSubmenu | null>(null);
  const [subHighlight, setSubHighlight] = createSignal<number | null>(null);

  function openSubmenu(row: number, item: MenubarSubmenuDef, rowTop: number): void {
    if (submenu()?.row === row) return;
    const subW = menuDropdownWidth(item.items);
    // Beside the item, overlapping the border; flipped left when there's no room.
    const right = left + w - 1;
    setSubHighlight(null);
    setSubmenu({
      row,
      item,
      left: right + subW <= props.screenWidth ? right : Math.max(0, left - subW + 1),
      top: top + rowTop,
    });
  }

  function enterRow(row: number): void {
    if (submenu()?.row !== row) setSubmenu(null);
    props.setHighlighted(row);
  }

  let itemIndex = 0;
  const itemNodes: JSX.Element[] = [];
  // Rows are laid out inside the border, so they are 2px narrower than the panel
  // and every x is one less than its offset from the panel's outer edge.
  const rowW = w - 2;
  const labelLeft = TEXT_X - 1;
  const markLeft = MARK_X - 1;

  let yOffset = 0;
  for (let i = 0; i < props.items.length; i++) {
    const item = props.items[i];

    if (item.type === "submenu") {
      const sub = item;
      const yTop = yOffset;
      const idxSelf = itemIndex++;
      // Stays lit while its submenu is open, even with the pointer inside that.
      const isHighlighted = () => !sub.disabled && (highlighted() === idxSelf || submenu()?.row === idxSelf);
      const ink = () => (isHighlighted() ? 0 : 1);
      itemNodes.push(
        <box
          position="absolute"
          left={0}
          top={yTop}
          width={rowW}
          height={ITEM_H}
          background={isHighlighted() ? 1 : 0}
          semantic={{ name: sub.label, role: "menu" }}
          onMouseEnter={() => {
            arm(null);
            if (sub.disabled) return;
            enterRow(idxSelf);
            openSubmenu(idxSelf, sub, yTop);
          }}
          onMouseLeave={() => props.setHighlighted(null)}
          onClick={() => { if (!sub.disabled) openSubmenu(idxSelf, sub, yTop); }}
        >
          <box position="absolute" left={labelLeft} top={0} width={rowW - labelLeft} height={ITEM_H} justifyContent="center">
            <text font={MENU_FONT} nowrap color={ink()} stipple={sub.disabled} verticalAlign="middle">
              {sub.label}
            </text>
          </box>
          <SubmenuArrow left={rowW - 8 - SUBMENU_ARROW.width} ink={ink()} />
        </box>
      );
      yOffset += ITEM_H;
    } else if (item.type === "separator") {
      itemNodes.push(
        <box
          position="absolute"
          left={0}
          top={yOffset + SEPARATOR_H / 2}
          width={rowW}
          height={1}
          background="checker"
        />
      );
      yOffset += SEPARATOR_H;
    } else if ((item as MenubarRadioGroupDef).type === "radiogroup") {
      const rg = item as MenubarRadioGroupDef;
      for (const ri of rg.items) {
        const riSelf = ri;
        const yTop = yOffset;
        const idxSelf = itemIndex++;
        const isHighlighted = () => highlighted() === idxSelf;
        itemNodes.push(
          <box
            position="absolute"
            left={0}
            top={yTop}
            width={rowW}
            height={ITEM_H}
            background={isHighlighted() ? 1 : 0}
            onMouseEnter={() => {
              enterRow(idxSelf);
              arm(() => runRadioItem(rg, riSelf.value));
            }}
            onMouseLeave={() => {
              props.setHighlighted(null);
              arm(null);
            }}
            onClick={() => {
              props.onClose();
              runRadioItem(rg, riSelf.value);
            }}
          >
            <Show when={riSelf.value === rg.value}>
              <box position="absolute" left={markLeft} top={0} width={labelLeft - markLeft} height={ITEM_H} justifyContent="center">
                <text font={MENU_FONT} nowrap color={isHighlighted() ? 0 : 1} verticalAlign="middle">
                  {CHECK_MARK}
                </text>
              </box>
            </Show>
            <box
              position="absolute"
              left={labelLeft}
              top={0}
              width={rowW - labelLeft}
              height={ITEM_H}
              justifyContent="center"
            >
              <text font={MENU_FONT} nowrap color={isHighlighted() ? 0 : 1} verticalAlign="middle">
                {riSelf.label}
              </text>
            </box>
          </box>
        );
        yOffset += ITEM_H;
      }
    } else {
      const ai = item as MenubarActionItem;
      const yTop = yOffset;
      const idxSelf = itemIndex++;
      const isHighlighted = () => highlighted() === idxSelf;
      itemNodes.push(
        <box
          position="absolute"
          left={0}
          top={yTop}
          width={rowW}
          height={ITEM_H}
          background={isHighlighted() && !ai.disabled ? 1 : 0}
          onMouseEnter={() => {
            if (ai.disabled) setSubmenu(null);
            else enterRow(idxSelf);
            arm(ai.disabled ? null : () => props.onRun(ai));
          }}
          onMouseLeave={() => {
            props.setHighlighted(null);
            arm(null);
          }}
          onClick={() => { if (!ai.disabled) props.onRun(ai); }}
        >
          <Show when={ai.checked}>
            <box position="absolute" left={markLeft} top={0} width={labelLeft - markLeft} height={ITEM_H} justifyContent="center">
              <text font={MENU_FONT} nowrap color={isHighlighted() && !ai.disabled ? 0 : 1}
                stipple={ai.disabled} verticalAlign="middle">
                {CHECK_MARK}
              </text>
            </box>
          </Show>
          <box position="absolute" left={labelLeft} top={0} width={rowW - labelLeft} height={ITEM_H} justifyContent="center">
            <text font={MENU_FONT} nowrap color={isHighlighted() && !ai.disabled ? 0 : 1}
              stipple={ai.disabled} verticalAlign="middle">
              {ai.label}
            </text>
          </box>
          <Show when={ai.shortcut}>
            {(shortcut) => {
              const label = shortcutLabel(shortcut());
              const width = Math.max(36, measureText(label, MENU_FONT));
              return (
                <box position="absolute" left={rowW - 4 - width} top={0} width={width} height={ITEM_H} justifyContent="center">
                  <text font={MENU_FONT} nowrap align="right" verticalAlign="middle"
                    color={isHighlighted() && !ai.disabled ? 0 : 1} stipple={ai.disabled}>
                    {label}
                  </text>
                </box>
              );
            }}
          </Show>
        </box>
      );
      yOffset += ITEM_H;
    }
  }

  return (
    <>
      <box
        position="absolute"
        left={left}
        top={top}
        width={w}
        height={h}
        background={0}
        borderColor={1}
        borderWidth={1}
      >
        {itemNodes}
      </box>
      <MenuShadow left={left} top={top} width={w} height={h} />
      <Show when={submenu()} keyed>
        {(open) => (
          <MenuPanel
            items={open.item.items}
            left={open.left}
            top={open.top}
            screenWidth={props.screenWidth}
            screenBottom={props.screenBottom}
            highlighted={subHighlight}
            setHighlighted={setSubHighlight}
            onClose={props.onClose}
            onRun={props.onRun}
          />
        )}
      </Show>
    </>
  );
}

const SUBMENU_ARROW = { width: 4, height: 7 };

/** The ▸ on a submenu item: a solid triangle, drawn rather than taken from the font. */
function SubmenuArrow(props: { left: number; ink: 0 | 1 }): JSX.Element {
  const top = Math.floor((ITEM_H - SUBMENU_ARROW.height) / 2);
  return (
    <For each={Array.from({ length: SUBMENU_ARROW.width }, (_, k) => k)}>
      {(k) => (
        <box
          position="absolute"
          left={props.left + k}
          top={top + k}
          width={1}
          height={SUBMENU_ARROW.height - 2 * k}
          background={props.ink}
        />
      )}
    </For>
  );
}

function spriteSrc(sprite: Sprite) {
  return { width: sprite.width, height: sprite.height, data: sprite.data, mask: sprite.mask };
}

interface AppMenuEntry {
  id: string;
  title: string;
  icon?: Sprite;
}

/** The 1px drop shadow along a panel's right and bottom edges, starting a few pixels in from its corners. */
function MenuShadow(props: { left: number; top: number; width: number; height: number }): JSX.Element {
  return (
    <>
      <box
        position="absolute"
        left={props.left + props.width}
        top={props.top + SHADOW_INSET}
        width={1}
        height={props.height - SHADOW_INSET + 1}
        background={1}
      />
      <box
        position="absolute"
        left={props.left + SHADOW_INSET}
        top={props.top + props.height}
        width={props.width - SHADOW_INSET + 1}
        height={1}
        background={1}
      />
    </>
  );
}

/** A text row of the application menu: Hide, Hide Others, Show All. */
interface AppMenuCommand {
  label: string;
  enabled: boolean;
  run: () => void;
}

function AppMenuDropdown(props: {
  apps: AppMenuEntry[];
  activeId: string;
  /** Screen x just past the application menu's title; the panel's right edge lines up with it. */
  right: number;
  /** Hide these apps, zooming their windows into the menu's title. */
  onHide: (appIds: string[]) => void;
  onClose: () => void;
  onChoose: (id: string) => void;
}): JSX.Element {
  const active = props.apps.find((app) => app.id === props.activeId);
  const others = props.apps.filter((app) => app.id !== props.activeId);
  const commands: AppMenuCommand[] = [
    {
      label: `Hide ${active?.title ?? "Finder"}`,
      // Something else has to be left to come forward.
      enabled: others.some((app) => !isAppHidden(app.id)),
      run: () => props.onHide([props.activeId]),
    },
    {
      label: "Hide Others",
      enabled: others.some((app) => !isAppHidden(app.id)),
      run: () => props.onHide(others.map((app) => app.id)),
    },
    {
      label: "Show All",
      enabled: props.apps.some((app) => isAppHidden(app.id)),
      run: () => showAllApps(),
    },
  ];

  let contentW = 0;
  for (const command of commands) contentW = Math.max(contentW, TEXT_X + measureText(command.label, MENU_FONT));
  for (const app of props.apps) contentW = Math.max(contentW, ICON_TEXT_X + measureText(app.title, MENU_FONT));
  const w = contentW + APP_RIGHT_PAD;
  const rowW = w - 2;
  const appsTop = commands.length * ITEM_H + SEPARATOR_H;
  const h = 2 + appsTop + props.apps.length * ICON_ITEM_H;
  const left = Math.max(0, props.right - w);
  const top = MENUBAR_H - 1;
  const highlighted = getHighlightedMenuItem;

  return (
    <>
      <box
        position="absolute"
        left={left}
        top={top}
        width={w}
        height={h}
        background={0}
        borderColor={1}
        borderWidth={1}
      >
        <For each={commands}>
          {(command, index) => {
            const on = () => command.enabled && highlighted() === index();
            return (
              <box
                position="absolute"
                left={0}
                top={index() * ITEM_H}
                width={rowW}
                height={ITEM_H}
                background={on() ? 1 : 0}
                semantic={{ name: command.label, role: "menuitem" }}
                onMouseEnter={() => {
                  setHighlightedMenuItem(index());
                  arm(command.enabled ? command.run : null);
                }}
                onMouseLeave={() => {
                  setHighlightedMenuItem(null);
                  arm(null);
                }}
                onClick={() => {
                  if (!command.enabled) return;
                  props.onClose();
                  command.run();
                }}
              >
                <box position="absolute" left={TEXT_X - 1} top={0} width={rowW - TEXT_X + 1} height={ITEM_H} justifyContent="center">
                  <text font={MENU_FONT} nowrap color={on() ? 0 : 1} stipple={!command.enabled} verticalAlign="middle">
                    {command.label}
                  </text>
                </box>
              </box>
            );
          }}
        </For>
        <box
          position="absolute"
          left={0}
          top={commands.length * ITEM_H + SEPARATOR_H / 2}
          width={rowW}
          height={1}
          background="checker"
        />
        <For each={props.apps}>
          {(app, index) => {
            const row = () => commands.length + index();
            const on = () => highlighted() === row();
            const ink = () => (on() ? 0 : 1);
            return (
              <box
                position="absolute"
                left={0}
                top={appsTop + index() * ICON_ITEM_H}
                width={rowW}
                height={ICON_ITEM_H}
                background={on() ? 1 : 0}
                semantic={{ name: app.title, role: "menuitem" }}
                onMouseEnter={() => {
                  setHighlightedMenuItem(row());
                  arm(() => props.onChoose(app.id));
                }}
                onMouseLeave={() => {
                  setHighlightedMenuItem(null);
                  arm(null);
                }}
                onClick={() => props.onChoose(app.id)}
              >
                <Show when={app.id === props.activeId}>
                  <box position="absolute" left={MARK_X - 1} top={0} width={ICON_X - MARK_X} height={ICON_ITEM_H} justifyContent="center">
                    <text font={MENU_FONT} nowrap color={ink()} verticalAlign="middle">{CHECK_MARK}</text>
                  </box>
                </Show>
                <Show when={app.icon}>
                  {(icon) => (
                    <image
                      position="absolute"
                      left={ICON_X - 1}
                      top={1}
                      width={SMALL_ICON}
                      height={SMALL_ICON}
                      src={spriteSrc(icon())}
                      mode={on() ? "inverted" : "normal"}
                    />
                  )}
                </Show>
                <box
                  position="absolute"
                  left={ICON_TEXT_X - 1}
                  top={0}
                  width={rowW - ICON_TEXT_X + 1}
                  height={ICON_ITEM_H}
                  justifyContent="center"
                >
                  <text font={MENU_FONT} nowrap color={ink()} verticalAlign="middle">{app.title}</text>
                </box>
              </box>
            );
          }}
        </For>
      </box>
      <MenuShadow left={left} top={top} width={w} height={h} />
    </>
  );
}
