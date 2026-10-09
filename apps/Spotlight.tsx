/**
 * Spotlight — the menubar app that finds anything: applications, documents,
 * folders and pictures on every disk, the System's own panels, apps in the
 * App Store, the answer to a sum, and the web.
 *
 * ⌘Space (or a click on the magnifying glass in the menubar) brings up the
 * panel over whatever is front; the menubar keeps that app's menus. Type to
 * search. ↑↓ move through the results and ⌘↑⌘↓ jump between sections;
 * Return opens the selection, ⌘Return shows it in the Finder, and a sum's
 * Return copies its answer. Escape clears the field, and closes the panel
 * when it is empty; so do ⌘Space and a click anywhere else. The panel opens
 * on the last search, selected, as Spotlight does.
 *
 * A shell app: it reads the app registry, the App Store's listings and the
 * whole file system, so it runs on the OS's thread and reaches the OS directly.
 */
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { TextInput, defineSprite, measureText, smallIcon, useUIServices, type Sprite } from "@mockintosh/ui";
import { defineApp, heldModifiers, useApp } from "@mockintosh/sdk";
import { MIME, isImageType, type FSNode } from "@mockintosh/fs";
import { useOS, type OSServices } from "../src/os/context";
import { getAllApps, onAppsChanged } from "../src/os/apps";
import { bundledApps } from "../src/os/bundledApps";
import { loadRegistry, showInAppStore, type RegistryEntry } from "../src/os/appStoreLink";
import { appForFileType } from "../src/os/openers";
import { FINDER_APP_ID, activateApp, updateOSWindow } from "../src/os/state";
import { openAboutBox } from "./finder/AboutBox";
import { openControlPanel } from "./finder/ControlPanel";
import { CHOOSER_TITLE, openChooser } from "./finder/Chooser";
import { iconForNode } from "./finder/attributes";
import { evaluate, formatNumber } from "./spotlight/calculator";
import { flatten, search, sectionJump, type Candidate, type Hit, type Section } from "./spotlight/search";
import { sprites } from "./spotlight/icons";

const PANEL_W = 380;
const FIELD_H = 24;
const RESULTS_H = 200;
const LIST_W = 200;
const PREVIEW_W = PANEL_W - LIST_W - 1;
const HEADER_H = 14;
const ROW_H = 18;
const ROW_ICON = 16;
const ROW_TEXT_X = 26;
const PAD = 6;

const ROW_FONT = "menu";
const SMALL_FONT = "body";

/** The last search, shown (selected) when the panel comes back. */
let lastQuery = "";

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDate(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const KIND_BY_TYPE: Readonly<Record<string, string>> = {
  [MIME.text]: "Text document",
  [MIME.markdown]: "Markdown document",
  [MIME.html]: "HTML document",
  [MIME.json]: "JSON document",
  [MIME.sprite]: "Icon",
  [MIME.canvas]: "Canvas drawing",
  [MIME.paint]: "MacPaint picture",
  [MIME.truetype]: "TrueType font",
  [MIME.deckerFont]: "Bitmap font",
  [MIME.suitcase]: "Font suitcase",
  "image/png": "PNG image",
  "image/jpeg": "JPEG image",
  "image/gif": "GIF image",
  "image/webp": "WebP image",
  "audio/wav": "WAV audio",
  "audio/x-wav": "WAV audio",
};

function kindOf(node: FSNode): string {
  if (node.kind === "directory") return node.role === "volume" ? "Disk" : "Folder";
  const known = KIND_BY_TYPE[node.type];
  if (known) return known;
  const opener = appForFileType(node.type);
  const title = opener && getAllApps().find((app) => app.id === opener)?.title;
  return title ? `${title} document` : "Document";
}

function isPicture(node: FSNode): boolean {
  return node.kind === "file" && (isImageType(node.type) || node.type === MIME.sprite || node.type === MIME.paint);
}

/** Folders whose insides aren't the user's to find: the Trash, and apps' preference files. */
const UNSEARCHED = new Set(["trash", "preferences"]);

function* fileCandidates(os: OSServices): Generator<Candidate> {
  const fs = os.fs;
  function where(node: FSNode): string {
    const path: string[] = [];
    let parent = node.parentId ? fs.node(node.parentId) : undefined;
    while (parent && parent.parentId !== null) {
      path.unshift(parent.name);
      parent = parent.parentId ? fs.node(parent.parentId) : undefined;
    }
    return path.join(" › ");
  }
  function candidate(node: FSNode): Candidate {
    const parent = node.parentId ? fs.directory(node.parentId) : undefined;
    const details: string[] = [];
    if (node.kind === "file") details.push(`Size: ${formatSize(node.size)}`);
    else if (node.role !== "volume") details.push(`${fs.childCount(node.id)} items`);
    details.push(`Modified: ${formatDate(node.modifiedAt)}`);
    const path = where(node);
    if (path) details.push(`Where: ${path}`);
    return {
      key: `file:${node.id}`,
      title: node.name,
      category: node.kind === "directory" ? "folders" : isPicture(node) ? "images" : "documents",
      icon: iconForNode(fs, node),
      kind: kindOf(node),
      details,
      modifiedAt: node.modifiedAt,
      open: () => os.openFSNode(node.id),
      reveal: () => {
        if (node.role === "volume") os.openFolderWindow(node.name, node.id);
        else if (parent && parent.parentId !== null) os.openFolderWindow(parent.name, parent.id);
      },
    };
  }
  function* walk(dirId: string): Generator<Candidate> {
    for (const node of fs.children(dirId)) {
      if (node.kind === "file" && (node.type === MIME.app || node.type === MIME.appShortcut)) continue;
      yield candidate(node);
      if (node.kind === "directory" && !(node.role && UNSEARCHED.has(node.role))) yield* walk(node.id);
    }
  }
  for (const volume of fs.volumes()) {
    yield candidate(volume);
    yield* walk(volume.id);
  }
}

function* appCandidates(os: OSServices): Generator<Candidate> {
  for (const app of getAllApps()) {
    if (app.id.startsWith("__") || app.kind === "menubar") continue;
    const details = [app.about?.version && `Version ${app.about.version}`, app.about?.description].filter(
      (line): line is string => !!line,
    );
    yield {
      key: `app:${app.id}`,
      title: app.title,
      category: "applications",
      icon: app.icon,
      kind: "Application",
      details,
      // The Finder is always running: coming to it brings its windows (or the desktop) forward.
      open: () => (app.id === FINDER_APP_ID ? activateApp(FINDER_APP_ID) : os.openApp(app.id)),
    };
  }
}

function systemCandidates(os: OSServices): Candidate[] {
  return [
    {
      key: "system:about",
      title: "About This Computer",
      category: "system",
      keywords: ["system", "version", "memory", "macintosh"],
      icon: "icon/computer",
      kind: "System",
      details: ["The version of this Macintosh, and what is using its memory."],
      open: () => void openAboutBox(os),
    },
    {
      key: "system:control-panel",
      title: "Control Panel",
      category: "system",
      keywords: ["settings", "preferences", "desktop", "pattern", "display", "screen", "zoom", "keyboard", "mouse"],
      icon: "icon/computer",
      kind: "System",
      details: ["The desktop pattern, the screen and the other settings of this Macintosh."],
      open: () => void openControlPanel(os),
    },
    {
      key: "system:chooser",
      title: CHOOSER_TITLE.replace(/…$/, ""),
      category: "system",
      keywords: ["printer", "print", "printing"],
      icon: "icon/computer",
      kind: "System",
      details: ["Chooses the printer, and sets up new ones."],
      open: () => void openChooser(os),
    },
    {
      key: "system:force-quit",
      title: "Force Quit",
      category: "system",
      keywords: ["quit", "kill", "stop", "hung"],
      icon: "icon/stop",
      kind: "System",
      details: ["Ends the frontmost application. Unsaved work is lost."],
      open: () => os.forceQuit(),
    },
  ];
}

function* storeCandidates(os: OSServices, registry: readonly RegistryEntry[]): Generator<Candidate> {
  const installed = new Set(getAllApps().map((app) => app.id));
  const listed = new Set<string>();
  for (const listing of bundledApps()) {
    listed.add(listing.id);
    if (installed.has(listing.id)) continue;
    yield {
      key: `store:${listing.id}`,
      title: listing.title,
      category: "appstore",
      icon: listing.icon,
      kind: "App Store",
      details: [listing.description],
      open: () => showInAppStore(os, listing.id),
    };
  }
  for (const entry of registry) {
    if (installed.has(entry.id) || listed.has(entry.id)) continue;
    const icon = entry.icon ?? "icon/application";
    const encoded = entry.declaration?.sprites?.[icon];
    yield {
      key: `store:${entry.id}`,
      title: entry.title,
      category: "appstore",
      icon,
      iconSprite: encoded && defineSprite(encoded.width, encoded.height, encoded.data),
      kind: "App Store",
      details: [`By ${entry.author}`, entry.description],
      open: () => showInAppStore(os, entry.id),
    };
  }
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

/** `text` cut to fit `width` with an ellipsis. */
function fit(text: string, font: string, width: number): string {
  if (measureText(text, font) <= width) return text;
  let end = text.length;
  while (end > 0 && measureText(`${text.slice(0, end)}…`, font) > width) end--;
  return `${text.slice(0, end)}…`;
}

function spriteSrc(sprite: Sprite) {
  return { width: sprite.width, height: sprite.height, data: sprite.data, mask: sprite.mask };
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

function SpotlightPanel(): JSX.Element {
  const app = useApp();
  const os = useOS();
  const win = app.window;
  const clipboard = useUIServices().clipboard;

  // Written from key handlers and effects, not just event handlers.
  const owned = { ownedWrite: true } as const;
  const [query, setQuery] = createSignal(lastQuery, owned);
  const [selected, setSelected] = createSignal(0, owned);
  const [scrollTop, setScrollTop] = createSignal(0, owned);
  const [registry, setRegistry] = createSignal<readonly RegistryEntry[]>([], owned);
  const [appsVersion, setAppsVersion] = createSignal(0, owned);
  onCleanup(onAppsChanged(() => setAppsVersion((v) => v + 1)));
  if (os.fetch) {
    void loadRegistry(os.fetch).then(setRegistry, () => {
      // Offline: the App Store's bundled apps are still found.
    });
  }

  /** Everything findable that doesn't depend on the query; recomputed when apps or files change. */
  const index = createMemo(() => {
    appsVersion();
    return [...appCandidates(os), ...systemCandidates(os), ...fileCandidates(os), ...storeCandidates(os, registry())];
  });

  const sections = createMemo<Section[]>(() => {
    const q = query().trim();
    if (!q) return [];
    const answers: Candidate[] = [];
    const value = evaluate(q);
    if (value !== null) {
      const answer = formatNumber(value);
      answers.push({
        key: "calculator",
        title: `${q.replace(/=$/, "").trim()} = ${answer}`,
        category: "calculator",
        icon: "spotlight/icon",
        kind: "Calculator",
        details: clipboard ? ["Return copies the answer."] : [],
        score: 2000,
        open: () => void clipboard?.writeText(answer),
      });
    }
    if (os.capabilities.has("network") && getAllApps().some((a) => a.id === "safari")) {
      answers.push({
        key: "web",
        title: `Search the Web for “${q}”`,
        category: "web",
        icon: "icon/safari",
        kind: "Safari",
        details: ["Opens the search in Safari."],
        score: 1,
        open: () => os.openApp("safari", { url: q }),
      });
    }
    return search(q, [...answers, ...index()]);
  });
  const hits = createMemo(() => flatten(sections()));
  const current = (): Hit | undefined => hits()[Math.min(selected(), hits().length - 1)];

  // A new search starts at the top.
  createEffect(query, (q) => {
    lastQuery = q;
    setSelected(0);
    setScrollTop(0);
  });

  // The panel is just the field until there is something to show.
  createEffect(
    () => (hits().length > 0 ? FIELD_H + 1 + RESULTS_H : FIELD_H),
    (height) => updateOSWindow(win.id, { height }),
  );

  // Clicking anywhere else puts Spotlight away, as on the Mac.
  let wasActive = false;
  createEffect(win.isActive, (active) => {
    if (active) wasActive = true;
    else if (wasActive) win.close();
  });

  /** The list's rows, laid out once per search: section headers and hits, with their tops. */
  const rows = createMemo(() => {
    const out: ({ type: "header"; label: string; top: number } | { type: "hit"; hit: Hit; index: number; top: number })[] = [];
    let top = 0;
    let index = 0;
    for (const section of sections()) {
      out.push({ type: "header", label: section.label, top });
      top += HEADER_H;
      for (const hit of section.hits) {
        out.push({ type: "hit", hit, index: index++, top });
        top += ROW_H;
      }
    }
    return { rows: out, height: top };
  });

  function scrollToSelection(index: number): void {
    const row = rows().rows.find((r) => r.type === "hit" && r.index === index);
    if (!row) return;
    // Keep the section header in view with the first hit of a section.
    const above = rows().rows[rows().rows.indexOf(row) - 1];
    const top = above?.type === "header" ? above.top : row.top;
    if (top < scrollTop()) setScrollTop(top);
    else if (row.top + ROW_H > scrollTop() + RESULTS_H) setScrollTop(row.top + ROW_H - RESULTS_H);
  }

  function select(index: number): void {
    const clamped = Math.max(0, Math.min(hits().length - 1, index));
    setSelected(clamped);
    scrollToSelection(clamped);
  }

  function move(direction: -1 | 1): void {
    if (heldModifiers().meta || heldModifiers().ctrl) select(sectionJump(sections(), selected(), direction));
    else select(selected() + direction);
  }

  /** Put the panel away, then do `action` with the keyboard back where it was. */
  function closeThen(action: (() => void) | undefined): void {
    win.close();
    action?.();
  }

  function submit(): void {
    const hit = current();
    if (!hit) return;
    const reveal = heldModifiers().meta || heldModifiers().ctrl;
    closeThen(reveal ? hit.reveal ?? hit.open : hit.open);
  }

  function cancel(): void {
    if (query()) setQuery("");
    else win.close();
  }

  const glyph = sprites["spotlight/search-field"];

  return (
    <box width={PANEL_W} height={win.height()} flexDirection="column" background={0}>
      <box width={PANEL_W} height={FIELD_H} paddingLeft={PAD} paddingRight={PAD} justifyContent="center">
        <TextInput
          name="spotlight-query"
          value={query()}
          onChange={setQuery}
          onSubmit={submit}
          onCancel={cancel}
          onHistory={move}
          placeholder="Spotlight Search"
          font={ROW_FONT}
          icon={glyph}
          borderless
          autoFocus
          selectAllOnFocus
          width={PANEL_W - PAD * 2}
        />
      </box>
      <Show when={hits().length > 0}>
        <box width={PANEL_W} height={1} background={1} />
        <box width={PANEL_W} height={RESULTS_H} flexDirection="row">
          <box
            width={LIST_W}
            height={RESULTS_H}
            overflow="scroll"
            scrollOffset={scrollTop()}
            onScroll={(deltaY) => setScrollTop((top) => Math.max(0, Math.min(rows().height - RESULTS_H, top + deltaY)))}
            semantic={{ name: "spotlight-results", role: "list" }}
          >
            <box width={LIST_W} height={Math.max(RESULTS_H, rows().height)}>
              <For each={rows().rows}>
                {(row) =>
                  row.type === "header" ? (
                    <SectionHeader label={row.label} top={row.top} />
                  ) : (
                    <ResultRow
                      hit={row.hit}
                      top={row.top}
                      selected={selected() === row.index}
                      onSelect={() => select(row.index)}
                      onOpen={() => closeThen(row.hit.open)}
                    />
                  )
                }
              </For>
            </box>
          </box>
          <box width={1} height={RESULTS_H} background={1} />
          <Show when={current()} keyed>
            {(hit) => <Preview hit={hit} />}
          </Show>
        </box>
      </Show>
    </box>
  );
}

function SectionHeader(props: { label: string; top: number }): JSX.Element {
  return (
    <box position="absolute" left={0} top={props.top} width={LIST_W} height={HEADER_H} paddingLeft={PAD} justifyContent="center">
      <text font="bodyBold" nowrap verticalAlign="middle">{props.label}</text>
      <box position="absolute" left={PAD + measureText(props.label, "bodyBold") + 4} top={HEADER_H / 2} width={Math.max(0, LIST_W - PAD * 2 - measureText(props.label, "bodyBold") - 4)} height={1} background="checker" />
    </box>
  );
}

/** A hit's icon at 16×16: its own small icon when there is one, else the 32×32 reduced. */
function useIcon(hit: Hit, size: 16 | 32): Sprite | undefined {
  const app = useApp();
  const big = hit.iconSprite ?? (hit.icon ? app.getSprite(hit.icon) : undefined);
  if (size === 32 || !big) return big;
  // A `<key>-16x16` drawn for the icon, or the small icon of the app it belongs to.
  const named = hit.icon && (app.getSprite(`${hit.icon}-16x16`) ?? getAllApps().find((a) => a.icon === hit.icon && a.smallIcon)?.smallIcon);
  const small = typeof named === "string" ? app.getSprite(named) : named;
  return small ?? (big.width <= 16 ? big : smallIcon(big));
}

function ResultRow(props: { hit: Hit; top: number; selected: boolean; onSelect: () => void; onOpen: () => void }): JSX.Element {
  const icon = useIcon(props.hit, 16);
  const ink = () => (props.selected ? 0 : 1);
  return (
    <box
      position="absolute"
      left={0}
      top={props.top}
      width={LIST_W}
      height={ROW_H}
      background={props.selected ? 1 : 0}
      semantic={{ name: props.hit.title, role: "option" }}
      onMouseDown={props.onSelect}
      onDoubleClick={props.onOpen}
    >
      <Show when={icon}>
        {(sprite) => (
          <image
            position="absolute"
            left={PAD}
            top={Math.floor((ROW_H - ROW_ICON) / 2)}
            width={sprite().width}
            height={sprite().height}
            src={spriteSrc(sprite())}
            mode={props.selected ? "inverted" : "normal"}
          />
        )}
      </Show>
      <box position="absolute" left={ROW_TEXT_X} top={0} width={LIST_W - ROW_TEXT_X - 2} height={ROW_H} justifyContent="center">
        <text font={ROW_FONT} nowrap color={ink()} verticalAlign="middle">
          {fit(props.hit.title, ROW_FONT, LIST_W - ROW_TEXT_X - 4)}
        </text>
      </box>
    </box>
  );
}

function Preview(props: { hit: Hit }): JSX.Element {
  const icon = useIcon(props.hit, 32);
  const inner = PREVIEW_W - PAD * 2;
  return (
    <box width={PREVIEW_W} height={RESULTS_H} padding={PAD} flexDirection="column" alignItems="center" gap={4} semantic={{ name: "spotlight-preview", role: "region" }}>
      <box height={8} />
      <Show when={icon}>
        {(sprite) => <image width={sprite().width} height={sprite().height} src={spriteSrc(sprite())} />}
      </Show>
      <text font={ROW_FONT} width={inner} align="center">{props.hit.title}</text>
      <text font={SMALL_FONT} width={inner} align="center">{props.hit.kind}</text>
      <Show when={(props.hit.details?.length ?? 0) > 0}>
        <box width={inner} height={1} background="checker" />
        <box width={inner} flexDirection="column" gap={2}>
          <For each={props.hit.details}>{(line) => <text font={SMALL_FONT} width={inner}>{line}</text>}</For>
        </box>
      </Show>
    </box>
  );
}

export default defineApp({
  id: "spotlight",
  title: "Spotlight",
  kind: "menubar",
  icon: "spotlight/icon",
  smallIcon: "spotlight/icon-16x16",
  hotkey: " ",
  runtime: "main",
  sprites,
  defaultSize: { width: PANEL_W, height: FIELD_H },
  windowKind: "panel",
  scrollable: false,
  resizable: false,
  singleInstance: true,
  about: { description: "Finds applications, documents, folders, System panels and App Store apps, answers sums, and searches the web." },
  Component: SpotlightPanel,
});
