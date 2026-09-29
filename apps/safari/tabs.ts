import { urlToAddress } from "./address";
import { startHistory, type History } from "./history";
import type { PageRequest } from "./page";

/** One tab: its own history, and what its address field says. */
export interface Tab {
  readonly id: number;
  readonly history: History;
  /** The address field's text. It follows the page, and holds what the user typed until they go there. */
  readonly address: string;
  /** Title of the last page this tab showed, or empty before one has loaded. */
  readonly title: string;
}

/** A window's tabs, in bar order. There is always at least one. */
export interface TabSet {
  readonly tabs: readonly Tab[];
  readonly activeId: number;
  readonly nextId: number;
}

function newTab(id: number, request: PageRequest): Tab {
  return { id, history: startHistory(request), address: urlToAddress(request.url), title: "" };
}

export function startTabs(request: PageRequest): TabSet {
  return { tabs: [newTab(1, request)], activeId: 1, nextId: 2 };
}

export function activeTab(set: TabSet): Tab {
  return set.tabs.find((tab) => tab.id === set.activeId) ?? set.tabs[0];
}

/** A new tab at the end of the bar, in front. */
export function openTab(set: TabSet, request: PageRequest): TabSet {
  const tab = newTab(set.nextId, request);
  return { tabs: [...set.tabs, tab], activeId: tab.id, nextId: set.nextId + 1 };
}

/**
 * Without the tab. Closing the one in front brings the tab to its right
 * forward, or to its left when it was last. Null when it was the only tab.
 */
export function closeTab(set: TabSet, id: number): TabSet | null {
  const at = set.tabs.findIndex((tab) => tab.id === id);
  if (at < 0) return set;
  if (set.tabs.length === 1) return null;
  const tabs = set.tabs.filter((tab) => tab.id !== id);
  const activeId = id === set.activeId ? tabs[Math.min(at, tabs.length - 1)].id : set.activeId;
  return { ...set, tabs, activeId };
}

export function selectTab(set: TabSet, id: number): TabSet {
  return set.tabs.some((tab) => tab.id === id) ? { ...set, activeId: id } : set;
}

/** Change one tab. A tab that has been closed stays closed. */
export function updateTab(set: TabSet, id: number, change: (tab: Tab) => Tab): TabSet {
  return { ...set, tabs: set.tabs.map((tab) => (tab.id === id ? change(tab) : tab)) };
}

/** Move the active tab's history, and point its address field at where it went. */
export function navigateActive(set: TabSet, move: (history: History) => History): TabSet {
  return updateTab(set, set.activeId, (tab) => {
    const history = move(tab.history);
    return history === tab.history ? tab : { ...tab, history, address: urlToAddress(history.current.url) };
  });
}
