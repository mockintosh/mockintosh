# Closing the gap between ChatGippity and a repo-level coding agent

Written 15 September 2026. Companion to the [M2 app-building slice](m2-apps.md), the [kernel plan](kernel-plan.md) and the [server infrastructure plan](server-infrastructure-plan.md). This document diagnoses why the in-OS ChatGippity agent produces markedly weaker apps than an agent running in Cursor against this repository when given the same instruction (for example "build a drawing app"), and proposes a phased plan to close that gap.

The comparison is grounded in the current pipeline (`apps/Assistant.tsx` → `src/os/agent/*` → `/api/chat` → kernel traps → builder) and in what a Cursor agent actually used to produce `apps/MacPaint.tsx` (657 lines plus four helper modules and a test file, about 1500 lines in total).

## Why the output differs

The gap is not mainly "worse model". The ChatGippity agent is running a 1500-line task inside a harness sized for the 12-line Counter template. Ordered by impact:

### 1. Hard ceilings that make a drawing app physically impossible in one run

| Limit | Where | Effect on "build a drawing app" |
|---|---|---|
| `max_completion_tokens: 4096` | `api/chat.ts` | One `write` tool call must carry the whole file body. MacPaint's main file alone is ~19 KB ≈ 5–6k tokens. The model either truncates mid-file (invalid JSON args → `parseArguments` returns `{}` → "Missing path") or self-censors to something tiny. |
| `TOOL_RESULT_MAX = 4000` chars on **every** tool result | `src/os/agent/execute.ts` | `read` of a file over 4000 chars comes back truncated. The agent cannot read back its own source once it exceeds ~100 lines, so every fix is a blind full rewrite. Build diagnostics are also clipped. |
| `DEFAULT_BUDGET = { steps: 16, ms: 120_000 }` | `src/os/agent/loop.ts` | 16 model turns and 2 minutes wall clock *including LLM latency*. The Cursor run that produced MacPaint used well over a hundred tool calls across many minutes. A `write → build_submit → read diagnostics → write` cycle is 3–4 steps, so the agent gets ~4 repair iterations before "I hit my step or time budget". |
| Edge runtime, non-streaming | `api/chat.ts` (`config.runtime = "edge"`) | A 4k-token completion with reasoning can exceed the edge function's time-to-first-byte limit; failures surface as opaque `LLM API error`. |
| No `reasoning_effort` / thinking configured | `api/chat.ts` | The Cursor agent plans in extended thinking before each edit; ChatGippity gets whatever the model's default is. |

### 2. Editing ergonomics: whole-file `write` only

The Cursor agent works with `StrReplace`, `Read` with offsets, `Grep`, `Glob`, and parallel tool calls. The in-OS agent has `read` (whole file, truncated) and `write` (whole file, optional `expectedRevision`). A one-line type error costs a complete re-emission of the file, which collides with the 4096 cap above. There is no search, no directory-recursive listing, no way to see "what does `onDrag` on `<bitmap>` receive" without fetching a 14 KB `.d.ts` that gets clipped to 4000 chars.

`project_create` also always seeds the Counter template (`counterSource`), so the agent starts by throwing away the scaffold rather than from a relevant one.

### 3. The verification loop cannot exercise a drawing app

This is the most drawing-app-specific gap. `AGENT_TRAPS` exposes `inspect`, `click`, `type`, `windows`, `apps`. The kernel *already has* `drag`, `dblclick`, `pointer` (raw gesture including move/scroll) and `screenshot` (`src/os/kernel/uiService.ts`), but none are exposed to the agent. So:

- The agent can install the app and confirm a `tool-pencil` button exists via `inspect`, but it cannot **drag on the canvas** to draw a stroke.
- Even if it could, `inspect` returns a semantic tree (names, bounds, text), not pixels. It has no way to know whether anything was painted. The Cursor agent, by contrast, ran vitest against `apps/macpaint/engine.ts` and took browser screenshots it could actually look at.
- Runtime errors thrown inside event handlers or effects go to the browser console; there is no trap that surfaces them. The only signal is compile diagnostics.

### 4. Knowledge: prose guide vs. the actual codebase

The Cursor agent reads `packages/ui/src/jsx.d.ts`, `pointer.ts`, `nodes.ts`, `MacPaint.tsx`, the `Button`/`TextInput` components, `ARCHITECTURE.md`, the tests, and the workspace rules. It can grep for how `<bitmap>` is dispatched. ChatGippity gets:

- `APP_DEV_GUIDE.md` (~26 KB, prose, one 10-line `<bitmap>` example, no complete non-trivial app).
- `AGENT_BRIEF`, a 4-step Counter recipe with a single sentence about drawing surfaces.
- `get_mockintosh_repo_file`, which fetches from GitHub **`main`** (`api/repo-file.ts`), not the deployed commit. When the working tree carries uncommitted changes across `packages/ui/src/*` (including bitmap behaviour), the tool can return docs for a different OS than the one it is running in. Results are also double-truncated (14 000 chars on the server, 4000 on the client).

No exact type surface (JSX intrinsic props, `Ink`, `PatternName`, `RasterSurface`, `Sprite`) is in the prompt; the model reconstructs it from examples and guesses.

The chosen fix is to ship the running OS's own source inside the OS as a read-only volume the agent can `read` and `search` (Phase 2), with a generated digest on top (Phase 3). The bytes are already in the deployment — the compiler worker embeds `packages/*/src` to typecheck user projects — they are just not reachable from the agent.

### 5. Prompt and process

- The system prompt says "Keep your responses concise and conversational" and sets a "witty" persona. That is right for chat and wrong for a build task; it biases toward small outputs.
- No planning or decomposition guidance: nothing says "put the pixel engine in `src/engine.ts` and the view in `src/index.tsx`", "write files under N lines", "verify with drag + screenshot", "add undo". The Cursor run had `.cursor/rules/engineering-philosophy.mdc`, the `classic-mac-icons` skill, plan mode, and a todo list.
- Conversation history is never compacted: every full `write` body and every 4 KB tool result stays in `history` forever, and the ~30 KB system prompt is re-sent every step.

### 6. Model and provider

`LLM_MODEL` defaults to `gpt-5.6-sol` on the OpenAI chat-completions shape only. There is no way to route build tasks to a stronger/thinking configuration than chat, and no provider abstraction beyond `LLM_API_URL`.

### What is not the problem

The compiler policy (`src/shared/buildPolicy.ts`) allows multi-file relative modules, `solid-js`, `@mockintosh/sdk`, `@mockintosh/ui` — MacPaint's imports would all pass. The kernel/CAS/build contract is sound. The agent loop itself (`runAgent`) is a reasonable skeleton. The gap is capacity, tools, feedback, and knowledge layered on top of it.

## Plan

Ordered by leverage. Phases 0–2 are where most of the quality gap closes; 3–5 are what gets it to "Cursor-like".

### Phase 0 — Measure first (½ day)

Add `scripts/agent-eval.ts`: run the real LLM through `runAgent` against `withHeadless` (the same harness `src/os/agent/agent.test.ts` uses) on a small task set — "build a counter", "build a drawing app with pencil/eraser/clear", "build a notes app that saves to Desktop". Score each: compiled, installed, `inspect` finds named controls, drag over the bitmap changes `screenshot` pixels, steps/tokens used. Every later phase should move this number; without it we are guessing.

### Phase 1 — Lift the ceilings (1 day)

1. `api/chat.ts`: `max_completion_tokens` → 32k when tools are present; set `reasoning_effort` (medium/high for build tasks, and map the user's "think" / "think hard" / "ultrathink" to escalating levels); switch the route to the Node runtime with `maxDuration` or stream the completion so long turns do not time out at the edge.
2. `src/os/agent/loop.ts`: budget → ~80 steps / 15 min, and make the deadline *idle-based* (reset on each tool result) so a long build does not eat the clock. Keep "Stop" cancellation as-is.
3. `src/os/agent/execute.ts`: replace the single `TOOL_RESULT_MAX` with per-tool budgets, and **spill instead of truncating**: `read` and diagnostics are exempt; any other result over budget is written to `/disk/…/tool-results/<call-id>.txt` on the VFS and the model receives a preview plus the path, so it can `read` a range later. Nothing is silently lost.
4. **Output-truncation continuation.** When a completion ends with `finish_reason: "length"` mid-tool-call (today: invalid JSON → `parseArguments` returns `{}` → "Missing path"), inject a short "Resume directly — no apology, no recap" user message and continue, at most three times. This alone fixes the most common failure mode of a large first `write`.
5. `api/repo-file.ts`: pin to `process.env.VERCEL_GIT_COMMIT_SHA` instead of `main` as a stopgap. The source volume in Phase 2 replaces this tool for everything the agent needs; remove `get_mockintosh_repo_file` once it lands.

### Phase 2 — Give it the tools a builder needs (4–5 days)

**Editing.** Add an `edit` file trap in `src/os/kernel/files.ts`: exact `oldText` → `newText` string replacement, **not** line numbers (line-based edits drift the moment the file changes; string matching is what Claude Code settled on after SWE-bench testing). Fail if `oldText` matches zero or more than one place; offer `replaceAll`. Require `expectedRevision` (CAS). This belongs at the kernel level, not in the agent: Terminal, MCP, and Source Editor get it too, and it is the shared primitive the engineering philosophy asks for. Add `read` `{ from, to }` line range, recursive `list`, and a `search` trap (regex over a subtree of `/disk` or `/system/source`). Expose all in `AGENT_TRAPS`.

**Ship the OS source inside the OS.** This is the chosen fix for issue 4. The agent should read the code that is actually running — `packages/ui/src/jsx.d.ts`, `pointer.ts`, the `Button`/`TextInput` components, `apps/MacPaint.tsx` — the way a repo-level agent does, instead of a prose summary of it or a GitHub fetch of a different commit.

- *Shape:* a second, **read-only volume** resolved by `Disk` in the kernel, e.g. `/system/source/packages/ui/src/pointer.ts`, backed by a `SourceProvider` on `Platform`. It is not copied into the user's `/disk`: `FSBackend` is one JSON catalog plus blobs, so a couple of hundred files would bloat the catalog on every reload, be persisted to OPFS as user data, appear in Finder as the user's files, and go stale the moment the site redeploys. Do not introduce a general mount abstraction in `packages/fs` for this; a narrow read-only volume in `Disk` is the honest size of the change, and a later mount system can subsume it.
- *Web provider:* a build-time manifest (paths, sizes, commit SHA) plus per-file static assets under `public/source/`, or a non-eager `import.meta.glob` so Vite code-splits one chunk per file. Reuse the glob set the compiler worker already embeds in `src/platform/web/builder/typecheck.ts`, so there is one definition of "the shipped source" and it cannot disagree with what the typechecker sees. **Nothing loads at boot**: static assets and split chunks cost nothing until read, the same rule the ~12 MB compiler worker already follows. The manifest (~10–20 KB) loads on first access to `/system/source`. Deployment size grows by a few hundred KB gzipped; page weight does not.
- *Headless provider:* read from the repository checkout, so the Phase 0 eval harness and the browser agent see the same volume.
- *Contents:* `packages/sdk`, `packages/ui`, the public surface of `packages/quickdraw`, `ARCHITECTURE.md`, `packages/sdk/docs/APP_DEV_GUIDE.md`, and `apps/*` as exemplars. Keep `src/os` internals out at first: the agent needs the SDK surface, and the shell's internals add the most bytes for the least value. Exclude tests.
- *Exemplar hygiene:* some bundled apps import OS internals (`apps/Assistant.tsx` uses `../src/os/context` and the kernel) and would fail the project compiler if copied. The manifest flags each app as SDK-clean or not, and the agent prompt says to model only on SDK-clean apps. `apps/MacPaint.tsx` is SDK-clean and is exactly the reference a drawing-app builder needs.
- *Search:* the `search` trap below must cover `/system/source`; without it the agent is guessing paths, which is worse than the guide. The in-browser index is built lazily on first search (~300 KB gzipped once, then cached) or shipped as a small pre-built index.
- *Beyond the agent:* the existing `read`/`stat`/`list` traps work unchanged; Source Editor can open system files read-only; Finder can grow a "System Folder ▸ Source" later. This is an OS feature with the agent as one consumer, which is the right layering.

Roughly a day of work; it sits next to `search` and deletes the GitHub fetch path.

**Read-before-edit.** The agent layer (`src/os/agent/execute.ts`) tracks the last revision it read per path and refuses to `edit`/`write` a file it has not read at its current revision, returning "file changed since you read it; read it again" instead. Catalog revisions make this exact where Claude Code has to rely on mtimes.

**Agent-facing tool descriptions.** The model currently sees the kernel's one-line `describe()` text verbatim ("Write a whole UTF-8 file", "Inspect immutable UI nodes"). Those are right for the kernel contract and useless as steering. Add a description overlay in `src/os/agent/tools.ts` — when to use the tool, what it returns, the common mistake — and keep kernel descriptions neutral. Tool descriptions are micro-prompts; they are the highest-leverage prompt text there is.

**Read/write partitioning.** Tag traps as read-only (`read`, `stat`, `list`, `search`, `inspect`, `windows`, `apps`, `screenshot`) or mutating (`write`, `edit`, `build_submit`, `app_install`, `click`, `drag`, `type`, `open`). `runAgent` runs read-only calls from one turn concurrently and mutating calls serially, instead of everything in sequence.

**Post-write typecheck hook.** After a successful `write`/`edit` to a project source file, run the fast typecheck only (`src/platform/web/builder/typecheck.ts`, not the full bundle) and append diagnostics to the tool result. The kernel `invoke` seam already supports this; it gives the model lint-after-edit feedback without spending a step on `build_submit`. Hooks are configured by the OS, never installable by the model.

**Scaffolding.** `project_create` takes a `template` (`counter` | `blank` | `canvas`) so a drawing app starts from a working bitmap surface rather than from Counter.

**Verification.** Expose `drag`, `dblclick`, `pointer`, and `screenshot`. For `screenshot`, encode the 1-bit frame to PNG on the client and return it as an OpenAI `image_url` content part in a `user`/`tool` message so the model *sees* the app. This needs `ChatMessage.content` in `src/shared/chatProtocol.ts` to become `string | ContentPart[]` and `toLLMMessages` to pass parts through — a wire-type change, so define it explicitly.

**Runtime errors.** Add an OS-owned per-instance error journal: catch errors at the app-instance boundary (handlers, effects, `onPaint`) and expose a `logs` trap (`instances` already has an `error` slot to extend). Without this the agent is debugging with compile diagnostics only.

Trade-off to flag: giving the agent `pointer` and `drag` also lets it operate the rest of the desktop. That matches Terminal/MCP today, so it is consistent, but it makes the "Stop" button and step budget load-bearing.

### Phase 3 — A digest on top of the source (1 day)

The source volume is the drill-down; the agent still needs a short, always-present introduction so it does not spend steps and tokens reading `pointer.ts` to learn a prop name. Extend `scripts/build-chat-context.ts` to generate, at build time and **from the same source set the volume ships**, so the two cannot disagree:

- A compact type digest: JSX intrinsic element props from `packages/ui/src/jsx.d.ts`, the `@mockintosh/sdk` export list with signatures, `RasterSurface`, `Sprite`, `Ink`, `PatternName`. Each entry carries its `/system/source/...` path so the model knows where to read further.
- A map of the volume: the SDK-clean exemplar apps with one line each on what they demonstrate (MacPaint: bitmap engine, tools palette, undo, patterns, sprite files), and the handful of files worth reading for common questions ("pointer events → `packages/ui/src/pointer.ts`").
- A "recipes" section: engine-in-a-separate-module, undo stack, pattern fills, palettes with `semantic` names, how to leave room for chrome.
- `project_create` templates (`blank`, `canvas`) are extracted from the same exemplar sources rather than hand-written a second time.

Keep the guide, but the agent should be able to answer "what does `onDrag` receive" from the digest, and confirm it from the source, not infer it from one example.

### Phase 4 — Split chat from build mode and manage context (2 days)

- Two system prompts selected by the presence of a build intent (or by the first `project_create`): keep the witty, concise persona for chat; for build mode drop "concise", add a procedure (plan → scaffold → engine → view → build → install → drag + screenshot → iterate → short report), file-size guidance ("keep files under ~200 lines; split modules"), and an instruction to prefer `edit` over `write` after the first version.
- **Stable, cacheable prompt prefix.** Order every request as: static guide and type digest → tools sorted alphabetically → an explicit boundary → per-session dynamic content (date, window list, reminders). OpenAI prefix caching discounts the ~30 KB we re-send on every step by roughly 90 %, but only while nothing volatile precedes it. Treat a cache-hit drop as a regression.
- **Event-driven system reminders.** Small injections triggered by state rather than one long static prompt: "`src/index.tsx` changed on disk since you last read it (Source Editor?)" (from revisions), "same diagnostic twice in a row — read the file before rewriting", "12 steps remain", and for a drawing app "you installed but have not dragged on the canvas or taken a screenshot". These steer mid-run at a fraction of the token cost.
- **Layered compaction in `runAgent`**, because no single strategy covers every case:
  - *Microcompact*: after a step completes, replace old `write`/`edit` bodies in `history` with `"[wrote src/index.tsx, 184 lines, rev 7]"` (the file is on disk and readable), and stub `inspect`/`screenshot` results older than N steps, keyed by `tool_call_id`.
  - *Auto-compact*: at a context threshold, summarise the run so far and re-inject only the current source files and the user's request.
  - *Reactive compact*: on a "context length exceeded" error from the gateway, compact and retry instead of surfacing the error.
  This is what lets 80 steps fit in context.
- **Write-ahead history.** Persist `history` to `Preferences/assistant/<session>.json` *before* each `complete()` call. A reload mid-run is resumable, "continue" resumes the same run rather than starting a new budget, and this is the checkpoint seam the durable-jobs work in the [server infrastructure plan](server-infrastructure-plan.md) needs later.

### Phase 5 — Model routing and durability (later)

- Provider abstraction in `api/chat.ts` (OpenAI chat-completions today; add Responses API / Anthropic) and per-mode model selection: cheaper model for chat, stronger + high reasoning for build mode.
- **A narrow verification sub-run.** Per-step error compounds (95 % per step is ~60 % after ten steps), so keep each agent's job small. After the builder reports done, run a second `runAgent` in a fresh context with only `open`, `inspect`, `click`, `drag`, `screenshot`, a one-paragraph prompt, and the user's original request; it reports pass/fail and what it saw. Isolating it from the builder's transcript removes the builder's confirmation bias. Nudge the builder when it has installed without any verification step.
- The [Vercel Sandbox research](vercel-sandbox-research.md) / [server infrastructure plan](server-infrastructure-plan.md) direction — remote build + headless test workers and durable jobs — is the eventual path to running project tests (`engine.test.ts`) the way the Cursor agent does. Not required for the bulk of the quality gain; Phases 1–4 are all client-side or gateway changes.

## Patterns borrowed from Claude Code

On 31 March 2026 the `@anthropic-ai/claude-code` 2.1.88 npm package shipped an unstripped `cli.js.map` exposing roughly 1,900 TypeScript source files. The source is Anthropic's and is not reused here; the *design patterns*, documented in several public analyses, are. The table lists the ones this plan adopts and where they land. The mapping is ours, inferred from those write-ups rather than from a first-party design document.

| Pattern | Why it matters for ChatGippity | Phase |
|---|---|---|
| Exact-string `Edit` (`old_string` → `new_string`), uniqueness enforced | Line-based edits drift; string matching survives concurrent edits and needs no line counting | 2 |
| Read-before-edit via per-file state | Prevents blind rewrites of a file the model has not seen at its current version; our revisions make it exact | 2 |
| Tool descriptions as micro-prompts | The team spent more effort on tool descriptions than on the system prompt; ours are kernel one-liners | 2 |
| Per-tool result budgets, overflow spilled to a file with a preview; `Read` exempt | Replaces a global 4000-char truncation that hides the agent's own source from it | 1 |
| Output-truncation continuation ("resume directly, no recap", ≤3 attempts) | Fixes the truncated-`write` → empty-args failure directly | 1 |
| Reader/writer partitioning of tool calls (reads concurrent, writes serial) | Multi-call turns finish faster with no ordering risk | 2 |
| Deterministic `PostToolUse` hooks configured by the host, not the model | Lint-after-edit feedback without spending a step; the kernel `invoke` seam already exists | 2 |
| Static/dynamic prompt split, tools sorted, explicit cache boundary | ~90 % discount on the prompt we re-send every step, as long as nothing volatile precedes it | 4 |
| Event-driven system reminders | Steers mid-run (file changed, repeated diagnostic, budget, unverified install) more cheaply than a long static prompt | 4 |
| Layered compaction: snip / microcompact / auto-compact / reactive compact | No single strategy handles all context pressure; microcompact by `tool_call_id` composes with the others | 4 |
| Write-ahead transcript persistence | Makes a run resumable across reload and is the checkpoint seam for durable jobs | 4 |
| Thinking-level keywords mapped to reasoning budget | Trivial to map onto `reasoning_effort` | 1 |
| Narrow sub-agents with fresh context; verification nudge after unverified task completion | Compound error argues for small jobs; an isolated verifier avoids the builder's confirmation bias | 5 |

Deliberately not borrowed for now: permission modes and the auto-approval classifier, plugin/skill marketplaces, coordinator/team mode, LSP integration, speculative execution, and MCP client support. ChatGippity operates one user's own computer with a visible Stop button and a step budget; those mechanisms solve problems this deployment does not yet have. The kernel's existing session/grant model is the place to revisit permissions if that changes.

## Expected outcome

After Phase 1 alone the agent can emit and read back a full-size file, survives an output-truncated `write`, and gets ~20 repair cycles instead of ~4. After Phase 2 it edits surgically instead of rewriting, gets type diagnostics after every edit, reads the running OS's own source and a real drawing app instead of a summary of them, and can actually draw on its own canvas and look at the result, which is the difference between "compiles" and "works". Phase 3 removes most of the remaining guessing about prop names and signatures without spending steps on reading. Together those cover the majority of the observable quality gap; Phases 4–5 are about consistency, cost, and independent verification. Every phase should be checked against the Phase 0 eval before moving on.

## Eval scores (Phases 0–4 landed)

`npm run agent:eval` on 15 September 2026 against `gpt-4o-mini` (`.env.local` `LLM_MODEL`), in-process `/api/chat`, headless OS with `/system/source`. One run after Phases 0–4 (no earlier baseline — Phase 0 shipped with the rest).

| Task | compiled | installed | named controls | painted | steps | history chars |
|---|---|---|---|---|---|---|
| counter | yes | yes | yes | n/a | 8 | 57 563 |
| drawing (pencil/eraser/clear) | yes | yes | yes | yes | 11 | 59 540 |
| notes (save to Desktop) | no | no | no | n/a | 80 (budget) | 39 250 |

Drawing is the target task: the agent created, built, installed, found the named tools, and a `drag` changed screenshot bytes. Notes exhausted the 80-step budget without a successful install — still the main remaining eval gap.

Browser check (15 September 2026): desktop booted at `http://127.0.0.1:5173/` with ChatGippity on the desktop and `/api/chat` on Node (`maxDuration` 300, key configured). The drawing-task screenshot step was verified by the headless eval (`painted=true` after `drag`), not by a second live ChatGippity session in the browser.
