import type { AppContext } from "@mockintosh/sdk";
import { fxProgram, type TtyProgram } from "@mockintosh/terminal/bash";
import { bundledPrograms } from "@mockintosh/terminal/wasi";

/**
 * Programs Terminal runs attached to its tty, beyond bash's own commands:
 * fx; Lua, kilo, SQLite and Python as WebAssembly, served beside the OS;
 * and `wasm` for any WASI program on the disk.
 */
export function terminalPrograms(app: AppContext, clipboard?: { writeText(text: string): Promise<void> }): TtyProgram[] {
  return [
    fxProgram({
      runtime: app.agentRuntime,
      kernel: app.kernel!,
      storage: app.storage,
      openUrl: app.browser
        ? async (url) => {
            await app.browser!.openExternal(url);
            return true;
          }
        : undefined,
      clipboard,
    }),
    ...bundledPrograms({ baseUrl: `${app.env.origin}/wasi/` }),
  ];
}
