# Mockintosh App Developer Guide

## Overview

Mockintosh is a Macintosh-style simulator running in the browser. The entire UI is rendered on a single `<canvas>` element at **512×342 pixels** into a **1-bit** framebuffer (packed 8 pixels per byte, as on the original Macintosh): black, white, and dither patterns. There is no HTML/CSS inside the simulated screen.

**SDK v3 is Solid 2-only.** Third-party apps are ES modules that `defineApp({ Component })` and optionally export `sprites`. They are loaded at runtime via dynamic `import()`. The OS shares one Solid runtime; externalize `solid-js`, `@mockintosh/ui`, `@mockintosh/sdk`, and (if you draw with it) `@mockintosh/quickdraw` in your Vite build and consume them through the OS import map.

v1 `App.render` / `WindowContext` apps are not loaded. SDK 2 bundles cannot share a realm with Solid 2; the App Store hides catalog entries with `sdk` major &lt; 3, and the installer refuses them with a rebuild prompt.

**Raster surface:** `<raster onPaint>` receives a single `RasterSurface` (not `(port, rect)`), and the framebuffer is packed 1 bpp — apps that indexed `port.portBits.baseAddr` directly must switch to `surface.setPixel` / `surface.blitPixels` (see below).

## Bundled apps

These ship with the OS. SDK-clean apps compile under the in-OS project compiler and are written against the public SDK exactly like a third-party app. Shell apps are part of the OS and use internal services.

| App | Source | Kind |
|---|---|---|
| MacPaint | `MacPaint.tsx` | SDK-clean |
| Canvas | `Canvas.tsx` | SDK-clean |
| Safari | `Safari.tsx` | SDK-clean |
| Testing | `Testing.tsx` | SDK-clean |
| File | `FileViewer.tsx` | SDK-clean |
| Preview | `Preview.tsx` | SDK-clean |
| Dither | `Dither.tsx` | SDK-clean |
| Trace | `Trace.tsx` | SDK-clean |
| Surface | `Surface.tsx` | SDK-clean |
| Showreel | `Showreel.tsx` | SDK-clean |
| Video Player | `VideoPlayer.tsx` | SDK-clean |
| Photo Booth | `PhotoBooth.tsx` | SDK-clean |
| Source Editor | `SourceEditor.tsx` | SDK-clean |
| Terminal | `Terminal.tsx` | SDK-clean |
| ChatGippity | `ChatGippity.tsx` | SDK-clean |
| Spotify | `SpotifyPlayer.tsx` | SDK-clean |
| GitHub | `GitHub.tsx` | SDK-clean |
| Finder | `Finder.solid.tsx` | Shell |
| App Store | `AppStore.tsx` | Shell |
| Icon Gallery | `IconGallery.tsx` | Shell |

## Quick Start

```tsx
import { defineApp, Button, createSignal } from "@mockintosh/sdk";

export default defineApp({
  id: "myapp",
  title: "My App",
  icon: "myapp/icon",
  defaultSize: { width: 200, height: 150 },
  Component() {
    const [count, setCount] = createSignal(0);
    return (
      <box padding={8} flexDirection="column" gap={8} background={0}>
        <text font="menu">{`Count: ${count()}`}</text>
        <Button label="+1" onClick={() => setCount((c) => c + 1)} />
      </box>
    );
  },
});
```

## Solid 2

Import reactive primitives from `@mockintosh/sdk` (`createSignal`, `createEffect`, `createMemo`, `onSettled`, `onCleanup`, `Show`, `For`, `Loading`, `Errored`, `isPending`). Do not import `solid-js/store`, `onMount`, `Index`, `ErrorBoundary`, `Suspense`, or `Context.Provider` — contexts are used as components (`<FocusContext>…</FocusContext>`).

- **Effects** are `createEffect(compute, apply)`. `compute` only reads signals and returns a value; `apply` uses that value (menus, host writes). `compute` runs immediately when the effect is created — declare every signal it reads *above* the `createEffect` call.
- **Mount** is `onSettled`, not `onMount`. Do not call `flush()` from `onSettled` or from an effect `apply`.
- **Async data** is a memo that returns a promise, wrapped in `<Loading>` (and `<Errored>` if you handle failure). Do not fill a signal from `onSettled(async () => …)`.
- **`For`** keys by item identity. Use `keyed={false}` only when you want index-style reuse. Changing a key remounts that child and drops in-progress edits.

## The Rendering Model

JSX compiles through `@mockintosh/ui` (universal Solid renderer) into a retained `box` / `text` / `image` / `raster` / `bitmap` tree. Those five lowercase tags are the **host elements** — the only nodes the engine measures and paints. `Button`, `TextInput`, `Dithered`, and the rest are **widgets**: Solid functions that compose host elements. A new look is a new widget or a prop, not a new tag.

The OS layouts that tree with flexbox and paints it through QuickDraw into the framebuffer.

```tsx
<box padding={8} flexDirection="column" gap={6} background={0}>
  <text font="menu">Hello</text>
  <image width={32} height={32} src={icon} />
  <bitmap width={80} height={40} pixels={buffer} />
  <raster width={80} height={40} onPaint={({ rect, setPixel }) => { /* pixel push */ }} />
</box>
```

**`<image>`** is a finished sprite asset. **`<bitmap>`** is a live unpacked pixel buffer you own (`Uint8Array`, `0` = white, nonzero = black, `width` bytes per row — not a QuickDraw `BitMap`). Replacing the array (typically `setPixels(new Uint8Array(old))`) is what redraws; there is no `onPaint` and no `revision`. Put `onMouseDown` / `onDrag` on the `<bitmap>` to ink it. Size the buffer smaller than the window if you also have chrome (buttons) in the same column.

```tsx
const [pixels, setPixels] = createSignal(new Uint8Array(80 * 40));
<bitmap
  width={80}
  height={40}
  pixels={pixels()}
  onMouseDown={(x, y) => {
    const next = new Uint8Array(pixels());
    next[y * 80 + x] = 1;
    setPixels(next);
  }}
/>
```

Use `<raster onPaint>` when the pixels come from somewhere Solid cannot see (dithered photos, video frames). The callback receives a `RasterSurface`:

```tsx
<raster width={w} height={h} onPaint={(surface) => {
  surface.fill(WHITE);                          // whole raster
  surface.setPixel(x, y, BLACK);                // raster-local coordinates, clipped
  surface.blitPixels(pixels, imgW, imgH, 0, 0); // 1 byte per pixel, 0 = white, non-zero = black
  // surface.port is the QuickDraw port (already clipped to the raster);
  // offset QuickDraw coordinates by surface.rect.x / surface.rect.y.
}} />
```

`onPaint` runs at paint time, outside any reactive scope, so reading a signal inside it does not schedule a repaint. When the pixels come from somewhere else (a camera, a decoder, a timer), bump `revision` from a signal: `<raster revision={frame()} onPaint={…} />` redraws whenever `frame` changes.

Never index the framebuffer yourself: its memory layout (packed 1 bpp) is an implementation detail of the platform.

### QuickDraw offscreen

An app that wants the Toolbox's own drawing — regions, pen modes, patterns, pictures, styled text — can import `@mockintosh/quickdraw` and draw into its own `BitMap`s through a `GrafPort` it opens, then `CopyBits` the result onto `surface.port` in `onPaint`. MacPaint is written this way. There is one QuickDraw in the system: `thePort`, the Font Manager and the cursor are shared with the OS, so save the current port with `GetPort` and restore it before you return, and never leave a drawing call half-done across an `await`. Font numbers come from `fontFamilyId(name)` in `@mockintosh/ui`.

### Layout

Layout is flexbox with the same defaults as CSS/Yoga: `flexDirection="column"`, `alignItems="stretch"`. A child with no explicit cross-axis size fills its parent, so `<text align="center">` centers within the parent without any manual width. Use `alignSelf`, an explicit `width`/`height`, or a `row` container to opt out. Prefer `flexGrow`, `gap`, `padding`, `justifyContent`, and `alignItems` over `position="absolute"` — reserve absolute placement for overlays and pixel-exact chrome.

There is no CSS, so there are no media queries. `useViewport()` is the framebuffer size (`{ width, height }` in logical pixels). It is a signal: `resize` updates it. Branch in Solid (`<Show when={vp().width < 320}>`) rather than putting breakpoint objects on style props.

Borders follow the CSS box model: `borderWidth` insets the padding box, so children (flow *and* absolute — `left={0}` means "just inside the border") are laid out inside it and never sit on top of it. `overflow="hidden"` / `"scroll"` clip children to the inside of the border. A bordered panel therefore keeps its border no matter what you put in it — you don't need to pad by hand. Touch pans an `overflow="scroll"` pane after slop and coasts after a flick; a mouse still uses the wheel.

```tsx
<box padding={8} gap={6}>
  <text font="menu" align="center">Centered heading</text>   {/* stretched to parent */}
  <Button label="OK" onClick={ok} />                          {/* content-sized */}
  <Button label="Wide" alignSelf="stretch" onClick={ok} />    {/* fills the column */}
</box>
```

### Ink

The screen is 1-bit. Every colour prop (`background`, `color`, `borderColor`) takes an `Ink`: `WHITE` (`0`) or `BLACK` (`1`). Anything in between is a dither — use a `PatternName` (`"gray50"`, `"checker"`, …) for `background`.

### Fonts

- `"body"` — general UI text
- `"menu"` — titles and control labels
- `"mono"` — fixed-width content

`measureText(text, font?)` is re-exported from `@mockintosh/ui`.

### Text alignment

Two different things are called "alignment"; keep them apart:

- **Where the `<text>` node sits in its parent** is flexbox: `alignSelf`, `alignItems`, `justifyContent`.
- **Where the glyphs sit inside the node's own box** is the text's job: `align` (`left` | `center` | `right`, per line — CSS `text-align`) and `verticalAlign` (`top` | `middle` | `bottom`, for the whole line block).

`wrap` word-wraps to the node's content width (padding respected); `\n` always breaks. `align` applies to each wrapped line, so `align="right" wrap` right-aligns a paragraph.

```tsx
<text width={200} height={40} align="center" verticalAlign="middle" font="menu">
  Centered both ways
</text>
<text wrap align="right" font="body">
  A paragraph whose every line hugs the right edge.
</text>
```

### Styled runs and links

For mixed styles in one paragraph, give `<text>` a `runs` array instead of children. Each run is `{ text, bold?, italic?, underline?, onClick? }`. The runs wrap together as one paragraph and share the node's `font`, `align` and `wrap`. Spaces collapse, as they do in HTML. A run with `onClick` is a link: the node shows the pointing-hand cursor over it and calls the handler when it is clicked. Runs cannot be selected.

```tsx
<text font="body" wrap runs={[
  { text: "Read the " },
  { text: "guide", underline: true, onClick: () => openGuide() },
  { text: " first.", bold: true },
]} />
```

### Pointer events

A press goes to the topmost node under the cursor that has a mouse handler; there is no bubbling. The node that received `onMouseDown` keeps `onDragStart` / `onDrag` / `onDragEnd` / `onMouseUp` until release, and gets `onClick` if released over itself. Start visual drag feedback (rubber bands, ghosts) in `onDragStart`, not `onMouseDown` — a plain click never reaches `onDragStart`. `onDragStart` fires on the first move but reports the press point, so measure drag deltas from its coordinates.

`onMouseMove` reports the pointer passing over a node while no button is down; with the button down, the pressed node gets `onDrag` instead. Inside any pointer or key handler, `heldModifiers()` (from `@mockintosh/sdk`) is the set of modifier keys the host saw with that event — `shift`, `option`, `command`, `control` — which is how a shift-drag constrains or an option-drag copies.

`cursor` on a node is either a semantic name (`"text"`, `"crosshair"`, `"watch"`, …) or your own 16×16 `CursorFace` — `{ sprite, hotSpot }`, drawn the way the ROM draws cursors: pixels whose sprite `mask` is clear but whose data is set *invert* the screen under them. Keep one face object per cursor shape rather than building a new one per render.

`onMouseDownCapture` is the exception to "no bubbling": it runs on every *ancestor* of the hit node, outermost first, before the target's `onMouseDown`. Calling `event.preventDefault()` swallows the press and everything that would follow it. Use it when a container must decide before its children react (a disabled overlay, a "click to activate" surface).

Window activation is handled for you: the first click on an inactive window brings it to the front and is *not* delivered to your content, so you never need to track focus or call anything to come forward.

## useApp() (OS Services)

```tsx
import { useApp } from "@mockintosh/sdk";

function MyView() {
  const app = useApp();
  const icon = app.getSprite("myapp/icon");
  return (
    <box padding={8}>
      <Button label="Paint" onClick={() => app.os.openApp("macpaint")} />
    </box>
  );
}
```

### About boxes

The first Apple-menu item is always the frontmost app's: "About My App…" while your window is active, "About This Computer…" when the Finder is. You do not add it yourself. By default it opens a standard OS About box with your icon and title; declare `about` on `defineApp` to add a version and description, or supply your own component:

```tsx
export default defineApp({
  id: "myapp",
  title: "My App",
  icon: "myapp/icon",
  about: { version: "1.2", description: "Draws things, in one bit." },
  // or: about: { Component: MyAboutBox, size: { width: 300, height: 140 } },
  // …
});
```

- `getSprite(name)` — OS sprites plus your exported `sprites`
- `storage.read/write/remove/list` — per-app key-value storage (see [Storage](#storage))
- `fs` — the shared file system (see [Files](#files))
- `window` — the window this component is in (see [Windows](#windows))
- `openWindow(spec?)` — open another window of your app (see [Windows](#windows))
- `os.openApp / closeWindow / showDialog` — `showDialog` resolves with the label of the button pressed or, with `showInput`, the text typed; pressing "Cancel" in an input dialog resolves `null`
- `os.busy(work)` — run something that freezes the Macintosh for a moment under the watch cursor: the watch reaches the screen first, then `work` runs, and the cursor comes back when it (or its promise) settles
- `setMenus(menus)` — this window's menubar (see [Menus](#menus))
- `quit()` — end this launch: close every one of its windows and return to the Finder (see [Menus](#menus))
- `fetch` — network access, when this Macintosh has it (see [Capabilities](#capabilities))
- `print` — the system printer, when the platform has one (see [Printing](#printing))
- `download` — offer a file to the host user (`save({ name, type, bytes })`), when the platform can
- `images` / `video` / `camera` — decode rasters, play video, or open a camera (see [Capabilities](#capabilities))
- `scheduler` — `requestFrame` / `now` (no `requestAnimationFrame` / `performance`)
- `capabilities` — the set of things this Macintosh can do (see [Capabilities](#capabilities))
- `env.origin` / `env.config` — host origin and configuration (`SPOTIFY_CLIENT_ID`, …)
- `crypto.randomBytes` / `crypto.sha256`
- `browser` — `openExternal`, `authorize`, `loadScript`, when this Macintosh runs in a browser

`useApp()` reads a per-window context, so call it during component setup (not in a callback created elsewhere).

## Capabilities

Mockintosh runs in more than one place — a browser today, small devices with a 1-bit panel tomorrow — and not every machine has every peripheral. A `Capability` names one such thing:

| Capability  | Means                                                                 |
|-------------|-----------------------------------------------------------------------|
| `network`   | `useApp().fetch` is available                                         |
| `clipboard` | copy and paste work                                                   |
| `printer`   | `useApp().print` is available                                         |
| `download`  | `useApp().download` is available                                      |
| `camera`    | `useApp().camera` is available                                        |
| `video`     | `useApp().video` is available                                         |
| `images`    | `useApp().images` is available                                        |
| `browser`   | `useApp().browser` is available (`openExternal`, `authorize`, `loadScript`) |

Two ways to use them:

- **`requires`** — for things your app cannot work without. Put them on `defineApp`. Published App Store catalog entries may repeat `requires` so the OS can skip a bundle it cannot run. The OS refuses to launch the app and tells the user why: *"Snapshot" needs a camera, which this Macintosh does not have.*

  ```tsx
  export default defineApp({ id: "snapshot", requires: ["camera"], /* … */ });
  ```

- **`useApp().capabilities`** — for features your app can do without. Check at the point of use and degrade gracefully:

  ```tsx
  const { capabilities, fetch } = useApp();
  <Show when={capabilities.has("network")} fallback={<text>Offline</text>}>
    <Button label="Refresh" onClick={() => fetch!("/api/feed")} />
  </Show>
  ```

`fetch` has the portable signature `(url, { method?, headers?, body? }) => Promise<{ ok, status, headers, text(), json(), arrayBuffer() }>` — the browser's `fetch` satisfies it, and so will a device's HTTP client. Stay within that subset.

## Storage

`useApp().storage` is a string key/value store private to your app. Each key is a file in `System Folder/Preferences/<your app id>/`, so users can inspect and delete your data from the Finder.

```tsx
const app = useApp();
const saved = await app.storage.read("settings.json");
await app.storage.write("settings.json", JSON.stringify({ volume: 7 }));
await app.storage.remove("settings.json");
```

## Files

`useApp().fs` is the user's file system — the same one the Finder shows. Catalog reads are reactive (call them inside `createMemo` or the `compute` half of `createEffect` and they re-run when that folder changes); bodies are read with `readText`/`readBytes`/`readJSON`.

```tsx
import { useApp, MIME, createMemo, For } from "@mockintosh/sdk";

function DesktopList() {
  const { fs } = useApp();
  // Find folders by role, never by name — the user may have renamed them.
  const desktop = () => fs.locate("desktop");
  const files = createMemo(() => (desktop() ? fs.children(desktop()!.id) : []));
  return <For each={files()}>{(n) => <text font="body">{n.name}</text>}</For>;
}

async function saveNote(fs: AppFileSystem, text: string) {
  const desktop = fs.locate("desktop")!;
  await fs.writeFile(desktop.id, "Note.txt", text, { type: MIME.text });
}
```

Files have one MIME `type` (`MIME.text`, `MIME.markdown`, `MIME.sprite`, …; `inferMimeType(name)` guesses from an extension). Mutations throw `FSError` (`isFSError(err, "exists")`) on name clashes and invalid moves — show the message in a dialog rather than swallowing it.

`<Markdown text={src} />` (and `parseMarkdown`) render markdown through the 1-bit layout tree. Import them from `@mockintosh/sdk`, not `@mockintosh/markdown`.

### Opening documents

Declare the types your app can open and the Finder will launch it on double-click, merging `FileDocumentProps` (`fileId`, `title`) into your props:

```tsx
import { defineApp, useApp, createMemo, Loading, MIME, type FileDocumentProps } from "@mockintosh/sdk";

export default defineApp<FileDocumentProps>({
  id: "notes",
  fileTypes: [MIME.text, MIME.markdown],
  Component(props) {
    const { fs } = useApp();
    const text = createMemo(() => fs.readText(props.fileId).then((value) => value ?? ""));
    return <Loading fallback={<text font="body">Opening…</text>}><text font="body">{text()}</text></Loading>;
  },
  // …
});
```

A plain string claims the type as your app's **default**: a double-click opens the first registered default for a type. An app that can work on a type but shouldn't own it — an editor or converter next to a viewer — claims it as an **alternate**, so the Finder only picks it when nothing claims the type as default:

```tsx
fileTypes: alternateFileTypes([MIME.sprite, ...IMAGE_TYPES]),
// same as [{ type: MIME.sprite, rank: "alternate" }, …]
```

`useApp().os.openersFor(type)` lists every app that opens a type, defaults first, for an "Open With" menu; hand the document over with `os.openApp(opener.appId, { fileId, title })`. Preview does this for pictures.

## Sprites

Export a `sprites` record beside your default app:

```tsx
import { fromGrid, type Sprite } from "@mockintosh/sdk";

export const sprites: Record<string, Sprite> = {
  "myapp/icon": fromGrid(32, 32, [
    "................................",
    "..############################..",
    // ...
  ]),
};
```

Prefix names with your app id (`"myapp/icon"`). OS sprites use `"icon/"` and `"chrome/"`.

Sprites are also a file type — `image/x-mockintosh-sprite`, `MIME.sprite` — which is how an app keeps a picture in the user's file system (PhotoBooth, Dither, MacPaint and Surface save this way; Preview opens them by default). `readSpriteFile(fs, fileId)` decodes one; `readImageFile(fs, images, fileId)` expands a sprite or decodes a still — never pass sprite bytes to `images.decode`. `writeSpriteFile(fs, parentId, name, sprite, { attributes })` writes one, optionally with a Finder `icon` attribute:

```tsx
const { fs } = useApp();
const desktop = fs.locate("desktop");
if (desktop) await writeSpriteFile(fs, desktop.id, "Photo", sprite, { attributes: { icon: "myapp/photo-icon" } });
```

## Printing

`useApp().print` is the system thermal printer. It is `undefined` on platforms that cannot reach one, so wrap printing UI in `<Show when={print}>`. Connecting prompts the user (a USB device picker on the web), so trigger it from a click.

```tsx
const { print } = useApp();

<Show when={print}>
  <Button label="Print" onClick={() => print!.printPicture(image)} />
</Show>
```

- `printPicture(image, options?)` — a 1-bit image (`{ width, height, data }`, 1 byte per pixel, `1` = black; a `Sprite` works). `scale` defaults to `"auto"`: the largest whole-number enlargement, portrait or landscape, that fills the paper. `"fit"` fills the width exactly. A number is that enlargement, shrunk to the paper when it doesn't fit. `orientation` is `"auto"`, `"portrait"`, or `"landscape"`.
- `layoutPicture(image, options?)` — the same layout, without printing. `page` is the bitmap that would be sent, and `scale` / `orientation` are what auto chose, so a preview can match the print.
- `printPage(height, (port, size) => …, { scale }?)` — draw a page yourself; `port` is `paperWidth / scale` pixels wide and each pixel prints as `scale × scale` dots. One-dot lines and screen fonts print faint on thermal paper, so pass `scale: 2` for screen-like artwork. `drawPixels(port, pixels, width, height, x, y)` places a 1-bit buffer and `drawString(port, text, x, y, font)` a line of text (`(x, y)` is its top-left; `measureText` and `fontLineHeight` size it). Surface prints its plot with its equation this way.
- `connected()` — reactive; `connect()` — connect without printing.
- `paperWidth` — dots per line (576 on 80 mm paper).

## Menus

The menubar always shows the menus of the *active app* — the app that owns the front window. Your menus appear when one of your windows is active and disappear when the user switches away; you never manage that. ⌘ shortcuts declared on items are bound automatically while your menus are showing.

There are two levels:

- **App-level** — `menus` on `defineApp`. Declared once, shown for every window of your app. Use it for menus that don't depend on component state.
- **Window-level** — `useApp().setMenus(menus)` from inside your component. Replaces the app-level menus while *that* window is active, so items can close over the window's own signals. Call it from `createEffect` so `disabled` flags and radio values track state.

**Every application should have a File menu whose last item is Quit (⌘Q).** That item calls `useApp().quit()`, which closes every window of this launch and returns to the Finder. Put a separator before Quit when the menu has other commands. The OS does not insert this item, and it will not quit an app that omits it. The Finder, App Store, and Icon Gallery are shell programs, not applications you leave, so they have no Quit. If your app must ask about unsaved work, do that in the Quit handler and call `quit()` only after the user confirms. Install the item from the component — `onClick` has to see `useApp()`, and a window-level `setMenus` replaces the app-level menus, so Quit has to be in the menus you actually install:

```tsx
app.setMenus([
  {
    label: "File",
    items: [
      // …your commands…
      { type: "separator" },
      { label: "Quit", shortcut: "Q", onClick: () => app.quit() },
    ],
  },
]);
```

```tsx
import { defineApp, useApp, createSignal, createEffect } from "@mockintosh/sdk";

export default defineApp({
  id: "counter",
  title: "Counter",
  icon: "counter/icon",
  defaultSize: { width: 140, height: 100 },
  menus: [{ label: "Help", items: [{ label: "Counter Help", disabled: true }] }],
  Component() {
    const app = useApp();
    const [count, setCount] = createSignal(0);
    const [step, setStep] = createSignal(1);

    createEffect(
      () => ({ count: count(), step: step() }),
      ({ count: n, step: s }) => {
      app.setMenus([
        {
          label: "File",
          items: [{ label: "Quit", shortcut: "Q", onClick: () => app.quit() }],
        },
        {
          label: "Counter",
          items: [
            { label: "Reset", shortcut: "R", disabled: n === 0, onClick: () => setCount(0) },
            { type: "separator" },
            {
              type: "radiogroup",
              value: String(s),
              onValueChange: (v) => setStep(Number(v)),
              items: [
                { label: "Step by 1", value: "1" },
                { label: "Step by 10", value: "10" },
              ],
            },
          ],
        },
      ]);
      },
    );
    // ...
  },
});
```

Item types (`MenubarItemDef`): an action `{ label, shortcut?, disabled?, checked?, onClick? }` (`checked` draws a check mark beside it), a `{ type: "separator" }`, a `{ type: "radiogroup", value, onValueChange, items }`, or a hierarchical menu `{ type: "submenu", label, disabled?, items }` that opens beside its item on hover. Items inside a submenu keep their ⌘-shortcuts. Reach for a submenu when a menu grows past about 15 items, since a pull-down taller than the screen gets cut off. The Apple menu is the OS's; you can't add to it.

## Windows

By default, opening your app opens one window — its *main window* — with `Component` inside, sized by `defaultSize`, of kind `windowKind` (a `document` unless you say otherwise), with `scrollable`, `resizable` and `minSize` as declared on `defineApp`.

`useApp().window` is the window your component is mounted in. `width()` and `height()` are the content size (reactive accessors — read them in JSX or effects), `isActive()` is whether it is frontmost, `scrollY()` the content scroll offset and `scrollTo(y)` moves it (a `scrollable` window keeps it within the height you gave `setContentSize`), `kind()` its current kind; `setTitle(title)` renames it, `setFullScreen(on)` takes it full screen and back, and `close()` closes it. A component that fills its window is:

```tsx
const { window: win } = useApp();
return <box width={win.width()} height={win.height()} flexDirection="column">…</box>;
```

### Window kinds

Like the Macintosh's `NewWindow`, you choose what kind of window you get:

| Kind         | Looks like                                                                 |
|--------------|----------------------------------------------------------------------------|
| `document`   | title bar with close and zoom boxes; grow box / scroll bars when `resizable` / `scrollable` |
| `dialog`     | title bar with a close box, fixed size                                     |
| `utility`    | tool palette above document and full-screen windows. `title: ""` is an 11px drag bar with no title; a title uses a 25% gray bar instead of racing stripes. It stays lit beside the key document, and the first click in it changes a control. Hidden while another app is front. |
| `plain`      | a bare 1px frame, no title bar, cannot be moved                            |
| `alert`      | `plain` and system-modal: nothing else takes input until it closes         |
| `fullscreen` | no chrome at all — the whole screen, menubar included (see below)          |
| `desk`       | your app's own desktop: no chrome, the whole screen below the menubar, always behind your other windows. Content coordinates are screen coordinates. Clicking it does not take the key window; hidden while another app is front. MacPaint's gray desk with its palettes is one. |

### Deciding what opening does: `onOpen`

Opening a window is your decision, not the OS's. `onOpen` is your app's `main`: the OS calls it when the user opens your app (`props` is `{}`) or one of your documents (`props` is `FileDocumentProps`). Without it, the OS opens the main window. With it, you open whatever you like through `app.openWindow(spec)` — or nothing:

```tsx
export default defineApp({
  id: "slides",
  title: "Slides",
  icon: "slides/icon",
  defaultSize: { width: 300, height: 200 },
  Component: Editor,
  onOpen(app, props) {
    if (props.fileId) {
      app.openWindow({ kind: "fullscreen", Component: Show, props });   // present it
    } else {
      app.openWindow({ props });                                         // the main window
    }
  },
});
```

`onOpen` receives an `AppContext`: everything `useApp()` has except `window` and `setMenus`, since there is no window yet. It runs outside any component — open windows and dialogs there; keep signals and effects inside components.

`openWindow(spec)` takes a `WindowSpec` whose every field is optional and defaults to your `defineApp`: `kind`, `title`, `size` (content pixels), `position`, `scrollable`, `resizable`, `minSize`, `Component` (a different component for this window — a preferences dialog, a palette) and `props`. `movable: false` pins a window where it opened. `onGoAway` makes the close box ask instead of close — run your Close command and call `window.close()` once the user agrees. `modal: false` keeps an `alert`-framed window from blocking the rest of the screen, for dialogs that decide themselves what clicks elsewhere do. It returns the window id, which `os.closeWindow` accepts. `openWindow()` with no argument is the main window.

### Full screen

A `fullscreen` window is the Macintosh "special presentation mode": your content covers the whole 512×342 screen and the menubar tucks above it. Two ways in — open a window as `kind: "fullscreen"`, or switch an existing window with `window.setFullScreen(true)`, which keeps your component mounted (camera streams, state, all of it) and remembers the windowed kind and bounds for `setFullScreen(false)`. A window that was *opened* full screen has nothing to go back to; close it instead. A `utility` window opened by the same app stays on top of that picture, and the menubar stays tucked while you use the palette.

The shell brings the menubar back: passing the pointer over the top edge of the screen slides it down over your picture. On the web, that includes the page margin above the canvas. A press on the edge does the same, and the pass is not delivered to your app. It slides away again when the pointer leaves, unless a menu is open. Your menus stay live while the bar is hidden, so a ⌘ shortcut still runs without revealing it. Offer "Exit Full Screen" on a menu if the window has a windowed form to return to — you do not need a button on the picture itself.

```tsx
const { window: win } = useApp();
const isFullScreen = () => win.kind() === "fullscreen";
createEffect(
  () => isFullScreen(),
  (full) => {
    app.setMenus([{ label: "View", items: [
      { label: full ? "Exit Full Screen" : "Full Screen", shortcut: "F",
        onClick: () => win.setFullScreen(!full) },
    ]}]);
  },
);
```

## The Manifest: mockintosh.json

There are two JSON shapes. Do not mix them.

**In-OS project** — the file `project_create` writes and `build_submit` reads. Extra keys fail the build. `project_create` already wrote a valid one; do not add catalog fields.

```json
{"id":"notes","title":"Notes","entry":"src/index.tsx","sdkVersion":"3"}
```

Allowed keys: `id`, `title`, `entry`, `sdkVersion` (`"3"` only). `entry` is the source path, not `./dist/index.js`. Icon and `requires` belong on `defineApp` in the source, not here.

**App Store catalog** — published bundles only (`AppManifest` in `@mockintosh/sdk`). The store uses this to skip a download the machine cannot run. It is not what the in-OS compiler accepts.

```json
{
  "id": "myapp",
  "title": "My App",
  "description": "A brief description",
  "icon": "myapp/icon",
  "author": "your-github-username",
  "version": "1.0.0",
  "sdk": "^3.0.0",
  "permissions": [],
  "requires": ["network"],
  "entry": "./dist/index.js"
}
```

**Requires** (catalog / `defineApp` only): capabilities the app cannot run without (see [Capabilities](#capabilities)). Omit if the app runs anywhere.

**Permissions** (catalog only):

- `"network"` — enables `useApp().fetch`

## Building Your App

```ts
import { defineConfig } from "vite";
import solid from "@solidjs/vite-plugin";

export default defineConfig({
  plugins: [
    solid({
      solid: {
        generate: "universal",
        moduleName: "@mockintosh/ui/renderer",
      },
    }),
  ],
  build: {
    lib: { entry: "src/index.tsx", formats: ["es"], fileName: "index" },
    rolldownOptions: {
      // The OS serves these through an import map so one runtime is shared.
      // Includes subpaths — JSX compiles to `@mockintosh/ui/renderer`.
      external: (id) => /^(@mockintosh\/(sdk|ui|quickdraw)|solid-js)(\/|$)/.test(id),
    },
  },
});
```

The bundle's default export is the `defineApp({...})` object. Optional named export: `sprites`.

Installing from the App Store writes the manifest to `Applications/<title>` as a `MIME.app` file; opening it launches the app and trashing it uninstalls.

## Constraints

- **512×342 pixels** — the entire screen. Your window is smaller, unless it is `fullscreen`.
- **Indexed pixels** — `BLACK`/`WHITE` are safest.
- **No DOM UI** — do not render HTML into the screen. Decode images, video, and camera frames through `useApp().images` / `video` / `camera`.
- **No browser globals** — `alert`, `confirm`, `prompt`, `document`, `localStorage`, `sessionStorage`, and `fetch` are not in the project type environment and fail the compile. Use `useApp().os.showDialog`, `useApp().storage`, `useApp().fs`, and `useApp().fetch`. Import file-system types and `MIME` from `@mockintosh/sdk`, not `@mockintosh/fs`. Anything else you need from the host is a [capability](#capabilities): declare it in `requires` or check it at the point of use.
- `createUI` is a single-instance renderer inside the OS; third-party apps share that runtime via the import map.


## Semantic controls and live operation (M1)

Give controls stable developer names so Terminal and external tools can inspect and operate them through normal input dispatch:

```tsx
<Button name="save" label="Save" onClick={save} disabled={!canSave()} />
<Checkbox name="enabled" label="Enabled" checked={enabled()} onChange={setEnabled} />
<TextInput name="document-title" value={title()} onChange={setTitle} />
<box semantic={{ name: "preview", role: "preview" }} width={64} height={64} />
```

Names are optional and scoped by the containing OS window. Duplicate names require a window scope or numeric node id. Snapshots expose detached lifetime ids, role, text/value, enabled/focused state, clipped bounds, and supported actions. `password` TextInputs mask values and aggregate text. Removed or replaced nodes invalidate their references; reload also invalidates the boot selection. An inactive window must be explicitly activated before a semantic click. A field must be focused before `type`.

These metadata fields do not grant kernel privileges to third-party apps. OS-owned Terminal and Control Panel use internal services; ordinary app code continues to use the SDK. The host's `BootedOS.kernel` validates requests against the registered trap contracts (`kernel.describe()`). See [M1 operation guide](../../../docs/m1-operation.md) for live MCP/CLI setup, session lifetimes, shell syntax, and error semantics.

## Editable project builds and instance cleanup

Source Editor and the M2 project operations can compile SDK 3 source into an artifact loaded by the host. In the browser, Build & Run uses a local compiler worker without companion setup. A paired companion can optionally supply remote compilation through the same build-provider contract. Keep imports to the supported shared SDK/UI/Solid modules and relative project source modules. The OS shares one reactive runtime with installed apps. Compile errors preserve the working app; restart resets its instance and Restore selects the previous artifact without changing newer source.

For resources created outside a component, register cleanup through `app.onCleanup?.(() => clearInterval(timer))` in `onOpen`. Solid computations created during `onOpen` also have an owned root. To keep an instance alive after its last window closes, explicitly call `const release = app.keepAlive?.()` and call `release?.()` when that work finishes. Component `onCleanup` continues to handle component-owned resources. These lifetimes are local and cooperative; they do not create durable server jobs or preempt infinite loops.
