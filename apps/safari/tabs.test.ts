import { describe, expect, it } from "vitest";
import { goBack, visit } from "./history";
import { START_URL, pageRequest } from "./page";
import { activeTab, closeTab, navigateActive, openTab, selectTab, startTabs, updateTab } from "./tabs";

const start = pageRequest(START_URL);
const github = pageRequest("https://github.com/");
const news = pageRequest("https://news.ycombinator.com/news");

describe("tabs", () => {
  it("starts with one tab in front, its address field following the page", () => {
    const set = startTabs(github);
    expect(set.tabs).toHaveLength(1);
    expect(activeTab(set).history.current).toBe(github);
    expect(activeTab(set).address).toBe("github.com");
    expect(activeTab(startTabs(start)).address).toBe("");
  });

  it("opens new tabs at the end, in front", () => {
    const set = openTab(openTab(startTabs(start), github), news);
    expect(set.tabs.map((tab) => tab.history.current)).toEqual([start, github, news]);
    expect(activeTab(set).history.current).toBe(news);
    expect(new Set(set.tabs.map((tab) => tab.id)).size).toBe(3);
  });

  it("brings the right-hand neighbour forward when the front tab closes, or the left one at the end", () => {
    const set = openTab(openTab(startTabs(start), github), news);
    const [first, second, third] = set.tabs;
    const middleClosed = closeTab(selectTab(set, second.id), second.id)!;
    expect(activeTab(middleClosed).id).toBe(third.id);
    const lastClosed = closeTab(set, third.id)!;
    expect(activeTab(lastClosed).id).toBe(second.id);
    const backClosed = closeTab(set, first.id)!;
    expect(activeTab(backClosed).id).toBe(third.id);
  });

  it("has nothing left when its only tab closes", () => {
    const set = startTabs(start);
    expect(closeTab(set, set.activeId)).toBeNull();
  });

  it("moves only the front tab's history, and follows it in the address field", () => {
    const set = selectTab(openTab(startTabs(start), github), 1);
    const moved = navigateActive(set, (history) => visit(history, news));
    expect(moved.tabs[0].history.current).toBe(news);
    expect(moved.tabs[0].address).toBe("news.ycombinator.com/news");
    expect(moved.tabs[1]).toBe(set.tabs[1]);
    const back = navigateActive(moved, goBack);
    expect(back.tabs[0].address).toBe("");
  });

  it("leaves a tab alone when its history doesn't move", () => {
    const set = updateTab(startTabs(start), 1, (tab) => ({ ...tab, address: "typed" }));
    expect(navigateActive(set, goBack)).toEqual(set);
  });
});
