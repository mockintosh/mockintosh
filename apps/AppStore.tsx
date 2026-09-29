import { For, Show, createMemo, createSignal, Loading, Errored } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { Button } from "@mockintosh/ui";
import { useApp, type AppManifest, defineApp } from "@mockintosh/sdk";
import { useOS } from "../src/os/context";
import { bundledApps, bundledManifest, type BundledAppListing } from "../src/os/bundledApps";
import { installedAppIds } from "../src/os/installedApps";

interface RegistryEntry {
  id: string;
  title: string;
  author: string;
  version: string;
  sdk: string;
  description: string;
  icon?: string;
  permissions?: string[];
  entry: string | null;
}

const REGISTRY_URL =
  "https://raw.githubusercontent.com/mockintosh/app-registry/main/registry.json";

function sdkMajor(sdk: string): number {
  const m = sdk.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

function ListingIcon(props: { name: string }): JSX.Element {
  const app = useApp();
  const sprite = createMemo(() => app.getSprite(props.name));
  return (
    <Show when={sprite()} fallback={<box width={32} height={32} />}>
      {(icon) => <image width={32} height={32} src={icon()} />}
    </Show>
  );
}

function AppStore(_props: Record<string, unknown>): JSX.Element {
  const app = useApp();
  const win = app.window;
  const fetch = app.fetch;
  // Installing apps is a shell privilege, not an SDK power: reach the OS directly.
  const os = useOS();
  const catalog = createMemo(async () => {
    if (!fetch) return [] as RegistryEntry[];
    const r = await fetch(REGISTRY_URL);
    const data = (await r.json()) as { apps?: RegistryEntry[] };
    return (data.apps ?? []).filter((e) => sdkMajor(e.sdk) >= 3);
  });
  // Reactive: installing (or trashing a .app in the Finder) updates the list.
  const installed = createMemo(() => new Set(installedAppIds(os.fs)));
  const [status, setStatus] = createSignal("");
  const [busyId, setBusyId] = createSignal<string | null>(null);

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
    });
  }

  return (
    <box width={win.width()} height={win.height()} padding={8} flexDirection="column" gap={6} background={0}>
      <text font="menu">App Store</text>
      <Show when={status()}>
        <text font="body">{status()}</text>
      </Show>
      <box overflow="scroll" flexGrow={1} minHeight={0} flexDirection="column" gap={8}>
        <text font="menu">Mockintosh Apps</text>
        <For each={bundledApps()}>
          {(listing) => (
            <box flexDirection="row" gap={6} borderColor={1} borderWidth={1} padding={4}>
              <ListingIcon name={listing.icon} />
              <box flexDirection="column" gap={2} flexGrow={1}>
                <text font="menu">{listing.title}</text>
                <text font="body">{listing.description}</text>
                <Show
                  when={installed().has(listing.id)}
                  fallback={
                    <Button
                      name={`install-${listing.id}`}
                      label={busyId() === listing.id ? "…" : "Install"}
                      disabled={busyId() === listing.id}
                      onClick={() => installBundled(listing)}
                    />
                  }
                >
                  <Button name={`open-${listing.id}`} label="Open" onClick={() => app.os.openApp(listing.id)} />
                </Show>
              </box>
            </box>
          )}
        </For>
        <Show when={fetch}>
          <text font="menu">From the Registry</text>
          <text font="body">SDK v3 apps only</text>
          <Loading fallback={<text font="body">Loading catalog…</text>}>
            <Errored fallback={() => <text font="body">Failed to load catalog.</text>}>
              <Show
                when={catalog().length === 0}
                fallback={
                  <For each={catalog()}>
                    {(e) => (
                      <box flexDirection="row" gap={6} borderColor={1} borderWidth={1} padding={4}>
                        <ListingIcon name={e.icon ?? "icon/computer"} />
                        <box flexDirection="column" gap={2} flexGrow={1}>
                          <text font="menu">{e.title}</text>
                          <text font="body">{`${e.author} · ${e.version}`}</text>
                          <text font="body">{e.description}</text>
                          <Show
                            when={installed().has(e.id)}
                            fallback={
                              <Button
                                name={`install-${e.id}`}
                                label={busyId() === e.id ? "…" : "Install"}
                                disabled={busyId() === e.id || !e.entry}
                                onClick={() => installRegistry(e)}
                              />
                            }
                          >
                            <Button name={`open-${e.id}`} label="Open" onClick={() => app.os.openApp(e.id)} />
                          </Show>
                        </box>
                      </box>
                    )}
                  </For>
                }
              >
                <text font="body">No SDK v3 apps in the catalog.</text>
              </Show>
            </Errored>
          </Loading>
        </Show>
      </box>
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
