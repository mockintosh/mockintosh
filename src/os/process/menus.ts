/**
 * Menus across the process boundary. The worker keeps the callbacks and sends
 * ids (`wireMenus`); the OS rebuilds menus whose items send those ids back
 * (`unwireMenus`).
 */
import type { MenubarDefinition, MenubarItemDef } from "@mockintosh/sdk";
import type { WireMenu, WireMenuItem } from "./protocol";

/** Callbacks by action id, filled in as menus are wired. */
export type MenuActions = Map<number, (value?: string) => void>;

export function wireMenus(menus: MenubarDefinition[], actions: MenuActions, nextId: () => number): WireMenu[] {
  const items = (list: MenubarItemDef[]): WireMenuItem[] =>
    list.map((item): WireMenuItem => {
      switch (item.type) {
        case "separator":
          return { type: "separator" };
        case "submenu":
          return { type: "submenu", label: item.label, disabled: item.disabled, items: items(item.items) };
        case "radiogroup": {
          const action = nextId();
          actions.set(action, (value) => item.onValueChange(value ?? item.value));
          return { type: "radiogroup", value: item.value, action, items: item.items.map((i) => ({ ...i })) };
        }
        default: {
          let action: number | undefined;
          const onClick = item.onClick;
          if (onClick) {
            action = nextId();
            actions.set(action, () => onClick());
          }
          return { type: "action", label: item.label, shortcut: item.shortcut, disabled: item.disabled, checked: item.checked, action };
        }
      }
    });
  return menus.map((menu) => ({ label: menu.label, items: items(menu.items) }));
}

export function unwireMenus(menus: WireMenu[], send: (action: number, value?: string) => void): MenubarDefinition[] {
  const items = (list: WireMenuItem[]): MenubarItemDef[] =>
    list.map((item): MenubarItemDef => {
      switch (item.type) {
        case "separator":
          return { type: "separator" };
        case "submenu":
          return { type: "submenu", label: item.label, disabled: item.disabled, items: items(item.items) };
        case "radiogroup":
          return { type: "radiogroup", value: item.value, items: item.items, onValueChange: (value) => send(item.action, value) };
        default: {
          const action = item.action;
          return {
            label: item.label,
            shortcut: item.shortcut,
            disabled: item.disabled,
            checked: item.checked,
            onClick: action === undefined ? undefined : () => send(action),
          };
        }
      }
    });
  return menus.map((menu) => ({ label: menu.label, items: items(menu.items) }));
}
