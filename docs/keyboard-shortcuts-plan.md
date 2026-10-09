# Keyboard shortcuts: audit and plan

Mockintosh runs inside a browser on a host OS, and both of them already use the ⌘ key. This document lists every shortcut we bind today, shows which ones clash with the browser or host, and proposes how keys should be routed so each command can be reached and the browser no longer acts on keys the Mac has handled.

## How keys flow today

```
window "keydown" (src/platform/web/index.ts:263)   ← preventDefault only for Tab
  → bootOS.onKey (src/os/boot.ts:829)
      screenshot capture
      ⌘⌥Esc / ⌃⌥Esc → force quit
      ⌘V / ⌃V → app's Paste item, else host clipboard paste
      meta + 1 char → runMenuShortcut (first enabled match in the menubar)
  → ui.dispatchKeyboard → focused widget (textEditing ⌘A/C/X/Z/Y, arrows…)
```

There are four structural problems:

1. **The browser also acts on every ⌘ key we handle.** The `keydown` listener never calls `preventDefault` on ⌘/⌃ chords. When an app runs ⌘S, the browser opens its Save Page dialog as well. ⌘R reloads the tab and throws away the session. ⌘[ goes back in the browser's history. ⌘= zooms the page, which rescales the canvas. `packages/ui/src/web/mount.ts` (UI kit mounted on a page) has the same gap.
2. **Some chords never reach the page.** Browsers and macOS keep ⌘Q, ⌘W, ⌘N, ⌘T (with their ⇧ forms), ⌘H, ⌘M, ⌘Tab, ⌘\` and ⌘Space for themselves. The page gets no `keydown` for them, so menu items bound to these keys can't be triggered from the keyboard, and pressing them quits, closes, or hides the browser.
3. **Menu shortcuts don't work on Windows or Linux.** `runMenuShortcut` only runs when `mods.meta` is set (`boot.ts:856`), and on those hosts the meta key is the Windows/Super key, which the OS takes. Paste and text editing already accept ⌃ as ⌘, but menus don't, so the behavior is inconsistent.
4. **The shortcut grammar is one character with ⌘ only, and ⇧ is ignored.** `item.shortcut.toLowerCase() === key.toLowerCase()` means ⇧⌘S runs ⌘S. Apps can't express ⇧⌘Z (Redo), ⇧⌘S (Save As), or ⌥⌘ variants, so they fall back on odd letters (Earth ⌘J "Now") or on keys the host takes.

## Inventory

The table groups every menu shortcut in `apps/` by host conflict. "Reserved" means the page never sees the key. "Default action" means the browser does something unless we call `preventDefault`. Browser behavior is taken from Chrome, Safari, and Firefox on macOS and needs confirming with the manual matrix in [Verification](#verification).

| Chord | Host behaviour | Bound in Mockintosh |
|---|---|---|
| ⌘Q | **Reserved**: quits the browser | Quit in every app (25+) |
| ⌘W | **Reserved**: closes the tab | Preview Close, Safari Close Tab, Terminal Close Window |
| ⌘N | **Reserved**: opens a new browser window | Finder New Folder, Canvas New, Safari/Terminal New Window, OP-1 New Tape |
| ⌘T | **Reserved**: opens a new tab | Safari New Tab, Photo Booth Take Photo |
| ⌘H | **Reserved (macOS)**: hides the browser | Earth Home |
| ⌘M | **Reserved (macOS)**: minimizes the window | Earth The Moon, Showreel Mute, Synth Mutate, MacPaint Align Middle |
| ⌘R | Default action: **reloads the page, and the session is lost** | Safari Reload, Showreel/Surface Play, Synth/TP-7/OP-1 Record, Photo Booth, Earth Rotate, Maps Reverse Route, Visualizer Surprise Me, MacPaint Align Right |
| ⌘[ ⌘] | Default action: history back/forward, **can leave the site** | Safari, Earth, Maps, OP-1, Synth, Showreel, Visualizer |
| ⌘= ⌘- ⌘0 | Default action: page zoom, which rescales the canvas | Earth, Maps, Surface, Chord, Showreel, Visualizer |
| ⌘1–⌘9 | Default action: switches browser tab | OP-1 ⌘5 Show Pattern |
| ⌘L | Default action: focuses the address bar, which then takes the following keys | Safari Open Location, Chord, TP-7, MacPaint Align Left |
| ⌘S ⌘P ⌘O | Default action: Save/Print/Open dialog on top of ours | Canvas, Maps, Surface, Foundry, Trace, OP-1, Synth, Dither, Preview, Photo Booth, MacPaint |
| ⌘F ⌘D ⌘E ⌘I ⌘B ⌘U ⌘K | Default action: find bar, bookmark dialog, and similar, varying by browser | Full Screen (8 apps), Duplicate/Directions/Dice/Bookmark, Export, Italic/Install, Bold, Underline/Revert, Clear Scrollback |
| ⌘A ⌘C ⌘X ⌘V ⌘Z | Default action is harmless while the canvas has focus | Edit menus, text widgets |
| ⌘. | Free (Stop in some browsers) | Terminal Interrupt, Synth/Chord/OP-1 All Notes Off, cancel in screenshot capture |

Problems inside apps:
- Earth binds F, P, `[` and `]` twice, but in menubars that are never shown together (mission vs. globe), so they don't collide. Nothing guards against a real collision: `runMenuShortcut` silently picks the first match.
- Instrument apps (Synth, Chord, OP-1, TP-7, Visualizer, Earth, Maps) ignore their raw-key handlers when ⌘/⌃ is held. That's correct and should stay.

## Strategy

### 1. If the Mac handled a key, the browser doesn't see it

`onKey` returns whether the Mac consumed the key, and the web platform calls `preventDefault()` when it did. A key counts as consumed when:
- a menu shortcut matched (enabled or not: a disabled item still belongs to the Mac, so ⌘S on a greyed-out Save shouldn't open the browser's dialog), or
- it was paste, force quit, or screenshot capture, or
- focus is inside the Mac and the chord is a text-editing chord (A C X Z Y, arrows, Backspace).

Any other chord falls through to the browser. If no app binds ⌘R, the user can still reload. If an app binds it, the app gets it and the page does not reload.

### 2. Every command can be reached: the host's second command key

Some chords never reach the page (problem 2 above), so each shortcut needs a second way in:
- **macOS host:** ⌃ also counts as ⌘ for menu shortcuts. Mini vMac does the same. ⌃ + letter is almost entirely free in browsers on macOS, and our text widgets already treat ⌃ as ⌘. The exception is when focus takes raw keys (`ui.focusedTakesRawKeys()`, i.e. Terminal): there ⌃ stays ⌃, as ⌃V already does.
- **Windows/Linux host:** Ctrl is ⌘. Meta belongs to the host OS. This fixes problem 3.

Menus keep showing `⌘` for authenticity. The Help menu or About box should mention "⌃ works as ⌘", and on Windows/Linux the menubar could optionally show the key as `Ctrl`.

### 3. A safety net for reserved keys

Users will press ⌘Q and ⌘W out of habit. Register a `beforeunload` handler while any app other than Finder is running (or, more precisely, while an app reports unsaved changes). A stray ⌘Q, ⌘W, or reload then shows the browser's "Leave site?" prompt instead of discarding the session. Data on disk survives anyway (OPFS), but window state and unsaved documents don't.

As a progressive enhancement on Chromium, when the Mac is shown in browser full screen (Fullscreen API), call `navigator.keyboard.lock()`. ⌘W, ⌘N, and ⌘T then reach the page. Which keys Keyboard Lock can capture on macOS needs checking per browser, and ⌘Q is likely still out of reach.

### 4. A shortcut grammar with modifiers, matched exactly

`shortcut: "S"` keeps meaning ⌘S. Add optional prefix glyphs: `"⇧S"`, `"⌥S"`, `"⌥⇧S"`. Matching requires the modifiers to be exactly equal, so ⇧⌘S no longer runs ⌘S. The menubar renders the full chord (`⇧⌘S`) in standard Mac modifier order. Changes are needed in `packages/sdk/src/menus.ts`, `src/os/kernel/schema.ts`, `src/os/process/menus.ts`, and `Menubar.solid.tsx` (width measurement and drawing).

### 5. One table of reserved and standard chords, enforced in development

`@mockintosh/sdk` exports:
- `STANDARD_SHORTCUTS`: File N O W S ⇧S P Q, Edit Z ⇧Z X C V A, ⌘. Cancel, ⌘? Help. An app may use these letters only for their standard meaning.
- `HOST_RESERVED`: Q W N T H M (and their ⇧ forms). An app may bind these only for their standard meaning, and only because the ⌃ alias (section 2) and the guard (section 3) cover them. Non-standard uses (⌘H, ⌘M) move.

A development-only `validateMenubar(menus)` runs whenever `setMenus` is called and warns about duplicate chords in a single menubar, non-standard uses of reserved or standard chords, and unparseable shortcuts.

Proposed remaps (only for non-standard uses of reserved chords):

| App | Today | Proposed |
|---|---|---|
| Earth: Home | ⌘H | ⇧⌘H (Finder's "Home") |
| Earth: The Moon | ⌘M | ⇧⌘M |
| Showreel: Mute | ⌘M | ⌥⌘M |
| Synth: Mutate | ⌘M | ⇧⌘M |
| Photo Booth: Take Photo | ⌘T | keep (it's Photo Booth's own), add Return/Space in the window |
| MacPaint: Align Middle | ⌘M | **decision needed**: keep the authentic key and rely on ⌃M, or move it |

Keys that only have a default action (⌘R, ⌘[, ⌘=, ⌘5…) don't need remapping. Section 1 makes them work as they are.

## Plan

1. **Stop the browser acting on handled keys** (small PR, biggest win). *Done.* A dimmed item's key is still cancelled in the browser, but it goes on to the focused field, because Finder dims Select All while renaming and the field needs ⌘A. The guard is off in development, where Vite reloads the page itself.
   - `PlatformInput.onKey(handler: (e) => boolean | void)`. `bootOS.onKey` returns true for handled keys as defined in section 1. `runMenuShortcut` reports disabled matches as handled too.
   - `src/platform/web/index.ts`: `if (handled) e.preventDefault()`. Match this in `packages/ui/src/web/mount.ts` (`ui.dispatchKeyboard` must report consumption).
   - Add the `beforeunload` guard.
2. **Host chord normalization.** *Done, more simply than first planned.* The same rule works on every host, so no host detection is needed. `macKey` (in `packages/ui/src/modifiers.ts`) makes ⌘ and ⌃ (Ctrl) both mean ⌘, except under raw-key focus, where ⌃ stays ⌃ and ⌃⇧ + letter is ⌘, as in a PC's terminals. ⌃Tab is left alone because it always moves focus. `bootOS.onKey` and the UI kit's `mount.ts` translate every key before dispatching it, so `ctrl` only ever reaches a terminal. The `meta || ctrl` checks inside the UI kit are now redundant but harmless, and they stay for other embedders. Not yet done:
   - Pointer modifiers are not translated, so on a PC, Ctrl-click is not ⌘-click.
   - On a PC, Ctrl+← now means line start (⌘←) rather than the PC's word left.
   - Menus still show only ⌘. A hint such as "⌃ works as ⌘" in About or Help is still to come.
3. **Shortcut grammar** with exact matching and rendering. Add ⇧⌘Z Redo to apps that have Undo.
4. **Policy table and `validateMenubar`.** Apply the remaps above.
5. **Optional:** Keyboard Lock in full screen, and a Keyboard Shortcuts page (Help menu and `sites/` docs) generated from the menubars and the table.

## Verification

- **Unit tests** (vitest, node environment):
  - `hostChord` for each host and modifier combination, including the raw-key exception.
  - The shortcut parser and matcher: exact modifiers, case, ⇧ forms.
  - `onKey`'s handled result for each class: matched, disabled-matched, unmatched, paste, force quit, editing chord with text focus, editing chord with no focus.
  - The web platform listener: dispatch a `KeyboardEvent` with `metaKey` on a stub `window` and assert `defaultPrevented`. Synthetic events don't trigger browser accelerators, so we assert on `defaultPrevented` rather than on browser behavior.
- **Menu audit test:** boot the OS on the in-memory platform, open each bundled app, and run `validateMenubar` over `getMenubarMenus()`. Menus depend on app state, so a test that changes state as well (Earth's mission mode) needs per-app hooks. Start with the menus each app shows at launch.
- **Manual browser matrix**, run once to confirm the reserved table and again whenever the key layer changes: Chrome, Safari, and Firefox on macOS, and Chrome/Edge on Windows. For each, check ⌘Q, ⌘W, ⌘N, ⌘T, ⌘R, ⌘S, ⌘[, ⌘=, ⌘L, ⌘5, and the ⌃ alias in Finder, Safari, Terminal, and MacPaint. Record the results in this file.
