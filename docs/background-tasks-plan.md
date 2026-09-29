# Background tasks: plan

Status: proposed. No code yet.

## Why

Apps that do heavy work today either slice it across display frames on the UI thread, which is slow, or do it all at once and freeze the Macintosh. The OP-1 now does the second: it bounces a demo song in one go under the watch cursor (`os.busy`), which stops the screen and all other apps for about a second. Everything an app runs shares one thread with the shell, the other apps, and the audio callbacks.

A **task** is work an app hands to the OS to run off the UI thread: it takes an input, may report progress, and returns a result. The app never sees a `Worker`. The OS owns the task's lifetime, and the platform decides how it runs: a module worker on the web, the same thread on hosts without threads.

The Macintosh never had this for applications until the Thread Manager (System 7.5, cooperative threads in the app's heap). Tasks are closer to a worker pool than to threads: no shared memory, no locks, messages in and out.

## Goals

- One SDK contract for background work, the same in bundled apps, template-built apps and apps built inside the OS.
- Real parallelism on the web. The UI thread only posts the input and receives the result.
- Every host can run tasks. A host without threads runs them in place, so apps never check a capability or declare `requires` for them.
- Task code can't reach the UI, the OS or the file system. It is a pure function of its input.
- Tasks end with the app instance that started them, as audio streams and microphone inputs do.
- Tests stay deterministic, and they catch data that couldn't cross a thread boundary.

## Non-goals

- Shared memory (`SharedArrayBuffer`, `Atomics`). It needs cross-origin isolation headers and changes the threat model. Revisit if a real need appears.
- Long-lived services or tasks that outlive their app.
- Tasks that call the kernel, the file system, `fetch` or the audio service. A task gets its input and returns a value; the app does I/O before and after.
- Running untrusted code more safely than the app's own code runs today. Task code has the same trust as the app that ships it (see Security).

## The contract

### Writing a task

A task lives in its own module whose name ends in `.task.ts` (or `.task.tsx`, `.task.js`). Its default export is `defineTask(…)`. It imports only relative modules and `@mockintosh/sdk/task`.

```ts
// apps/op1/bounce.task.ts
import { defineTask } from "@mockintosh/sdk/task";
import { bouncePart, type Song } from "./song";

export interface BounceInput { song: Song; part: number; sampleRate: number }
/** How much of the part is on tape, 0…1. */
export type BounceProgress = number;

export default defineTask(async (input: BounceInput, ctx): Promise<Float32Array> => {
  return bouncePart(input.song, input.part, input.sampleRate, {
    onProgress: (fraction) => ctx.progress(fraction),
    // Lets a host without threads keep drawing; free in a worker.
    pause: () => ctx.yield(),
    signal: ctx.signal,
  });
});
```

`@mockintosh/sdk/task` is a new UI-free SDK entry: `defineTask`, the task types, and the SDK's pure helpers (`encodeWav`, `decodeWav`, `midiToFrequency`, `noteName`). It imports nothing from `@mockintosh/ui`, `solid-js` or the OS, so it can be bundled into a worker. The main `@mockintosh/sdk` entry re-exports it.

```ts
export interface TaskContext<P> {
  /** Report how far the task has got. The app sees the latest value; values may be dropped in between. */
  progress(value: P): void;
  /** Aborted when the app cancels the task or quits. */
  readonly signal: AbortSignal;
  /**
   * Give the host a chance to do other work. Free in a worker; on a host
   * without threads this is where the display gets to draw. Long tasks
   * should call it every few milliseconds of work.
   */
  yield(): Promise<void>;
}

export type TaskFunction<I, O, P> = (input: I, ctx: TaskContext<P>) => O | Promise<O>;
export interface TaskDefinition<I, O, P> { readonly run: TaskFunction<I, O, P> }
export function defineTask<I, O, P = never>(run: TaskFunction<I, O, P>): TaskDefinition<I, O, P>;
```

### Starting a task

Importing a task module from app code gives the app a **handle**, not the function:

```ts
import bounceTask from "./op1/bounce.task";   // TaskModule<BounceInput, Float32Array, BounceProgress>

const runs = song.parts.map((_, part) => app.tasks.run(bounceTask, { song, part, sampleRate }));
runs.forEach((run, part) => run.onProgress((fraction) => setProgress(part, fraction)));
const tracks = await Promise.all(runs.map((run) => run.result));
```

```ts
/** A task module as an app holds it; built by the toolchain from a `.task.ts` file. */
export interface TaskModule<I, O, P> {
  readonly id: string;            // the module path, for messages and the debugger
  /** @internal The task bundled as one self-contained ES module. */
  readonly source: string;
  /** @internal The same task, loaded in this realm, for hosts without threads. */
  readonly definition: TaskDefinition<I, O, P>;
}

export interface TaskRunOptions {
  /** ArrayBuffers in the input to move to the task instead of copying. The app loses access to them. */
  transfer?: readonly ArrayBuffer[];
}

export type TaskState = "running" | "done" | "failed" | "cancelled";

export interface TaskRun<O, P> {
  /** Settles once: the result, or a `TaskError` (failed, cancelled, the app quit). */
  readonly result: Promise<O>;
  state(): TaskState;
  /** The latest progress value, if any has arrived. */
  progress(): P | undefined;
  /** Returns an unsubscribe function. */
  onProgress(listener: (value: P) => void): () => void;
  cancel(): void;
}

export interface TaskService {
  run<I, O, P>(task: TaskModule<I, O, P>, input: I, options?: TaskRunOptions): TaskRun<O, P>;
}
```

`useApp().tasks` and `AppContext.tasks` are always present.

### Data across the boundary

Input, progress values and results must be structured-cloneable: plain objects, arrays, numbers, strings, typed arrays, `Map`, `Set`. They can't be functions, class instances with methods, or Solid stores. ArrayBuffers in a **result** are transferred automatically, since the task has no further use for them: a bounced track comes back without a copy. Input buffers are copied unless listed in `transfer`.

The in-place runner clones the same data (see Platform), so a test fails on an uncloneable value just as the browser would.

### Errors and cancellation

- A throw in the task rejects `result` with a `TaskError` whose `reason` is `"failed"` and whose message and stack come from the task.
- `cancel()`, and the app quitting, reject with `reason: "cancelled"`. On the web the worker is terminated at once, so a task needn't check `signal`. In place, cancellation only lands at the task's next `yield()` or `signal` check; that is the price of having no threads.
- A worker that fails to start (bad bundle, host refusal) rejects with `reason: "failed"` before the task runs.

## How the code reaches the worker

A worker can't use the page's import map, and apps built inside the OS are a single file. So each task module is **bundled on its own at build time, into a string**, and the importing app gets that string inside the handle. The app's build output stays a single file, build records don't change, and every pipeline produces the same thing.

Importing `./bounce.task` from app code compiles to:

```js
import definition from "\0task-direct:./bounce.task";   // the task in this realm, bundled normally
export default { id: "op1/bounce.task", source: "…the task and its imports, as one module…", definition };
```

The task code therefore appears twice in the app bundle: once as real code for in-place hosts, once as a string for workers. For the OP-1 engine that's tens of kilobytes. If it matters later, the string could become a separate asset in pipelines that can emit files.

### Rules the build enforces on a task's import graph

- Only relative imports and `@mockintosh/sdk/task`. `@mockintosh/sdk/task` is **bundled into** the task, not left external, because the worker has no import map. Importing `@mockintosh/sdk`, `@mockintosh/ui`, `solid-js` or `@mockintosh/quickdraw` from the task graph is a build error naming the import chain. Type-only imports are fine, since they're erased.
- The same banned host globals as app code (`buildPolicy.ts`), plus the worker's own: `self`, `postMessage`, `importScripts`, `close`.
- Task modules can't import other task modules.

### One plugin core, three pipelines

A shared module (`src/shared/taskModules.ts`) owns the id convention, the graph rules and the generated wrapper. Each pipeline gives it a way to bundle one entry into a string:

| Pipeline | Bundler | Where |
| --- | --- | --- |
| In-OS builder (browser worker and companion) | `@rollup/browser` / rollup | `src/platform/web/builder/compiler.ts`, `scripts/builder/compiler.ts` |
| Main web build and dev server | Vite (rolldown) | `vite.config.ts` |
| Third-party template | Vite | `templates/app/vite.config.ts`, ideally as a published `@mockintosh/sdk/vite` plugin |

The in-OS builder needs the source of `@mockintosh/sdk/task` to bundle it. It already embeds the SDK sources for typechecking, and `sdk/task` must stay small and self-contained so that is enough.

## OS

`src/os/tasks.ts` provides `TaskService` per app instance, like `instanceAudio` does for the speaker:

- Every run is owned by its instance (`os.instances.own`). Quitting or restarting the app cancels its runs.
- It enforces a limit on concurrent runs per app (proposed: 4) and queues the rest in order. A queued run's `state()` is `"running"` and it can be cancelled.
- It uses `Platform.tasks` when present, or else the in-place runner, which is also OS code.
- It adds no kernel traps in the first pass. Listing an instance's running tasks in `instances` output is a small follow-up.

## Platform

```ts
interface Platform {
  /** Runs tasks off the display's thread. Absent = the OS runs them in place. */
  tasks?: TaskHost;
}

interface TaskHost {
  start(source: string, id: string, input: unknown, transfer: readonly ArrayBuffer[], events: TaskHostEvents): TaskHostRun;
}
interface TaskHostEvents {
  progress(value: unknown): void;
  done(result: unknown): void;
  failed(message: string, stack?: string): void;
}
interface TaskHostRun { cancel(): void }
```

The host sees only source strings and cloneable values. It never sees app types.

- **Web** (`src/platform/web/tasks.ts`): a module worker per run, from one bootstrap script bundled by Vite. The bootstrap imports the task source from a Blob URL (as `loadArtifact` already does), runs it, posts progress and the result (with its buffers transferred), and handles cancel. It is terminated on cancel and when the run settles. There is no pool at first: worker start-up is a few milliseconds, and pooling can come later if it shows up in a profile. The global limit is `navigator.hardwareConcurrency - 1`, at least 1.
- **Headless**: no `Platform.tasks`, so the OS's in-place runner is exercised. `createHeadlessPlatform({ tasks: "threaded" })` could add a host that also round-trips through `structuredClone` and resolves on the next `tick`, to test apps that assume the result arrives later.
- **Boards and QuickJS**: in place, with no work needed. Tasks that `yield()` keep the display alive.

## OP-1 as the first user

- `apps/op1/sampler.ts` imports `encodeWav` and `decodeWav` from `@mockintosh/sdk/task` rather than the main entry. Nothing else in the song and engine graph imports the SDK at runtime.
- `apps/op1/song.ts`: `SongBounce` becomes a plain function, `bouncePart(song, part, sampleRate, { onProgress, pause, signal })`, that calls `pause` every so many blocks. Task code has no clock, so it counts blocks rather than milliseconds. The deterministic 256-frame blocks stay.
- `apps/op1/bounce.task.ts`: one task per part (`{ song, part, sampleRate }` → `Float32Array`), so the four tracks bounce in parallel. Each track appears on the tape as it finishes, driven by real progress.
- `apps/OP1.tsx`: the `os.busy` freeze goes. A sample-rate change cancels and restarts the runs. Tape › Demo Songs is disabled while a bounce runs.
- Expected: the same load time as the freeze or less, without stopping the Macintosh. Measured single-threaded in Node a song takes 0.3–1.2 s, and four parts in parallel should take roughly a quarter of that.

## Stages

Each stage lands on its own with its tests green.

1. **SDK contract and OS runner.** `@mockintosh/sdk/task` with a `package.json` export. App code imports it like the rest of the SDK, so it also needs an import-map entry and a `sharedBuildImports` entry; it is external in app code and bundled in task graphs. Also the `TaskService` types, `src/os/tasks.ts` with the in-place runner, cloning, instance ownership and the concurrency limit, and `AppContext.tasks`. Tests build handles by hand with a test helper. There are no build changes yet.
2. **In-OS builder.** `src/shared/taskModules.ts`, the rollup plugin in both builders, and the task-graph rules in `buildPolicy.ts` with a clear message per rule. Compiler tests cover a task project and each rule's failure. The SDK-clean gate (`apps/sdkClean.test.ts`) must pass with a bundled app that imports a task.
3. **Vite and web workers.** The Vite plugin for build and dev server, `src/platform/web/tasks.ts` and the worker bootstrap, and a browser check that a task runs in a worker and cancel terminates it.
4. **OP-1.** The migration above, with the OP-1 headless test driven through the task and a check that quitting mid-bounce cancels.
5. **Template and docs.** The template plugin, `APP_DEV_GUIDE.md` (writing a task, the data rules, what can't be imported), `ARCHITECTURE.md` (the `Platform.tasks` row, the layering note, and `tasks.ts` in the directory list), and `sdkClean` if its rules change.

Other apps may be worth moving once this exists, anywhere heavy work is now spread across display frames. For example, Surface computes its renders in its own `requestFrame` loop. I haven't audited the rest.

## Security

Task code comes from the same bundle as the app and runs with the same origin. A worker has no DOM, but it can reach `fetch` and IndexedDB, which is as much as app code in the page could reach by ignoring the SDK. The import rules and the banned-globals check keep honest code on the contract. They aren't a sandbox. If untrusted apps ever need isolation, it should come for the page code and the task code together, not for tasks alone.

## Open questions

1. **Dev server.** In `vite dev`, bundling a task into a string on every change needs a nested rolldown (or esbuild) build inside the plugin's `load`. The alternative in dev only is a worker URL (`?worker&url`) with the source loaded by URL. The plugin core would have to allow `source` to be a URL, so hosts would take either.
2. **Naming.** `tasks` and `.task.ts`, or `threads` after the Thread Manager? "Task" says it's a job that finishes; "thread" suggests shared state, which this doesn't have.
3. **Progress rate.** Should the OS throttle progress to one per display frame, or leave that to the task?
4. **Per-app limit.** Is 4 right, or should it follow `hardwareConcurrency`?
5. **Kernel visibility.** Should running tasks show up in `instances` (and so in Terminal and MCP) from the first pass?
