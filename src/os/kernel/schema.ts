export * from "../../shared/schema";
import { string, boolean, number, integer, array, object, bytes, type Schema } from "../../shared/schema";
export const frame = object({ width: integer, height: integer, rowBytes: integer, bytes });
export const inspection = array(object({
  id: integer, name: string, role: string, text: string, value: string,
  enabled: boolean, focused: boolean, windowId: string,
  bounds: object({ x: number, y: number, width: number, height: number }), actions: array(string),
}, ["id", "role", "text", "enabled", "focused", "bounds", "actions"]));
const menuOption = object({ label: string, value: string, disabled: boolean }, ["label", "value"]);
const menuLeaves = [
  object({ type: { enum: ["separator"] } }),
  object({ type: { enum: ["radiogroup"] }, value: string, items: array(menuOption) }),
  object({ type: { enum: ["action"] }, label: string, shortcut: string, disabled: boolean, checked: boolean }, ["label"]),
] as const;
const submenu = <const S extends Schema>(items: S) =>
  object({ type: { enum: ["submenu"] }, label: string, disabled: boolean, items: array(items) }, ["type", "label", "items"]);
// The schema subset has no references, so nesting is spelled out: a menu,
// its submenus, and theirs. Deeper submenus still work; this only bounds what
// `menu` can report.
const innerMenuItem = { anyOf: [...menuLeaves, submenu({ anyOf: menuLeaves })] } as const;
const menuItem = { anyOf: [...menuLeaves, submenu(innerMenuItem)] } as const;
export const menuResult = { anyOf: [array(object({ label: string, items: array(menuItem) })), object({ menu: string, item: string })] } as const;
export const shellOutcome = object({
  id: string, session: string, cwd: string, stdout: string, stderr: string,
  stdoutBytes: bytes, stderrBytes: bytes, exitCode: integer, truncated: object({ stdout: boolean, stderr: boolean })
});
