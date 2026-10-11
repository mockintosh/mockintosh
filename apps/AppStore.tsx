import { For, Show, createEffect, createMemo, createSignal, untrack, Loading, Errored } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { Button, defineSprite, type Sprite } from "@mockintosh/ui";
import { useApp, type AppManifest, defineApp } from "@mockintosh/sdk";
import { useOS } from "../src/os/context";
import { bundledApps, bundledManifest, type BundledAppListing } from "../src/os/bundledApps";
import { installedAppIds } from "../src/os/installedApps";
import { loadRegistry, pendingPage, takePendingPage, type RegistryEntry } from "../src/os/appStoreLink";

/** One catalog row, whether it ships in this build or comes from the registry. */
interface StoreApp {
  id: string;
  title: string;
  description: string;
  icon: string;
  /** The icon's pixels when the app isn't installed and the OS doesn't have them. */
  iconSprite?: Sprite;
  author: string;
  version: string;
  /** False when a registry entry has no bundle URL. */
  installable: boolean;
  install: () => void;
}

/** Icon column. Wide enough for a 32px icon and a two-line name in Geneva 9. */
const CELL_W = 88;
const GRID_GAP = 6;

function rowsOf<T>(items: readonly T[], columns: number): T[][] {
  const cols = Math.max(1, columns);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += cols) out.push(items.slice(i, i + cols));
  return out;
}

function ListingIcon(props: { name: string; sprite?: Sprite }): JSX.Element {
  const app = useApp();
  const sprite = createMemo(() => props.sprite ?? app.getSprite(props.name));
  return (
    <Show when={sprite()} fallback={<box width={32} height={32} />}>
      {(icon) => <image width={32} height={32} src={icon()} />}
    </Show>
  );
}

function AppShelf(props: {
  apps: readonly StoreApp[];
  columns: number;
  onOpen: (app: StoreApp) => void;
}): JSX.Element {
  const rows = createMemo(() => rowsOf(props.apps, props.columns));
  return (
    <box flexDirection="column" gap={GRID_GAP}>
      <For each={rows()}>
        {(row) => (
          <box flexDirection="row" gap={GRID_GAP}>
            <For each={row}>
              {(item) => (
                <box
                  width={CELL_W}
                  flexDirection="column"
                  alignItems="center"
                  gap={2}
                  cursor="pointer"
                  semantic={{ name: `app-${item.id}`, role: "button" }}
                  onClick={() => props.onOpen(item)}
                >
                  <ListingIcon name={item.icon} sprite={item.iconSprite} />
                  <text width={CELL_W} font="body" align="center">
                    {item.title}
                  </text>
                </box>
              )}
            </For>
          </box>
        )}
      </For>
    </box>
  );
}

function AppPage(props: {
  app: StoreApp;
  installed: boolean;
  busy: boolean;
  onBack: () => void;
  onOpen: () => void;
}): JSX.Element {
  return (
    <box flexDirection="column" gap={8}>
      <Button name="app-back" label="Back" onClick={() => props.onBack()} />
      <box flexDirection="row" gap={8} alignItems="center">
        <ListingIcon name={props.app.icon} sprite={props.app.iconSprite} />
        <box flexDirection="column" gap={4} flexGrow={1} flexShrink={1} minWidth={0}>
          <text font="menu" spacing={1}>{props.app.title}</text>
          <text font="body">{`${props.app.author} · ${props.app.version}`}</text>
          <Show
            when={props.installed}
            fallback={
              <Button
                name={`install-${props.app.id}`}
                label={props.busy ? "…" : "Install"}
                disabled={props.busy || !props.app.installable}
                onClick={() => props.app.install()}
              />
            }
          >
            <Button name={`open-${props.app.id}`} label="Open" onClick={() => props.onOpen()} />
          </Show>
        </box>
      </box>
      <text font="body">{props.app.description}</text>
    </box>
  );
}

function AppStore(_props: Record<string, unknown>): JSX.Element {
  const app = useApp();
  const win = app.window;
  const fetch = app.fetch;
  // Installing apps is a shell privilege, not an SDK power: reach the OS directly.
  const os = useOS();
  const catalog = createMemo(async () => (fetch ? await loadRegistry(fetch) : ([] as RegistryEntry[])));
  // Reactive: installing (or trashing a .app in the Finder) updates the list.
  const installed = createMemo(() => new Set(installedAppIds(os.fs)));
  const [status, setStatus] = createSignal("");
  const [busyId, setBusyId] = createSignal<string | null>(null);
  // A window opened to show one app (a Spotlight result) starts on its page.
  const firstListing = untrack(() => {
    const request = pendingPage();
    return request && bundledApps().find((l) => l.id === request.appId);
  });
  const [page, setPage] = createSignal<StoreApp | null>(firstListing ? bundledListing(firstListing) : null);
  const columns = createMemo(() => {
    const inner = Math.max(CELL_W, win.width() - 16);
    return Math.max(1, Math.floor((inner + GRID_GAP) / (CELL_W + GRID_GAP)));
  });

  async function install(manifest: AppManifest): Promise<void> {
    const installer = os.installer;
    if (!installer) {
      setStatus("This Macintosh cannot install apps.");
      return;
    }
    setBusyId(manifest.id);
    try {
      await installer.install(manifest);
      setStatus(`Installed ${manifest.title}.`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Install failed.");
    }
    setBusyId(null);
  }

  function installBundled(listing: BundledAppListing): void {
    void install(bundledManifest(listing));
  }

  function installRegistry(e: RegistryEntry): void {
    if (!e.entry) {
      setStatus("This catalog entry has no bundle URL.");
      return;
    }
    void install({
      id: e.id,
      title: e.title,
      description: e.description,
      icon: e.icon ?? "icon/computer",
      author: e.author,
      version: e.version,
      sdk: e.sdk,
      permissions: e.permissions ?? [],
      entry: e.entry,
      declaration: e.declaration,
    });
  }

  function bundledListing(listing: BundledAppListing): StoreApp {
    const manifest = bundledManifest(listing);
    return {
      id: listing.id,
      title: listing.title,
      description: listing.description,
      icon: listing.icon,
      author: manifest.author,
      version: manifest.version,
      installable: true,
      install: () => installBundled(listing),
    };
  }

  function registryListing(e: RegistryEntry): StoreApp {
    const icon = e.icon ?? "icon/computer";
    const encoded = e.declaration?.sprites?.[icon];
    return {
      id: e.id,
      title: e.title,
      description: e.description,
      icon,
      iconSprite: encoded && defineSprite(encoded.width, encoded.height, encoded.data),
      author: e.author,
      version: e.version,
      installable: !!e.entry,
      install: () => installRegistry(e),
    };
  }

  // The shelf and an app page share the window's scroll: a page opens at its
  // top, and Back returns to where the shelf was.
  let shelfScrollY = 0;

  function openPage(item: StoreApp): void {
    setStatus("");
    if (!page()) shelfScrollY = win.scrollY();
    setPage(item);
    win.scrollTo(0);
  }

  function closePage(): void {
    setStatus("");
    setPage(null);
    win.scrollTo(shelfScrollY);
  }

  // Asked to show one app (a Spotlight result): turn to its page.
  createEffect(pendingPage, (request) => {
    if (!request) return;
    takePendingPage();
    const listing = bundledApps().find((l) => l.id === request.appId);
    if (listing) {
      if (untrack(page)?.id !== listing.id) openPage(bundledListing(listing));
      return;
    }
    if (!fetch) return;
    void loadRegistry(fetch).then((entries) => {
      const entry = entries.find((e) => e.id === request.appId);
      if (entry) openPage(registryListing(entry));
    }, () => setStatus("Failed to load catalog."));
  });

  return (
    <box
      width={win.width()}
      minHeight={win.height()}
      padding={8}
      flexDirection="column"
      gap={6}
      background={0}
      onLayout={({ height }) => win.setContentSize(win.width(), height)}
    >
      <Show when={!page()}>
        <text font="menu" spacing={1}>App Store</text>
      </Show>
      <Show when={status()}>
        <text font="body">{status()}</text>
      </Show>
      <Show
        when={page()}
        fallback={
          <box flexDirection="column" gap={8}>
            <text font="menu" spacing={1}>Mockintosh Apps</text>
            <AppShelf apps={bundledApps().map(bundledListing)} columns={columns()} onOpen={openPage} />
            <Show when={fetch}>
              <text font="menu" spacing={1}>From the Registry</text>
              <text font="body">SDK v3 apps only</text>
              <Loading fallback={<text font="body">Loading catalog…</text>}>
                <Errored fallback={() => <text font="body">Failed to load catalog.</text>}>
                  <Show
                    when={catalog().length === 0}
                    fallback={
                      <AppShelf
                        apps={catalog().map(registryListing)}
                        columns={columns()}
                        onOpen={openPage}
                      />
                    }
                  >
                    <text font="body">No SDK v3 apps in the catalog.</text>
                  </Show>
                </Errored>
              </Loading>
            </Show>
          </box>
        }
      >
        {(item) => (
          <AppPage
            app={item()}
            installed={installed().has(item().id)}
            busy={busyId() === item().id}
            onBack={closePage}
            onOpen={() => app.os.openApp(item().id)}
          />
        )}
      </Show>
    </box>
  );
}

export default defineApp({
  id: "appstore",
  title: "App Store",
  icon: "icon/appstore-smr-32x32",
  smallIcon: "icon/appstore-16x16",
  defaultSize: { width: 360, height: 340 },
  scrollable: true,
  resizable: true,
  minSize: { width: 240, height: 180 },
  Component: AppStore,
});
