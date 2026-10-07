/**
 * `@mockintosh/terminal/bash` — bash over the Mockintosh disk, as a
 * session (for tools like fx's workspace) and as an interactive shell.
 */
export { BashSession, HOME } from "./session";
export type { BashSessionOptions, ExecResult } from "./session";
export { BashRunner } from "./runner";
export type { BashRunnerOptions, ProgramContext, TtyProgram } from "./runner";
export { KernelFs, FsError } from "./kernelFs";
export type { KernelLike } from "./kernelFs";
export { osCommands, runS1, s1Quote, OS_COMMANDS } from "./osCommands";
export { bashWorkspace } from "./workspace";
export type { BashWorkspace, WorkspaceRequest } from "./workspace";
export { fxProgram, fxEnvironment, KEY_VARIABLE } from "./fx";
export type { FxProgramOptions } from "./fx";
export { SHELL_AGENT_BRIEF, shellAgentInstructions } from "./brief";
