# Mockintosh Architecture

Mockintosh is a mock operating system in the style of an early Macintosh, running in the browser. It renders at the original 512×342 resolution, scaled up to fit the browser window, into a 1-bit pixel buffer: every pixel is white or black, and every shade in between is a dither pattern, exactly as on the original hardware.

## High-Level Overview

The entire UI is rendered to a **single `<canvas>` element** backed by the 1-bit framebuffer: a QuickDraw `BitMap` packed exactly as on the original Macintosh — 8 pixels per byte, most-significant bit leftmost, `1` = black, rows padded to a 16-bit word (`packedBits.ts` in `@mockintosh/quickdraw` is the only code that knows this layout). A 512×342 screen is 22 KB, and the same bytes can be handed to a 1-bit panel driver or an ESC/POS printer unchanged. There is no HTML/CSS rendering within the simulated screen. Colour is deliberately out of scope; if it ever returns it will come in the way Color QuickDraw did — a `PixMap` with a `pixelSize` beside the 1-bit `BitMap` — rather than as a palette bolted onto the monochrome path.

The frontend is built with **Vite** and a **SolidJS custom renderer** (`@mockintosh/ui`) that paints a retained `box` / `text` / `image` / `raster` / `bitmap` tree through QuickDraw into that framebuffer. The OS shell lives in `src/os` and is brought up by `bootOS(platform)` (`src/os/boot.ts`); the browser entry point `src/solidMain.ts` just builds the web platform and calls it. The backend runs as **Vercel Edge Functions** in the same repo.

```
┌──────────────────────────────────────────────────────────────┐
│                         Browser                              │
│   Single <canvas> (512×342, scaled by zoom)                  │
│   Menubar · Windows · Desktop icons · cursor                 │
│   Hidden DOM: <video>, <audio>                               │
└──────────────────────────────────────────────────────────────┘
```

## Layering

```
@mockintosh/quickdraw (GrafPort, CopyBits, fonts)
        ↓
@mockintosh/ui (Solid universal renderer, layout, draw, pointer + focus)
        ↓
src/os shell (bootOS, signals, window chrome, menubar, dialogs, app registry)
        ↓
apps/*.tsx bundled apps         @mockintosh/sdk v2 → third-party ESM

src/platform/<host>  ─ implements Platform ─▶  bootOS(platform)
```

`createUI` is a **single-instance** renderer (`_setRepaintHook`, QuickDraw font globals). The OS calls it through `bootOS`; other canvas hosts use `mountCanvasUI` from `@mockintosh/ui/web`.

## Kernel (Toolbox traps)

Each `BootedOS` owns a `Kernel`: a trap dispatcher with an instance identity, boot generation, and caller sessions. Sessions identify the caller and own cleanup. `createSession({ operations })` can attach an operation grant; `invoke` then throws `permission` for names outside that set. Nested `Execution.invoke` inside a handler is trusted and is not filtered. `defineOperation` keeps each trap's input schema, result schema, and handler together. The same table is what MCP lists, what Terminal runs, and what Source Editor calls. Wire types live in `@mockintosh/protocol`.

Traps are grouped as managers in documentation only:

| Manager | Traps |
| --- | --- |
| File | `stat`, `list`, `read` / `read_bytes`, `write` / `write_bytes`, `mkdir`, `remove`, `move`, `copy` |
| Settings | `desktop_pattern` (Control Panel and Desktop use the same typed service; bytes live in Preferences) |
| Window / Event | `apps`, `open`, `windows`, `activate`, `inspect`, `click`, `dblclick`, `drag`, `type`, `key`, `pointer`, `menu`, `render`, `screenshot` / `screenshot_save` |
| Project | `project_create`, `source_open`, `build_submit`, `build_status`, `build_cancel`, `app_install`, `app_restart`, `app_restore`, `instances` |

Finder and `useApp().fs` keep talking **node ids and roles**. File traps resolve a path through `Disk`: `/disk` is a shell prefix for the volume root, not a mount. Catalog v3 revisions and compare-and-swap writes make two writers (human + agent) safe.

`@mockintosh/ui` exposes detached immutable inspection snapshots. Automation validates live targets and routes gestures through the same boot input handlers as human events. The S1 shell is an adapter over traps; `help` comes from the command table. The browser's opt-in companion, CLI, and MCP select an explicit boot and invoke traps. `npm run mockintosh` (`scripts/cli`) turns that boot's operation table into commands: flags are the trap's property names, and `pair` / `sessions` are the only hand-written ones. Disconnect never causes a headless fallback or automatic mutation replay.

Handlers receive an `Execution` with the caller, cancellation, streams, the boot `Disk`, and nested `invoke`. See [toolbox-cut.md](docs/toolbox-cut.md) and [M1 operation](docs/m1-operation.md).

## App projects, builds, and lifetimes

`Kernel` caller lifetimes own cleanup; revocation releases shell sessions and cancels pending work. One `ShellManager` serves Terminal and RPC. Outcome history is independent from live sessions, whose idle retention is bounded.

`src/os/projects` owns source snapshots, persisted immutable build records, selected/previous artifacts, and install/restart/recovery operations. The browser and companion implement the same `BuildProvider`: the browser defaults to a lazy module worker; the companion runs a cancellable worker process. Both typecheck and compile without executing project source. `src/shared/buildPolicy.ts` owns source limits, supported imports, and TypeScript options. The browser embeds the shipped SDK sources/declarations for typechecking; compiler code and assets stay out of the initial desktop load. Pairing can select the companion provider; disconnect restores the local provider for subsequent builds, without replaying in-flight work. `Platform.loadArtifact` loads persisted ESM in the host's shared runtime. Neither compilation nor Blob URLs belong in the kernel. Source Editor and shell commands use the same registered operations and revision checks.

`AppInstances` owns actual launch lifetimes and window ids. The window store still owns geometry, ordering, and rendering. App contexts register cleanup and explicitly retain background work; restart disposes the old instance and launches the selected build. Component initialization errors are caught at the window and attributed to the instance. This is the lifecycle needed for app replacement, not a general process table.

The shipped [M2 app-building slice](docs/m2-apps.md) creates, builds, runs, edits, restarts, restores, and reopens Counter after reboot. ChatGippity's M3 loop calls the same project/UI traps from the live computer; `/api/chat` is one LLM turn and does not execute them. Shell S2 and a general multi-file editor remain planned.

## Platform layer

Everything above the dashed line compiles **without DOM types**; `npm run check:core` (`tsconfig.core.json`, `lib: es2022`, no `@types`) enforces it. The only host globals the core assumes are the ones every engine we target provides — `console`, timers, `TextEncoder`/`TextDecoder` — listed exhaustively in `src/platform/core-env.d.ts`. Anything else the OS needs from the machine comes through one object:

```ts
interface Platform {
  display:   { width, height, framebuffer?, present(screen: BitMap), whenVisible?(cb) }  // whenVisible: the presented frame can be seen
  input:     { onPointer(handler), onKey(handler), onDrop?(handler) }  // raw events, screen coordinates; onDrop is host files
  scheduler: { requestFrame(cb), now() }                  // requestFrame returns a cancel
  storage:   FSBackend                                    // the disk
  env:       { origin, config }                           // host origin + VITE_* / device config
  hostCapabilities: HostCapability[]                      // leftover flags; `browser` is derived from the service
  clipboard?, printerLinks?, printer?, download?, fetch?  // peripherals; absent = feature hidden
  images?, video?, camera?, audio?, microphone?           // media; capabilities follow presence
  agentRuntime?                                           // language-model agents with app-supplied tools
  processes?                                              // app processes (web: module Workers); absent = apps share the OS thread
  crypto                                                  // randomBytes + sha256
  browser?                                                // openExternal, authorize, loadScript
}
```

The design follows the Macintosh: required members are what every Mac had (screen, mouse, keyboard, clock, disk); optional members are peripherals, and the OS hides the corresponding features (Print buttons, copy/paste) when they are missing. Double-click detection, ⌘-shortcuts, and paste are OS policy and live in `bootOS`, so a platform only reports what the hardware saw.

Implementations:

- `src/platform/web/` — `<canvas>` + `CanvasPresenter`, DOM events (including host file drops), `requestAnimationFrame`, `OPFSBackend`, `navigator.clipboard`, `WebUSBPrinterTransport`, `fetch`, `FontFace` rasterizing for Foundry's Browser Hinted mode, a Web Audio speaker (`media/audio.ts`), a `getUserMedia` microphone (`media/microphone.ts`), and an agent runtime (`agentRuntime.ts`: fx's WebAssembly core through libfx, loaded on first use, absent without JSPI). The only OS-level code allowed to touch the DOM.
- `src/platform/headless/` — in-memory display with frame read-back, synthetic input injection, a hand-advanced clock, `InMemoryBackend`, and (with `audioSampleRate`) a speaker that renders on the clock and keeps what it played, and (with `microphoneSampleRate`) a microphone that delivers whatever a test `speak`s into it. `src/os/boot.test.ts` boots the whole shell on it and drives menus, ⌘N, and the capability dialog from Node. It is the starting point for any new host: swap `present()` and the input injectors for real drivers.

Which apps ship is the entry point's decision, not the OS's: `src/systemApps.ts` registers the web build's always-on apps, and lists the optional ones the App Store installs. Bundled apps are written against `@mockintosh/sdk` only — `export default defineApp(…)`, `useApp()` — so they are the same shape as a third-party bundle and could be moved out of the tree. An SDK-clean app may also import `@mockintosh/quickdraw` for offscreen drawing; the OS serves the one shared instance through the import map, because `thePort`, the Font Manager and the cursor are globals (MacPaint is a port of `MacPaint.p` onto it). Three stay OS-owned and reach into `src/os` on purpose: Finder (desktop, folder windows, About This Macintosh, Control Panel), App Store (installation privileges), and Icon Gallery (the OS icon catalog). Finder is registered by boot; other bundled apps are registered by the host. Kernel clients (Source Editor, Terminal, ChatGippity) stay SDK-clean and receive a granted `AppContext.kernel` session from `permissions`.

### Capabilities

Apps declare what they cannot work without — `requires: ["camera"]` on `defineApp`/`registerApp`, and on App Store manifests. `platformCapabilities(platform)` (`src/os/capabilities.ts`) derives the set this machine has: `network`/`clipboard`/`printer`/`download`/`audio`/`microphone`/`fonts` and the media services from the services present, the rest from `hostCapabilities`. The OS refuses to launch an app with unmet requirements and tells the user why (“*"Photo Booth" needs a camera, which this Macintosh does not have.*”), and skips loading installed bundles it cannot run (their shortcuts explain the same when opened). Apps that work with *or* without a feature check `useApp().capabilities` at the point of use instead — Preview opens sprite files everywhere and gates PNG decoding on `images`; Dither hides Export when `download` is absent; Foundry disables Browser Hinted when the platform has no host rasterizer; the TP-7 requires only a speaker and says "NO MICROPHONE" when asked to record without one.

## App model

### System apps

Bundled Solid components registered with `registerApp` (`src/os/apps.ts`):

```ts
interface SolidApp<P = Record<string, never>> {
  id: string;
  title: string;
  icon: string;
  defaultSize: { width: number; height: number };   // the main window's
  windowKind?: WindowKind;                           // the main window's (default "document")
  scrollable?: boolean;
  resizable?: boolean;
  minSize?: { width: number; height: number };
  singleInstance?: boolean;
  menus?: MenubarDefinition[];   // the app's menubar
  Component: (props: P) => JSX.Element;              // the main window's content
  onOpen?(app: AppContext, props: P): void;          // the app's `main`; default: open the main window
}
```

### Opening an app

`openApp(appId, props, fromRect)` (`boot.ts`) is what the Finder calls for an icon or a document. It checks `requires`, brings an already-open matching window to the front (same `fileId` / `directoryId`, same `url` when the launch has one, or any window when `singleInstance`), and otherwise runs the app's **`onOpen`** with an `AppContext` — the Macintosh `main` receiving its `'oapp'`/`'odoc'` event. The default `onOpen` opens the main window; an app that supplies its own decides for itself: open in full screen, show a dialog first, open nothing. Whether an app opens a window is the app's business, not the OS's.

Windows are opened through **`AppContext.openWindow(spec)`** (`OSServices.openWindow` underneath, `buildAppWindow` in `appWindow.ts` — this shell's `NewWindow`). A `WindowSpec` names the kind, title, size, position, `scrollable`/`resizable`, and optionally a `Component` other than the app's main one; every field defaults to the `defineApp` declaration, so `openWindow()` is the main window. The first window opened from an icon gets the zoom-rect animation. `OSWindow.Component` holds a window's own component when it has one; `WindowContent` mounts it, else the app's.

`AppContext` (`appContext.ts`) is everything an app can do without a window — sprites, storage, `fs`, `os.openApp/closeWindow/showDialog`, `openWindow`, `fetch`, `print`, `images`/`video`/`camera`, `scheduler`, `crypto`, `browser`, granted `kernel`, `capabilities`, `env`. `AppServices`, what `useApp()` returns inside a window, is `AppContext` plus `window` and `setMenus`. The OS supplies one `AppServices` per window. `useWindow()` (shell-internal) exposes `{ id, width, height, isActive, scrollY, kind, setTitle, setContentSize, setInfoBar, setMenus, setFullScreen, close }`. Apps fill a non-scrolling band above the body with `WindowHeader` (Finder folder “N items”, Icon Gallery search) and below it with `WindowFooter`; the window scrollbar thumbs only the body. `win.height` is that body. `setContentSize` is the document height that drives the thumb.

Finder is registered like any other app (`FINDER_APP_ID`): the desktop is its window-less surface and folder windows are its windows (`kind: "finder-folder"`, `props: { directoryId }`). A live 1-bit buffer the app owns is a `<bitmap pixels>` node (unpacked `Uint8Array`; replacing the array repaints). Apps that paint from an external source (video frames, dithered photos) use `<raster onPaint>`, which hands them a `RasterSurface` (`setPixel` / `blitPixels` / `fill` in raster-local coordinates, plus the clipped QuickDraw port) and an explicit `revision` to dirty the frame. The framebuffer's memory layout never reaches app code. There is no other rendering path.

### App processes

An app that declares `runtime: "worker"` runs in a process of its own when the platform has `processes` and a process can give it everything it declares (`processBlocker` in `src/os/process/eligible.ts`). Otherwise it runs on the OS's thread like every other app ([plan](docs/worker-apps-plan.md)).

- **The worker** (`src/platform/web/process/`) loads the app from `src/appModules.ts` and runs its `onOpen`. It lays every window the app opens out in its own band of one offscreen bitmap, in its own focus scope, and draws them with the worker's own Solid, `@mockintosh/ui` and QuickDraw.
- **`AppProcess`** (`src/os/process/host.ts`) is on the OS's side. It opens a real OS window for each window the app opens; the window's content (`ProcessWindow`) shows that window's latest picture and sends its input back. `AppProcess` answers the app's calls (`src/os/process/protocol.ts`) with the instance's real `AppContext`.
- **Synchronous reads:** window size, catalog, fonts and sprites are answered in the worker from state the OS keeps current.
- **Sound:** a process feeds the speaker's audio thread directly through `AudioService.openPort`.
- **Stopping:** ending the instance asks the worker to run its cleanups, then terminates it.

### Apps, windows, and the menubar

Windows belong to apps via `OSWindow.appId`; the **active app** is derived, never stored: the active window's app, or the Finder when nothing is open (`getActiveAppId()` in `state.ts`). System-modal alerts borrow the menubar of the frontmost non-modal window.

Menus are owned by apps, not windows. `SolidApp.menus` (or `setAppMenus(appId, …)` for menus that change at runtime) registers an app's menubar; `useWindow().setMenus` sets a *per-window override* for menus that depend on window state (Finder's "Clean Up" is enabled only inside a folder). `getMenubarMenus()` resolves override → app menus → `[]`, so switching windows always shows the right menus with no imperative sync.

### Third-party apps (SDK v3)

```ts
export default defineApp({
  id: "myapp",
  title: "My App",
  icon: "myapp/icon",
  defaultSize: { width: 200, height: 120 },
  Component() { return <box padding={8}><text font="body">Hi</text></box>; },
});
```

Bundles externalize `solid-js`, `solid-js/store`, `@mockintosh/ui`, and `@mockintosh/sdk`. The OS serves those via an import map so one Solid runtime is shared. The `AppInstaller` (`src/os/installedApps.ts`) fetches a remote bundle through `Platform.loadModule`, validates `Component`, registers the module's `sprites`, and calls `registerApp`. A host without `loadModule` can still install bundled apps (below); a remote bundle then fails with a clear error. The App Store filters registry entries to `sdk` major ≥ 3.

### Bundled optional apps

The toy apps (Synthesizer, MacPaint, and the rest of the App Store's "Mockintosh Apps" section) stay in this repo, but a new desktop does not get a shortcut for them. `systemApps.ts` registers each with `registerBundledApp` (`src/os/bundledApps.ts`): title, description, and icon sprites up front, the module behind `import()`. Installing writes the same `.app` manifest as a remote app, with `entry: "bundled:<id>"`, and a desktop shortcut. The installer resolves that prefix from the registry instead of `Platform.loadModule`. Trashing the `.app` uninstalls. Boot migrates an existing disk once: a desktop shortcut to a bundled app and no manifest means install it, then a `bundledAppsMigrated` attribute on the Applications folder keeps a later uninstall from coming back.

`useApp()` provides `getSprite`, `storage` (per-app folder), `fs` (the shared file system), `window` (this window's reactive size, `isActive`, `scrollY`, `kind`, `setTitle`, `setFullScreen`, `close`), `openWindow` (another window of this app), `os.openApp/closeWindow/showDialog`, `setMenus` (this window's menubar), `capabilities`, optional `fetch` and `print`, and `env`. Sprite files (`image/x-mockintosh-sprite`) are read and written with `readSpriteFile` / `writeSpriteFile` from the SDK. Apps that declare `fileTypes` are launched with `FileDocumentProps` when such a file is opened. The OS supplies one `AppServices` per window through the SDK's `AppServicesContext`, so each window's components see their own.

The SDK is the single source of the app contract shared with the OS: `SolidApp` (the internal `src/os/apps.ts` type extends it) and the menubar types (`MenubarDefinition`, `MenubarItemDef`, …) live in `packages/sdk/src` and the shell imports them from `@mockintosh/sdk`.

## Directory Structure

```
src/platform/
  types.ts                  Platform interface (display, input, scheduler, storage, peripherals)
  core-env.d.ts             The host globals the DOM-free core may assume
  web/                      Browser platform
    index.ts                createWebPlatform: canvas via @mockintosh/ui/web, DOM input, RAF, OPFS, WebUSB
    OPFSBackend.ts          FSBackend on the Origin Private File System
    WebUSBPrinterTransport.ts
    webBluetoothPrinterTransport.ts
  headless/                 In-memory platform for tests and as a template for new hosts

packages/ui/                1-bit Solid canvas kit — npm `@mockintosh/ui`, site `ui.mockintosh.com`
                            engine: host elements + createUI + layout/draw/input/fonts
                            algorithms: dither, sprites, PNG
                            primitives/: headless create* behavior (press, toggle, slider)
                            widgets/: skins over host elements (Button, TextInput, …)
                            ./web and ./vite: host adapters
                            Mockintosh apps import widgets via `@mockintosh/sdk`, not this package name
packages/fs/                Reactive virtual file system + backends
packages/sdk/               defineApp, useApp, menubar types, UI + fs + protocol re-exports
packages/protocol/          Wire schemas: kernel resources, jobs, chat, build contract
packages/agent/             ChatGippity loop (`runAgent`) over KernelClient + fetch
packages/markdown/          The document model (LayoutNode) and mdast → LayoutNode; the SDK's DocumentView draws it
packages/print/             Print pages → PrinterEncoder (ESC/POS, cat printer) → PrinterTransport
packages/quickdraw/         GrafPort, CopyBits, BitBlt, packed 1-bit BitMap

sites/ui/                   ui.mockintosh.com — kit catalog; @mockintosh/ui only, not the OS
                            catalog DevTools (right-click Inspect) is 1-bit chrome in the framebuffer

apps/                       Bundled apps (*.tsx), SDK-only except Finder, App Store, Icon Gallery
  Finder.solid.tsx
  finder/                   Finder windows: folder views, AboutBox, Control Panel
  Safari.tsx
  safari/                   Tabs, history, router, toolbar and tab bar (chrome.tsx); sites/ holds the site adapters (GitHub, Hacker News, mockintosh.com)
  sdkClean.ts               SDK_CLEAN / SHELL_APPS manifest for the compile gate
  …

src/
  solidMain.ts              Browser entry: createWebPlatform → bootOS
  systemApps.ts             Registers the web build's always-on apps, and the optional apps' listings
  os/                       Shell (DOM-free)
    boot.ts                 bootOS(platform): boot order, frame loop, input → UI, OSServices
    capabilities.ts         Platform capability set; `requires` checks and their wording
    apps.ts                 SolidApp registry (+ apps skipped as unavailable)
    appContext.ts           The SDK's AppContext as the shell provides it (onOpen, useApp)
    appWindow.ts            buildAppWindow: WindowSpec + defineApp defaults → OSWindow (NewWindow)
    state.ts                Window store, active app, app menus, full-screen toggle
    windowKinds.ts          Window definitions (the WDEF table): chrome, layer, modal per kind
    windowContext.ts        useWindow()
    windowGeometry.ts       Chrome metrics + content-rect helpers (single source of truth)
    layering.ts             Kind-aware z-order
    fsBootstrap.ts          First-boot volume + role folders
    openers.ts              File type → app resolution
    sprites/                SpriteRegistry + generated built-in sprite data (scripts/convert-sprites.ts)
    iconCatalog/            System 7.5.3 IconFamily dump (ICN# / ics# / color members); Icon Gallery reads this, not the sprite registry
    cursor.ts               Draws QuickDraw's cursorState with CopyBits (the VBL cursor task)
    cursors.ts              The OS cursors as QuickDraw `Cursor`s (arrow, iBeam, watch, grab)
    zoomAnimation.ts        XOR zoom-rect animation (presents via a callback)
    appStorage.ts           Per-app storage folder
    bundledApps.ts          Optional apps: listings, bundled: manifests, one-time desktop migration
    installedApps.ts        AppInstaller: .app manifests; bundled: entries or Platform.loadModule
    printers/               Printers: the list + default (manager), one device per printer, driver catalog, saved list
    components/             Desktop, Window, Menubar, Dialog, Splash

templates/app/              vite-plugin-solid universal starter

api/                        Vercel functions; api/_web/ is the shared web reader (fetch + SSRF guard, HTML simplifier, site rules)
```

## Rendering pipeline

Each dirty frame:

1. Solid tree → layout → QuickDraw paint (`ui.frame()`). The tree ends with `ScreenCorners`, an inert layer that anchors the rounded-CRT corner sprites with `right`/`bottom` absolute layout above every window and menu.
2. The host compositor copies that clean frame and stamps QuickDraw's `cursorState.cursor` (mask `srcBic`, data `srcOr`) — the VBL cursor task. Pointer motion restamps the copy; it does not re-paint the tree.
3. `platform.display.present(composite)` — on the web, `CanvasPresenter` expands the packed bits to RGBA on the 2D canvas

`InitGraf` allocates the framebuffer (`globals.screenBits`) unless the display owns one (`display.framebuffer`, for DMA-backed panels); the shell paints the tree into that `BitMap`. A presentation copy receives the cursor stamp so the UI buffer stays clean. Zoom XOR paints on `screenBits` and presents that buffer for the duration of the animation.

QuickDraw paints through the original `RgnBlt` / `StretchBits` pipeline (`CopyBits`, `ScrollRect`, and every shape verb). Word-wide `BitBlt` fast paths are omitted unless they are pixel-identical to the general path. `BitBltSlow` is the per-pixel oracle tests compare against; it is not part of the public surface.

Sprites (`Sprite` in `@mockintosh/ui`, re-exported by the SDK) stay 1 byte per pixel as an asset format, with `defineSprite` (2 bpp base64) and `fromGrid` (ASCII art) as the two decoders; `<image>` packs each sprite to a `BitMap` once (cached per sprite) and draws it with `CopyBits`.

`<text runs={…}>` draws one paragraph of styled runs (bold, italic, underline) instead of a single-style string. `fonts/runLayout.ts` wraps the runs as one flow: words that touch across a run boundary stay together, spaces collapse, and a word longer than the line breaks per character. A run with `onClick` is a link. The node installs its own click and pointer-cursor handlers (`textRuns.ts`) and finds the run under the pointer from the same layout it draws. Runs are not selectable. Underlines are drawn by the UI (`fonts/underline.ts`), not by DrawText's underline bit. The strike's baseline is the cell bottom, so DrawText would put the line under the descenders. The UI draws it one row below `capAscent` instead, keeping DrawText's gap around descender ink.

Layout snaps every node to the pixel grid (positions floor, sizes round) so centering and percentages never produce half-pixels, which QuickDraw would refuse to draw.

`<text>` has two vertical boxes. The Decker cell (`glyphHeight`) is the line box for wrapping and for QuickDraw (`drawString`, strike `ascent = cell` so the baseline is the cell bottom). Single-line `verticalAlign="middle"` is the Control Manager rule: center FontInfo (`ascent + descent + leading`) in the box, then `MoveTo` the baseline. Built-in faces use the System 6 FONT headers (Chicago 12 is 12/3/0); the Decker cell is only mapped onto that baseline. Those numbers live in `@mockintosh/ui` (`faceMetrics`); they must not replace the strike or every QuickDraw glyph shifts.

**Font Manager and TrueType.** `fonts/registry.ts` is the Font Manager: families of bitmap strikes and TrueType / OpenType outlines, resolved the System 7 way, with outlines scaled, autohinted and rendered one glyph at a time by `fonts/truetype/`. System Folder › Fonts is installed by `src/os/fontFolder.ts`. How it all fits, and what's next: [`docs/fonts.md`](docs/fonts.md).

## QuickDraw

`@mockintosh/quickdraw` is a TypeScript rewrite of Bill Atkinson's 1984 QuickDraw (`reference/QuickDraw`). The public entry is exactly `QuickDraw.p` + `GrafUtil.p` plus the three OS seams the original left outside the unit. Pixel helpers (`newBitMap`, `getBit`, `makeRect`, …) live on `@mockintosh/quickdraw/bits`.

### Adaptation policy

A faithful port in another language is not a byte-for-byte emulation. These eight deviations are accepted; everything else should match the original exactly (`docs/quickdraw-fidelity-plan.md` §4):

1. **Memory / handles.** Handles are object references; `NewHandle` / `SetSize` / `DisposHandle` become allocation and GC. Growth-in-chunks (`polyMax`, `rgnMax`, `picMax`) and the 16-bit size cap of `QuickGlue.a` are dropped. `Kill*` / `Dispose*` may be no-ops.
2. **Word size.** 16-bit wraparound of coordinates is not emulated, except where the original relies on 16.16 fixed-point (`FixRatio`, `FixMul`, `|0` wraps in `DrawArc` / `DrawLine` / `PutLine`) — those go through `fixmath.ts` and `|0`.
3. **Traps → functions.** `_LongMul` / `_FixMul` / `_FixRatio` are local functions with ROM semantics. VAR parameters mutate the passed object; `GetPort` may return a value.
4. **Bounds-check.** Where the original would read or write arbitrary memory, the port bounds-checks and returns white / zero. Where the original would trap (nil `thePort`), the port throws `QDError` (`'QuickDraw: thePort is NIL'`). Query routines that do not dereference `thePort` keep working without one.
5. **Three OS seams.** The screen (`InitGraf(screenBits: BitMap)`), the Font Manager (`installFontManager` + `FMInput` / `FMOutput` / `FontStrike`), and the cursor engine (`$800` vectors + `cursorState`) stay outside QuickDraw, with the original record shapes — not convenience callbacks.
6. **Pixel-identical shortcuts only.** 68k word-wide `BitBlt` cases, `StretchBits` ratio tables, and `_StackAvail` text splits are omitted. JS may skip work when pixels match: `TrimRect` + all-rect `BitBlt`, `DrText` direct-to-screen, `DrawArc` solid-rect slabs, span apply under a region mask, pooled blit scratch, and skipping `ShieldCursor` when the vector is the default no-op. See `packages/quickdraw/README.md`.
7. **Packed regions + PICT serialize.** Regions use the packed XOR-delta inversion-point stream (`Int16Array`, not raw bytes). `Picture` is `{picSize, picFrame, data}` with `serializePicture` / `parsePicture` producing exact PICT v1 bytes.
8. **Pixel helpers on `./bits`.** `packedBits.ts` (`getBit` / `setBit` / `newBitMap` / `rowBytesFor` / `bitMapFromPixels` / `pixelsFromBitMap`) and `makePoint` / `makeRect` / `cloneRect` are host utilities, not QuickDraw. Import them from `@mockintosh/quickdraw/bits`.

Anything in the fidelity catalogue marked ADDED, SIMPLIFIED, BUG, or MISSING that is not on this list is in scope for removal or restoration.

### How to verify against `reference/QuickDraw`

- Source files carry `file:line` comments pointing at the original (`reference/QuickDraw/*.a`, `QuickDraw.p`, `GrafUtil.p`) so a reader can diff a TypeScript routine against the assembly.
- Internal helpers keep the original names (`DoLine`, `FrRect`, `PushVerb`, `RgnBlt`, `SeekRgn`, `CheckPic`) and file grouping; they are not re-exported from the barrel. Tests that need them import the source path (`../src/bitblt`, `../src/rgnBlt`, …).
- No `Math.max(1, …)`, no `portRect` in a blitter, no `as any`, no `scanlines` region encoding. `packages/quickdraw/tests/fidelity.test.ts` greps `src/*.ts` for those.
- Run the suite: `npx vitest run packages/quickdraw/tests`.
- Departures from the assembly that are not listed above are bugs.

Pointer events hit-test the node tree (`ui.dispatchPointer`) with capture: the node that received `mouseDown` keeps `drag` / `mouseUp`. There is no bubbling — a press goes to the topmost node with a handler — but there *is* a capture phase: `onMouseDownCapture` runs on every ancestor of the hit (root-most first) before the target's `onMouseDown`, and `preventDefault()` swallows the press along with its mouseup / click / drag. A press also makes the nearest `focusScope` the active one. Keyboard goes to the focus manager; ⌘ shortcuts are handled by the shell first.

The node tree follows DOM semantics: `insertChild` *moves* an already-attached node, which is what Solid's `<For>` relies on when `WindowStack` reorders windows.

Window drag/resize uses an XOR outline (`penMode="xor"` / `darkCheckers`) driven by `state.ts`.

### Window chrome invariant

Nothing inside a window can alter its chrome. The body box draws the outer hairline as its border and clips children (`overflow="hidden"`); `@mockintosh/ui` follows the CSS box model, so children are laid out *inside* the border and clipped to it. `dBoxProc` alerts add a 2px white gap and a 2px inner band inside that hairline. Header content that belongs to the window (e.g. Finder's item count) goes through `win.infoBar`, not the content area. All chrome metrics live in `src/os/windowGeometry.ts`; apps needing screen-space geometry use `windowContentRect()` rather than hardcoding title-bar heights.

### Window activation invariant

Activation is owned by the shell, not by content. The window body's `onMouseDownCapture` (`handleActivationPress` in `Window.solid.tsx`) is the only place `bringToFront` is called from a pointer event. A press on an inactive window brings it to the front; if the press is on the title bar it continues as a drag, anywhere else it is swallowed so content never reacts to the click that focused its window (classic Mac). While an `alert` is open, presses on every other window are swallowed (`isBlockedByModal`). Apps therefore never need to — and must not — call `bringToFront` themselves.

## Window kinds and layering

A window's `kind` selects a **window definition** (`src/os/windowKinds.ts`) — the table the Macintosh kept in the WDEF a `procID` pointed at. It is the only place a kind's chrome, layer and modality are spelled out; `Window.solid.tsx`, `windowGeometry.ts` and `layering.ts` read it and never test the kind themselves.

| Kind              | Mac `procID`      | Chrome                                              | Layer                        |
| ----------------- | ----------------- | --------------------------------------------------- | ---------------------------- |
| `"document"`      | `zoomDocProc`     | title, close, zoom; grow box / scroll bars if asked | 1 documents                  |
| `"finder-folder"` | —                 | a document the Finder can tell apart                | 1                            |
| `"dialog"`        | `movableDBoxProc` | title, close; no zoom, no grow                      | 1                            |
| `"utility"`       | `rDocProc`        | untitled: 11px 25% gray drag bar and close box; a title uses the document-height bar, same fill, no stripes | 4 above fullscreen |
| `"plain"`         | `plainDBox`       | 1px frame and shadow; no title bar, not movable     | 1                            |
| `"alert"`         | `dBoxProc`        | 1px / 2px white / 2px square frame and shadow; system-modal | 5 front              |
| `"fullscreen"`    | —                 | none; bounds are the screen, menubar hidden         | 3 above documents            |
| `"desk"`          | —                 | none; the screen under the menubar, local = global coordinates; a press does not take the key window | behind the app's other windows; hidden when another app is front |

`buildAppWindow` clamps size/position to the desktop (gray region minus 3 px). Zoom box toggles `standardBounds` vs `userBounds`. Opening from a Finder icon plays the zoom-rect animation.

**Full screen** is the Macintosh "special presentation mode": the application takes the whole screen, menubar included. `setWindowFullScreen(id, on)` (`useApp().window.setFullScreen`) switches a window into and out of `fullscreen` *in place* — the content stays mounted, as with the zoom box — remembering its windowed kind and bounds in `OSWindow.windowed`. A window may also be *opened* as `fullscreen`; it has no windowed form to return to. While the frontmost non-modal window covers the screen, `isMenubarHidden()` is true and the menubar is tucked above the picture (`menubarTop()`), but `getMenubarMenus()` is unchanged, so the app's ⌘ shortcuts keep working. A press on the top edge, or the pointer passing that edge (including the page above the canvas), slides the bar down four pixels per frame; it slides back up when the pointer drops below the bar unless a menu is open (`menubarReveal.ts`). A utility window paints above that picture and keeps its gray drag bar while the document stays the key window, so the menubar stays tucked. Palettes are hidden when another app is frontmost ([Macintosh Human Interface Guidelines, Utility Windows](https://dev.os9.ca/techpubs/mac/HIGuidelines/HIGuidelines-112.html#HEADING112-0)).

## Event flow

```
platform.input (raw down/up/move/scroll, key down/up)
   → bootOS: double-click detection, full-screen menubar edge,
             ⌘V paste via platform.clipboard,
             ⌘ shortcut scan of the active menubar
   → ui.dispatchPointer / dispatchKeyboard
```

## File System

`@mockintosh/fs` (`packages/fs`) is the virtual file system: a **reactive catalog** (Solid store of `FSNode`s keyed by id, plus a per-directory child index and a per-volume role index) over a pluggable **`FSBackend`** that stores the catalog as one JSON document and file bodies as blobs (`OPFSBackend` in the browser, `InMemoryBackend` in tests). Reads (`children`, `node`, `locate`, `attributes`, …) are store reads, so a Finder memo that lists one folder re-runs only when that folder changes — there is no change-notification plumbing. Mutations (`mkdir`, `writeFile`, `rename`, `move`, `remove`, `setAttributes`) are the only writers; `batch()` coalesces several into one reactive update and one persistence write.

```
FileSystem (packages/fs)       catalog + bodies, roles, attributes, migrations
  └ FSBackend                  OPFSBackend | InMemoryBackend
src/os/fsBootstrap.ts          first-boot layout; repairs role folders each boot
src/os/openers.ts              MIME type → app (`SolidApp.fileTypes`)
packages/sdk/src/spriteFile.ts readSpriteFile / writeSpriteFile (image/x-mockintosh-sprite)
src/os/appStorage.ts           useApp().storage → System Folder/Preferences/<appId>/
src/os/installedApps.ts        App Store manifests as MIME.app files in Applications
apps/finder/attributes.ts      Finder's typed view of node attributes
```

**Layout.** Root → volumes → folders. Well-known folders carry a `role` (`volume`, `desktop`, `trash`, `applications`, `pictures`, `system`, `preferences`, `extensions`, `printer-drivers`) and are found with `fs.locate(role)`, never by name — the user may rename them. At most one folder per role per volume. Pictures is the volume's folder for user pictures.

**Types.** A file has one MIME `type` (`MIME` constants: `text/plain`, `image/x-mockintosh-sprite`, `application/x-mockintosh-app-shortcut`, `application/x-mockintosh-app`, `application/x-decker`, …) and a byte `size`. Bodies are bytes; `readText`/`readJSON`/`writeJSON` are conveniences.

**Attributes.** Consumers (not the FS) own per-node metadata bags: the Finder's icon, free-form position and stacking order live there, typed only in `apps/finder/attributes.ts`; the installer keeps `appId` on manifest files. The FS persists them and removes them with the node.

**Durability.** A body is written to the backend *before* its catalog entry appears; an entry is removed *before* its body is deleted. The catalog is debounced (500 ms) and versioned: `parseCatalog` migrates older documents (the v1 `FileManager` catalog → v2: MIME types, roles, attributes → v3: persisted revisions) and drops unreachable nodes rather than failing.

**Opening.** A double-click asks `resolveOpenAction`: directories open a Finder window; `MIME.appShortcut` / `MIME.app` launch the referenced app; other files launch the first registered app that claims the MIME type as its `"default"` in `fileTypes` (falling back to an `"alternate"` claim), with `FileDocumentProps` (`fileId`, `title`) as props. `os.openersFor(type)` lists every claimant for "Open With". FileViewer opens `text/*`; Preview is the default for 1-bit sprite files and PNG/JPEG/GIF/WebP, and offers Dither and Trace, which claim those types as alternates; Foundry opens TrueType/OpenType, `%%FNT1` strikes and `.suit` suitcases. Unknown types show a dialog, as does a shortcut or manifest whose app is no longer registered (`reason: "unknown-app"`).

**Host import.** The web platform reports files the user drags from the real computer onto the screen (`PlatformInput.onDrop`). `bootOS` writes them into the folder under the pointer (desktop, or an open Finder folder) via `src/os/hostImport.ts`. Dropping onto a Dither window also opens the new file there; dropping a font onto Foundry does the same.

**Apps.** `useApp().fs` exposes the same `FileSystem` (typed `AppFileSystem` in the SDK); `useApp().storage` is a per-app folder under `System Folder/Preferences`. Installed third-party manifests are `MIME.app` files in `Applications` and are loaded at boot by the `AppInstaller`.

## Printing

```
PrintPage (off-screen GrafPort, paper width)  →  EscPosEncoder  →  PrinterTransport
      @mockintosh/print                            @mockintosh/print       WebUSBPrinterTransport | (UART, socket…)
```

Printing follows the Macintosh Printing Manager model: the page is an ordinary QuickDraw port (`createPrintPage`), so anything that draws to the screen can draw to paper — `CopyBits` for pictures, `drawString` from `@mockintosh/ui` for text in the UI fonts. `EscPosEncoder` packs the finished 1-bit page into banded `GS v 0` raster commands plus feed and cut; it is pure and unit-tested. The `PrinterTransport` is the platform edge: `WebUSBPrinterTransport` (browser, Chromium) finds the device's bulk OUT endpoint and streams the bytes; a microcontroller would send the same bytes over UART.

The shell keeps a list of printers with one default (`src/os/printers/manager.ts`, like the Chooser) and hands apps the default as `useApp().print`, an *optional* capability: it is `undefined` when the platform can't reach any printer, so apps hide their Print UI with `<Show when={print}>`. `printPicture` lays the picture out for the paper (`src/os/printers/pictureLayout.ts`): by default the largest whole-number scale and the orientation that fills the paper, which `layoutPicture` returns without printing so a preview matches the page. `printPage` gives an app the raw port. The Print dialog (`showPrintDialog`, `packages/sdk/src/printDialog.tsx`) is an SDK component rather than a shell service: an app opens it as its own modal `alert` window, it lays the page out with `layoutPicture`, and it hands back the orientation and scale to print with. Which device is the printer is the shell's business, not the app's: the Finder's Chooser window (`apps/finder/Chooser.tsx`, Apple menu) adds, removes and configures printers through the shell-only `SystemPrinters`, and transports report a dismissed device picker as `PrinterCancelledError`, which the service treats as "don't print" rather than an error.

**Drivers.** What a printer can't say about itself — paper width, dots per line, cutter, command-set quirks, which Bluetooth service to write to — lives in a `PrinterDriver` (`@mockintosh/print` `driver.ts`), which is plain data. Built-ins ship in `BUILTIN_PRINTER_DRIVERS`; user drivers are JSON files (`driverFile.ts`, format `mockintosh-printer-driver` v1, strictly validated) in System Folder › Extensions › Printer Drivers (role `printer-drivers`), read live by `src/os/printers/drivers.ts`. A file with a built-in's id replaces it. When a printer is added, `identifyPrinter` gathers its `PrinterIdentity` (USB descriptors, IEEE 1284 device ID, ESC/POS `GS I`, Bluetooth name and services) and `matchPrinterDrivers` ranks the drivers against it; the Chooser shows the ranking and the settings already proven for the driver (width, speed, density). Experiments live in a second Finder window, Printer Diagnostics (`apps/finder/PrinterDiagnostics.tsx`, from the Chooser): identify and probe, width, cut, status and heat tests, and "Save as Driver…" to turn a tuned setup into a file. How to bring up a new printer is the `thermal-printer-drivers` skill in `.cursor/skills/`.

**Configured printers** are saved in Preferences › Printers (`printerList.ts`): name, driver id, optional dots override, and a `PrinterDeviceRef` to find the same device again (USB vendor/product/serial, Bluetooth id). The platform supplies `PrinterLinks` (`kinds` + `open(request)`): on the web, one `WebUSBPrinterTransport` bound to its device, or one `WebBluetoothPrinterTransport` that offers every driver's GATT service in the picker and writes through the first the device has. A board with a printer wired in sets `Platform.printer` instead, which appears as a fixed entry.

## Safari

Safari shows the web the way a 1996 browser did: text, links, pictures and forms, with no style sheets or scripts. Every page, whatever its source, becomes the same document model (`LayoutNode[]` from `@mockintosh/markdown`), and the SDK's `DocumentView` draws it.

```
address bar / link / form  →  PageRequest  →  router ─┬─ start page (about:start)
                                                     ├─ site adapter (GET, client-side API calls)
                                                     └─ /api/browse (server reads the HTML)  →  WebPage { url, title, nodes }
```

- **Window.** The toolbar (Back/Forward, the address field, Copy Link, New Window) and the tab bar sit in a `WindowHeader`, so the window's scroll bar moves only the page, which reports its height with `setContentSize`. Each tab has its own history (`apps/safari/tabs.ts`). Loaded pages are kept per history entry, along with where they were scrolled to, so switching tabs and going Back don't load again; Reload makes a new entry.
- **Site adapters** (`apps/safari/sites/`) draw sites that have an open API. An adapter with a `bookmark` gets a button in the tab bar. GitHub uses api.github.com, with an optional token under Bookmarks › GitHub Token…; Hacker News uses the Algolia API. Both APIs allow cross-origin requests, so the adapters call them through `useApp().fetch` and never touch the server. There is no separate GitHub app; github.com is only a Safari site.
- **mockintosh.com** is a picture page: the adapter draws the micro desktop with its alert from Safari's own pixels (`sites/mockintosh.ts`) at 2× on a black page, with no network and no bookmark.
- **`/api/browse`** fetches the page (`api/_web/fetch.ts`) and reduces it to the document model (`api/_web/simplify.ts`). The fetch checks every redirect hop against private and local addresses, caps the size and times out. The simplifier keeps headings, paragraphs, lists, links, images, `pre` blocks, data tables and GET/POST forms, and drops layout tables, scripts, styles and hidden elements. Per-site rules (`api/_web/sites.ts`) pick the content root and strip chrome, for example on Wikipedia. View › Reader sends the page through Defuddle first.
- **Pictures** come through `/api/web-image` (image types only, at most 8 MB), are decoded by `useApp().images`, and are dithered to the column width.

Safari keeps links and history as plain strings. It parses them with the SDK's pure `parseUrl` / `formatUrl`, because apps compile without the host's `URL`.

## App Store

Browses `registry.json`. Only `sdk` major ≥ 2 entries are shown. Install imports the ESM bundle, registers the Solid app, and persists the manifest.

## Dependencies

| Package            | Purpose                                      |
| ------------------ | -------------------------------------------- |
| `vite`             | Build and dev server                         |
| `solid-js`         | Reactivity (universal renderer, not DOM)     |
| `vite-plugin-solid`| JSX → `@mockintosh/ui/renderer`              |
| `@mockintosh/sdk`  | Third-party app API                          |

## Deployment

Vercel: Vite static site + Edge Functions (`api/chat`, `api/checkout`, `api/verify-purchase`, Safari's `api/browse` and `api/web-image`, and the `api/oauth` phone sign-in relay behind `useApp().signIn`). The relay keeps pairings in a Redis REST store (`KV_REST_API_URL` / `KV_REST_API_TOKEN`); `scripts/dev-api.ts` keeps them in memory.
