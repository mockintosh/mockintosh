# Making bundled apps SDK-clean

Written 15 September 2026. Companion to the [ChatGippity agent plan](chatgippity-agent-plan.md), which needs to know which bundled apps a third party (or the in-OS agent) can safely copy, and to the [App Developer Guide](../packages/sdk/docs/APP_DEV_GUIDE.md), whose promise is that bundled apps are "written against the public SDK exactly like third-party apps". This document audits that promise app by app, lists every non-SDK resource the bundled apps reach for, and proposes what to add to the SDK so that as many of them as possible can be moved inside it.

## Definition

An app is **SDK-clean** when its source compiles under the in-OS project compiler exactly as a user project would. Concretely, from `src/shared/buildPolicy.ts`:

- Imports only `solid-js`, `solid-js/store`, `@mockintosh/sdk`, `@mockintosh/ui`, `@mockintosh/ui/renderer`, and relative modules inside the project.
- No banned host globals: `alert`, `confirm`, `prompt`, `document`, `localStorage`, `sessionStorage`, `indexedDB`, `XMLHttpRequest`.
- Typechecks against `lib.es2022` only — no DOM library. So `window`, `navigator`, `Image`, `OffscreenCanvas`, `HTMLVideoElement`, `ImageData`, `URL.createObjectURL`, `requestAnimationFrame`, `performance` and `crypto.subtle` fail the typecheck even though only some of them are on the banned list. Timers (`setTimeout`, `setInterval`) are host globals the core assumes (`core-env.d.ts`) and are fine.

The in-OS compiler has no DOM. That is why the fixes below are SDK services rather than compiler exemptions.

Two distribution paths exist today and only one enforces this bar. Apps installed from the App Store are built externally with Vite and can use the DOM freely at runtime (that is what the `browser` capability is for). Apps built inside the OS (Source Editor, Terminal, ChatGippity) go through `validateSources` + `typecheck` and cannot. The audit below uses the stricter bar because it is the one that matters for the agent, for the source volume, and for portability.

## Inventory

Fourteen bundled apps under `apps/`. Non-SDK resources are listed per app; "shell" means the app is deliberately part of the OS shell and uses internal services on purpose.

Not in the table: **About This Macintosh** and **Control Panel**. As on System 7 they are Finder windows, not applications — `apps/finder/AboutBox.tsx` and `apps/finder/ControlPanel.tsx`, opened from the Apple menu by the Finder (`src/os/kernel/menus.ts`, `src/os/systemWindows.ts`). They are part of the Finder's source and are covered by the Finder row below.

| App | Status | Non-SDK resources | Notes |
|---|---|---|---|
| `MacPaint.tsx` (+ `macpaint/*`) | **Clean** | — | `engine.test.ts` imports `src/os/resourceCatalog`; tests are outside the bar. The reference drawing app. |
| `Safari.tsx` | **Clean** | — | Uses `useApp().fetch`. |
| `Testing.tsx` | **Clean** | — | Component showcase. |
| `FileViewer.tsx` | **Clean** | — | `MIME` and `<Markdown>` from the SDK. |
| `Picture.tsx` | **Clean** | — | `images.decode` + `toBits`. |
| `VideoPlayer.tsx` | **Clean** | — | `video.open` + `scheduler.requestFrame` + `createDitherer`. |
| `PhotoBooth.tsx` | **Clean** | — | `camera.open` + `scheduler.requestFrame` + `createDitherer`. |
| `SpotifyPlayer.tsx` (+ `spotify/*`, `sprites/spotify.ts`) | **Clean**, `requires: ["network", "browser"]` | — | `crypto`, `encodeQR`, `env.config`, `browser.authorize` / `loadScript`, `images` + `toBits`. |
| `SourceEditor.tsx` | **Clean** | — | Granted `kernel` (`stat`/`read`/`write`/`build_*`/`app_*`/`project_create`). |
| `Terminal.tsx` | **Clean** | — | Granted `run_shell` / `shell_close` with streams and `keepAlive()`. |
| `Assistant.tsx` | **Clean** | — | `permissions: ["kernel:*"]` + `@mockintosh/agent`. |
| `AppStore.tsx` | Shell, by design | `useOS().installer`, `installedAppIds(os.fs)` | Installing apps is a shell privilege (`ARCHITECTURE.md`). |
| `Finder.solid.tsx` (+ `finder/*`, including `AboutBox.tsx` and `ControlPanel.tsx`) | Shell, by design | `src/os/state` (`openOSWindow`, `updateOSWindow`, `setAppMenus`, `getWindows`), `src/os/apps.registerApp`, `src/os/windowContext`, `src/os/windowGeometry`, `src/os/systemWindows`, `src/os/kernel/settings`, `src/os/resourceCatalog`, `package.json`, full `FileSystem` from `@mockintosh/fs`, `os.sprites`, `os.resolution`, `os.menubarHeight`, `os.playWindowOpenAnimation`, `os.openFSNode`, `os.openFolderWindow` | The Finder *is* the shell, and About / Control Panel are its windows. |
| `IconGallery.tsx` | Shell, by design | `src/os/iconCatalog/{catalog,decode,types}` and `system753.json` | Developer tool over the OS's own icon catalog. Excluded. |

Score today: **11 of 14 clean**; Finder, App Store, and Icon Gallery remain the shell. The App Developer Guide table is generated from `apps/sdkClean.ts`.

## The gaps, grouped

The non-SDK resources of the seven target apps collapse into five gaps. Each is a missing SDK concept, not a missing exemption. One further gap belongs only to the shell and is recorded at the end for completeness, not as work.

### G1. Capabilities that are flags without services (`images`, `video`, `camera`)

`Platform.hostCapabilities` declares `images`, `video`, `camera` as booleans, and the apps then implement them with the DOM. The `network`, `clipboard`, and `printer` capabilities work differently and correctly: the platform provides a *service* (`fetch`, `clipboard`, `printer`) and the capability is derived from its presence. `images`/`video`/`camera` should follow the same pattern. Affects Picture, VideoPlayer, PhotoBooth.

### G2. No frame clock or monotonic time for apps

`requestAnimationFrame` and `performance.now` are DOM. `PlatformScheduler` already has `requestFrame` and `now`; the SDK does not expose them. Affects VideoPlayer, PhotoBooth, and any future animation.

### G3. Pixel conversion helpers live in one app

`photobooth/dither.ts` (Atkinson, Bayer) and the inline luminance thresholds in Picture and VideoPlayer are the same job: RGBA → 1-bit. This is the core operation of a 1-bit machine and belongs in the SDK. Affects Picture, VideoPlayer, PhotoBooth, Spotify (album art).

### G4. Kernel access for tools that operate the computer

SourceEditor, Terminal, and ChatGippity are *kernel clients*: they create a session and `invoke` traps. The kernel explicitly says "sessions identify the caller; they are not an ACL" (`src/os/kernel/index.ts`), so there is no way today to give an app a scoped kernel handle. The M1 guide says semantic metadata "does not grant kernel privileges to third-party apps"; that is right, but it does not follow that *no* app may have kernel access — only that it needs a grant model.

### G5. Browser-only apps have no browser API

Spotify requires `browser` and then uses `window`, `crypto`, `document`, `localStorage`, an npm package, and a Vite env var. The capability is honest; the access path is not. Some of these (`crypto`, QR codes, storage) are not browser-specific at all and belong in the SDK proper; the rest (`window.open` + OAuth redirect, script injection) need a `browser` service or must stay externally built.

### Recorded, not planned: a gap only the shell has

- **System resources are OS-internal.** `src/os/resourceCatalog` (`ppat`, `CURS`) and `src/os/iconCatalog` (`ICN#`) are the Mockintosh Resource Manager and live in the shell; only the Finder's Control Panel window, Icon Gallery, and MacPaint's *tests* read them. A `@mockintosh/resources` package with a `GetPattern`/`GetIcon` surface would be a natural SDK addition if a third-party app ever needs the system catalog, but nothing in the target set does. Not scheduled.

## Proposed SDK additions

Layering rule throughout: `@mockintosh/sdk` may depend on `@mockintosh/ui`, `@mockintosh/quickdraw`, `@mockintosh/fs`, and new sibling packages; it may not import `src/os`. Anything an app needs from the shell therefore either moves into a package or is provided by the OS through `AppContext`.

### A. Media services on `AppContext` (closes G1, G3)

Add three optional services, present exactly when the platform provides them, and derive the capabilities from their presence — deleting `images`/`video`/`camera` from `HostCapability` so only `browser` remains a declared flag.

```ts
/** Decoded raster: 8-bit RGBA, row-major, as `ImageData` but without the DOM. */
export interface ImageFrame { width: number; height: number; rgba: Uint8ClampedArray }

export interface ImageService {
  /** Decode PNG/JPEG/GIF bytes; `type` is the MIME hint. Rejects when undecodable. */
  decode(bytes: Uint8Array, type?: string, options?: { maxWidth?: number; maxHeight?: number }): Promise<ImageFrame>;
}

export interface VideoSource {
  play(): Promise<void>;
  pause(): void;
  /** Latest decoded frame, or null before the first one. Cheap to call every frame. */
  frame(): ImageFrame | null;
  readonly width: number;
  readonly height: number;
  close(): void;
}
export interface VideoService {
  open(url: string, options?: { loop?: boolean; muted?: boolean }): Promise<VideoSource>;
}

export interface CameraSource extends Omit<VideoSource, "play" | "pause"> {}
export interface CameraService {
  /** Prompts the user on the web; call from a click. */
  open(options?: { facing?: "user" | "environment"; width?: number; height?: number }): Promise<CameraSource>;
}

export interface AppContext {
  // …existing…
  images?: ImageService;
  video?: VideoService;
  camera?: CameraService;
}
```

On the web platform these wrap `createImageBitmap`/`OffscreenCanvas`, `<video>`, and `getUserMedia` respectively, in `src/platform/web/`. The headless platform omits them, so tests that need them use a fixture platform.

Pixel conversion moves into the SDK as pure functions (either `packages/sdk/src/raster.ts` or `@mockintosh/ui`, which already owns `Sprite` and `Ink`):

```ts
export type DitherMode = "threshold" | "atkinson" | "bayer";
/** RGBA → 1 byte per pixel, 0 = white, 1 = black — the `<bitmap pixels>` format. */
export function toBits(frame: ImageFrame, mode?: DitherMode, options?: { threshold?: number }): Uint8Array;
/** Same, reusing a caller-owned buffer and error rows for per-frame use. */
export function createDitherer(width: number, height: number, mode: DitherMode): (frame: ImageFrame, out: Uint8Array) => void;
```

`photobooth/dither.ts` becomes the implementation, minus its canvas reads.

### B. Scheduler on `AppContext` (closes G2)

```ts
export interface AppScheduler {
  requestFrame(callback: (timeMs: number) => void): () => void;   // returns cancel
  now(): number;
}
export interface AppContext { scheduler: AppScheduler }
```

Backed by `PlatformScheduler`. Frames requested by a window are cancelled when it closes, so apps stop leaking loops.

### C. Scoped kernel access (closes G4)

The largest change and the one that turns Source Editor, Terminal, and ChatGippity into ordinary apps. Two parts:

1. **Grants in the kernel.** `createSession(options?: { operations?: readonly string[] })` records an allowlist; `invoke` rejects operations outside it with `permission`. Sessions without an allowlist keep today's behaviour (shell callers). This is the ACL the kernel comment says it lacks, and the same mechanism the [server infrastructure plan](server-infrastructure-plan.md) needs for remote callers.
2. **A kernel client on `AppContext`**, present when the manifest declares `permissions: ["kernel:<trap>", …]` (or a `kernel:*` for tools):

   ```ts
   export interface KernelClient {
     invoke(name: string, args: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<unknown>;
     describe(): readonly OperationContract[];
   }
   export interface AppContext { kernel?: KernelClient }
   ```

   The OS creates the session with the granted operations and revokes it when the app instance ends. `AbortSignal` bridges to the internal `Cancellation`, so apps never import `src/os/kernel/cancellation`.

Wire types the apps need (`Resource` from `kernel/schema`, `Job` from `projects`) move to `src/shared/` beside `buildContract.ts` and are re-exported from the SDK as types, following the existing pattern.

With this, SourceEditor needs only `kernel` + `TextEditor`; Terminal needs `kernel` and drives the shell through `run_shell`/`shell_close` (streaming output via the `OperationStreams` the kernel already has, exposed on `invoke` options); ChatGippity needs `kernel` plus the agent loop.

### D. Agent loop as a package (finishes ChatGippity)

`src/os/agent` has no kernel dependency beyond `invoke` and `Cancellation`; it is already written against an `AgentInvoke` function type. Move it to `packages/agent` (with `src/shared/chatProtocol.ts`) and ChatGippity becomes an SDK app that uses `kernel.invoke` as its `AgentInvoke`. This also gives the eval harness in the agent plan a package to import.

### E. Portable utilities that Spotify proves are missing (partially closes G5)

Not browser-specific and worth adding regardless of Spotify:

- `crypto`: `randomBytes(n)`, `sha256(bytes)` — PKCE needs both; a microcontroller has both.
- `encodeQR(text): Sprite` — the SDK bundles a QR encoder. A QR code is the natural way for a 1-bit screen to hand a URL to a phone; Spotify's device-flow login is the first user, pairing (`m1-operation.md`) is an obvious second.
- Storage: the app already migrates `localStorage` to `useApp().storage`; delete the legacy path.
- Configuration: `import.meta.env.VITE_SPOTIFY_CLIENT_ID` becomes a manifest `config` block or an OS-provided `env.config` map, so no bundled app reads Vite env vars.

What remains browser-only is the OAuth redirect (`window.open` + `message`) and the Spotify Web Playback SDK script. Provide a minimal `browser` service for the first — `AppContext.browser?: { openExternal(url): Promise<void>; authorize(url, { redirectOrigin }): Promise<URLSearchParams> }` — and accept that the Web Playback SDK stays out of reach: Spotify remains `requires: ["browser"]`, but stops touching globals. That is the correct end state for a browser-only app: honest capability, SDK-mediated access.

### Not proposed

- **Finder, App Store, and Icon Gallery** stay shell apps. The Finder owns windows, menus, desktop geometry, the zoom animation, and — as on System 7 — the About box and Control Panel windows; the App Store installs code; Icon Gallery is a developer view over the OS's own catalog. Making these SDK-clean would mean exposing shell internals (resource catalogs, settings, the package manifest) as API for no third-party consumer. Document them as the three shell apps and move on. If a third-party app ever needs the system pattern or icon catalog, a `@mockintosh/resources` package is the shape (see "Recorded, not planned" above).
- **An "About" SDK surface beyond `about`.** `SolidApp.about` (component or version/description) already exists; the Apple menu's first item is the active app's About and the OS draws a standard box when none is declared. Nothing more is needed.
- **`@mockintosh/markdown` as an allowed import.** Cheaper to re-export `parseMarkdown` and a `<Markdown>` component from the SDK than to grow `sharedBuildImports` and the import map. One allowed surface stays one.

## Enforcement

Add `apps/sdkClean.test.ts`: for every entry in an explicit `SDK_CLEAN` list, read the app's source tree, run `validateSources` and the project `typecheck` from the builder on it, and assert zero diagnostics. Also assert the *inverse*: an app not in the list must fail, so that when a fix lands the list is updated deliberately. The list is the manifest the agent plan's source volume flags exemplars with, generated from one place.

`APP_DEV_GUIDE.md` gets a "bundled apps" table generated from the same list, replacing the aspirational sentence.

## Phases

Ordered so each phase flips apps to clean and is independently shippable.

### Phase 1 — Cheap wins and the test (½ day)

- `apps/sdkClean.test.ts` with `MacPaint`, `Safari`, `Testing`.
- FileViewer: import `MIME` from the SDK.
- SDK re-exports `parseMarkdown` + `<Markdown>`; MarkdownView and FileViewer flip.
- **Result: 5 of 11 clean.** Done.

### Phase 2 — Media services and the scheduler (2–3 days)

- `Platform.images/video/camera` on the web platform; `AppContext.images/video/camera`; capabilities derived from services; `HostCapability` shrinks to `browser`.
- `AppContext.scheduler`.
- `toBits`/`createDitherer` in the SDK from `photobooth/dither.ts`.
- Picture, VideoPlayer, PhotoBooth flip. Photo Booth's viewfinder `<raster revision>` loop moves to `scheduler.requestFrame`.
- **Result: 8 of 11 clean.** Done. Ditherers live in `@mockintosh/ui` and are re-exported by the SDK. Bonus: these three apps now have a portability story for the e-paper build.

### Phase 3 — Kernel grants and kernel client (3–4 days)

- Session operation allowlists in the kernel; `permission` errors on out-of-grant `invoke`; tests for revocation and stale sessions.
- `AppContext.kernel` behind `permissions: ["kernel:…"]`; `AbortSignal` → `Cancellation` bridge; `OperationStreams` exposed for `run_shell`.
- `Resource` / `Job` wire types to `src/shared`, re-exported from the SDK.
- SourceEditor first (it proves a third party could ship a better editor), then Terminal.
- **Result: 10 of 11 clean.** Done. Wire schemas live in `@mockintosh/protocol` (SDK and agent cannot import `src/shared`).

### Phase 4 — Agent package and Spotify (2–3 days)

- `packages/agent`; ChatGippity flips.
- SDK `crypto`, `encodeQR`, manifest `config`; `AppContext.browser`; Spotify drops every global and the npm dependency, keeps `requires: ["browser"]`.
- **Result: 11 of 11 clean; Finder, App Store, and Icon Gallery documented as the shell.** Done.

## Trade-offs to decide up front

- **Grants are a new kernel concept.** Phase 3 adds an ACL the kernel deliberately did not have. The alternative — keep Terminal/SourceEditor/ChatGippity as shell apps — is legitimate and cheaper. The argument for doing it is that a third-party editor, terminal, or agent front-end is exactly the kind of app a hackable Macintosh should allow, and the same grant model is needed for remote callers anyway.
- **Media services set the portability bar.** Once `images`/`video`/`camera` are services, an embedded platform must implement or omit them; there is no "just use the DOM" escape hatch. That is the point, but it means the web implementations must be complete enough that bundled apps lose nothing.
- **`browser` becomes SDK-mediated, not raw.** External Vite-built App Store apps can still use the DOM directly; the SDK only promises what it exposes. Bundled apps should model the honest path.

## Relationship to other plans

- The [agent plan](chatgippity-agent-plan.md) needs the SDK-clean list to flag exemplars on the source volume; Phase 1 here produces it. Every app that flips becomes a safe reference for the agent.
- The [physical product](physical-product-plan.md) / embedded direction needs G1–G3 regardless of the agent; this plan front-loads them.
- The [server infrastructure plan](server-infrastructure-plan.md) assumes kernel grants; Phase 3 here is where they would be built.
