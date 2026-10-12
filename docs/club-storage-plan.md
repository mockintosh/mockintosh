# Your disk in the Computer Club: synced storage

Plan, 12 October 2026. Phase 1 (your disk, locally) is built; see [What's built](#whats-built-phase-1). Companion to the [Computer Club plan](computer-club-plan.md), which covers accounts, credits and connecting Macs.

## Context

A Mockintosh's disk lives in the browser's private storage (OPFS). It is lost when the browser clears the site's data, and it stays on the one browser that made it. Now that people have Computer Club accounts, their things can follow them: to another browser, another computer, a phone, or back after the browser has cleared its storage.

The question was whether to save everything or to sync a chosen part, iCloud-style. The answer here is both, by drawing the line where classic Mac OS drew it: **your own disk syncs completely, and the Mac's disk stays local.**

## Decisions

- **Your home is a disk of its own, AppleShare style.** While you're signed in, a second disk named after you ("Gustav") appears under Mockintosh HD. It holds your Desktop Folder, Documents, Pictures, Projects, Preferences, Fonts and Trash.
- **Everything on your disk syncs; nothing on Mockintosh HD does.** There are no per-file sync settings: the disk is the boundary, and the Finder shows it.
- **The desktop and Trash are views over every disk**, as in System 7: each disk keeps its own invisible `Desktop Folder` and `Trash`, and the Finder shows them together.
- **While you're signed in, the desktop means *your* desktop.** Anything dropped on the desktop, and any new desktop file (a screenshot), goes to your disk, even from a window on Mockintosh HD. This departs from System 7, where a file kept to its own disk, because otherwise people would lose files they assumed were syncing.
- **New files default to your disk:** Save dialogs, Photo Booth, MacPaint, screenshots.
- **Signed out, nothing changes from today.** A guest, or a Mockintosh with no Club, has one disk, Mockintosh HD.
- **Joining moves the guest's things to your disk**, with Move selected; signing in to an existing account on a Mac with guest files asks first, with Don't Move selected (see [From guest to member](#from-guest-to-member)).

## What's built (phase 1)

- **Home disks in the file system** (`packages/fs`). A volume node can carry `home` (the member's Club id) and `ejected`. Your disk lives in the same catalog and OPFS storage as Mockintosh HD; there is no second backend yet.
  - `volumes()` lists mounted disks, startup disk first; `locate(role)` searches a mounted home disk first, so Desktop Folder, Pictures and Documents resolve to it, and roles it lacks (System Folder, Preferences, Applications, Fonts) to Mockintosh HD. `locate("volume")` stays the startup disk. The order lives in `packages/fs/src/volumes.ts`, shared with app processes' mirror (`src/platform/web/process/fsMirror.ts`).
  - An ejected disk and everything on it read as absent (`node`, `children`, writes), with a fast path when nothing is ejected; app processes' snapshots leave it out.
  - `mountHome(member, name)` creates or remounts the disk; `eject(id)` ejects it.
- **The member's disk** (`src/os/home.ts`, started from `src/os/boot.ts`). It follows `os.club.member`: mounted with its Desktop Folder, Trash, Documents and Pictures on sign-in; ejected on sign-out, and Finder windows on it close. While the Club is unreachable (`os.club.offline`) the disk stays as it was. Members now have an `id` (`ClubMember.id`), which names the disk's owner.
- **The guest's files.** On mounting, desktop items other than app shortcuts and everything in Pictures on Mockintosh HD are offered once: a new account (made in the last hour, disk new to this Mac) gets **Move** as the default, an existing one **Don't Move**. Moving is one catalog change, since both disks share the Mac's storage: no copying and nothing to resume. Desktop positions travel with the files; a clash gets " (this Mac)". Later sign-ins ask only about files made since (`guestCheckedAt` on the disk).
- **The Finder.** The desktop shows each disk's icon and Desktop Folder; an icon moved on the desktop stays on its own disk, and anything else dropped there goes to your disk. One Trash icon (Mockintosh HD's) shows every disk's Trash: its window lists them together, trashing sends each item to its own disk's Trash, the full icon and Empty Trash cover them all. A home disk gives up its desktop place when it ejects, and an icon whose saved place another disk's icon took while it was away moves to the nearest free place (`GridIcon.group`).
- **Apps.** New files from screenshots, Photo Booth, MacPaint, imports and the rest go to your disk through `locate`. Photo Booth and TP7 use a remembered library only if it's on that disk. App Store installs and their shortcuts stay on Mockintosh HD (phase 3 moves them).
- **Tests:** `src/os/fs.test.ts` (home disks), `src/os/home.test.ts`, `apps/finder/iconGrid.test.ts`, `src/platform/web/process/fsMirror.test.ts`.

Phase 2 syncs the home disk's subtree out of the shared catalog; giving it a storage folder of its own can wait until there is a reason.

## What is on a disk today

Measured on a fresh disk (8 files, 6.7 KB) and read from the code:

- **Not on the disk** (part of the OS that the site serves, the same for everyone):
  - the system fonts (Chicago, Geneva, New York, …), compiled into the JavaScript;
  - the built-in apps, and App Store apps' code;
  - icons, sprites, the 1984 video and the Showreel.
- **On the disk:**
  - the catalog: the folder tree, ~5.6 KB new (`mockintosh-fs/meta.json`);
  - desktop shortcuts (~20 bytes each) and App Store install manifests (~260 bytes each, `src/os/installedApps.ts`);
  - each app's settings under `System Folder/Preferences/<app>` (`src/os/appStorage.ts`), small JSON;
  - your work: Photo Booth pictures, MacPaint paintings, screenshots. Being 1-bit, each is a few KB to ~50 KB;
  - app projects: source, plus every build's `index.js` and source map (`docs/m2-apps.md`), the largest category for developers and rebuildable from source;
  - fonts you add (`System Folder/Fonts`), and files dragged in from the real computer (`src/os/hostImport.ts`), of any size.

A heavy member (200 pictures, 30 paintings, three projects with ten builds each) has about 15 MB, ~9 MB of it build output.

## Layout

| Your disk ("Gustav", synced) | Mockintosh HD (this Mac, local) |
|---|---|
| Desktop Folder: your files | Desktop Folder: the Mac's shortcuts (Safari, App Store, …) |
| Documents, Pictures, Projects | System Folder: Extensions, Printer Drivers |
| Applications: your App Store installs (manifests) | Preferences tied to hardware: printers, screen size |
| Preferences: your apps' settings | Build output and caches |
| Fonts you added | Trash (the Mac's) |
| Trash (yours, emptied after 30 days) | |

- **Roles per disk.** The file system already finds folders by role per disk (`locate(role, volumeId)` in `packages/fs/src/fileSystem.ts`) and supports several disks. The work is in the ~36 callers that assume one Desktop, Trash or Pictures.
- **App settings follow you by default.** The app storage API gains a "this Mac only" option for hardware settings, such as the Chooser's printers. Everything else moves from `System Folder/Preferences/<app>` to your disk's `Preferences/<app>`.
- **Build output doesn't sync.** A project's `dist/` folders are marked local; another Mac rebuilds from the synced source, or fetches only the build in use.
- **Your App Store installs** are manifests on your disk, so your apps reappear on every Mac you sign in to.

## The Desktop and Trash

- **The desktop** shows every mounted disk's Desktop Folder together. Get Info says where an item really is ("Where: Gustav: Desktop Folder").
- **Dropping on the desktop while signed in** moves the item into your disk's Desktop Folder, from any disk. Signed out, it goes to Mockintosh HD's.
- **Icon positions** are already stored per file (`attributes.position`), so they sync with the file. A Mac with a smaller screen pulls icons inside its edges without changing the saved position.
- **The Trash icon** shows every disk's Trash; Empty Trash empties them all. Put Away returns an item to its folder on its own disk. Your disk's Trash empties items older than 30 days, which bounds what it stores.
- **Ejecting or signing out** removes that disk's items from the desktop and the Trash view, and mounting it again brings them back.

## From guest to member

**Joining on this Mac.** The new disk is empty and the guest's things are almost certainly the new member's. The Club window offers, with Move selected:

> Move the 3 items you made before joining to your disk "Gustav"? They're on the desktop and in Pictures on Mockintosh HD. [Don't Move] [Move]

1. **One move.** Both disks share the Mac's storage, so moving is a single catalog change: the same files at the same desktop positions, nothing on the screen jumps, and nothing to resume.
2. **Upload in the background** (phase 2). The Club window shows progress ("Uploading 12 of 40"); moving doesn't wait for the network.
3. **What moves:** desktop items the guest made and everything in Pictures. Phase 3 adds app settings that follow you and App Store installs. **What stays:** the Mac's app shortcuts and settings tied to this Mac.
4. **Over the quota** (phase 2): whatever doesn't fit stays on Mockintosh HD, and the window lists it.

**Signing in to an existing account on a Mac with guest files.** The guest files might be the member's from before signing in, or someone else's on a shared computer. The window asks, with Don't Move selected, and says how many items. Moving them:
- **Name clashes** get a suffix: "Untitled Painting (this Mac)".
- **App settings** keep the account's version, the one in use elsewhere.

**Signing out.** Your disk unmounts. The cached copy stays hidden, so the next sign-in is instant and works offline; "Remove my files from this Mac" clears it, for shared computers. Files a guest makes while signed out follow the existing-account rule at the next sign-in.

## Syncing

- **One row per file and folder**, not the catalog as one JSON document. Each row has the revision number the file system already keeps. A Mac asks "what changed since my cursor?" and gets the list of rows eagerly; file contents come when a file is opened.
- **Small files in the database, large ones in Blob.**
  - Files under ~16 KB (settings, shortcuts, manifests, many pictures) are stored in the row.
  - Larger ones go in private Vercel Blob storage under the SHA-256 of their contents, so identical files are stored once and an unchanged file is never uploaded again.
- **Batched uploads.** Changes go up at most every 30–60 seconds, and when the tab is hidden or closing. A file rewritten 50 times in a minute uploads once.
- **Checking for changes when it matters:** when the window gets focus or becomes visible, plus a slow interval while open. A realtime channel can come later.
- **Offline.** Your disk's local copy works without the network; changes queue and go up when it's back.
- **Conflicts are per file, never per tree.**
  - Every write carries the revision it was based on; the file system already refuses a stale one (`expectedRevision`, `FSError("conflict")`).
  - When two Macs changed the same file, both versions are kept, the second as "Report (from laptop)".
  - Folder renames and moves that cross apply in the order the Club received them; an item moved into a folder another Mac deleted is put back in the Desktop Folder.
- **Versions.** The catalog format has a version (`CURRENT_CATALOG_VERSION`). A Mac whose format is older than the disk's mounts it read-only and says to reload, so an old copy can't damage a newer disk.

## Cost

At list prices: Vercel Blob $0.023 per GB-month, $5 per million uploads, $0.05 per GB downloaded ([Vercel Blob pricing](https://vercel.com/docs/vercel-blob/usage-and-pricing)); Neon $0.35 per GB-month and ~$0.11 per compute-hour ([comparison](https://www.prisma.sh/blog/prisma-postgres-vs-neon-pricing-2026)). Check both before budgeting. For 10,000 heavy members:

| Cost | Synced naively | Synced as above |
|---|---|---|
| Storing files (~150 GB) | ~$3.50 a month | ~$1.50 (build output and old Trash skipped) |
| Uploads (every write to Blob, ~300 a day each) | ~$450 a month | a few dollars (small files in rows, batching, dedupe) |
| Sync requests (a check every 30 s while open) | ~$10–20 a month | a few dollars (on focus, slow interval) |
| Database compute | ~$76 a month (always awake) | the same; the Club is heading there anyway |
| Downloading a disk to a new Mac (15 MB) | a fraction of a cent | the same |

Storage is nearly free because 1-bit work is small. What costs money is write and request volume, which the sync design controls, and outliers (imported media), which the quota controls.

- **Quota:** 100 MB free, thousands of 1-bit pictures. A cap per file (e.g. 25 MB). More space later, paid in credits each month. The disk's Get Info shows "used of 100 MB".
- **Dormant disks:** archived after a long period without a sign-in, with notice by email.

## Data model (the Club's database)

- **`disk_node(id, user_id, parent_id, name, kind, type, size, revision, modified_at, attributes jsonb, content bytea null, blob_sha256 null, local_only bool, deleted_at)`**: one row per file or folder on a member's disk. `content` holds small files; `blob_sha256` names large ones. Deleted rows stay as tombstones for a while so other Macs learn about the deletion.
- **`disk_blob(sha256 PK, size, user_id, created_at)`**: which large contents exist, for quotas and cleanup.
- **`disk_cursor`**: a per-member change counter, so "what changed since N" is one indexed query.
- **Quota** is the sum of `size` over a member's live rows.

## Code

- **`packages/fs`:** home disks share the catalog and storage with Mockintosh HD (phase 1). The sync engine (phase 2) pushes and pulls the rows of the home disk's subtree.
- **The Finder** (`apps/Finder.solid.tsx`) shows the union of Desktop Folders and Trash folders, and routes desktop drops to your disk while signed in.
- **`src/os/appStorage.ts`:** settings on your disk by default, with a "this Mac only" option.
- **`src/os/fsBootstrap.ts`:** creating and repairing your disk's folders when it mounts.
- **The callers** that assume one Desktop, Trash or Pictures (~36) take the disk they mean.
- **The Club** (`sites/club`): `/api/disk/changes`, `/api/disk/push` and `/api/disk/blob/*`, behind the session, with quota checks.
- **The Club window** gains the move prompts, upload progress, and "Remove my files from this Mac" on sign-out.

## Phases

1. **Your disk, locally** (built). Mount a second, local-only disk for the signed-in member: per-disk roles in the Finder, the merged Desktop and Trash, "my desktop" drops, new files defaulting to it, the guest-to-member move and its prompts. No network yet; this proves the interface on its own. Signing out already ejects the disk and keeps its contents on the Mac; phase 4 adds removing them.
2. **Sync.** The Club's tables and endpoints, the push and pull engine, small files in rows and large ones in Blob, batching, conflict copies, the read-only gate for older versions, quota.
3. **Settings that follow you.** App settings on your disk by default, the "this Mac only" option, App Store installs reappearing on other Macs.
4. **Signing out and shared computers.** Unmount, keep or clear the cached copy, guest files at the next sign-in.
5. **Docs.** `ARCHITECTURE.md`, the SDK guide (where an app's files and settings go), the Club plan.

## Risks and open questions

- **Other people's copies.** A copy of Mockintosh on someone else's site, once connected, could read your disk. The connect page should ask for it separately from credits: "use your credits" and "see your disk" as two permissions.
- **Encryption.** End-to-end encryption (keys only on your Macs) would keep files from the Club too, but makes restoring after losing every device hard and rules out server features later. In v1, files are private to the member and encrypted at rest by the providers.
- **Losing local data before it syncs.** Browsers can clear OPFS. Asking for persistent storage (`navigator.storage.persist()`) when you sign in, and uploading promptly, narrows the window.
- **Blobs missing from OPFS.** While measuring for this plan, one disk in the desktop app's browser pane had a complete catalog but no file contents. It's being investigated separately; it must be understood before sync relies on the local copy.
- **Moving many files.** A guest with hundreds of pictures makes the first upload long; the move is local and instant, and the upload is resumable and shows progress.

## Verification

- **Unit tests:** the merged desktop and Trash across disks; "my desktop" drops from Mockintosh HD; the guest-to-member move and its defaults; conflict copies from two Macs editing one file; tombstones; the read-only gate; quota refusals; dedupe of identical contents.
- **End to end, locally,** with two browsers (two ports) against the local Club: join in one with guest files and move them; sign in to the other and see the same desktop; edit a file in both and get a conflict copy; sign out and in; clear one browser's site data and get everything back.
