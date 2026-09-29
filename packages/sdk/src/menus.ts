/**
 * Menubar definition types — shared by the OS shell (which draws them) and
 * apps (which declare them). This is the single source of truth; the OS
 * imports these from `@mockintosh/sdk`.
 */

/** One pull-down menu: its title in the menubar and its items. */
export interface MenubarDefinition {
  label: string;
  items: MenubarItemDef[];
}

export type MenubarItemDef =
  | MenubarActionItem
  | MenubarRadioGroupDef
  | MenubarSubmenuDef
  | MenubarSeparator;

/** A clickable command. `shortcut` is a single character, shown and bound as ⌘+key. */
export interface MenubarActionItem {
  type?: "action";
  label: string;
  shortcut?: string;
  disabled?: boolean;
  /** Draw a check mark beside the item (`CheckItem`). */
  checked?: boolean;
  onClick?: () => void;
}

/** A mutually exclusive group; the item whose `value` matches is checked. */
export interface MenubarRadioGroupDef {
  type: "radiogroup";
  value: string;
  onValueChange: (value: string) => void;
  items: { label: string; value: string; disabled?: boolean }[];
}

/**
 * A hierarchical menu: an item with a ▸ that opens `items` beside it on
 * hover. Items inside keep their ⌘-shortcuts. A disabled submenu can't be
 * opened, and its items' shortcuts don't fire.
 */
export interface MenubarSubmenuDef {
  type: "submenu";
  label: string;
  disabled?: boolean;
  items: MenubarItemDef[];
}

export interface MenubarSeparator {
  type: "separator";
}
