import { ServiceError } from "./errors";
import type { MenubarActionItem, MenubarDefinition, MenubarItemDef, MenubarRadioGroupDef } from "@mockintosh/sdk";
import type { OSServices } from "../context";
import { FINDER_APP_ID, getActiveAppId, getMenubarMenus, setOpenMenuIndex, setHighlightedMenuItem } from "../state";
import { getApp } from "../apps";
import { openAppAboutBox } from "../components/AppAboutBox.solid";
import { openAboutBox } from "../../../apps/finder/AboutBox";
import { openControlPanel } from "../../../apps/finder/ControlPanel";
import { CHOOSER_TITLE, openChooser } from "../../../apps/finder/Chooser";
import {
  CAPTURE_ENTIRE_SCREEN_LABEL,
  CAPTURE_SELECTED_PORTION_LABEL,
  SCREENSHOT_MENU_LABEL,
} from "../screenshot";

/** The Apple menu's title: the Apple logo glyph. */
export const APPLE_MENU_LABEL = "\uF8FF";

/** The Finder's About item; the About box it opens is a Finder window. */
export const ABOUT_THIS_COMPUTER_LABEL = "About This Computer…";

/**
 * The first Apple-menu item belongs to the frontmost application: "About
 * <app>…", or "About This Computer…" when that is the Finder. It is never
 * disabled — an app that declares no `about` gets the standard OS box.
 */
export function aboutMenuItem(os: OSServices): MenubarActionItem {
  const appId = getActiveAppId();
  if (appId === FINDER_APP_ID) return { label: ABOUT_THIS_COMPUTER_LABEL, onClick: () => openAboutBox(os) };
  const app = getApp(appId);
  return {
    label: `About ${app?.title ?? appId}…`,
    onClick: () => { if (app) openAppAboutBox(os, app); },
  };
}

export function appleMenu(os: OSServices): MenubarDefinition {
  return {
    label: APPLE_MENU_LABEL,
    items: [aboutMenuItem(os), {
      type: "separator"
    }, {
      label: "Control Panel",
      onClick: () => openControlPanel(os)
    }, {
      label: "Icon Gallery",
      onClick: () => os.openApp("icon_gallery")
    }, {
      label: "MacPaint",
      onClick: () => os.openApp("macpaint")
    }, {
      label: "Trace",
      onClick: () => os.openApp("trace")
    }, {
      label: "Terminal",
      onClick: () => os.openApp("terminal")
    }, {
      label: CHOOSER_TITLE,
      onClick: () => openChooser(os)
    }, {
      type: "submenu",
      label: SCREENSHOT_MENU_LABEL,
      items: [{
        label: CAPTURE_ENTIRE_SCREEN_LABEL,
        onClick: () => { void os.screenshots.captureEntireScreen(); },
      }, {
        label: CAPTURE_SELECTED_PORTION_LABEL,
        onClick: () => os.screenshots.beginPortionCapture(),
      }],
    }, {
      label: "Find File",
      disabled: true
    }, {
      label: "Scrapbook",
      disabled: true
    }, {
      type: "separator"
    }, {
      label: "Puzzle",
      disabled: true
    }]
  };
}
/** An item that does something when chosen. */
export type MenuCommand = MenubarActionItem | MenubarRadioGroupDef;

/**
 * Every command in `items`, depth-first, including those inside submenus —
 * except under a disabled submenu, which can't be opened.
 */
export function* menuCommands(items: readonly MenubarItemDef[]): Generator<MenuCommand> {
  for (const item of items) {
    if (item.type === "separator") continue;
    if (item.type === "submenu") {
      if (!item.disabled) yield* menuCommands(item.items);
      continue;
    }
    yield item;
  }
}

export function runMenuItem(item: MenubarActionItem) {
  if (item.disabled || !item.onClick) throw new ServiceError("permission", "Menu item is unavailable");
  setOpenMenuIndex(null);
  setHighlightedMenuItem(null);
  item.onClick();
}
export function runRadioItem(group: MenubarRadioGroupDef, value: string) {
  if (!group.items.some(item => item.value === value)) throw new ServiceError("invalid-argument", "Unknown menu value");
  setOpenMenuIndex(null);
  setHighlightedMenuItem(null);
  group.onValueChange(value);
}
/** Every menu in the menubar right now: the Apple menu, then the active app's. */
export function menus(os: OSServices) {
  return [appleMenu(os), ...getMenubarMenus()];
}
export function runNamedMenu(os: OSServices, menu: string, label: string) {
  const matches = menus(os).filter(m => m.label === menu);
  if (matches.length !== 1) throw new ServiceError(matches.length ? "ambiguity" : "missing-resource", "Menu must match exactly once");
  const actions: (() => void)[] = [];
  for (const item of menuCommands(matches[0].items)) {
    if (item.type === "radiogroup") {
      for (const option of item.items) if (option.label === label) actions.push(() => runRadioItem(item, option.value));
    } else if (item.label === label) {
      actions.push(() => runMenuItem(item));
    }
  }
  if (actions.length !== 1) throw new ServiceError(actions.length ? "ambiguity" : "missing-resource", "Menu item must match exactly once");
  actions[0]();
}
