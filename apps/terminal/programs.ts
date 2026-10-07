import type { AppContext } from "@mockintosh/sdk";
import type { TtyProgram } from "@mockintosh/terminal/bash";

/** Programs Terminal runs attached to its tty, beyond bash's own commands. */
export function terminalPrograms(_app: AppContext): TtyProgram[] {
  return [];
}
