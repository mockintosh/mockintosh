# libfx in an embedded terminal: findings and bug reports

Mockintosh runs fx's terminal interface (`createFxTerminal` from [libfx](https://github.com/vercel-labs/fx/tree/main/sdk)) inside its own terminal emulator, in a Web Worker, with a host `workspace` whose `exec` runs bash on the Mockintosh disk. That's `fx.ts` beside this file, and `src/platform/web/agentRuntime.ts`. This note collects what we found while doing it, written so each item can go upstream as an issue.

- **Versions tested:** libfx 0.0.11, 0.0.13 and 0.0.13-dev.1415.g607b1632fff6. The results below are the same in all three unless noted.
- **Backend:** `wasm-jspi`, the browser build's core. The terminal surface has no native addon (`LIBFX_NATIVE_SURFACE_MISSING`), so in Node 24 libfx runs the same WebAssembly core as in Chrome.
- **Model:** a scripted gateway passed as `fetch`, so the runs are deterministic and need no key (see [Repro](#repro)). On 7 October 2026 we confirmed #1 against the live AI Gateway (0.0.13, model `grok-4.7`), and checked the working setup there end to end (see [Live check](#live-check)).

**The working setup**, which Mockintosh uses: give `createFxTerminal` a workspace with `permission: "allow-sandboxed"`. The [Terminal docs](https://fx.sh/docs/lib/terminal.md) say that with it "fx runs commands without asking; your adapter enforces access restrictions". fx then runs workspace commands in its default mode, with no reviewer and no full access. Even `FX_PERMISSION_MODE=ask` doesn't prompt, so it doesn't freeze. Issues 1, 2 and 4 only arise with `permission: "prompt"`, which hands commands to fx's own permission mode. We first chose `"prompt"`, met #1 and #2, and worked around them with full access before finding this.

## Summary

| # | Finding | Severity for an embedder |
|---|---|---|
| 1 | With a `"prompt"` workspace, auto mode, the default, holds every command: no safety reviewer is configured and none is ever requested | High for `"prompt"` workspaces: the default mode can't run any command |
| 2 | With a `"prompt"` workspace, ask mode busy-waits once it asks for approval: 100% CPU, the event loop never runs again, the approval key can't arrive | High for `"prompt"` workspaces: freezes the tab or worker |
| 3 | The terminal surface takes no host context: `instructions`, `tools` and skills are ignored, `--system` refuses to start, and `AGENTS.md` is never read in the browser | Medium: the agent doesn't know where it is |
| 4 | In full access, an acknowledgment notice (✗) appears at every start: it is written to a settings file the browser build can't open | Low: cosmetic |
| 5 | `FX_PERMISSION_MODE` takes undocumented values and silently ignores unknown ones (`full_access` falls back to auto) | Low |
| 6 | Several host contracts are undocumented: the workspace `info` rules, store shapes, the gateway stream format | Low: documentation |

## 1. With a `"prompt"` workspace, auto mode holds every command

**What happens.** With `workspace.permission: "prompt"` and the default permission mode, the model's `shell` call never runs. fx shows `└ Review unavailable echo hello`, and the tool result sent back to the model is:

```json
{"type":"execution-denied","reason":"{\"error\":{\"type\":\"tool_review_held\",\"tool_name\":\"shell\",\"message\":\"Safety reviewer unavailable; action held\",\"reason\":\"review_unavailable\",\"review_cause\":\"reviewer_unconfigured\",\"held\":true,\"suggestion\":\"The action did not run because safety review was unavailable. Continue with a different safe action or retry later.\"}}"}
```

Only two model requests are made: the turn, and its continuation with the denial. No reviewer request is ever sent, so this isn't the gateway failing; nothing is configured to review. The system prompt still says "permission mode is auto … fx sends each unresolved action to a narrow safety reviewer".

**Expected.** fx's [permission docs](https://fx.sh/docs/configure-fx/permissions.md) say auto mode sends "unrecognized or dynamic shell commands" to a reviewer model (`openai/gpt-5.6-luna` on the AI Gateway by default), which `review_model` in `~/.fx/settings.json` or `FX_REVIEW_MODEL` can change. In the embedded build no reviewer is ever called. Setting `FX_REVIEW_MODEL=openai/gpt-5.6-luna` changes nothing: still two requests, still `reviewer_unconfigured`. Either the reviewer should work through the host's gateway (`fetch`), or the docs should say that a `"prompt"` workspace can't run commands in auto mode. Even `echo hello` was held, though the docs class "recognized project commands" as routine.

The live gateway gives the same result. The command was held with `review_cause: "reviewer_unconfigured"`, there were two model requests and no reviewer request, and the model's reply was "Blocked."

**Impact.** With a `"prompt"` workspace, fx's default can't do anything with it.

**Mockintosh today.** Uses `"allow-sandboxed"` (the working setup above). Our workspace is the sandbox: bash on the simulated machine, never the host.

## 2. With a `"prompt"` workspace, ask mode freezes once it asks

**What happens.** With `workspace.permission: "prompt"` and `FX_PERMISSION_MODE=ask`, fx starts normally and its status line reads `ask · …`. When the model's `shell` call needs approval, the process goes to 100% CPU and never returns to the event loop:
- the repro's 10-second `setTimeout` watchdog never fires;
- `fetch` and terminal input are never serviced;
- the key that would answer the prompt can't be delivered.

Idle Ask mode, with no pending approval, doesn't spin.

**Likely cause** (not verified): the approval loop polls for terminal input through an import that returns synchronously when nothing is queued. It would then spin inside the core without suspending (JSPI only yields when an import returns a promise).

**Expected.** The approval prompt waits for input by suspending, like the normal composer.

**Impact.** In a browser this freezes the tab, or the Web Worker running fx. We reproduced it in Node; we didn't try it in a browser, where it would freeze the window.

**Mockintosh today.** Unaffected: with `"allow-sandboxed"`, fx never asks.

## 3. No host context on the terminal surface

**What happens.**
- `createFxTerminal` ignores `instructions` and `tools`, which `createFxAgent` accepts, and there's no skills hook. A marker passed as `instructions` never appears in a model request.
- `args: ["--system", "…"]` stops fx before it becomes interactive, with `WasmTerminalInteractiveLaunchRequired`.
- `AGENTS.md` is never read. The core's WASI `path_open` is unavailable in the browser build, and it never asks the workspace for one: across a turn with a tool call, `exec` is called only with the model's command. The core does have project-instruction support ("reduce applicable AGENTS.md files", "Reading project instructions before continuing"), but it seems to depend on a file system.

**Expected.** One of:
- an `instructions` (or skills) option for `createFxTerminal`, as for agents;
- reading `AGENTS.md` through the workspace (`exec` or a read hook);
- host tools on the terminal surface.

**Impact.** fx can't be told what environment it's in. Ours is just-bash on a simulated Mac with its own commands for building apps. The system prompt it does get ("Native host paths, git, Node, npm, Python … are unavailable") is generic.

**Mockintosh today.** Every model request goes through the `fetch` the host supplies, so `fetchWithInstructions` (`src/platform/web/agentInstructions.ts`) inserts one more system message after fx's own: our brief plus any `AGENTS.md`. It works with 0.0.11 and 0.0.13, but it depends on the gateway request format (`{ prompt: [...] }`), which isn't a public contract.

## 4. ✗ notice at every start in full access (`FX_PERMISSION_MODE=full-access`)

**What happens.** Each start in full access prints `✗ full-access-acknowledgment: active for this process but not saved to user settings (FileNotFound)`, or `(HomeNotSet)` without `HOME` in `env`. The host supplies `configStore`, but the acknowledgment is saved to a settings file through WASI, which the browser build can't open.

**Expected.** Persist it through `configStore` when one is supplied, or don't report it as a failure in embedded builds.

## 5. Undocumented `FX_PERMISSION_MODE` values

| Value | Result |
|---|---|
| `full-access`, `yolo` | full access |
| `ask` | ask (see #2) |
| `full_access`, and presumably any other unknown value | silently auto (see #1) |

The core has `InvalidPermissionMode` errors, but they aren't raised for these. **Expected:** documented values, and an error for unknown ones.

## 6. Contracts we had to infer

These work, but we found them by reading `fx-sdk.js` and the core's strings. Documenting them would help embedders:

- **Workspace info.** `prepareWorkspaceAdapter` silently rejects a workspace unless `version` is 1, `cwd === root`, `gitAvailable === false`, `ephemeral === true`, and `permission` is `"allow-sandboxed"` or `"prompt"`. The Terminal docs describe `permission`, but not that `"prompt"` combined with the default mode runs nothing in the browser (#1).
- **`sessionStore.list()`.** The record shape is unknown. The core's strings mention `updated_at_ms`, `created_at_ms` and `revision`. We return `[]`, so resuming from a picker isn't offered.
- **Gateway stream.** The `fetch` response the core accepts is AI SDK stream parts as SSE (`data: {…}`). `finish` needs `finishReason: { unified, raw }` and nested `usage` (`inputTokens: { total, noCache, cacheRead, cacheWrite }`, `outputTokens: { total, text, reasoning }`). The older flat shapes fail with `InvalidProviderFinishReason`. This is what lets an embedder test fx without a key; see the repro.
- **Types.** The package ships no TypeScript declarations (we keep our own in `src/platform/web/libfx.d.ts`).

## Repro

Plain libfx, no Mockintosh code. The script uses `permission: "prompt"`, the setting that triggers #1 and #2; change it to `"allow-sandboxed"` and every mode runs the command. Save as `repro.mjs` in a folder with `{ "type": "module" }` in its `package.json`, run `npm install libfx@0.0.13`, then:

```bash
node repro.mjs               # 1: held, reviewCause "reviewer_unconfigured", shellCommandsRun []
node repro.mjs full-access   # works: shellCommandsRun ["echo hello"]; 4: notSavedNotice "FileNotFound"
node repro.mjs full_access   # 5: silently auto, held
node repro.mjs ask           # 2: never prints; 100% CPU; stop it with Ctrl-C
```

Every run also prints `hostInstructionsReachedModel: false` and `agentsMdRequested: false` (#3).

```js
// libfx embedded-terminal repro: a scripted AI Gateway makes the model call
// the workspace `shell` tool once, then prints what happened to it.
//   node repro.mjs [FX_PERMISSION_MODE]   e.g. node repro.mjs, node repro.mjs full-access, node repro.mjs ask
import { createFxTerminal } from "libfx";

const mode = process.argv[2];
let screen = "";
const dataHandlers = new Set();
const terminal = {
  write: (bytes) => { screen += typeof bytes === "string" ? bytes : new TextDecoder().decode(bytes); },
  onData: (handler) => (dataHandlers.add(handler), () => dataHandlers.delete(handler)),
  cols: 100,
  rows: 30,
  onResize: () => () => {},
};

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
const sse = (parts) => new Response(parts.map((p) => `data: ${JSON.stringify(p)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
const requests = [];
const gateway = async (url, init) => {
  requests.push({ url, body: new TextDecoder().decode(init.body) });
  if (requests.length === 1) {
    return sse([
      { type: "stream-start", warnings: [] },
      { type: "tool-call", toolCallId: "call_1", toolName: "shell", input: JSON.stringify({ action: "run", command: "echo hello" }) },
      { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage },
    ]);
  }
  return sse([
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: "done" }, { type: "text-end", id: "t" },
    { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
  ]);
};

const executed = [];
const fx = await createFxTerminal({
  terminal,
  env: { AI_GATEWAY_API_KEY: "test-key", HOME: "/work", ...(mode ? { FX_PERMISSION_MODE: mode } : {}) },
  fetch: gateway,
  // Accepted by createFxAgent; not used by the terminal surface.
  instructions: "MARKER-HOST-INSTRUCTIONS",
  workspace: {
    info: { version: 1, root: "/work", cwd: "/work", home: "/work", gitAvailable: false, ephemeral: true },
    permission: "prompt",
    // Any AGENTS.md the core asks for through the workspace would show up here.
    exec: async ({ command }) => (executed.push(command), { exitCode: 0, stdout: command.includes("AGENTS") ? "MARKER-AGENTS-MD\n" : "hello\n", stderr: "" }),
  },
  openUrl: () => false,
  clipboard: null,
});
setTimeout(() => console.log("watchdog: the event loop is still running"), 10_000).unref();
await fx.interactive;
for (const handler of dataHandlers) handler("say hello\r");
await new Promise((resolve) => setTimeout(resolve, 3000));

const mentions = (text) => requests.some((r) => r.body.includes(text));
console.log(JSON.stringify({
  mode: mode ?? "(default)",
  modelRequests: requests.length,
  shellCommandsRun: executed,
  held: /Review unavailable|action held/.test(screen) || mentions("reviewer_unconfigured"),
  reviewCause: mentions("reviewer_unconfigured") ? "reviewer_unconfigured" : null,
  hostInstructionsReachedModel: mentions("MARKER-HOST-INSTRUCTIONS"),
  agentsMdRequested: executed.some((c) => c.includes("AGENTS")),
  notSavedNotice: /not saved to user settings \(([A-Za-z]+)\)/.exec(screen)?.[1] ?? null,
}, null, 2));
fx.abort();
process.exit(0);
```

Output on libfx 0.0.13, Node 24.20.0, macOS arm64:

```
default      {"modelRequests":2,"shellCommandsRun":[],"held":true,"reviewCause":"reviewer_unconfigured",...}
full-access  {"modelRequests":2,"shellCommandsRun":["echo hello"],"held":false,...,"notSavedNotice":"FileNotFound"}
yolo         same as full-access
full_access  same as default
ask          no output; still running at 100% CPU after 25 s
```

In Mockintosh, `packages/terminal/tests/fx.test.ts` runs real fx the same way through the whole stack: Terminal, the pseudo-terminal, bash on the disk, and the `fetchWithInstructions` workaround.

## Live check

`packages/terminal/tests/fx.live.test.ts` is opt-in, because it spends tokens. It runs real fx with a live model through the whole stack, on a headless Macintosh with the real compiler:

```bash
FX_LIVE_KEY_FILE=/path/to/key FX_LIVE_LOG=/tmp/fx-live.log npx vitest run packages/terminal/tests/fx.live.test.ts
```

Asked to "build and launch a small Mockintosh app titled Hello Fx … whose window shows the text Hello from fx", fx (0.0.13, `grok-4.7`, with our brief; this run used full access, before we found `"allow-sandboxed"`) did it in about 25 seconds, and did it twice:
1. read examples under `/system/source/apps`;
2. ran `project … blank`;
3. wrote `src/index.tsx`;
4. ran `check` ("No problems.");
5. ran `build --run`;
6. confirmed with `windows` and `inspect` (and, the second time, `logs`);
7. reported accurately.

The app's window showed the text. The brief is what told it these commands exist: the commands it ran are the ones the brief names.
