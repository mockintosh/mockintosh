# Apps in Web Workers

Plan, 30 September 2026. It follows the [Browsix research](browsix-research.md) §2 and the prototypes on this branch (Canvas, OP-1 and Showreel Webworker). Sections below the status table are proposals until their step is marked done.

## Decision

Every app runs in its own Web Worker unless it opts out. The Finder stays on the main thread for now. The main thread keeps the shell: window manager, menubar, dialogs, the Finder, the display and input. An app's code, its Solid tree, layout, drawing, timers and sound rendering run in the worker. The worker reaches the OS only by messages.

Why, from the prototypes (headless Chrome, 60 fps):

| | Main thread busy |
| --- | --- |
| Showreel on the main thread | ~22.5% |
| Showreel in a worker | ~7% |
| Idle desktop | ~0.8% |

- The app's work leaves the main thread. The rest is the display and the copy of each frame into the window.
- A hung app can be stopped. `worker.terminate()` makes Force Quit real.
- `requires` and kernel grants can be enforced. A worker can only do what the host answers. Namespace grants in one realm are not a sandbox ([kernel plan](kernel-plan.md) §5).
- Sound keeps playing when the main thread is busy. The worker renders into the speaker's audio thread through a port (`AudioService.openPort`) and no sample passes through the main thread.
- Each worker has its own Solid, `@mockintosh/ui` and QuickDraw. The globals that forced one shared runtime (`thePort`, the Font Manager, the cursor, `createUI`'s single instance) become per-process.

The cost: input reaches the screen about one frame later than on the main thread, and each worker loads its own copy of the runtime and fonts. Step 4 measures both before the default changes.

### The Finder stays on the main thread

The Finder is the shell's desktop as much as an app. It paints the desktop and its icons, it is the frontmost app when nothing else is open, and it drags files between folder windows and the desktop through OS state (`apps/Finder.solid.tsx` imports `src/os`). It draws little per frame, so a worker saves it little. It can move after the OS has a drag service and document events (Apple Events, [Browsix research](browsix-research.md) §5).

The App Store and Icon Gallery move once their `src/os` imports are traps. The App Store then installs through a granted operation, not direct access.

Kernel clients (Terminal, Source Editor, ChatGippity, fx) suit workers well: their `AppContext.kernel` calls are already serializable trap invocations.

## Architecture

### One worker per app instance

A worker is a process. `AppInstances` (`src/os/instances.ts`) gains a process for each instance that runs in a worker. `onOpen` runs in the worker with a proxied `AppContext`. Each `openWindow` there opens an ordinary OS window on the main thread, whose content is the worker's picture of it. Quitting or failing the instance terminates the worker. Closing the last window ends the instance as it does today.

Inside the worker, `createUI` stays single-instance. All the process's windows share one UI instance: each window's tree is laid out in its own band of one tall offscreen bitmap, and the worker sends each window only its own band. Pointer and key events carry the window id and are translated into that band.

### Messages

`src/os/process/protocol.ts` defines the messages. It is the prototype's protocol plus window ids:

- **Host → worker:** start, open result, window size, active, kind, pointer, key, menu action, catalog snapshot, printer and audio state, video progress, replies.
- **Worker → host:** `openWindow` / close, frames per window, cursor, menus, calls.

Calls are the `AppContext` surface by name (`fs.writeJSON`, `os.showDialog`, `audio.openPort`, `video.excerpt`, `kernel.invoke`, …). The host answers each call with the instance's real `AppContext`, so grants and ownership are enforced where they are today.

Synchronous reads have local answers in the worker:

- **Catalog:** a mirror of the catalog that the host resends when it changes.
- **Fonts and sprites:** tables sent at start and kept in sync.
- **Window state:** size, active and kind signals.

### Where the code goes

| Piece | Location | Notes |
| --- | --- | --- |
| Protocol | `src/os/process/protocol.ts` | DOM-free |
| Host: process, calls, window content | `src/os/process/host.ts`, `WorkerWindowContent` in `components/` | DOM-free; talks to a `ProcessPort` |
| Worker runtime | `src/platform/web/process/` | Uses worker globals (`performance`, `crypto`, `MessagePort`), so it lives with the web host |
| Starting a worker | `Platform.processes?.spawn()` | Web: `new Worker(...)`. Headless: absent |
| Which module is an app | `src/appModules.ts` | One table the main thread and the worker share |

A platform without `processes` runs every app on the main thread, as today. That keeps the headless platform, `boot.test.ts` and device bring-up unchanged. `SolidApp.runtime: "main"` opts an app out anywhere.

### Loading app code in the worker

- **Bundled apps:** the worker imports the same module the main thread would, from the shared `appModules.ts` table.
- **Built in the OS (`src/os/projects`):** the host sends the artifact's code, and the worker imports it from a Blob URL.
- **App Store bundles:** the worker imports the bundle URL.

Module workers don't read the page's import map. So in the worker, bare `solid-js`, `@mockintosh/ui`, `@mockintosh/sdk` and `@mockintosh/quickdraw` imports must be rewritten to shim modules that re-export the worker's own copies. That is step 6. Until then, installed and built apps run on the main thread.

## Steps

Each step is a commit (or a few) on `worker-apps`, with tests and a browser check.

| # | Step | Status |
| --- | --- | --- |
| 0 | Prototypes, speaker port, faster RGBA expansion | done |
| 1 | Move the prototype into the OS: protocol, host, runtime, `Platform.processes`, shared module table; `SolidApp.runtime` | done |
| 2 | One worker per instance: `onOpen` and `openWindow` in the worker, several windows per process, About box | done, except custom About boxes (those apps stay on the OS's thread) |
| 3 | Input latency: render on input, not on the next tick after it; present the frame the same main-thread frame | done: pictures in shared memory (see below) |
| 4 | Measure memory and start-up per worker; decide whether small apps stay on the main thread | done: every app can have a process (see below) |
| 5 | Close the gaps, app by app: installed fonts, full sprite registry, microphone port, `printPage`, live video frames, `busy`, `keepAlive`, errors into the instance journal | |
| 6 | Third-party and built apps: import shims in the worker | |
| 7 | Make `worker` the default; retire the Webworker twins; Force Quit (⌘⌥Esc) | |

The prototype twins stay until step 7, so each step can be compared with the main-thread app.

## Input latency (step 3)

Measured from `pointerdown` to the pixels changing on the display canvas, clicking a Canvas tool at a random point in the display's frame (headless Chrome, 40 clicks each):

| | Click to pixels |
| --- | --- |
| Canvas on the OS's thread | 9.4 ms |
| Canvas in a process, pictures by message | 26.1 ms |
| Canvas in a process, pictures in shared memory | 11.8 ms |

The worker needs about 1 ms to handle a click and draw. The rest was the message queue. After an input event the browser renders before it delivers other messages, so a picture that was ready in time still arrived just after the OS's frame and waited a whole frame for the next one. The worker now publishes each window's picture in shared memory (`src/os/process/sharedFrame.ts`), and the OS takes it as its frame starts (`OSServices.beforeFrame`). Shared memory needs a cross-origin-isolated page, which the dev server and `vercel.json` provide. Where the browser can't isolate the page (Safari doesn't support `credentialless`), pictures still go by message and cost the extra frame.

## Cost of a process (step 4)

Production build (`vite build` + `vite preview`), headless Chrome, `performance.measureUserAgentSpecificMemory()`:

| | Page | Workers | Total | First picture |
| --- | --- | --- | --- | --- |
| Idle desktop | 7.0 MB | — | 9.4 MB | — |
| Canvas on the OS's thread | 9.2 MB | — | 11.1 MB | — |
| Canvas in a process | 6.6 MB | 4.2 MB | 16.2 MB | 49 ms after spawn |
| Showreel in a process | 11.9 MB | 7.0 MB | 19.8 MB | 158 ms |
| OP-1 in a process | 7.0 MB | 34.0 MB (its tapes) | 46.0 MB | 157 ms |

A process costs about 3–5 MB beyond the app's own memory (its runtime, fonts, and a second copy of the app's code) and 50–160 ms to its first picture. Ten open apps would cost about 40 MB. That's affordable, so no app stays on the OS's thread to save memory. The page still loads each process app's module to read its declaration. Loading only a manifest would save that copy (step 7).

## Risks

- **Hidden synchronous APIs.** An app that calls something synchronous the worker can't answer locally (a new `fs` read, `openersFor`) breaks in the worker. The worker runtime throws a clear error naming the call. The app runs on the main thread (`runtime: "main"`) until the call is served.
- **Memory.** Each worker carries a runtime and the fonts. If step 4 shows this matters, small apps stay on the main thread, or fonts load lazily.
- **Latency.** Drawing apps (MacPaint, Canvas) feel an extra frame. Step 3 must remove it, or those apps stay on the main thread.
- **Debugging.** A worker's errors and console output appear under a separate context in DevTools. Errors go to the instance journal (`instances.note`) as they do today.
