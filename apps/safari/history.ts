import type { PageRequest } from "./page";

/** Back/forward, as a browser keeps it: going somewhere new drops the forward list. */
export interface History {
  back: PageRequest[];
  current: PageRequest;
  forward: PageRequest[];
}

export function startHistory(current: PageRequest): History {
  return { back: [], current, forward: [] };
}

export function visit(history: History, next: PageRequest): History {
  return { back: [...history.back, history.current], current: next, forward: [] };
}

/** Swap the current entry (a redirect landed somewhere else, Reader toggled). */
export function replace(history: History, next: PageRequest): History {
  return { ...history, current: next };
}

export function goBack(history: History): History {
  const previous = history.back[history.back.length - 1];
  if (!previous) return history;
  return { back: history.back.slice(0, -1), current: previous, forward: [history.current, ...history.forward] };
}

export function goForward(history: History): History {
  const [next, ...rest] = history.forward;
  if (!next) return history;
  return { back: [...history.back, history.current], current: next, forward: rest };
}
