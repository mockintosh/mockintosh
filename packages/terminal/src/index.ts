/**
 * `@mockintosh/terminal` — the core: no DOM, no Solid. The view is
 * `@mockintosh/terminal/view`, shells are `@mockintosh/terminal/bash`, and
 * WebAssembly programs are `@mockintosh/terminal/wasi`.
 */
export { createTerminalScreen } from "./screen";
export type {
  TerminalScreen, TerminalSize, TerminalFrame, TerminalRow, TerminalCell, TerminalCursor, TerminalModes, ScreenOptions,
} from "./screen";
export { monochromeStyle, paletteRgb, luminance, sameStyle, styleKey, PLAIN_STYLE } from "./style";
export type { CellStyle, CellAttributes, Paper, TerminalColor } from "./style";
export { encodeKey, encodeText, encodePaste, encodeMouse, encodeFocus, controlCode } from "./keys";
export type { KeyModifiers, KeyModes, MouseAction, MouseButton } from "./keys";
export { SelectionModel, compare as compareCells } from "./selection";
export type { CellPosition, SelectionRange, SelectionUnit } from "./selection";
export { LineEditor, KeyReader, columns } from "./lineEditor";
export type { ReadResult, Completion, LineEditorOptions } from "./lineEditor";
export { charWidth, stringWidth, stripEscapes } from "./width";
export { proceduralGlyph, CELL_WIDTH, CELL_HEIGHT } from "./glyphs";
export { OutputChannel, echoProcess, replayProcess } from "./process";
export type { TerminalProcess } from "./process";
export { Pty, COOKED, RAW, SIGNAL_NUMBERS } from "./pty";
export type { Tty, Termios, Signal } from "./pty";
export { runShell, runForeground, exitBuiltin } from "./shell";
export type { Job, ShellRunner, RunShellOptions } from "./shell";
export { kernelProcesses } from "./processes";
export type { ProcessKernel, ProcessRegistry, RegisteredProcess } from "./processes";
export { TerminalBridge } from "./bridge";
export type { XtermLike } from "./bridge";
