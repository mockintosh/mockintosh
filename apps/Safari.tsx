import { Show, WindowHeader, createEffect, createMemo, createSignal, onCleanup } from "@mockintosh/sdk";
import { Menu, useUIServices, type JSX } from "@mockintosh/ui";
import { DocumentView, useApp, defineApp, type AppWindow, type FormField, type MenubarItemDef, type WebForm } from "@mockintosh/sdk";
import type { ImageFrame } from "@mockintosh/ui";
import { addressToUrl, formRequest, isSecure, resolveLink, urlToAddress } from "./safari/address";
import { AddressField, BACK_FORWARD_W, BackForward, HEADER_H, TOOLBAR_BUTTON_W, TOOLBAR_H, TOOLBAR_HEADER_H, TabBar, ToolbarButton, type TabLabel } from "./safari/chrome";
import { goBack, goForward, replace, visit } from "./safari/history";
import { backIcon, forwardIcon, plusIcon, shareIcon } from "./safari/icons";
import { PageError, START_URL, pageRequest, type GithubAccount, type PageRequest, type WebPage } from "./safari/page";
import { BOOKMARKS_KEY, addBookmark, bookmarkTitle, moveBookmark, parseBookmarks, removeBookmark, serializeBookmarks, type Bookmark } from "./safari/bookmarks";
import { faviconCache, type FaviconLoader } from "./safari/favicon";
import { remoteImageLoader } from "./safari/remote";
import { loadPage, readerApplies, type PageResult } from "./safari/router";
import { githubSprites } from "./safari/sites/github/icons";
import { GITHUB_SIGN_IN_HOST, signInToGithub } from "./safari/sites/github/signIn";
import { FAVICON_SIZE, StartView } from "./safari/startView";
import { activeTab, closeTab, navigateActive, openTab, selectTab, startTabs, updateTab, type TabSet } from "./safari/tabs";

const TOKEN_KEY = "github-token.txt";
const WINDOW_SIZE = { width: 480, height: 320 };
const MIN_SIZE = { width: 300, height: 180 };
const TOOLBAR_PAD = 4;
const TOOLBAR_GAP = 5;
/** Everything in the toolbar but the address field, and the field's shadow. */
const TOOLBAR_FIXED = BACK_FORWARD_W + TOOLBAR_BUTTON_W * 2 + TOOLBAR_GAP * 3 + TOOLBAR_PAD * 2 + 1;
const PAGE_PADDING = 6;
/** The loading bar eases towards this share of the field: with no length to go by, it never claims to be done… */
const PROGRESS_CEILING = 0.9;
/** …covering about two thirds of the way there in this long. */
const PROGRESS_EASE_MS = 900;
/** How long a full bar stays once the page is in. */
const PROGRESS_LINGER_MS = 150;

/** The start page's grid of bookmarks, and what it can do to them. */
interface Favorites {
  bookmarks(): readonly Bookmark[] | null;
  editing(): boolean;
  setEditing(editing: boolean): void;
  remove(bookmark: Bookmark): void;
  /** Put `bookmark` at `to` among the favorites. */
  move(bookmark: Bookmark, to: number): void;
  /** Ask for an address and a name, and bookmark it. */
  add(): void;
  icons?: FaviconLoader;
}

/** A tab's page as shown: which tab and history entry it is for. */
interface ShownPage {
  tabId: number;
  request: PageRequest;
  result: PageResult;
}

interface SafariViewProps {
  shown(): ShownPage;
  loadImage?: (src: string) => Promise<ImageFrame | null>;
  favorites: Favorites;
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
  const startPage = () => {
    const page = shownPage();
    return page?.kind === "start" ? page : null;
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
          <Show
            when={startPage()}
            fallback={
              <Show when={documentPage()} fallback={message(failure())}>
                {(page) => <DocumentView nodes={page().nodes} onLink={openLink} onSubmit={submitForm} loadImage={props.loadImage} />}
              </Show>
            }
          >
            {() => (
              <StartView
                bookmarks={props.favorites.bookmarks()}
                width={props.win.width() - PAGE_PADDING * 2}
                editing={props.favorites.editing()}
                icons={props.favorites.icons}
                onOpen={openLink}
                onEditingChange={props.favorites.setEditing}
                onDelete={props.favorites.remove}
                onMove={props.favorites.move}
                onAdd={props.favorites.add}
              />
            )}
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

  const github: GithubAccount = {
    async signIn() {
      if (!app.signIn) throw new PageError("This Macintosh can't sign in from a phone.");
      let next: string | null;
      try {
        next = await signInToGithub(fetch, app.signIn, app.crypto);
      } catch (error) {
        throw new PageError(error instanceof Error ? error.message : "Signing in to GitHub failed.");
      }
      if (next !== null) await saveToken(next);
      return next;
    },
    signOut: () => saveToken(""),
  };

  /**
   * Pages by history entry, so switching tabs and going back show what was
   * already loaded. Reload and Reader make a new entry and load again. A
   * post is sent once, whatever the token does meanwhile (signing in is one).
   */
  const loaded = new WeakMap<PageRequest, { token: string; result: Promise<PageResult> }>();
  function load(request: PageRequest, githubToken: string): Promise<PageResult> {
    const hit = loaded.get(request);
    if (hit && (hit.token === githubToken || request.method === "post")) return hit.result;
    const result = loadPage(request, { fetch, settings: { githubToken }, github });
    loaded.set(request, { token: githubToken, result });
    return result;
  }

  /** A post a site adapter took lands on an ordinary page, which takes its place in history. */
  function land(tabId: number, request: PageRequest, result: PageResult): boolean {
    if (result.kind !== "page" || !result.landed) return false;
    const landed = result.landed;
    loaded.set(landed, { token: token(), result: Promise.resolve({ kind: "page", page: result.page }) });
    setTabs((set) =>
      updateTab(set, tabId, (tab) => (tab.history.current === request ? { ...tab, history: replace(tab.history, landed) } : tab)),
    );
    return true;
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
        if (land(tabId, request, result)) return;
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

  /**
   * The address field's loading bar. Pages don't report how far along they
   * are, so it eases towards 90% while one loads, as Safari's does without a
   * length to go by, fills when the page arrives, and then goes.
   */
  const [progress, setProgress] = createSignal<number | null>(null);
  let progressFrame: (() => void) | null = null;
  function animateProgress(step: (elapsed: number) => boolean): void {
    progressFrame?.();
    const start = app.scheduler.now();
    const frame = () => {
      progressFrame = step(app.scheduler.now() - start) ? app.scheduler.requestFrame(frame) : null;
    };
    progressFrame = app.scheduler.requestFrame(frame);
  }
  createEffect(
    // The start page is drawn here, with nothing to wait for.
    () => loading() && wanted().request.url !== START_URL,
    (busy) => {
      if (busy) {
        animateProgress((elapsed) => {
          setProgress(PROGRESS_CEILING * (1 - Math.exp(-elapsed / PROGRESS_EASE_MS)));
          return true;
        });
        return;
      }
      // Done: stop easing, even when the page came before the bar's first frame…
      progressFrame?.();
      progressFrame = null;
      // …and fill a bar that showed, then let it go.
      if (progress() === null) return;
      setProgress(1);
      animateProgress((elapsed) => {
        if (elapsed < PROGRESS_LINGER_MS) return true;
        setProgress(null);
        return false;
      });
    },
  );
  onCleanup(() => progressFrame?.());
  /**
   * What the page area shows: the page wanted, or while it loads, the tab's
   * previous page, as a browser keeps it until the next one is ready, so a
   * site's header stays put. A tab with nothing shown yet says Loading….
   */
  const displayed = () => {
    const page = shown();
    return ready() ?? (page && page.tabId === wanted().tabId ? page : undefined);
  };

  const scrolledTo = new WeakMap<PageRequest, number>();
  const landed = new WeakSet<PageResult>();
  const loadImage = app.images ? remoteImageLoader(fetch, app.images, 1024) : undefined;
  const icons = app.images ? faviconCache(remoteImageLoader(fetch, app.images, 512), FAVICON_SIZE) : undefined;

  /** `null` until read from the preferences folder. */
  const [bookmarks, setBookmarks] = createSignal<readonly Bookmark[] | null>(null);
  const [editingFavorites, setEditingFavorites] = createSignal(false);
  void app.storage.read(BOOKMARKS_KEY).then(
    (text) => setBookmarks(parseBookmarks(text)),
    () => setBookmarks(parseBookmarks(null)),
  );

  function saveBookmarks(next: readonly Bookmark[]): void {
    setBookmarks(next);
    void app.storage.write(BOOKMARKS_KEY, serializeBookmarks(next));
  }

  async function bookmarkAs(url: string, suggested: string): Promise<void> {
    const title = await app.os.showDialog({
      message: "Name this bookmark:",
      showInput: true,
      inputDefault: suggested,
      buttons: ["Cancel", "Add"],
      variant: "note",
    });
    const current = bookmarks();
    if (title === null || !current) return;
    saveBookmarks(addBookmark(current, { title: title.trim() || bookmarkTitle(url), url }));
  }

  async function addAddress(): Promise<void> {
    const entered = await app.os.showDialog({
      message: "Bookmark the page at this address:",
      showInput: true,
      buttons: ["Cancel", "Next"],
      variant: "note",
    });
    if (entered === null || !entered.trim()) return;
    const url = addressToUrl(entered);
    if (url === START_URL) return;
    await bookmarkAs(url, bookmarkTitle(url));
  }

  // Editing ends when the tab leaves the start page.
  createEffect(
    () => front().history.current.url,
    (url) => {
      if (url !== START_URL && editingFavorites()) setEditingFavorites(false);
    },
  );

  const favorites: Favorites = {
    bookmarks,
    editing: editingFavorites,
    setEditing: setEditingFavorites,
    remove: (bookmark) => {
      const current = bookmarks();
      if (current) saveBookmarks(removeBookmark(current, bookmark.url));
    },
    move: (bookmark, to) => {
      const current = bookmarks();
      if (current) saveBookmarks(moveBookmark(current, bookmark, to));
    },
    add: () => void addAddress(),
    icons,
  };

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
    closeOneTab(tabs().activeId);
  }

  function closeOneTab(id: number): void {
    const remaining = closeTab(tabs(), id);
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

  /** Whether the Share button's menu is open. */
  const [sharing, setSharing] = createSignal(false);
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

  /** The front page, when it is one Bookmarks › Add Bookmark… can keep. */
  const bookmarkablePage = (): WebPage | null => {
    const page = shown();
    if (!page || page.tabId !== front().id || page.request !== front().history.current) return null;
    if (page.result.kind !== "page" || page.result.page.kind === "start" || page.request.method !== "get") return null;
    return page.result.page;
  };

  function addBookmarkForPage(): void {
    const page = bookmarkablePage();
    if (page) void bookmarkAs(page.url, page.title || bookmarkTitle(page.url));
  }

  function editFavorites(): void {
    if (front().history.current.url !== START_URL) go(pageRequest(START_URL));
    setEditingFavorites(true);
  }

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
        canBookmark: bookmarks() !== null && bookmarkablePage() !== null,
        bookmarks: bookmarks() ?? [],
        signedIn: token() !== "",
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
            { label: "Add Bookmark…", shortcut: "D", disabled: !state.canBookmark, onClick: addBookmarkForPage },
            { label: "Edit Favorites", disabled: state.bookmarks.length === 0, onClick: editFavorites },
            ...(state.bookmarks.length > 0 ? [{ type: "separator" } as const] : []),
            ...state.bookmarks.map((bookmark): MenubarItemDef => ({ label: bookmark.title, onClick: () => openBookmark(bookmark) })),
            { type: "separator" },
            { label: "Sign In to GitHub…", disabled: state.signedIn, onClick: () => go(pageRequest("https://github.com/login")) },
            { label: "Sign Out of GitHub", disabled: !state.signedIn, onClick: () => void saveToken("") },
            { label: "GitHub Token…", onClick: () => void editToken() },
          ],
        },
      ]);
    },
  );

  /** The header band spans the scrollbar column too, so it measures itself. */
  const [barWidth, setBarWidth] = createSignal(win.width() + 15);
  const manyTabs = () => tabs().tabs.length > 1;
  const headerH = () => (manyTabs() ? HEADER_H : TOOLBAR_HEADER_H);
  const tabLabels = (): TabLabel[] =>
    tabs().tabs.map((tab) => ({
      id: tab.id,
      label:
        tab.id === tabs().activeId && loading()
          ? "Loading…"
          : tab.title || (tab.history.current.url === START_URL ? "Start page" : urlToAddress(tab.history.current.url) || "Untitled"),
    }));
  const message = (text: string) => <text font="body" wrap>{text}</text>;
  const reportHeight = ({ height }: { height: number }) => win.setContentSize(win.width(), height);

  return (
    <>
      <WindowHeader height={headerH()}>
        <box width="100%" height={headerH() - 1} flexDirection="column" background={0} onLayout={({ width }) => setBarWidth(width)}>
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
              progress={progress()}
            />
            <Menu
              name="safari-share-menu"
              open={sharing()}
              onDismiss={() => setSharing(false)}
              align="end"
              items={[
                { label: "Copy URL", disabled: !canCopyLink(), onClick: copyLink },
                { label: "Add to Bookmarks…", disabled: !bookmarkablePage(), onClick: addBookmarkForPage },
              ]}
              trigger={
                <ToolbarButton name="safari-share" icon={shareIcon} disabled={!canCopyLink() && !bookmarkablePage()} active={sharing()} onClick={() => setSharing(!sharing())} />
              }
            />
            <ToolbarButton name="safari-new-tab" icon={plusIcon} onClick={newTab} />
          </box>
          <Show when={manyTabs()}>
            <box height={1} background={1} />
            <TabBar
              width={barWidth()}
              tabs={tabLabels()}
              activeId={tabs().activeId}
              onSelect={(id) => setTabs((set) => selectTab(set, id))}
              onClose={closeOneTab}
            />
          </Show>
          {/* A black line and a white one: with the window's own rule under them, a Finder folder's double rule. */}
          <box height={1} background={1} />
          <box height={1} background={0} />
        </box>
      </WindowHeader>
      <Show
        when={displayed()}
        fallback={<box width={win.width()} height={win.height()} padding={PAGE_PADDING} onLayout={reportHeight}>{message("Loading…")}</box>}
      >
        {(page) => (
          <SafariView shown={page} loadImage={loadImage} favorites={favorites} go={go} setTabs={setTabs} win={win} scrolledTo={scrolledTo} landed={landed} />
        )}
      </Show>
    </>
  );
}

export default defineApp({
  id: "safari",
  requires: ["network"],
  signIn: { hosts: [GITHUB_SIGN_IN_HOST] },
  title: "Safari",
  icon: "icon/safari",
  smallIcon: "icon/safari-16x16",
  sprites: githubSprites,
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
