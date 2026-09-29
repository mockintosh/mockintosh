import { Show, WindowHeader, createEffect, createMemo, createSignal } from "@mockintosh/sdk";
import { useUIServices, type JSX } from "@mockintosh/ui";
import { DocumentView, useApp, defineApp, type AppWindow, type FormField, type MenubarItemDef, type WebForm } from "@mockintosh/sdk";
import type { ImageFrame } from "@mockintosh/ui";
import { addressToUrl, formRequest, isSecure, resolveLink, urlToAddress } from "./safari/address";
import { AddressField, BACK_FORWARD_W, BackForward, HEADER_H, TOOLBAR_BUTTON_W, TOOLBAR_H, TabBar, ToolbarButton, type TabLabel } from "./safari/chrome";
import { goBack, goForward, replace, visit } from "./safari/history";
import { backIcon, forwardIcon, shareIcon, windowsIcon } from "./safari/icons";
import { START_URL, pageRequest, type PageRequest, type SiteBookmark, type WebPage } from "./safari/page";
import { remoteImageLoader } from "./safari/remote";
import { loadPage, readerApplies, type PageResult } from "./safari/router";
import { SITE_BOOKMARKS } from "./safari/sites";
import { BOOKMARKS } from "./safari/start";
import { activeTab, closeTab, navigateActive, openTab, selectTab, startTabs, updateTab, type TabSet } from "./safari/tabs";

const TOKEN_KEY = "github-token.txt";
const WINDOW_SIZE = { width: 480, height: 320 };
const MIN_SIZE = { width: 300, height: 180 };
const TOOLBAR_PAD = 4;
const TOOLBAR_GAP = 5;
/** Everything in the toolbar but the address field, and the field's shadow. */
const TOOLBAR_FIXED = BACK_FORWARD_W + TOOLBAR_BUTTON_W * 2 + TOOLBAR_GAP * 3 + TOOLBAR_PAD * 2 + 1;
const PAGE_PADDING = 6;

/** A tab's page as shown: which tab and history entry it is for. */
interface ShownPage {
  tabId: number;
  request: PageRequest;
  result: PageResult;
}

interface SafariViewProps {
  shown(): ShownPage;
  loadImage?: (src: string) => Promise<ImageFrame | null>;
  go(request: PageRequest): void;
  setTabs(change: (set: TabSet) => TabSet): void;
  win: AppWindow;
  scrolledTo: WeakMap<PageRequest, number>;
  landed: WeakSet<PageResult>;
}

/** Reads the pending page. Must sit under `<Loading>` so the chrome can paint first. */
function SafariView(props: SafariViewProps): JSX.Element {
  const shownPage = (): WebPage | null => {
    const { result } = props.shown();
    return result.kind === "page" ? result.page : null;
  };
  const documentPage = () => {
    const page = shownPage();
    return page?.kind === "document" ? page : null;
  };
  const picturePage = () => {
    const page = shownPage();
    return page?.kind === "picture" ? page : null;
  };
  const failure = () => {
    const { result } = props.shown();
    return result.kind === "error" ? result.message : "";
  };
  const baseUrl = () => shownPage()?.url ?? props.shown().request.url;

  let scrollingRequest: PageRequest | null = null;
  createEffect(
    () => props.shown(),
    ({ tabId, request, result }) => {
      scrollingRequest = request;
      props.win.scrollTo(props.scrolledTo.get(request) ?? 0);
      const firstTime = !props.landed.has(result);
      props.landed.add(result);
      props.setTabs((set) =>
        updateTab(set, tabId, (tab) => ({
          ...tab,
          title: result.kind === "page" ? result.page.title : "Can't Open Page",
          address: firstTime && result.kind === "page" && tab.history.current === request ? urlToAddress(result.page.url) : tab.address,
        })),
      );
    },
  );
  createEffect(
    () => props.win.scrollY(),
    (y) => {
      if (scrollingRequest) props.scrolledTo.set(scrollingRequest, y);
    },
  );

  function openLink(href: string): void {
    const target = resolveLink(href, baseUrl());
    if (target) props.go(pageRequest(target));
  }

  function submitForm(form: WebForm, fields: FormField[]): void {
    const request = formRequest(form, fields, baseUrl());
    if (request) props.go(request);
  }

  const message = (text: string) => <text font="body" wrap>{text}</text>;
  const reportHeight = ({ height }: { height: number }) => props.win.setContentSize(props.win.width(), height);

  return (
    <Show
      when={picturePage()}
      fallback={
        <box width={props.win.width()} minHeight={props.win.height()} padding={PAGE_PADDING} flexDirection="column" background={0} onLayout={reportHeight}>
          <Show when={documentPage()} fallback={message(failure())}>
            {(page) => <DocumentView nodes={page().nodes} onLink={openLink} onSubmit={submitForm} loadImage={props.loadImage} />}
          </Show>
        </box>
      }
    >
      {(page) => (
        <box width={props.win.width()} height={props.win.height()} justifyContent="center" alignItems="center" background={page().background ?? 0} onLayout={reportHeight}>
          <image semantic={{ name: "safari-picture", role: "image" }} src={page().picture} width={page().picture.width} height={page().picture.height} />
        </box>
      )}
    </Show>
  );
}

function Safari(props: Record<string, unknown>): JSX.Element {
  const app = useApp();
  const win = app.window;
  const fetch = app.fetch!; // present: the app requires "network"
  const { clipboard } = useUIServices();

  const initial = pageRequest(typeof props.url === "string" ? addressToUrl(props.url) : START_URL);
  const [tabs, setTabs] = createSignal<TabSet>(startTabs(initial));
  const front = () => activeTab(tabs());

  const [storedToken, setStoredToken] = createSignal("");
  const [tokenOverride, setTokenOverride] = createSignal<string | null>(null);
  void app.storage.read(TOKEN_KEY).then((value) => setStoredToken(value ?? ""));
  const token = () => tokenOverride() ?? storedToken();

  /**
   * Pages by history entry, so switching tabs and going back show what was
   * already loaded. Reload and Reader make a new entry and load again.
   */
  const loaded = new WeakMap<PageRequest, { token: string; result: Promise<PageResult> }>();
  function load(request: PageRequest, githubToken: string): Promise<PageResult> {
    const hit = loaded.get(request);
    if (hit && hit.token === githubToken) return hit.result;
    const result = loadPage(request, { fetch, settings: { githubToken } });
    loaded.set(request, { token: githubToken, result });
    return result;
  }

  const wanted = createMemo(
    () => ({ tabId: front().id, request: front().history.current }),
    { equals: (a, b) => a.tabId === b.tabId && a.request === b.request },
  );
  const [shown, setShown] = createSignal<ShownPage | undefined>(undefined);
  createEffect(
    () => ({ ...wanted(), githubToken: token() }),
    ({ tabId, request, githubToken }) => {
      void load(request, githubToken).then((result) => {
        if (wanted().tabId === tabId && wanted().request === request) setShown({ tabId, request, result });
      });
    },
  );
  const ready = () => {
    const page = shown();
    const next = wanted();
    return page && page.tabId === next.tabId && page.request === next.request ? page : undefined;
  };
  const loading = () => ready() === undefined;

  const scrolledTo = new WeakMap<PageRequest, number>();
  const landed = new WeakSet<PageResult>();
  const loadImage = app.images ? remoteImageLoader(fetch, app.images, 1024) : undefined;

  function go(request: PageRequest): void {
    setTabs((set) => navigateActive(set, (history) => visit(history, request)));
  }

  function setAddress(address: string): void {
    setTabs((set) => updateTab(set, set.activeId, (tab) => ({ ...tab, address })));
  }

  function openBookmark(bookmark: { url: string }): void {
    go(pageRequest(bookmark.url));
  }

  function reload(): void {
    setTabs((set) => navigateActive(set, (history) => replace(history, { ...history.current })));
  }

  function toggleReader(): void {
    setTabs((set) => navigateActive(set, (history) => replace(history, { ...history.current, reader: !history.current.reader })));
  }

  function newTab(): void {
    setTabs((set) => openTab(set, pageRequest(START_URL)));
  }

  function closeFrontTab(): void {
    const remaining = closeTab(tabs(), tabs().activeId);
    if (remaining) setTabs(remaining);
    else win.close();
  }

  function showNeighbourTab(step: 1 | -1): void {
    setTabs((set) => {
      const at = set.tabs.findIndex((tab) => tab.id === set.activeId);
      const next = set.tabs[(at + step + set.tabs.length) % set.tabs.length];
      return selectTab(set, next.id);
    });
  }

  function newWindow(): void {
    app.openWindow({ title: "Safari", size: WINDOW_SIZE, minSize: MIN_SIZE, scrollable: true, resizable: true });
  }

  const pageUrl = () => front().history.current.url;
  const canCopyLink = () => clipboard !== undefined && pageUrl() !== START_URL;
  function copyLink(): void {
    if (canCopyLink()) void clipboard?.writeText(pageUrl()).catch(() => {});
  }

  async function openLocation(): Promise<void> {
    const entered = await app.os.showDialog({
      message: "Open the page at this address, or search for these words:",
      showInput: true,
      inputDefault: front().address,
      buttons: ["Cancel", "Open"],
      variant: "note",
    });
    if (entered !== null && entered.trim()) go(pageRequest(addressToUrl(entered)));
  }

  async function editToken(): Promise<void> {
    const entered = await app.os.showDialog({
      message: "GitHub token. Public repositories open without one; a token raises the rate limit and opens private repositories.",
      showInput: true,
      inputDefault: token(),
      buttons: ["Cancel", "OK"],
      variant: "note",
    });
    if (entered === null) return;
    await saveToken(entered.trim());
  }

  async function saveToken(next: string): Promise<void> {
    setTokenOverride(next);
    if (next) await app.storage.write(TOKEN_KEY, next);
    else await app.storage.remove(TOKEN_KEY);
  }

  const bookmarkItems: MenubarItemDef[] = BOOKMARKS.map((bookmark) => ({ label: bookmark.title, onClick: () => openBookmark(bookmark) }));

  createEffect(
    () => {
      const tab = front();
      return {
        canBack: tab.history.back.length > 0,
        canForward: tab.history.forward.length > 0,
        reader: tab.history.current.reader,
        readerApplies: readerApplies(tab.history.current),
        manyTabs: tabs().tabs.length > 1,
        canCopyLink: canCopyLink(),
      };
    },
    (state) => {
      app.setMenus([
        {
          label: "File",
          items: [
            { label: "New Window", shortcut: "N", onClick: newWindow },
            { label: "New Tab", shortcut: "T", onClick: newTab },
            { label: "Open Location…", shortcut: "L", onClick: () => void openLocation() },
            { type: "separator" },
            { label: "Close Tab", shortcut: "W", onClick: closeFrontTab },
            { label: "Close Window", onClick: () => win.close() },
            { label: "Quit", shortcut: "Q", onClick: () => app.quit() },
          ],
        },
        {
          label: "Edit",
          items: [{ label: "Copy Link", disabled: !state.canCopyLink, onClick: copyLink }],
        },
        {
          label: "View",
          items: [
            { label: "Reader", checked: state.reader, disabled: !state.readerApplies, onClick: toggleReader },
            { label: "Reload", shortcut: "R", onClick: reload },
            { type: "separator" },
            { label: "Show Previous Tab", disabled: !state.manyTabs, onClick: () => showNeighbourTab(-1) },
            { label: "Show Next Tab", disabled: !state.manyTabs, onClick: () => showNeighbourTab(1) },
          ],
        },
        {
          label: "History",
          items: [
            { label: "Back", shortcut: "[", disabled: !state.canBack, onClick: () => setTabs((set) => navigateActive(set, goBack)) },
            { label: "Forward", shortcut: "]", disabled: !state.canForward, onClick: () => setTabs((set) => navigateActive(set, goForward)) },
            { type: "separator" },
            { label: "Start Page", onClick: () => go(pageRequest(START_URL)) },
          ],
        },
        {
          label: "Bookmarks",
          items: [
            ...bookmarkItems,
            { type: "separator" },
            { label: "GitHub Token…", onClick: () => void editToken() },
            { label: "Forget GitHub Token", onClick: () => void saveToken("") },
          ],
        },
      ]);
    },
  );

  /** The header band spans the scrollbar column too, so it measures itself. */
  const [barWidth, setBarWidth] = createSignal(win.width() + 15);
  const tabLabels = (): TabLabel[] =>
    tabs().tabs.map((tab) => ({
      id: tab.id,
      label: tab.id === tabs().activeId && loading() ? "Loading…" : tab.title || urlToAddress(tab.history.current.url) || "Untitled",
    }));
  const message = (text: string) => <text font="body" wrap>{text}</text>;
  const reportHeight = ({ height }: { height: number }) => win.setContentSize(win.width(), height);

  return (
    <>
      <WindowHeader height={HEADER_H}>
        <box width="100%" height={HEADER_H - 1} flexDirection="column" background={0} onLayout={({ width }) => setBarWidth(width)}>
          <box height={TOOLBAR_H} flexDirection="row" alignItems="center" gap={TOOLBAR_GAP} paddingLeft={TOOLBAR_PAD} paddingRight={TOOLBAR_PAD}>
            <BackForward
              back={{ name: "safari-back", icon: backIcon, disabled: front().history.back.length === 0, onClick: () => setTabs((set) => navigateActive(set, goBack)) }}
              forward={{ name: "safari-forward", icon: forwardIcon, disabled: front().history.forward.length === 0, onClick: () => setTabs((set) => navigateActive(set, goForward)) }}
            />
            <AddressField
              value={front().address}
              onChange={setAddress}
              onSubmit={() => go(pageRequest(addressToUrl(front().address)))}
              secure={isSecure(pageUrl())}
              width={Math.max(60, barWidth() - TOOLBAR_FIXED)}
            />
            <ToolbarButton name="safari-copy-link" icon={shareIcon} disabled={!canCopyLink()} onClick={copyLink} />
            <ToolbarButton name="safari-new-window" icon={windowsIcon} onClick={newWindow} />
          </box>
          <box height={1} background={1} />
          <TabBar
            width={barWidth()}
            bookmarks={SITE_BOOKMARKS}
            tabs={tabLabels()}
            activeId={tabs().activeId}
            onBookmark={(bookmark: SiteBookmark) => openBookmark(bookmark)}
            onSelect={(id) => setTabs((set) => selectTab(set, id))}
            onNewTab={newTab}
          />
        </box>
      </WindowHeader>
      <Show
        when={ready()}
        fallback={<box width={win.width()} height={win.height()} padding={PAGE_PADDING} onLayout={reportHeight}>{message("Loading…")}</box>}
      >
        {(page) => (
          <SafariView shown={page} loadImage={loadImage} go={go} setTabs={setTabs} win={win} scrolledTo={scrolledTo} landed={landed} />
        )}
      </Show>
    </>
  );
}

export default defineApp({
  id: "safari",
  requires: ["network"],
  title: "Safari",
  icon: "icon/safari",
  about: {
    description:
      "Browses the web the way it looked in 1996: text, links, pictures and forms, without style sheets or scripts. GitHub and Hacker News are drawn from their APIs.",
  },
  defaultSize: WINDOW_SIZE,
  scrollable: true,
  resizable: true,
  minSize: MIN_SIZE,
  Component: Safari,
});
