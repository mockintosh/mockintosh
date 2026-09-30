# What to borrow from Browsix

Research date: 2026-09-30. Sources: [browsix.org](https://browsix.org/), the [plasma-umass/browsix](https://github.com/plasma-umass/browsix) repository, and the ASPLOS 2017 paper *Browsix: Bridging the Gap Between Unix and the Browser* (Powers, Vilk, Berger). No code was written as part of this note.

## Recommendation

Keep building our own kernel. Do not adopt Browsix as a dependency. Take its main idea: a small, trusted kernel on the page, and untrusted code that reaches it only through serializable system calls. Our trap table is already halfway there.

Browsix provides Unix processes and a terminal. It has no windows, graphics, event loop, or Toolbox, which are the hard parts of Mockintosh. Its model is POSIX (file descriptors, `fork`, signals, TCP) rather than an event-driven Mac. It is research code that has been unmaintained for years, and it depends on patched forks of Emscripten and GopherJS. Integrating it would add a second filesystem and a second syscall layer to reconcile with `packages/fs` and `src/os/kernel/`. The pieces worth borrowing are a few hundred lines on top of what we already have.

## How Browsix is built

- **Kernel on the main thread.** A TypeScript kernel runs in the page and owns the process table, the file system and the sockets.
- **Processes are Web Workers.** They run in parallel with the page, so a long computation does not block the UI.
- **System calls are messages.** Processes reach the kernel only by `postMessage`. Sync syscalls were added later: the worker blocks on a `SharedArrayBuffer` with `Atomics.wait` while the kernel does the work. C and Go programs need this because they expect calls to block.
- **Unix semantics.** The kernel supports pid, parent, `wait`, `kill` and signal handlers, plus file descriptors and `pipe(2)`, so shell pipelines work.
- **Shared, layered file system.** It is built on BrowserFS, with a read-only base served over HTTP and a writable layer on top.
- **Sockets inside the tab.** Processes can listen on TCP ports, and the page's HTTP requests to those ports go to the worker. A demo runs Go microservices behind a page this way.
- **Runtimes target one ABI.** Patched Emscripten (C/C++) and GopherJS (Go), plus an in-browser Node.js, all compile to the same syscall interface. `fork` needed Emscripten's Emterpreter to save and restore the stack.
- **Security boundary.** Everything stays inside the browser tab's own sandbox. Nothing extra is granted.

## Where Mockintosh is today

See [ARCHITECTURE.md](../ARCHITECTURE.md) and the [kernel plan](kernel-plan.md) for detail.

- One JS realm on the main thread. Apps are Solid components that paint through QuickDraw into one 1-bit framebuffer.
- Apps call the OS directly through `useApp()` / `AppContext` (`src/os/appContext.ts`). Only kernel clients get `AppContext.kernel`.
- `src/os/kernel/` is a trap table. Its operations are declared with `defineOperation` and have schemas and session grants. MCP, the CLI, the companion, Terminal and the agent all use it.
- Some shell apps import from `src/os` directly: Finder and its panels, AppStore and IconGallery (`SHELL_APPS` in `apps/sdkClean.ts`).
- Third-party apps load as ESM through `Platform.loadModule` and run with full page privileges. As the kernel plan already says, manifest `requires` and namespace grants are not a sandbox.
- `AppInstances` (`src/os/instances.ts`) handles lifecycles but is deliberately not a process table.
- There is no inter-app messaging, the clipboard is text only, and there is no app-to-app drag.

## What to borrow

### 1. The trap table as the only door

This is what made Browsix work: a process has no reference to kernel objects, only a message channel. Apply the same rule to apps:

- Back each `AppContext` capability (fs, storage, windows, fetch, print, media) with a trap. The call can stay a direct in-realm function call for now. What matters is that the argument and result are serializable and pass through the grant check.
- Move Finder, AppStore and IconGallery off `src/os` imports. Anything they need that has no trap is a missing trap.
- Treat the SDK major version as the ABI version, the way Browsix's runtimes all targeted one syscall interface.

This fits kernel plan principle 1 (one operation implementation) and makes the next two steps possible. Keep reactive local reads where they matter (principle 4). Only mutations and capability access need to go through the trap table.

### 2. Untrusted apps in Workers

Now planned for every app except the Finder: see [Apps in Web Workers](worker-apps-plan.md).

Browsix splits trusted kernel from untrusted process along the Worker boundary. Do the same for App Store and other third-party apps. First-party apps stay in the main realm.

- A worker runs its own Solid, `@mockintosh/ui` and QuickDraw. This matches the kernel plan's "one UI runtime per realm": each worker is another realm. The global singletons (`thePort`, Font Manager, cursor) are then per worker instead of a blocker.
- The worker draws into its own 1-bit window bitmap. A full 512×342 screen is 22 KB, so it can post dirty rects, or the whole window, as transferable `ArrayBuffer`s. The window manager composites them.
- Input events, menu commands and trap calls are messages in the other direction.
- Force Quit (⌘⌥Esc) becomes real: `worker.terminate()` stops a hung app. With a shared realm, that is impossible.
- `requires` capabilities become enforced, because a worker can only do what the kernel answers.

The core already compiles without DOM types, which makes this feasible. The open questions are fonts and resources loading inside the worker, text measurement, and how much latency the round trip adds to live drags. A throwaway prototype with one SDK app (Counter, for example) running in a worker would answer them.

### 3. Process accounting for S2

The kernel plan already has `ps`, `kill` and `wait` waiting on "process accounting". The terminal plan has a `TerminalProcess` contract with an exit code and stop. Browsix's minimum is the right size for that work:

- a pid and a parent
- an exit status and `wait`
- `kill`, which ends in `worker.terminate()` for worker-hosted code, or in abort for in-realm commands
- stdin, stdout and stderr as streams, and pipes between commands

Put app instances, shell commands, builds and agent runs in the same table, so `ps` shows everything and `kill` cancels anything. Follow the kernel plan's rule not to allocate placeholder pids: add the table when the first thing needs to be killed.

### 4. Layered file system

BrowserFS's overlay has a read-only base from the server and a writable layer in the browser. For Mockintosh:

- The **base** is System Folder, fonts, bundled apps and printer driver JSON, served with each deploy.
- The **top layer** is the user's changes in OPFS.
- **Updates** ship a new base instead of migrating the catalog document (we are on v3 already).
- **Restore factory settings** means dropping the top layer, or one folder of it.

The kernel plan already has a mount table and `src/os/kernel/disk.ts` for resolving paths. Overlay is one more kind of mount. Delete-over-base needs whiteout entries in the catalog. Read ZenFS, which I understand is BrowserFS's maintained successor, for its overlay semantics. Build the layering into `packages/fs` rather than taking it as a dependency, because our catalog uses ids and roles, not paths.

### 5. A message-based way for apps to talk to each other

Browsix uses pipes and in-browser TCP sockets. The Mac equivalent is Apple Events:

- An app registers handlers for named events with schemas, the same way `defineOperation` declares traps.
- Other apps, shell scripts and the agent/MCP send events and await replies through the kernel.
- The core events ('oapp', 'odoc', 'pdoc', 'quit') take over what `onOpen(AppContext)` does today.

This crosses the worker boundary from §2 with no extra work. The plumber idea in the [Plan 9 research](plan9-research.md) sits on top of it: plumbing routes a message, and an Apple Event delivers it.

## What not to borrow

- **POSIX fidelity, `fork`, file descriptors as the universal handle, TCP emulation.** Browsix needs these to run unmodified Unix programs. We do not, and `fork` cost Browsix an interpreter mode in Emscripten.
- **Sync syscalls over `SharedArrayBuffer`.** This needs cross-origin isolation (COOP/COEP headers), which affects cross-origin module and image loads. Async messages suit Solid apps. Revisit only if we run blocking compiled code; the agent runtime's JSPI route is lighter for that.
- **Patched compilers.** Our SDK and the builder worker already are the toolchain.

## If we want real Unix programs in Terminal

Use a WASI runtime in a Worker, not Browsix. It would connect to the S2 stdin and stdout streams and appear in the process table as one more kind of process. It would read the VFS through traps, not a second file system.

## Suggested order

1. Trap coverage for `AppContext`, and shell apps moved off `src/os` imports (§1).
2. A throwaway prototype of one SDK app in a worker (§2).
3. Process accounting when S2 needs `kill` (§3).
4. Apple Events, starting with the core four (§5).
5. Overlay base layer when the next catalog migration comes up (§4).
