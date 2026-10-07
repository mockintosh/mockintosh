import { appleMenu, runMenuItem, runRadioItem } from "../kernel/menus";
import { For, Show, createMemo, createSignal } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { measureText, COMMAND_KEY, CHECK_MARK, smallIcon, type Sprite } from "@mockintosh/ui";
import { getApp } from "../apps";
import { runningAppIds } from "../appSwitcher";
import { useOS } from "../context";
import {
  FINDER_APP_ID,
  activateApp,
  getActiveAppId,
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
const MENUBAR_H     = 20;
const ITEM_H        = 16;
const MENU_PADDING  = 4;
const SEPARATOR_H   = 8;
const LABEL_PAD     = 12;   // horizontal padding inside each menu title
const APPLE_W       = 24;   // Apple menu is wider than label alone
const MENU_FONT     = "menu";
const CHECK_COL_W   = 14;       // fixed column for the radio-group check mark so labels align
const SMALL_ICON    = 16;       // ics# — what the application menu shows
const SWITCHER_W    = 26;       // icon plus the gap the menu bar keeps around it

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
  return measureText(label, MENU_FONT) + LABEL_PAD * 2;
}

/** Whether a panel reserves the check column: any radio group or checkable item aligns every label after it. */
function hasCheckColumn(items: MenubarItemDef[]): boolean {
  return items.some(
    (item) => item.type === "radiogroup" || ((item.type ?? "action") === "action" && (item as MenubarActionItem).checked !== undefined),
  );
}

function menuDropdownWidth(items: MenubarItemDef[]): number {
  let max = 80;
  const checkCol = hasCheckColumn(items) ? CHECK_COL_W : 0;
  for (const item of items) {
    if ("label" in item && item.label) {
      const w = measureText(item.label, MENU_FONT) + checkCol;
      const shortcut = "shortcut" in item ? (item as MenubarActionItem).shortcut : undefined;
      const sw = shortcut ? measureText(`${COMMAND_KEY}${shortcut}`, MENU_FONT) + 16
        : item.type === "submenu" ? SUBMENU_ARROW.width + 16 : 0;
      max = Math.max(max, w + sw + 32);
    } else if ((item as MenubarRadioGroupDef).type === "radiogroup") {
      for (const ri of (item as MenubarRadioGroupDef).items) {
        max = Math.max(max, CHECK_COL_W + measureText(ri.label, MENU_FONT) + 32);
      }
    }
  }
  return max;
}

function menuDropdownHeight(items: MenubarItemDef[]): number {
  let h = MENU_PADDING * 2;
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

/** Cumulative x positions of each menu title. */
function computeMenuXOffsets(menus: MenubarDefinition[]): number[] {
  const xs: number[] = [];
  let x = APPLE_W;
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
  const switcherX = () => os.resolution.width - SWITCHER_W;

  const openIdx   = () => getOpenMenuIndex();
  const openMenu  = () => {
    const idx = openIdx();
    if (idx === -1) return appleMenu(os);
    if (idx === APP_MENU) return null;
    return idx !== null ? props.menus[idx] ?? null : null;
  };
  const openMenuX = () => {
    const idx = openIdx();
    if (idx === -1) return 0;
    if (idx === APP_MENU) return switcherX();
    return idx !== null ? menuXOffsets()[idx] ?? 0 : 0;
  };

  function toggleMenu(idx: number) {
    setOpenMenuIndex(openIdx() === idx ? null : idx);
    setHighlightedMenuItem(null);
  }

  function closeMenu() {
    setOpenMenuIndex(null);
    setHighlightedMenuItem(null);
  }

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

      {/* Apple menu */}
      <box
        position="absolute"
        left={0}
        top={0}
        width={APPLE_W}
        height={MENUBAR_H - 1}
        justifyContent="center"
        alignItems="center"
        background={openIdx() === -1 ? 1 : 0}
        semantic={{ name: "Apple", role: "menu" }}
        onClick={() => toggleMenu(-1)}
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
              top={0}
              width={menuTitleWidth(menu.label)}
              height={MENUBAR_H - 1}
              justifyContent="center"
              background={isOpen() ? 1 : 0}
              semantic={{ name: menu.label, role: "menu" }}
              onClick={() => toggleMenu(idx())}
            >
              <text
                font={MENU_FONT}
                align="center"
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
        top={0}
        width={SWITCHER_W}
        height={MENUBAR_H - 1}
        justifyContent="center"
        alignItems="center"
        background={openIdx() === APP_MENU ? 1 : 0}
        semantic={{ name: "Application", role: "menu" }}
        onClick={() => toggleMenu(APP_MENU)}
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
          screenWidth={os.resolution.width}
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
      {/* Background overlay to capture clicks outside the menu and close it */}
      <box
        position="absolute"
        left={0}
        top={0}
        width={10000}
        height={10000}
        onClick={() => props.onClose()}
      />
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
      top: top + rowTop - MENU_PADDING,
    });
  }

  function enterRow(row: number): void {
    if (submenu()?.row !== row) setSubmenu(null);
    props.setHighlighted(row);
  }

  let itemIndex = 0;
  const itemNodes: JSX.Element[] = [];
  const labelLeft = 8 + (hasCheckColumn(props.items) ? CHECK_COL_W : 0);

  let yOffset = MENU_PADDING;
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
          width={w}
          height={ITEM_H}
          background={isHighlighted() ? 1 : 0}
          semantic={{ name: sub.label, role: "menu" }}
          onMouseEnter={() => {
            if (sub.disabled) return;
            enterRow(idxSelf);
            openSubmenu(idxSelf, sub, yTop);
          }}
          onMouseLeave={() => props.setHighlighted(null)}
          onClick={() => { if (!sub.disabled) openSubmenu(idxSelf, sub, yTop); }}
        >
          <box position="absolute" left={labelLeft} top={0} width={w - 8 - labelLeft} height={ITEM_H} justifyContent="center">
            <text font={MENU_FONT} nowrap color={ink()} stipple={sub.disabled} verticalAlign="middle">
              {sub.label}
            </text>
          </box>
          <SubmenuArrow left={w - 8 - SUBMENU_ARROW.width} ink={ink()} />
        </box>
      );
      yOffset += ITEM_H;
    } else if (item.type === "separator") {
      itemNodes.push(
        <box
          position="absolute"
          left={1}
          top={yOffset + SEPARATOR_H / 2}
          width={w - 2}
          height={1}
          background={1}
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
            width={w}
            height={ITEM_H}
            background={isHighlighted() ? 1 : 0}
            onMouseEnter={() => enterRow(idxSelf)}
            onMouseLeave={() => props.setHighlighted(null)}
            onClick={() => {
              props.onClose();
              runRadioItem(rg, riSelf.value);
            }}
          >
            <Show when={riSelf.value === rg.value}>
              <box position="absolute" left={8} top={0} width={CHECK_COL_W} height={ITEM_H} justifyContent="center">
                <text font={MENU_FONT} nowrap color={isHighlighted() ? 0 : 1} verticalAlign="middle">
                  {CHECK_MARK}
                </text>
              </box>
            </Show>
            <box
              position="absolute"
              left={8 + CHECK_COL_W}
              top={0}
              width={w - 16 - CHECK_COL_W}
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
          width={w}
          height={ITEM_H}
          background={isHighlighted() && !ai.disabled ? 1 : 0}
          onMouseEnter={() => {
            if (ai.disabled) setSubmenu(null);
            else enterRow(idxSelf);
          }}
          onMouseLeave={() => props.setHighlighted(null)}
          onClick={() => { if (!ai.disabled) props.onRun(ai); }}
        >
          <Show when={ai.checked}>
            <box position="absolute" left={8} top={0} width={CHECK_COL_W} height={ITEM_H} justifyContent="center">
              <text font={MENU_FONT} nowrap color={isHighlighted() && !ai.disabled ? 0 : 1}
                stipple={ai.disabled} verticalAlign="middle">
                {CHECK_MARK}
              </text>
            </box>
          </Show>
          <box position="absolute" left={labelLeft} top={0} width={w - 8 - labelLeft} height={ITEM_H} justifyContent="center">
            <text font={MENU_FONT} nowrap color={isHighlighted() && !ai.disabled ? 0 : 1}
              stipple={ai.disabled} verticalAlign="middle">
              {ai.label}
            </text>
          </box>
          <Show when={ai.shortcut}>
            <box position="absolute" left={w - 40} top={0} width={36} height={ITEM_H} justifyContent="center">
              <text font={MENU_FONT} nowrap align="right" verticalAlign="middle"
                color={isHighlighted() && !ai.disabled ? 0 : 1}>
                {`${COMMAND_KEY}${ai.shortcut}`}
              </text>
            </box>
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

function AppMenuDropdown(props: {
  apps: AppMenuEntry[];
  activeId: string;
  screenWidth: number;
  onClose: () => void;
  onChoose: (id: string) => void;
}): JSX.Element {
  let labelW = 80;
  for (const app of props.apps) labelW = Math.max(labelW, measureText(app.title, MENU_FONT));
  const w = 8 + CHECK_COL_W + SMALL_ICON + 6 + labelW + 12;
  const h = MENU_PADDING * 2 + props.apps.length * ITEM_H;
  const left = Math.min(props.screenWidth - SWITCHER_W, props.screenWidth - w - 4);
  const highlighted = getHighlightedMenuItem;

  return (
    <>
      <box position="absolute" left={0} top={0} width={10000} height={10000} onClick={() => props.onClose()} />
      <box
        position="absolute"
        left={Math.max(0, left)}
        top={MENUBAR_H - 1}
        width={w}
        height={h}
        background={0}
        borderColor={1}
        borderWidth={1}
      >
        <For each={props.apps}>
          {(app, index) => {
            const top = MENU_PADDING + index() * ITEM_H;
            const on = () => highlighted() === index();
            const ink = () => (on() ? 0 : 1);
            return (
              <box
                position="absolute"
                left={0}
                top={top}
                width={w}
                height={ITEM_H}
                background={on() ? 1 : 0}
                onMouseEnter={() => setHighlightedMenuItem(index())}
                onMouseLeave={() => setHighlightedMenuItem(null)}
                onClick={() => props.onChoose(app.id)}
              >
                <Show when={app.id === props.activeId}>
                  <box position="absolute" left={4} top={0} width={CHECK_COL_W} height={ITEM_H} justifyContent="center">
                    <text font={MENU_FONT} nowrap color={ink()} verticalAlign="middle">{CHECK_MARK}</text>
                  </box>
                </Show>
                <Show when={app.icon}>
                  {(icon) => (
                    <image
                      position="absolute"
                      left={4 + CHECK_COL_W}
                      top={0}
                      width={SMALL_ICON}
                      height={SMALL_ICON}
                      src={spriteSrc(icon())}
                      mode={on() ? "inverted" : "normal"}
                    />
                  )}
                </Show>
                <box
                  position="absolute"
                  left={4 + CHECK_COL_W + SMALL_ICON + 6}
                  top={0}
                  width={labelW}
                  height={ITEM_H}
                  justifyContent="center"
                >
                  <text font={MENU_FONT} nowrap color={ink()} verticalAlign="middle">{app.title}</text>
                </box>
              </box>
            );
          }}
        </For>
      </box>
    </>
  );
}
