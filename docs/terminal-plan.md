# Terminal emulator: plan

Status: built, October 2026, on the `terminal` branch, together with bash, a kernel process table and WebAssembly programs. See [As built](#as-built) at the end for what differs from this plan and what's left; ARCHITECTURE.md › Terminal is the current description.

## Why

Terminal today is a scrollback string and a `TextInput`. It can run the S1 shell line by line, but it can't host a program that draws: nothing moves a cursor, clears a line, or shows inverse video, and every key except Enter and the arrows is lost. fx's real interface is such a program, and so is anything full-screen we might want later (an editor, `top`, a remote shell through the companion).

A **terminal** is the missing piece: a screen of character cells that a program drives with a byte stream of text and escape sequences (the VT100/xterm language), and a keyboard that sends bytes back. A **terminal process** is whatever is on the other end: the S1 shell, fx, later a kernel pseudo-terminal or a host shell.

## Goals

- A `TerminalView` any app can mount, speaking the xterm dialect well enough to run fx's interface unmodified.
- Pixels that look like a 1984 Mac: Monaco 9 in 6×11 cells, 1-bit, attributes as bold, underline, inverse and dither, never colour.
- One process contract, so Terminal (S1 shell) and the fx app use the same view, and a new process is an adapter rather than a new UI.
- The emulator core compiles without DOM types and runs on the headless platform, so tests feed it recorded byte streams and compare screens.
- Terminal.app moves onto it without losing anything it has today (history, interrupt, streaming output).

## Non-goals

- Colour. 256-colour and truecolour are mapped to 1-bit attributes, not rendered.
- Our own VT parser, for now. The parser and screen model come from xterm.js (Decision 1); ours only if it stops fitting.
- A kernel pseudo-terminal (raw mode for programs *inside* the S1 shell). The first shell adapter is line-based on the client; the kernel PTY is Phase 6.
- Sixel, kitty graphics or any in-terminal images.
- Ligatures, proportional fonts, bidirectional text.

## Evidence

The spike (in `/tmp`, not the repo) connected `createFxTerminal` from libfx 0.0.11 to `@xterm/headless` 6.0.0 in Node 24:

- fx's welcome screen rendered correctly at 85×29, the size of a full-screen Mockintosh window in Monaco 9, including `𝒇`, `┃`, `›`, `⚠︎` and the box-drawing dividers.
- Keys written with `terminal.input()` reached fx, and xterm answered fx's cursor-position queries (`ESC[6n` → `ESC[8;1R`) without our help.
- fx's startup stream uses: cursor addressing, erase line/screen, SGR bold/underline/256-colour greys, synchronized output (`?2026`), bracketed paste (`?2004`), autowrap off (`?7l`), kitty keyboard push (`ESC[>1u`), modifyOtherKeys (`ESC[>4;2m`), OSC 2 titles, OSC 8 hyperlinks, and the theme query `?996n` / `?2031h`. xterm ignores the kitty and theme requests and fx carries on with its fallbacks.

`@xterm/headless` is MIT, 147 KB minified (39 KB gzipped), has no DOM types in its typings, and at runtime touches only `navigator.userAgent`/`navigator.platform`, guarded by a Node check.

## Decisions

### 1. Emulator engine: `@xterm/headless` behind our own interface

| Option | For | Against |
| --- | --- | --- |
| `@xterm/headless` (chosen) | Parser, buffer, scrollback, reflow, replies to queries, Unicode widths: the long tail is done and tested by VS Code's terminal. DOM-free. | Its selection, key encoding and renderers live in the browser package, so we write those. A non-browser, non-Node host needs a `navigator` shim. |
| Our own VT parser | Full control, no dependency, a good fit for the "transcribe the original" spirit. | Weeks of long-tail work (wrapping, scroll regions, reflow, wide characters, the query zoo) before fx looks right. |
| Full `@xterm/xterm` | Everything, including selection and key encoding. | Renders to its own DOM/canvas/WebGL; it can't draw into the QuickDraw framebuffer. |

xterm types never leave `@mockintosh/terminal`. Apps see `TerminalScreen` (below), so replacing the engine later is one module.

### 2. Home: a new `@mockintosh/terminal` package

The core (screen wrapper, key encoder, style mapping, selection model, line discipline) is DOM-free and joins `tsconfig.core.json`. The widget (`TerminalView`) depends on `@mockintosh/ui` and `solid-js`, like the SDK does. It is not a `@mockintosh/ui` widget because every app would then load xterm, and `ui` is the shared runtime served through the import map. Bundled apps import the package; third-party bundles would bundle it themselves until there's a reason to serve it from the import map.

### 3. Rendering: one `<raster onPaint>` over a row cache

Each terminal is a single `<raster>`: cells are fixed 6×11 boxes, inverse and selection are rectangle inversions, and box-drawing characters must meet exactly at cell edges. `<text>` nodes per row would fight the layout engine for no gain. Drawing uses the clipped QuickDraw port the raster provides, so bold and underline come from QuickDraw's own text styles.

### 4. Shell integration: client-side line discipline first

S1's `run_shell` takes a whole command line and streams output. The first `shellProcess` therefore does in JavaScript what a Unix tty driver does in cooked mode: echo, line editing, history, ⌃C → abort. That's enough for today's shell and costs no kernel work. Raw mode for full-screen programs inside the shell needs a kernel PTY (Phase 6).

## The contract

### Processes

What sits on the far side of the terminal. The shape deliberately matches the libfx terminal adapter reversed, so fx fits without glue.

```ts
/** The program side of a terminal: bytes in, bytes out, a size. */
export interface TerminalProcess {
  /** Bytes from the keyboard (already encoded: "\r", "\x1b[A", "\x03", …). */
  write(data: string): void;
  /** Output for the screen. Returns an unsubscribe. */
  onOutput(handler: (data: Uint8Array | string) => void): () => void;
  /** The terminal changed size; the process redraws if it cares. */
  resize(size: TerminalSize): void;
  /** Resolves with an exit code when the process ends. */
  readonly exited: Promise<number>;
  /** Stop the process and release its resources. */
  close(): void;
}

export interface TerminalSize { cols: number; rows: number }
```

Adapters shipped in this plan:

- `shellProcess(kernel)`: the S1 shell through `run_shell` / `shell_close`, with `LineDiscipline` in front.
- `fxProcess(options)`: `createFxTerminal` from libfx, with the view's screen passed as its `terminal` adapter (Phase 5).
- `echoProcess()` and `replayProcess(fixture)`: for tests, and for trying the view without a shell.

### Screen

The emulator, wrapped. `TerminalView` owns one; tests drive it directly.

```ts
export interface TerminalScreen {
  readonly size: TerminalSize;
  /** Feed program output. */
  write(data: Uint8Array | string): void;
  /** Bytes the terminal sends to the program: typed keys and replies to queries. */
  onInput(handler: (data: string) => void): () => void;
  /** Send user input (after key encoding) through the terminal, as xterm's `input()`. */
  input(data: string): void;
  resize(size: TerminalSize): void;
  /** Rows as the renderer needs them: the viewport, top line of scrollback, cursor. */
  frame(scrollTop?: number): TerminalFrame;
  readonly modes: TerminalModes;          // bracketed paste, mouse tracking, app cursor keys, focus events, sync output
  onChange(handler: () => void): () => void;   // after a write is parsed
  onTitle(handler: (title: string) => void): () => void;
  onBell(handler: () => void): () => void;
  dispose(): void;
}

export interface TerminalFrame {
  rows: readonly TerminalRow[];
  cursor: { x: number; y: number; visible: boolean } | null;
  scrollTop: number;
  scrollbackLength: number;
}

export interface TerminalRow { cells: readonly TerminalCell[]; revision: number }

export interface TerminalCell {
  text: string;            // "" for the right half of a wide character
  width: 0 | 1 | 2;
  style: CellStyle;
  link?: string;           // OSC 8 target
}

export interface CellStyle {
  bold: boolean;
  underline: boolean;
  inverse: boolean;
  /** 1-bit rendering of foreground and background colour, decided once by `monochromeStyle`. */
  ink: "normal" | "dim";
  paper: "white" | "light" | "dark" | "black";
}
```

`createTerminalScreen({ size, scrollback })` is the only function that imports `@xterm/headless`.

### The view

```tsx
<TerminalView
  process={process}            // a TerminalProcess; the view connects and disconnects it
  width={app.window.width()}
  height={app.window.height()}
  onTitle={title => app.window.setTitle(title)}
  onExit={code => …}
/>
```

The view computes `cols = floor(innerWidth / 6)`, `rows = floor(innerHeight / 11)`, resizes the screen and the process together (debounced to a frame), and exposes `copySelection()`, `paste(text)`, `clear()` and `selectAll()` for the app's Edit menu.

## Rendering

- **Frame pacing.** `onChange` bumps the raster's `revision` at most once per display frame (`scheduler.requestFrame`). While the program holds synchronized output (`?2026h`), the view doesn't bump at all, with a 150 ms safety release so a crashed program can't freeze the window.
- **Row cache.** Each row is drawn into a 1-bit row buffer keyed on the row's content and style, then blitted. An idle cursor blink redraws one cell; a streaming reply redraws the rows that changed.
- **1-bit style mapping.** `monochromeStyle(fg, bg, attrs)` is the single place colour becomes ink, and it's tested as a table:
  - Default, bright and near-white foregrounds draw normally. Dark greys (palette 232–243 and equivalent RGB) draw **dim**, as a 50% dither of the glyph. fx's dividers (`38;5;240`) and secondary text (`38;5;245`) come out quieter than body text, which is the intent of those colours.
  - Background luminance picks the paper: white, light (25% pattern), dark (75%), black. Black paper with default ink draws the glyph in white.
  - `inverse` swaps ink and paper after mapping. `bold` is QuickDraw bold (the one-pixel smear), clipped to the cell. `italic` is ignored at 9 point.
- **Cursor.** A block that inverts its cell, blinking on the scheduler; a hollow box when the window is inactive, as in the classic Mac terminal programs. Hidden while the program sends `?25l`.
- **Glyphs.** Characters are drawn from the mono strike. Box drawing (U+2500–257F), block elements (U+2580–259F) and Braille (U+2800–28FF, fx's spinners) are drawn **procedurally** per cell, as xterm.js does, so lines join across cells and every character is covered without hand-drawing 400 glyphs. Other missing characters go to the `bitmap-font-glyphs` workflow; until then they draw the font's missing-glyph box. Wide characters take two cells.

## Input

### Keys

`encodeKey(key, modifiers, modes): string | null` turns a `KeyboardEvent.key` plus modifiers into bytes:

- Printable characters as themselves; Enter `\r`; Backspace `\x7f`; Tab `\t`; Escape `\x1b`.
- Arrows as `CSI A…D`, or `SS3 A…D` in application cursor mode. Home, End, Page Up/Down, Delete, Insert and F1–F12 in xterm's encoding, with modifier parameters (`CSI 1;5C` for ⌃→).
- ⌃ + letter as C0 control codes (⌃C = `\x03`).
- ⌥ as Meta (Escape prefix) when the Terminal setting says so; otherwise ⌥ types the Mac character, as Apple's Terminal defaults.
- ⌘ is never sent. ⌘-letter goes to the menubar first (OS policy already), so ⌘C/⌘V/⌘K/⌘Q are the app's.

It is a table-driven pure function, tested against xterm's expected sequences. The kitty keyboard protocol is out of scope until a program needs it; fx falls back without it.

### Changes needed in `@mockintosh/ui` and the shell

These are small, but they change shared behaviour, so each lands with tests:

1. **Tab capture.** `focus.ts` consumes Tab for focus traversal before the focused node sees it. Add a prop for focusable nodes that take raw keys; the focus manager passes Tab (and Shift-Tab) to them instead. ⌃Tab still moves focus, as on the Mac, so keyboard users can leave a terminal.
2. **A paste event.** `boot.ts` pastes by dispatching one `keypress` per character. The terminal must receive the text in one piece to wrap it in bracketed-paste markers when the program asked for them (fx does), and to keep pasted newlines from submitting line by line. Add `onPaste(text)` to event handlers; the shell calls it on the focused node and falls back to keypresses when a node has none, so nothing else changes.
3. **⌃V.** The shell treats ⌃V like ⌘V, but in a terminal ⌃V means "insert the next character literally". ⌘V stays paste everywhere; ⌃V becomes an ordinary key for nodes that take raw keys. One prop should cover this and Tab capture (for example `rawKeys`); the name is decided in Phase 2.
4. **Key repeat and Escape.** Verify both reach `onKeyDown` unmodified on the web platform (repeat presumably arrives as repeated `down` events; to confirm).

### Mouse, selection, scrolling

- **Selection** is ours (xterm's lives in its browser package): drag selects by cell, double-click a word, triple-click a line, Shift-click extends. Selected cells render inverted; ⌘C copies through `translateToString` over the range. A pure `SelectionModel` in the core, tested without a view.
- **Mouse reporting.** When the program turns on mouse tracking, clicks (and drags in `?1002`) are sent as SGR reports (`CSI <0;col;rowM`) instead of selecting; Shift-drag still selects, as in xterm.
- **Scrollback** uses the window's own scroll bar: content height is `scrollbackLength × 11`, `scrollY` picks the top line. New output snaps to the bottom unless the user has scrolled up. The alternate screen (`?1049`) has no scrollback, so the thumb disappears while a full-screen program runs.
- **Focus events.** With `?1004` on, window activation and deactivation send `CSI I` / `CSI O`.

### Other channels

- **Title** (OSC 0/2) → `onTitle`; Terminal sets the window title from it.
- **Bell** → flash the menu bar, the System 7 behaviour with the volume at zero; a speaker beep when the platform has audio and the user asked for one.
- **Hyperlinks** (OSC 8) → underline on hover; ⌘-click asks before opening through `platform.browser`.
- **OSC 52 clipboard writes** → ignored in v1; a program writing to the Mac clipboard deserves a permission prompt.

## The shell adapter

`LineDiscipline` sits between the view and `run_shell`. It echoes typed characters, handles Backspace, ⌃U, ⌃W, ←/→, history on ↑/↓, and on Enter sends the line to `run_shell` and streams stdout/stderr to the screen (stderr in bold). ⌃C aborts the running command; ⌃D on an empty line closes the session; ⌃L clears. The prompt is `cwd>` as today. Output uses `\r\n`; lone `\n` from traps is translated (the tty driver's `onlcr`).

Moving Terminal.app onto it removes `TextInput`, the 16 KiB string cap and the estimated scroll offset.

## fx on the terminal

The fx app being built now uses `createFxAgent` (kernel traps as typed tools) behind a chat UI. `createFxTerminal` is a different fx surface, with its own interface and only `shell.run` as a tool (plus MCP, which the browser build can't configure yet: saving a server fails with `FileNotFound`). Moving fx onto the terminal is therefore a product choice, not a drop-in swap:

- `fxProcess` passes `createFxTerminal` an adapter built from the view's screen (`write` → screen, `onData` → encoded keys and query replies, `cols`/`rows`, `onResize`).
- `workspace.exec` runs S1 commands through `run_shell`, so fx's one tool drives the OS.
- `openUrl` → `platform.browser.openExternal` for Vercel sign-in; the OAuth, session, prompt-history and config stores → `app.storage`. That also fixes the "durable prompt history unavailable" and "saved credential storage is unavailable" warnings the spike showed.
- The same JSPI capability and lazy WebAssembly load as the agent-based app.
- Typed kernel tools arrive later, through an in-page MCP bridge (a patched libfx loader) or an upstream `tools` option on `createFxTerminal`.

To keep that door open, the fx app should keep its agent wiring (credentials, tool mapping, storage) apart from its chat UI, so a terminal-backed window can be a second front end on the same app rather than a rewrite.

## Testing

- **Pure core, in Node:** `encodeKey` tables, `monochromeStyle` table, `SelectionModel`, `LineDiscipline` (keys in, bytes out, `run_shell` faked).
- **Recorded fixtures:** byte streams captured from fx with the spike harness (startup, `/help`, a streamed reply, a resize), fed to `TerminalScreen`; assertions on the text grid and styles. When fx changes its output, re-recording shows the difference.
- **Pixels:** `TerminalView` in a headless boot, screenshot compared against goldens for attributes, cursor, dither and procedural glyphs.
- **End to end:** Terminal.app on the headless platform: type `help`, Enter, assert the screen; ⌃C during a long command; resize the window and assert `cols`/`rows` reached the process.

xterm's own VT conformance isn't retested; we test our mapping of it.

## Phases

0. **Spike (done).** fx on `@xterm/headless` in Node. Next: save the harness as `scripts/terminal/record-fx.ts` and check in the first fixtures.
1. **Core.** `packages/terminal` with `createTerminalScreen`, `encodeKey`, `monochromeStyle`, `SelectionModel`, `LineDiscipline`, fixture tests; add it to `tsconfig.core.json`.
2. **View.** `TerminalView`: raster renderer, row cache, cursor, key input, resize, scrollback, title, bell; the ui changes (Tab capture, paste event, ⌃V rule); procedural box drawing, blocks and Braille.
3. **Terminal.app.** Replace the `TextInput` UI with `TerminalView` + `shellProcess`. Edit menu (Copy, Paste, Select All, Clear Scrollback ⌘K). Same behaviour as today, then better.
4. **Interaction.** Selection and copy, mouse reporting, hyperlinks, focus events, bracketed paste.
5. **fx in a terminal window.** `fxProcess`, capability gating, storage adapters, sign-in; an fx window mode alongside the chat UI.
6. **Later.** A kernel PTY trap so S1 programs can use raw mode; a companion process that exposes a real host shell (with its own security review); our own parser if `@xterm/headless` ever stops fitting.

## Open questions

- Should dim text be a 50% dither or plain? Dither is more faithful to fx's intent and may be harder to read at 9 point; decide by screenshot in Phase 2.
- ⌥ as Meta by default, or Mac characters by default?
- Is 85×29 at full screen enough for fx's layout, or does the fx window want a smaller mono face? The spike says it fits; real use will tell.
- Should `@mockintosh/terminal` be served through the import map so third-party apps get a terminal without bundling xterm?

## As built

Phases 1–5 shipped, and Phase 6 in part, in a different order than planned: a pseudo-terminal came first, because bash and WebAssembly programs both needed one.

- **Package.** `@mockintosh/terminal` is a shared runtime (import map on the page, loaded lazily in app processes), which answers the open question: Terminal stays SDK-clean, and a built app can embed a terminal without bundling xterm.
- **Terminal.app** runs bash, not S1: [just-bash](https://github.com/vercel-labs/just-bash) over the kernel's file traps, with S1's commands as bash commands. There is no client-side line discipline in front of `run_shell`; the shell reads keys in raw mode through `LineEditor` (readline's bindings, history kept in the app's storage, completion, ⌃R).
- **Kernel PTY.** The pseudo-terminal lives in the terminal package (`pty.ts`), in Terminal's process, rather than as a kernel trap: everything that uses it runs there. The kernel got process accounting instead (`ps`, `kill`, `wait`, and `process_start`/`process_exit`/`process_signals` for job owners), which lists app instances too.
- **Programs.** WASI programs run in their own workers with blocking system calls over shared memory: Lua, kilo, SQLite's shell, Python 3.14 with its standard library, and any `.wasm` on the disk (`wasm file.wasm`). `scripts/wasi/mactty.c` gives programs termios and the window size.
- **fx.** `AgentRuntime.createTerminal` runs fx's terminal core on a `TerminalBridge` in an fx window (File › New Terminal Window); its shell tool runs bash on the disk and asks first.
- **Open questions answered.** Dim text draws in plain ink. Both patterns tried broke Monaco 9's one-pixel strokes on fx's help screen: a 50% checkerboard deleted diagonals (an x vanished), and a 25% knock-out aligned to the screen dotted the horizontals of every other line, because cells are 11 pixels tall. fx's emphasis survives through bold. ⌥ types Mac characters: the platform's key events carry `KeyboardEvent.key` only, so ⌥-as-Meta would need `code` first.

Not done yet:

- OSC 8 hyperlinks and OSC 52 clipboard writes (xterm's headless API doesn't expose link ranges).
- A scroll bar: scrollback is the wheel and Shift-Page Up/Down.
- Bash output arrives when a line finishes (just-bash returns whole results); programs stream.
- Job control (`&`, `fg`, ⌃Z suspends nothing), pipes between WebAssembly programs (each stage runs to completion), and programs reading the terminal from inside a pipeline.
- `run_shell` and MCP still speak S1; bash is Terminal's and fx's.
- A prebuilt program (Python) starts with `getcwd()` as "/"; relative paths still resolve from the shell's directory, and Python's `sitecustomize` enters `$PWD`.
- Safari can't run WebAssembly programs (no cross-origin isolation, so no shared memory).
