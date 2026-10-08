# A programmable Mockintosh — build apps, operate the OS, then change the system

**Near-term cut (14 September 2026):** do not implement live mounts, `/dev` action files, or grant/namespace ACLs from this document. Experiences A and B still stand. The public face of the machine is a Toolbox (named traps) plus the File Manager. Follow [toolbox-cut.md](toolbox-cut.md) until that cut is done.

Working plan, 9 September 2026; rewritten 10 September around the user's chosen experiences and extended with portable computer hosting. Future sections are proposals, not claims of shipped behavior. It supersedes the earlier M1–M4 namespace/RPC/process/shell sequence. The M1 implementation is present in the working tree; see the status below.

## Read this first

Mockintosh should be a computer you can create things inside. You can ask an agent for an app, find the result on your desktop, open its source, and change it yourself. You can also ask an agent on your regular computer to operate the same Mockintosh you are looking at.

The architecture serves those experiences. The public face of the machine is a Toolbox of named traps plus the File Manager. Terminal, ChatGippity, and external MCP clients call the same traps. A path is a convenience for humans and agents, not the OS's native address. Plan 9-style live mounts are deferred; see [toolbox-cut.md](toolbox-cut.md).

The shell is an adapter over those traps, delivered in stages alongside the experiences rather than postponed until somebody proves it is useful.

Read the experience sections for what we are building; the walkthrough for where work happens; and the engineering sections when implementing. Terms used throughout:

| Term | Meaning here | Example |
| --- | --- | --- |
| Service | A component that performs work through a documented interface | Build source into an app bundle |
| Namespace | A map from paths to files or service resources | `/services/build` names the selected builder |
| VFS | Virtual filesystem combining mounted storage and live services under those paths | `cat` reads a document or an OS setting through the same interface |
| Shell | A command language over the kernel and VFS | Save a build-and-run sequence as a script |
| Mount | Attach a service's resource tree at a path | A remote builder appears under `/services/build` |
| Kernel | The common entry point for inspecting and operating Mockintosh | Read a file, open an app, submit an action |
| Session | The particular running OS and caller an operation belongs to | The browser instance visible on your desk |
| App instance | One running app with owned windows and cleanup | The Counter currently open |
| Agent run | A conversation task with tool calls and results | “Build me a counter” through completion |

These are separate concepts. Mounting a server connects to its interface; it does not execute its code on the device. A file-like interface may describe a live command or event stream, not a document stored on disk.

## Experience A — “Build me an app”

**What you do.** Open ChatGippity and ask: “Make a counter with a big number and plus and minus buttons.” The agent creates it and puts a launch icon on the desktop. Open the app and use it. Choose Open Source, change the increment from one to five, press Build & Run, and see the change. Close and reopen Mockintosh: the app and your source are still there.

**What makes it worthwhile.** The result is a possession you can inspect and modify. The agent accelerates creation, while an ordinary web developer can understand the resulting project.

**How it works.**

1. The agent reads the SDK contract for this running OS.
2. It creates a project folder containing readable Solid/TypeScript source and a manifest.
3. It asks a build service to compile an immutable revision of those files.
4. Build diagnostics come back as file/line/column messages. The agent can edit and retry.
5. The installer registers a successful build and creates a desktop shortcut.
6. The agent opens the app, checks its controls and output, and reports what worked.
7. The human opens the same source files in an editor. Save and Build & Run use the same services.

**Acceptance.** Complete that loop in the visible browser OS. Verify the buttons, the manual source edit, the desktop shortcut, and persistence after reboot. A compile error leaves editable source and the last successful build available. Agent claims are grounded in build/tool results rather than merely returning a code block.

**Scope.** Solid components, signals, TypeScript, imports, and a normal project layout. The visual vocabulary is Mockintosh's `@mockintosh/ui` custom renderer, not browser HTML/CSS. Arbitrary npm packages, a complete IDE, live state-preserving hot reload, and a full shell are not required for this experience.

## Experience B — “Use my Mockintosh”

**What you do.** In an AI client on your regular computer, connect the Mockintosh MCP server and ask: “Open Control Panel and change the desktop pattern.” Watch the agent open the app, find its controls, choose a pattern, and verify the result. Ask ChatGippity inside the OS to do the same thing.

Technically, the person talks to an AI client; the MCP server supplies tools to that client. ChatGippity can call the shared tools directly inside Mockintosh. It need not run a second MCP connection to operate its own OS. Supporting arbitrary third-party MCP servers from ChatGippity is a separate extension. See the [MCP architecture](https://modelcontextprotocol.io/docs/learn/architecture).

**How it works.** Both clients receive a description of the same running machine and use the same actions. Tools expose windows, named controls, menus, files, settings, and screenshots. Actions enter the same OS policy and input paths as human actions.

**Acceptance.** An external MCP client and ChatGippity can each open an app, click a named control, type into a field, change a real persistent setting, and inspect the result in that exact browser instance. Reloading preserves the setting. A separately booted headless machine is useful for tests but does not satisfy the live-browser demonstration.

**Scope.** The first real setting is desktop pattern, with a small set of valid choices. Control Panel currently shows a sample pattern without a setting control, and Desktop uses a fixed checker background. Implement the setting and its human UI together; giving a nonexistent setting a path is not sufficient.

## Experience C — “Change the system” (potential next step)

**What you do.** Ask for a new Finder action or a different built-in app behavior, inspect the change, try it, and restore the previous version if you prefer it.

There are three progressively stronger forms of hackability:

| Level | Example | What must exist |
| --- | --- | --- |
| Change data and settings | Change desktop pattern or an app preference | Documented settings and persistence; part of B |
| Edit apps and extension points | Fork a bundled utility, add an Open Selection handler | Source packages, documented extension contracts, replace/restore lifecycle |
| Replace shell or core code | Change Finder behavior or window chrome | A development build, a bootable previous version, and a recovery route outside the modified shell |

A settings write changes data. Editing app source changes the next compiled program. Editing a file named `/sys/...` does not automatically modify the running kernel. Each kind of change needs an explicit apply/build/reload operation.

Start after A and B with “fork a bundled app, edit it, run the fork, restore the original.” Then choose one concrete shell extension to expose. Core self-modification remains an experiment: keep a known-good boot path, and test changed shell code in a separate runtime/instance. The current renderer and QuickDraw globals do not support arbitrary nested boots in one realm.

## Implementation status, 10 September 2026

M1 now has a shared kernel/VFS, named UI operations, persistent desktop pattern, Terminal/S1, host CLI, and a paired local companion with a stdio MCP adapter. Current automated verification: 219 tests, TypeScript checks, and production build. Earlier live-browser MCP/CLI/Terminal demonstrations covered reload persistence and Finder rename; they were not rerun for the architecture consolidation. See [M1 operation and verification](m1-operation.md).

The S1 presentation follow-up is implemented: `ls` lists sorted names with directory suffixes, metadata/UI commands provide readable output, and successful mutations are quiet. A leading `--json` opts into full operation results; direct MCP tools remain structured. `cat` preserves file bytes. This is functional evidence, not blanket completion of every future shell feature. The later M2/M3 scope and durable server hosting remain planned. The kernel review follow-up preserves caller context across live mounts, makes pending render waits cancellable through shutdown, bounds retained outcomes, and validates nested operation schemas.

The architecture consolidation is implemented: operation definitions colocate schemas and typed handlers; boot composes storage outside the dispatcher; caller-scoped VFS access replaces permission checks based on argument names. S1 commands now own syntax, execution, and presentation in one table, while all bridge peers share validated wire envelopes. These adapters preserve readable shell output and structured direct operations. See `ARCHITECTURE.md` for ownership and `docs/m1-operation.md` for the execution contract.

The next app-building slice is now implemented: caller lifetime cleanup, shared Terminal/RPC shell management, editable Counter source, browser and companion compilers, immutable artifacts, install/launch, instance restart, restore, and reboot persistence. Source Editor and shell/direct tools share the project operations. See [M2 apps](m2-apps.md) for setup, contracts, limits, and evidence. This is the complete Counter workflow, not completion of shell S2 or every planned M2 editor feature; M3 and durable server execution remain future work.

### Pre-M1 baseline and remaining seams

The following table records the starting point of the experience rewrite. Its M1 missing-work entries have since been substantially implemented as described above; recheck the code before using it as a task list.

| Existing piece | Useful foundation | Missing work |
| --- | --- | --- |
| [bootOS](../src/os/boot.ts), [Platform](../src/platform/types.ts), headless host | DOM-free OS core, shared input policy, frame readback | Kernel/session interface and live bridge |
| [FileSystem](../packages/fs/src/fileSystem.ts) | Reactive catalog, byte bodies, path resolution, stable ids, roles | Mount adapter, source revisions, project installation |
| [SDK](../packages/sdk/src/index.ts), [app context](../src/os/appContext.ts) | Solid apps, `AppContext`, `onOpen`, multiple windows | Running-instance ownership, rebuild/restart lifecycle |
| [app template](../templates/app/vite.config.ts), root import map | Universal Solid compilation and shared runtime imports | Build from VFS source and load resulting artifacts |
| [AppInstaller](../src/os/installedApps.ts), [openers](../src/os/openers.ts) | Manifest installation and document launching | Directory bundles, build replacement, Open Source |
| [FileViewer](../apps/FileViewer.tsx), UI TextInput | Read-only text display; single-line editing | A usable multiline source editor |
| [Assistant](../apps/Assistant.tsx), [chat endpoint](../api/chat.ts) | Chat UI, provider proxy, a limited tool round | Matching request schema and repeated OS/build tool loop |
| [generated chat context](../scripts/build-chat-context.ts) | Developer guide already embedded in the prompt | Serve exact runtime SDK/version/types/examples to both clients |
| [Control Panel](../apps/finder/ControlPanel.tsx), [Desktop](../src/os/components/Desktop.solid.tsx) | Place to expose desktop pattern | Persistent setting and editable control |

Concrete chat mismatch: the UI sends `messages`, while the endpoint expects `prompt` and `conversationHistory`; the UI also appends the new user message twice when constructing its request. The endpoint allows one tool round followed by a response with tools disabled. A multi-step app-building agent needs a different loop. Fix these during the chat milestone, preserving existing supported chat tools.

The earlier claim that `api/mockintosh-context.ts` still teaches SDK v1 is obsolete: it now imports the generated developer guide. Extend that source-of-truth mechanism.

## Follow one request through the system

For “Build me a counter,” start with this division of work:

~~~text
ChatGippity on the Mockintosh screen
    ↕ conversation, proposed tool calls, tool results
Agent/model gateway (regular computer or server)
    ↕ authenticated calls for one selected OS session
Shared Mockintosh tools
    ├── read/write project files in the live OS's storage
    ├── submit source revision to the selected build service
    ├── install artifact and create desktop shortcut
    └── open app, inspect controls, click, capture result

External AI client → MCP adapter → the same shared Mockintosh tools
~~~

The gateway holds model credentials and requests model responses. The live OS owns its local files, UI, and action execution. The builder accepts source and returns artifacts; it does not need direct access to the whole OS.

Start with a build provider on the regular computer using the app template's compilation configuration. That is the first useful remote computation service. The browser now also implements that contract with a local compiler worker, so both development and public web builds support app building without a companion. A hosted compiler can implement the same contract later.

An immutable source snapshot crosses this boundary, not an OPFS handle or a browser-local filesystem path. A remote service cannot dereference those. Returned artifacts are written into the app package in the live OS.

## One computer, multiple hosts

Running in a browser, on a server, and on a capable device are first-class deployment goals. A display can be attached locally or over a network. Preserve local browser operation without an account or hosted dependency. Host-specific capabilities remain explicit; a small device may be a remote terminal even if it cannot run the JavaScript/Solid runtime itself.

| Mode | Runtime and authoritative disk | Display/input |
| --- | --- | --- |
| Local browser | Browser runtime and local storage | Same browser |
| Server computer | Isolated server runtime and durable storage | Browser or device attaches remotely |
| Local device | Compatible device runtime and storage adapter | Attached hardware |
| Remote terminal | Another host runs the computer | Device only displays frames and sends input |

These modes share kernel operations and filesystem semantics. They do not imply automatic live migration, offline merging of a running desktop, or identical peripheral support.

The kernel/host boundary must establish:

1. **Persistent computer identity.** A host supplies a durable computer id; each start has a globally unambiguous boot id or persisted generation. Caller sessions and display connections are separate identities. The current realm-local instance/generation is insufficient as a durable computer identity. Restoring a backup must not revive old boot references.
2. **Independent lifetimes.** Disconnecting a client releases its input state and cancels connection-owned work. The host controls computer shutdown and any idle-stop policy. Explicitly detached jobs require ownership contracts; closing a viewer must not implicitly destroy a server disk or imply that all jobs survive.
3. **Attachable display and input.** Add versioned frame delivery, keyframes/resynchronization, bounded queues, input ordering, and a clear single-controller/multiple-viewer policy. Start with fixed resolution and client scaling. Use the existing human input path; remote controls respect the same modal/focus policy.
4. **Durable host storage.** Browser, server, and device adapters must report successful durable writes and failures consistently. Keep a single writer for each disk until a stronger multiwriter service is implemented. A transferable snapshot contains catalog, bodies, schema/runtime compatibility metadata, and checksums, not live pointers or JavaScript memory.
5. **Isolated execution.** Retain one UI runtime per realm. Hosts create separate runtimes and own resource limits, termination, recovery, and code isolation. Kernel namespace grants are not a security sandbox for imported JavaScript.
6. **Explicit handoff.** Initially export/import a stopped or consistently snapshotted disk. Forks receive new computer identities. Moving one computer requires revoking the old writer before enabling the new one; disconnected browser copies cannot silently become competing authorities.

Accounts, API-key/OAuth handling, placement, billing, provider APIs, and remote connection routing belong around the kernel. Provider details and data-layer research live in the [server infrastructure plan](server-infrastructure-plan.md). Collaborative documents may use a local-first provider later; clicks, execution ownership, and VFS catalog consistency retain their own contracts.

### H1 — Persistent server computer and remote terminal

Retain this optional portability milestone alongside M2/M3 without renumbering them. Local execution with durable synchronized data, and remotely owned build/agent jobs, are the preferred next experiments. A continuously hosted desktop is not required for either. Establish identity/lifetime/storage seams before any server-computer implementation; a full hosting product is not a prerequisite for app creation.

Acceptance: start a server-hosted computer, attach a browser, create a file and change the desktop, disconnect all viewers, reconnect to the same running boot, then stop/restart the runtime and verify the same computer and disk with a new boot identity. Operate the visible remote desktop through both human input and MCP. Reject stale boot references; recover a dropped frame stream; ensure two boot attempts cannot write the same disk. Verify browser-local operation still works independently. Disk persistence does not promise restoration of unsaved app memory or open windows.

H1 proves browser/server portability. A device host is validated separately against a chosen device's actual runtime and peripherals; a remote display client alone does not prove native device execution.

### Local computer, synchronized data, optional remote helper

The emerging preference is a responsive local computer whose saved data follows its owner, with remote work continuing when the device closes. Evaluate Evolu for selected persistent app/project data; keep rendering, input, windows, and live execution local. Syncing saved data does not restore unsaved memory or migrate a running process. Folder/file conflict semantics remain explicit work before whole-disk replication.

A remote helper can operate on a shared project while the local computer remains interactive. It needs a build worker or agent execution environment, not necessarily a permanently running desktop. An isolated headless Mockintosh may be useful for testing generated apps; an interactive remote desktop remains a separate capability. Shared encrypted data must be explicitly accessible to the worker that processes it.

For the first close-your-device experience, submit work remotely from the outset. Before saying it will continue, persist an immutable input snapshot and obtain a durable job acceptance with a job id. The remote job owns execution independently of the viewer connection; local UI reconnects to progress and results. Synchronized data alone does not prove acceptance. A request still queued locally cannot promise remote progress while offline.

Keep build jobs (compile/test one snapshot) distinct from agent runs (conversation and repeated edit/build/test steps). Extend the M2 build-service lifecycle and M3 agent ownership accordingly. Record inputs, source revision, toolchain/model configuration as applicable, progress, budgets, cancellation and terminal outcome. Publish results as a separate revision if the human has edited meanwhile; never silently replace newer source or install a stale result.

Later, an explicit “Continue on server” may transfer checkpointed work: conversation, completed action ids/outcomes, source snapshot, and pending steps. It does not transfer JavaScript memory. Use an ownership epoch and acknowledged checkpoint to prevent simultaneous execution. Reconcile in-flight side effects before resuming; a timeout is not permission to repeat them. Browser-close callbacks are not a reliable transfer mechanism.

Acceptance for remotely owned work: start from the local UI, observe accepted job id, close the device, complete remotely, reconnect and inspect/install the resulting app. Also test disconnect before acceptance, server restart, cancellation from another client, and concurrent local edits. This complements M2/M3; H1 is optional unless the desired job needs a persistent remote OS.

## Build next, leave room for, explore later

| Status | Decisions |
| --- | --- |
| **Build next** | VFS; shared OS tools; staged shell/Terminal/CLI; named UI inspection; live MCP bridge; desktop setting; source editor; Solid build provider; directory app packages; replace/restart; ChatGippity tool loop |
| **Leave room for** | Async service access; session-specific bindings; local/remote builder substitution; stable resource references; scoped operations; revisioned files and cancellable jobs |
| **Explore later** | Network home and archives; shared spaces and agents; general CPU servers; actual 9P compatibility; arbitrary remote program execution; full POSIX compatibility/preemptive scheduling; core self-modification |

“Leave room for” means a small interface choice justified by these experiences. It does not mean building the entire future system now.

## Shared architecture and invariants

~~~text
Human GUI / source editor      ChatGippity tools      External MCP tools
            │                         │                       │
            └────────────── shared operations ────────────────┘
                                      │
Terminal / CLI / run_shell → Shell ────┤
                                      │
                          Kernel + caller session
                                      │
                       VFS: namespace / service bindings
                   ┌──────────────────┼──────────────────┐
                   ▼                  ▼                  ▼
             Local file adapter   OS state services   Build service
              existing FS       windows/UI/settings   local or remote
~~~

1. **One operation implementation.** GUI conveniences, internal tools, and MCP tools call shared operations. No MCP-only state mutations or alternate app installer. Typed local calls stay typed; pointer movement and rendering do not serialize to text.
2. **One naming model, explicit views.** The initial session has a default mount table. Caller/session context is explicit from the start, allowing a different build provider or restricted view later. Full per-process union mounts are deferred.
3. **Paths name public resources, not every implementation detail.** Expose state needed for control, creation, and extension. Preserve internal stores and the SDK's typed conveniences.
4. **Async service boundary, efficient local reads.** Service metadata and bodies can be asynchronous. Existing local Solid consumers may retain reactive reads of the same authoritative stores. Remote consumers use a view/cache with loading, error, revision, and staleness state. Do not rewrite all Finder reads before the first experience works.
5. **Runtime identity and source revision are explicit.** Tool results identify the selected OS session; actions identify their target; builds identify their source. Stale references must not silently operate on a different target.
6. **A successful transport response is not proof of the user outcome.** Re-read state or inspect the UI after a change. Build success, app launch, and tested behavior are separate results.
7. **The VFS is the common resource namespace.** Persistent files and public live resources are mounted trees with common stat/list/read/write operations. MCP convenience tools must not grow an independent resource model. Actions have documented control endpoints or kernel lifecycle operations, and shell commands use those same contracts. An accepted capability must be usable from both tools and the shell; neither gets private mutations.
8. **Mount aliases resolve at boot.** The operation registry owns action contracts; live mount tables bind existing operations and fail immediately when a target is missing. Dynamic per-window/app projections stay providers. Settings are public files backed by typed local services, not parallel setting RPCs; diagnostics are file resources too.

Suggested homes: `src/os/kernel/` for session/operations and OS synthetic services; `packages/fs/` for generic namespace types/adapters; `src/os/build/` for project/build contracts; a host-side service module for compilation; `scripts/mockintosh-mcp.ts` for the MCP entry point. Split packages only where a second consumer needs them.

### Resource and action contracts

A service's public metadata includes a stable resource id, revision, kind, content type, and supported operations. It does not reuse the catalog's `parentId` as a universal identity: one resource can be reachable through several bindings.

Define async stat/list/read/write and the needed directory operations, including expected-revision writes for source editing. Keep whole-file helpers initially. For snapshots, commands, and streams document different semantics:

| Resource | Read/write meaning |
| --- | --- |
| Source file | Read UTF-8 text; conditional replacement checks the last revision |
| Window title or setting | Read current value; validated write updates owning state |
| Control endpoint | Write one complete command; return its outcome or job reference |
| Build diagnostics | Read structured messages for a named build |
| Events | Subscribe from a cursor; cancel explicitly; gaps require resnapshot |

Structured tools can wrap these operations: `inspect`, `read_file`, `write_file`, `open_app`, `click`, `type_text`, `key`, `menu`, `set_setting`, `build_app`, `install_app`, `restart_app`, and `screenshot`. These are proposed tool names, not an additional set of implementations. Discoverable service operations and their schemas provide the canonical contracts; tool names provide convenient entry points.

Use stable error codes such as `ENOENT`, `EACCES`, `ENOSYS`, `ESTALE`, `ECONFLICT`, `EDISCONNECTED`, and `ECANCELLED`, plus readable messages. Cross-mount rename fails explicitly until a copy/move contract exists. Rebinding does not copy state; `pathOf(id)` needs a namespace and a preferred-path policy when aliases exist.

### Initial namespace

All paths below are proposed. App/role directories may be renamed; internal code uses their ids and roles, and discovers their current paths.

~~~text
/disk/                                  persistent local volume
/windows/<windowId>/                    title, rect, active, app, UI snapshot
/windows/<windowId>/ui/<nodeId>/         identity, name, role, state, rect, actions
/apps/<appId>/                          registry metadata and source-package reference
/instances/<instanceId>/                app, windows, build, status, diagnostics
/dev/screen                            packed pixels plus format metadata
/dev/mouse                             pointer commands
/dev/keyboard                          text and key commands
/sys/menubar/                          current menus and available actions
/sys/settings/desktop-pattern          current persistent desktop pattern
/sys/capabilities                      available host features and services
/sys/sdk/                              runtime version, guide, types, examples
/services/build/                       supported toolchain and build operations
/services/build/jobs/<jobId>/           source revision, status, diagnostics, artifact
~~~

The volume display name stays “Macintosh HD” while its mount path remains stable. Synthetic trees need not appear as desktop disks. Add a small Inspector or Go to Folder when useful; a complete shell is not required to inspect source, errors, and actions.

This mounted namespace is the VFS, not merely a list of suggested names for unrelated APIs. Existing FileSystem is the persistent-volume adapter. OS services supply the live mounts. Retaining typed local fast paths does not create a second authoritative state model.

### UI inspection and action semantics

Expose immutable UI snapshots through `@mockintosh/ui`, without leaking mutable CanvasNode internals. Include stable lifetime id/generation, window id, optional developer name, semantic role, text/value, enabled/focused state, clipped rectangle, and available actions. Provide an aggregate per-window snapshot so remote clients do not need one network request per property.

Assign names to Finder, menus, Control Panel, editor controls, window chrome, and generated app example controls. Duplicate names within a lookup scope produce an ambiguity result; structural paths are for browsing and debugging. Sibling insertion/removal can reuse a structural path, so it is not a safe action identity.

Coordinate input uses the existing typed inject path in `bootOS`. Named click resolves and validates a target immediately before dispatch. If the window is inactive, activation is an explicit step, followed by a fresh target check; do not claim the activation click also pressed the control. Reject stale, disabled, occluded, or modal-blocked targets. Semantic menu/setting operations use the same validated handlers as the human UI and are distinguishable in the action history from simulated clicks.

Screenshots expose actual pixels and dimensions/stride/encoding. The MCP adapter produces an image format its client can display; PBM/raw bytes alone are not sufficient for every image-capable client. Conversion belongs at the host/adapter edge, preserving the DOM-free core.

A render barrier finishes pending layout/paint before capture and can return on an idle desktop. It must not wait indefinitely for a new presented frame when nothing is dirty. It is not a promise that arbitrary network work or host timers have settled.

## Engineering A + B — shell, Terminal, and scripts

**Experience.** Open Terminal and explore the running machine with familiar commands. Ask an agent to write a script, read it yourself, run it, and save it as a repeatable tool. The script can open apps, inspect controls, change settings, build source, and capture results. An external agent can execute that same script through MCP.

**Why it matters for agents.** Familiar commands and paths provide a reusable vocabulary; pipelines and scripts let the agent compose operations without a new tool for each workflow. Text output can be searched and filtered before returning it to the model. This is an architectural reason to include a shell, not an established claim that it outperforms structured tools on every task. Validate both on the chosen scenarios.

MCP is the connection/tool protocol; shell is one interface it can expose. Provide `run_shell` alongside structured tools, with command/script, cwd, bounded output, cancellation, and the selected session. Complex JSON arguments, source text, and binary artifacts may be easier to pass through structured calls. Both routes use the same authority, resource identities, and operation results. The shell runs inside Mockintosh's environment; `run_shell` is not permission to execute the regular computer's host shell.

### Commands and three front ends

Commands are TypeScript modules registered under `/bin`, discoverable with help and usage. The shell parses syntax, resolves paths, connects streams, and runs commands. A command receives argv, cwd, environment, a caller-scoped kernel, stdin/stdout/stderr, and a cancellation signal; it returns an exit status. Build and app commands wrap the shared services rather than hiding separate implementations.

| Commands | Purpose |
| --- | --- |
| `help`, `ls`, `cat`, `stat`, `pwd`, `cd` | Discover commands, documents, SDK, and live resources |
| `echo`, `write`, `mkdir`, `rm`, `mv`, `cp` | Create and manipulate VFS contents; `write path text` sends one complete body |
| `open`, `windows`, `inspect`, `click`, `dblclick`, `drag`, `type`, `key`, `menu` | Operate the visible OS through shared policies |
| `build`, `install`, `restart` | Compile a source revision, select an artifact, run the app |
| `grep`, `head`, `tail` | Filter text; document the supported options |
| `screenshot`, `render`, `sleep` | Capture output, finish pending painting, or wait with cancellation |
| `ps`, `kill`, `wait` | Inspect and manage locally owned execution once process accounting lands |
| `sh -c command`, `sh script` | Run command strings and scripts stored in the VFS |

The `build` command waits for the submitted job and exits nonzero on failure; it prints diagnostics to stderr and the successful build id to stdout. `install` takes an explicit successful build id, checks its source revision, and refuses accidental downgrade/stale selection unless requested. `restart` runs the selected installed build. Thus a script cannot silently install an unrelated result after a failed build.

There are three front ends over one interpreter:

- **Terminal app:** line editor, history, scrollback, and interrupt. This uses the existing single-line input as a starting point; it does not require the source editor's multiline buffer.
- **Host CLI:** `mockintosh-sh --connect <session>` acts on a live OS; explicit `--headless` boots an isolated machine for tests. Host stdin/stdout connect to the interpreter's streams.
- **Agent tool:** `run_shell` invokes the interpreter in a scoped OS session and returns exit status, bounded stdout/stderr, and a run reference when work continues. Omitted output is reported; full output can be retained as a resource.

Paths belong to the caller's VFS. Per-shell cwd/environment persist for that shell, while a tool invocation explicitly chooses whether to reuse or create a shell session. Source files written through structured tools are immediately visible to shell commands.

### Staged implementation, retained ambition

| Stage | Lands with | Contents |
| --- | --- | --- |
| **S1 — Explore and control** | M1 | Command registry, Terminal, CLI, `run_shell`, quotes/escapes, `;`, basic file/UI commands, exit status, cancellation |
| **S2 — Compose and save** | M2 | Script files, `\|`, `<`, `>`, `>>`, stderr redirection, `&&`/`\|\|`, environment expansion, text filters, build/install/restart commands |
| **S3 — Manage running work** | M3 | `/proc`, `ps`/`kill`/`wait`, background command jobs, stream cleanup and ownership integrated with app instances |

This is a useful shell, not a promise of Bash compatibility. Publish supported syntax and fail on unsupported constructs. Functions, loops, globbing, command substitution, richer job control, and shell-language compatibility remain explicit follow-on design choices rather than being dismissed as “a program's job.” Save ordinary sequences early, and add those features when the desired scripts justify them.

Pipelines carry byte streams with text helpers, bounded buffers, backpressure, EOF, and cancellation. Define pipeline exit status, including an option to fail when any stage fails. Redirection to ordinary files follows file-write rules; writing a control endpoint submits a complete command, not arbitrary chunks. `&&` runs the next command only after success. Distinguish parsing/dispatch failures, command failure, cancellation, and disconnected/unknown outcomes. Never execute script text with JavaScript eval or pass it to the host shell.

Local execution records unify command runs and app-instance ownership as S3 lands: actual pid, parent, kind, app/command identity, state, exit code, and owned resources. `/proc/<pid>/{status,args,windows,parent,ctl}` is a view of those records; `/proc/self` uses caller context. Existing `/instances` entries refer to the corresponding app execution records rather than forming a second lifecycle authority. `kill` requests cancellation, removes owned windows through the store, and runs registered cleanup; it cannot preempt a synchronous same-realm infinite loop. Remote build job ids remain separate from local pids; command cancellation explicitly requests remote cancellation when supported.

### Concrete scripts and acceptance

Proposed S2 syntax, once the named setting values and commands exist:

~~~sh
cat /sys/settings/desktop-pattern
echo checker > /sys/settings/desktop-pattern
menu  "Control Panel"
render && screenshot /disk/check.pbm
ls /apps | grep counter
~~~

The setting parser accepts a trailing newline. The image command chooses a documented encoding from its option or extension. Project paths in scripts use the actual discovered locations; role-based lookup remains the internal implementation.

Acceptance: a saved script inspects/changes the desktop setting, opens its UI, and captures the result. Run it in Terminal, against the same browser through MCP, and against an explicit headless test instance. A build script stops before installation after a compile error. A pipeline filters a listing, returns the documented exit status, and stops cleanly on interrupt. GUI, direct tools, and shell agree on resulting state and validation errors.

Shell-script tests are an additional readable integration layer. Move suitable `Testing.tsx` scenarios there once parity is demonstrated; retain focused implementation and pixel tests where they provide different evidence.

## Engineering A — projects, editor, builder, and app lifetime

### Project format and human ownership

Example logical layout; locate Applications and Desktop by role:

~~~text
/disk/Applications/Counter.app/
  mockintosh.json
  README.md
  src/index.tsx
  sprites/icon.sprite                   optional
  dist/<buildId>/index.js
  dist/<buildId>/index.js.map
~~~

The manifest has stable app id, title/icon, SDK compatibility, required capabilities, source entry, and the selected successful build entry. Track source revision and toolchain version with the build metadata. Source is authoritative; generated output is inspectable but regenerated. Start with relative project imports and the SDK's supported shared-runtime imports, without arbitrary dependency installation.

The desktop contains one shortcut to the registered app id. Rebuild updates that app instead of creating duplicates. Finder recognizes directory bundles before the generic directory opener, launches them on double-click, and offers Open Source/Show Package Contents. Existing manifest-file installs continue to work.

The source editor needs multiline insertion, selection, newline/indentation handling, scrolling, clipboard where available, Save, dirty state, and a way to navigate build diagnostics. FileViewer's read-only text and TextInput's single-line model do not meet this requirement. Syntax highlighting and language-server features can wait. An agent write must not silently replace a human's unsaved buffer: detect revision conflicts and let either side reload/merge deliberately.

### Build service

Proposed contract:

~~~ts
interface BuildRequest {
  requestId: string;
  sourceRevision: string;
  files: Array<{ path: string; bytes: Uint8Array }>;
  entry: string;
  sdkVersion: string;
}

interface BuildDiagnostic {
  severity: "error" | "warning";
  message: string;
  file?: string;
  line?: number;
  column?: number;
}
~~~

Submission returns a job reference. Status, diagnostics, cancellation, and the final artifact are separate operations. Byte encoding is the transport adapter's job. Validate relative paths and toolchain compatibility; the builder uses a fixed supported configuration rather than executing a project's arbitrary build script.

The first provider reuses [the app template](../templates/app/vite.config.ts): Solid universal compilation targeting `@mockintosh/ui/renderer`, with the runtime imports and their subpaths externalized to the OS's shared runtime. This preserves familiar source and avoids a second Solid runtime. Type-check against the served SDK contract and report diagnostics; compilation alone is not type-checking. Source maps connect runtime errors to editable source.

A browser worker compiler now ships as the browser default; the companion remains an optional remote provider. A small device can use the same remote builder only if its runtime can load and execute the resulting app; remote compilation does not make unsupported Solid/ESM execution possible. Do not replace the chosen Solid authoring experience with a DSL merely to meet a hypothetical device budget.

Build outputs are immutable and tied to the submitted source revision. If the source changes while a build runs, keep the output as that revision's result rather than silently presenting it as the newest code.

### Install, run, edit, rebuild

The loader accepts artifacts from the OS filesystem through a host module-loading adapter. Web Blob/module URL handling stays behind Platform; source packages do not contain transient Blob URLs as durable manifest entries. Bundle relative modules into the artifact and define asset resolution. Validate the manifest and module shape, register sprites, then select the build and create/update its shortcut.

Introduce running app instance ownership when restart becomes necessary, using the current `AppContext`/`onOpen` seam. Record app id, build id, owned windows, cleanup, and attributable diagnostics. Instances may outlive a window only when they explicitly own background work. Reopening documents uses the current app contract and a deliberate instance/delivery policy, rather than a pid allocated for each request.

On restart, close owned windows through the window store, dispose owned effects/subscriptions/timers, update the app registration, and reopen the selected build. Host timers need registered cleanup; a Solid owner does not cancel arbitrary timers. Verify that reordering windows does not remount their contents. Expose instance status before adding a complete POSIX-style process table.

Retain the previous successful artifact and make Restore Previous Build available. Compile failure does not replace the selected build. Runtime initialization failure is reported and allows recovery. Same-realm JavaScript cannot be preempted by cooperative “kill”; a hung app may require reloading the OS with auto-launch disabled. ESM caches may retain loaded modules until reload; promise clean app resources and correct new builds, not unlimited hot-reload memory reclamation.

## Engineering B — shared tools, live connection, and settings

The operation registry owns schemas, validation, dispatch, and result types. Internal tools and the MCP adapter use that registry; neither reaches directly into mutable window stores or invents its own installer. Agent-visible documentation is generated from the same contracts.

The live bridge identifies the OS instance, boot generation, SDK version, capabilities, and granted operations. The external client selects an instance explicitly. Reload invalidates old UI references. Disconnect is reported; an adapter must not silently start a new headless OS and keep reporting success.

Start with a companion MCP server on the regular computer and an opt-in browser connection to it. Pair the connection with that instance; restrict connection origins and authenticate commands. Follow the MCP SDK/specification supported by the target clients; the browser bridge is a separate internal transport, not “MCP over WebSocket” by assumption.

Subscription RPC uses ids, notifications, cancellation/unsubscribe, and disconnect cleanup. Callbacks and returned unsubscribe functions remain local conveniences, not JSON values. Serialize conflicting UI actions; include action ids and outcomes. A timeout after a mutation is an unknown outcome to reconcile, not permission to blindly repeat a click or install.

Implement desktop pattern in a settings service backed by the role-based preferences folder. Control Panel reads and writes the service, Desktop renders its value, and tools can either use the named controls or the same setting operation. Validate supported patterns and supply a default for older disks.

## Engineering A + B — the in-OS agent loop

First align the chat UI and endpoint on a single typed request/response contract and correct message history construction. Preserve existing image/docs behavior while adding the shared OS tools.

An agent run repeats: request model response → validate proposed tool call → execute against selected session → return result → continue or finish. The existing one-tool-round limit cannot build, inspect, fix, and retry. Add an explicit step/time/output budget, cancellation, progress, and errors rather than promising an unbounded background task.

The initial gateway may return proposed tool calls to the OS, which executes them and submits results on the next request. This works without giving a server direct access to browser storage or assuming an Edge request stays alive throughout a build. Correlate tool calls, source revisions, and results to the run; stop submitting new work after cancellation and resolve any already-committed operation.

Show readable progress (“Writing source”, “Building”, “Trying the app”), expandable tool results, and links to source/diagnostics. A human should be able to understand what changed. Record completed actions and changed file revisions; this is an activity history, not deterministic replay of the whole machine.

Use the running OS's SDK guide, declarations, examples, and version as model context. The build pipeline already embeds the guide; extend it instead of introducing a second handwritten SDK description or fetching an incompatible latest branch as the authority.

Keep provider credentials at the gateway. Session operation grants are enforced where tools execute. App creation/control tasks should run through the authorized workflow without confirmation on every click. Treat imported documents and app text as task data, not authority to widen the run's granted scope.

Generated apps currently share a JavaScript realm with the OS. Namespace filtering and manifest `requires` do not turn that into a sandbox. A hostile-code execution boundary needs its own design; the initial build loop must accurately describe this trust model and keep a reload/recovery path.

## Milestones and evidence

These milestone numbers replace the old sequence. Product priority is A then B; implementation delivers B's shared controls early because A uses them to try and debug the apps it creates.

| Milestone | Deliverable | Evidence that it works |
| --- | --- | --- |
| **M0 — Baseline and contracts** | Land current refactor separately; confirm SDK/import map and app context; freeze example scenarios and chat contract | Core checks and existing tests pass; current seams documented accurately |
| **M1 — Operate the visible OS** | VFS, shared tools, named UI, render barrier, persistent desktop setting, live MCP bridge, shell S1 | External client opens Control Panel, changes/verifies the pattern after reload; Terminal and `run_shell` explore/control the same browser |
| **H1 — Optional persistent server computer** | Durable computer/boot identities, isolated host, persistent disk, remote display/input | Disconnect/reconnect and restart preserve the computer and disk; stale boots fail; browser-local mode still works |
| **M2 — Make and edit a real app** | Project folders, source editor, first build provider, package loader/shortcut, instance restart/recovery, shell S2 | Human builds Counter, edits/rebuilds it, reopens after reboot; saved scripts and pipelines exercise the same operations |
| **M3 — Ask the agent to build it** | Repeated ChatGippity tool loop, runtime SDK context, progress/cancel, source conflicts, shell S3 | ChatGippity creates/tests/repairs Counter and changes settings; agents can use direct tools or shell scripts; running jobs are inspectable and cancellable |
| **M4 — First system modification experiment** | Fork/restore one bundled app, then one chosen extension contract | Agent and human can inspect, run, and undo the modification; core remains recoverable |

For M1–M3, keep checks proportional but meaningful:

- Headless tests use named controls and shared operations; retain pixel assertions for visual behavior.
- Test stale/ambiguous targets, inactive windows, modal blocking, unsupported settings, and idle render barriers.
- Exercise the same operation results through direct and RPC adapters, including errors and disconnects. Listing mounts alone cannot prove parity.
- Include shell parity and script/pipeline error, cancellation, redirection, and output-limit cases as S1–S3 land. Compare direct-tool and shell routes on the same agent tasks without assuming either always wins.
- Run a deterministic fixture agent through the complete tool loop, including a build error and retry. Use a real model run as a separate product demonstration, not the sole regression test.
- Build and launch a real Solid fixture using the production import configuration; verify source edit → different behavior → persistence, and restart cleanup.
- Cover concurrent source edits, stale build completion, invalid bundles, failed launch, shortcut deduplication, and previous-build recovery.
- Run `check:core`, type-checking, and relevant existing suites as each implementation lands. Update ARCHITECTURE and the SDK guide when behavior ships.

The first milestones should be separate reviewable changes. No fixed time estimate is claimed; editor interaction and restart cleanup are larger pieces than a thin RPC adapter.

## Future possibilities we are preserving

These remain important, but none is a prerequisite for Counter appearing on the desktop.

| Possibility | Connection to the chosen experiences | What would make it worth building next |
| --- | --- | --- |
| Remote agent or compiler service | Already useful for A on limited hardware | A second host/provider that implements the same contract |
| Network home and archives | Keep source/apps across devices; recover earlier experiments | “Open my project on another Mockintosh” |
| Shared folders, mailboxes, or app workshops | Exchange apps and collaborate with people/agents | “Send this app to a friend” or “Work on this project together” |
| Per-session/per-process rebinding | Give a builder, agent, or app a different view of resources | A concrete need to swap providers or constrain a workspace |
| General CPU servers | Run larger jobs away from the terminal | A task the fixed build/agent services cannot reasonably express |
| Plumber / Open Selection | Open diagnostics at a line; connect apps through contextual data | A second use beyond editor diagnostics |
| App semantic services | Extend a drawing/editor app through its document and event interface | One useful external helper |
| Richer shell language and compatibility | Extend the committed S1–S3 shell with functions, loops, globbing, or other syntax | A concrete automation script requiring those constructs |
| Actual 9P interoperability | Mount third-party Plan 9 services or accept 9P clients | A named service/client we want to connect |
| HyperCard-style worlds, virtual peripherals | Playful packaged environments and device substitution | A user-facing experiment chosen after A/B |
| Core self-modification | Deeper form of C | A specific shell change plus proven boot recovery |

For network storage, the server must own authoritative file operations and revisions. The current FSBackend writes one catalog document and is not a multiwriter database; putting that backend behind HTTP is insufficient. Add read caching, durable-write acknowledgments, change notifications, and explicit conflicts before claiming shared storage. Offline mutation merging and automatic replay of device commands are not implied.

For remote resource mounts, expose async operations and scoped exports; a local reactive cache represents loading/disconnection honestly. Keep service identity separate from mount location. Remote jobs have their own ids and disconnect/lifetime policy rather than borrowing local process ids.

A small terminal can keep UI/input local and use remote builds/agents. A device too small to run the renderer may instead need a separate display/input transport to an OS running elsewhere. Neither path is guaranteed merely by the small framebuffer or DOM-free core.

## Decisions and rationale

- 2026-09-10 — Multiple hosts are an explicit product goal. Add H1 alongside M2/M3, keep host infrastructure outside the kernel, and separate persistent computers from boots and client connections. Provider selection and local-first data research are tracked in the server infrastructure plan.

- 2026-09-09 — Original plan proposed namespace, RPC, processes, and shell as four phases.
- 2026-09-10 — Earlier review established named UI access, shared typed input, a stable disk mount, and the kernel as the common operation boundary. These principles are retained.
- 2026-09-10 — User selected in-OS agent app creation with editable Solid source, and agent control through MCP or in-OS chat, as the first compelling experiences. System hacking is a potential follow-on.
- 2026-09-10 — Reorganized around those experiences and their acceptance scenarios. The app builder is first-class, including a human source editor and build/restart recovery.
- 2026-09-10 — A full shell and broad process model cease to be prerequisites. Add the actual instance lifecycle needed for app rebuilding; do not allocate placeholder pids.
- 2026-09-10 — Preserve Plan 9 composition through async service contracts and explicit session views. Use a companion builder first; defer general network storage/CPU infrastructure until a concrete experience requires it.
- 2026-09-10 — Corrected outdated assumptions: generated SDK chat context already exists; current app context and onOpen are the ownership seam; structural UI indices can be reused; watch callbacks are not a wire protocol.
- 2026-09-10 — Future choices remain visible with their triggers. Moving them out of the first milestones is sequencing, not rejection.
- 2026-09-10 — User reaffirmed the shell and VFS direction. The experience rewrite had removed too much shell detail. Restored Terminal, CLI, command modules, scripts, pipes/redirection, process commands, and shell tests as a staged S1–S3 commitment within M1–M3. Named the VFS explicitly and strengthened tool/shell parity. Full shell-language compatibility still need not precede the first demonstration.

## References

- [Server infrastructure plan](server-infrastructure-plan.md) — hosting, deployment, data ownership, and H1 delivery.
- [Server data-layer research](server-data-research.md) — traditional, local-first, and multiplayer options.
- [Apps in Web Workers](worker-apps-plan.md) — one worker per app instance; the isolated execution §5 asks for, inside the browser.
- [Browsix research](browsix-research.md) — what to borrow from a Unix kernel in the browser.

- [Plan 9 research and earlier kernel review](plan9-research.md) — primary sources and fuller discussion of namespaces, service protocols, Acme, plumbing, and pitfalls.
- [Plan 9 from Bell Labs](https://9p.io/sys/doc/9.html) — file interfaces, private namespaces, and terminal/compute/storage separation.
- [The Use of Name Spaces in Plan 9](https://9p.io/sys/doc/names.html) — service composition and substitution.
- [9P protocol](https://9p.io/magic/man2html/5/intro) — resource handles, requests, cancellation.
- [Acme](https://9p.io/sys/doc/acme/acme.html) — applications extended through service interfaces.
- [MCP architecture](https://modelcontextprotocol.io/docs/learn/architecture) — hosts, clients, servers, tools, and transports.
- [Architecture](../ARCHITECTURE.md), [SDK developer guide](../packages/sdk/docs/APP_DEV_GUIDE.md), [app template](../templates/app/vite.config.ts) — current implementation contracts.
- [Physical product plan](physical-product-plan.md), [project ideas](ideas.md) — retained device and creative directions.
