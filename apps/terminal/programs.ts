import type { AppContext } from "@mockintosh/sdk";
import type { TtyProgram } from "@mockintosh/terminal/bash";
import { bundledPrograms } from "@mockintosh/terminal/wasi";

/**
 * Programs Terminal runs attached to its tty, beyond bash's own commands:
 * Lua, kilo, SQLite and Python as WebAssembly, served beside the OS, and
 * `wasm` for any WASI program on the disk.
 */
export function terminalPrograms(app: AppContext): TtyProgram[] {
  return bundledPrograms({ baseUrl: `${app.env.origin}/wasi/` });
}
