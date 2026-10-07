import { describe, it, expect, vi } from "vitest";
import { createNode, setNodeProperty } from "../src/nodes";
import { computeLayout } from "../src/layout";
import {
  createDoubleClickTracker,
  createPointerDispatcher,
  hitTest,
  nodeAt,
  TOUCH_SLOP,
  type PointerScheduler,
} from "../src/pointer";
import { createFocusManager } from "../src/focus";
import type { MeasureFunc } from "../src/layout";

const noMeasure: MeasureFunc = () => ({ width: 0, height: 0 });

function tree() {
  const root = createNode("_root");
  root.style = { width: 100, height: 100 };
  const a = createNode("box");
  a.style = { position: "absolute", left: 0, top: 0, width: 50, height: 50 };
  a._eventHandlers = {};
  const b = createNode("box");
  b.style = { position: "absolute", left: 25, top: 25, width: 50, height: 50 };
  b._eventHandlers = {};
  a.parent = root;
  b.parent = root;
  root.children = [a, b];
  computeLayout(root, 100, 100, noMeasure);
  return { root, a, b };
}

describe("hitTest", () => {
  it("returns the topmost (later) node", () => {
    const { root, b } = tree();
    b._eventHandlers.onClick = () => {};
    const hit = hitTest(root, 30, 30);
    expect(hit).toBe(b);
  });

  it("skips inert subtrees", () => {
    const { root, a, b } = tree();
    a._eventHandlers.onClick = () => {};
    b._eventHandlers.onClick = () => {};
    b.props.inert = true;
    expect(hitTest(root, 30, 30)).toBe(a);
  });

  it("honors hit masks", () => {
    const { root, b } = tree();
    b._eventHandlers.onClick = () => {};
    const mask = new Uint8Array(50 * 50);
    mask[0] = 1; // only (0,0) of the box
    b.props.hitMask = { data: mask, width: 50, height: 50 };
    expect(hitTest(root, 25, 25)).toBe(b);
    expect(hitTest(root, 30, 30)).toBe(null);
  });
});

describe("nodeAt skip", () => {
  it("looks through a covering overlay to the page underneath", () => {
    const { root, a, b } = tree();
    expect(nodeAt(root, 30, 30)).toBe(b);
    expect(nodeAt(root, 30, 30, 0, 0, null, (node) => node === b)).toBe(a);
  });
});

describe("pointer capture", () => {
  it("delivers drag and dragEnd to the mousedown node", () => {
    const { root, a } = tree();
    const events: string[] = [];
    a._eventHandlers.onMouseDown = () => events.push("down");
    a._eventHandlers.onDragStart = () => events.push("start");
    a._eventHandlers.onDrag = () => events.push("drag");
    a._eventHandlers.onDragEnd = () => events.push("end");
    a._eventHandlers.onMouseUp = () => events.push("up");
    const focus = createFocusManager(root);
    const ptr = createPointerDispatcher(root, focus);
    ptr.dispatch("mousedown", 10, 10);
    ptr.dispatch("mousemove", 80, 80);
    ptr.dispatch("mouseup", 80, 80);
    expect(events).toEqual(["down", "start", "drag", "end", "up"]);
  });

  it("starts a drag at the press point so the first move is not lost", () => {
    const { root, b } = tree();
    const calls: number[][] = [];
    b._eventHandlers.onMouseDown = () => {};
    b._eventHandlers.onDragStart = (lx, ly, gx, gy) => calls.push([lx, ly, gx, gy]);
    b._eventHandlers.onDrag = (lx, ly, gx, gy) => calls.push([lx, ly, gx, gy]);
    const ptr = createPointerDispatcher(root, createFocusManager(root));
    ptr.dispatch("mousedown", 30, 30);
    ptr.dispatch("mousemove", 45, 40);
    expect(calls).toEqual([
      [5, 5, 30, 30],
      [20, 15, 45, 40],
    ]);
  });

  it("fires enter and leave on ancestors when the hit moves", () => {
    const root = createNode("_root");
    root.style = { width: 100, height: 100 };
    const wrap = createNode("box");
    wrap.style = { position: "absolute", left: 0, top: 0, width: 50, height: 50 };
    wrap._eventHandlers = {};
    const inner = createNode("box");
    inner.style = { position: "absolute", left: 0, top: 0, width: 50, height: 50 };
    inner._eventHandlers = {};
    wrap.parent = root;
    inner.parent = wrap;
    root.children = [wrap];
    wrap.children = [inner];
    computeLayout(root, 100, 100, noMeasure);
    const events: string[] = [];
    wrap._eventHandlers.onMouseEnter = () => events.push("wrap:enter");
    wrap._eventHandlers.onMouseLeave = () => events.push("wrap:leave");
    inner._eventHandlers.onClick = () => {};
    const focus = createFocusManager(root);
    const ptr = createPointerDispatcher(root, focus);
    ptr.dispatch("mousemove", 10, 10);
    ptr.dispatch("mousemove", 80, 80);
    expect(events).toEqual(["wrap:enter", "wrap:leave"]);
  });

  it("keeps delivering hover to nodes under the pointer during a capture", () => {
    const { root, a, b } = tree();
    const events: string[] = [];
    a._eventHandlers.onMouseDown = () => {};
    a._eventHandlers.onMouseLeave = () => events.push("a:leave");
    b._eventHandlers.onMouseEnter = () => events.push("b:enter");
    b._eventHandlers.onMouseLeave = () => events.push("b:leave");
    const focus = createFocusManager(root);
    const ptr = createPointerDispatcher(root, focus);
    ptr.dispatch("mousedown", 10, 10); // on a
    ptr.dispatch("mousemove", 60, 60); // over b (drop target)
    ptr.dispatch("mousemove", 90, 5);  // over nothing
    ptr.dispatch("mouseup", 90, 5);
    expect(events).toEqual(["a:leave", "b:enter", "b:leave"]);
  });

  it("does not click if released outside the node", () => {
    const { root, a } = tree();
    let clicked = false;
    a._eventHandlers.onMouseDown = () => {};
    a._eventHandlers.onClick = () => {
      clicked = true;
    };
    const focus = createFocusManager(root);
    const ptr = createPointerDispatcher(root, focus);
    ptr.dispatch("mousedown", 10, 10);
    ptr.dispatch("mouseup", 80, 80);
    expect(clicked).toBe(false);
  });

  it("focuses a tabIndex node on mousedown", () => {
    const { root, a } = tree();
    a._eventHandlers.tabIndex = 0;
    a._eventHandlers.onMouseDown = () => {};
    const focus = createFocusManager(root);
    const ptr = createPointerDispatcher(root, focus);
    ptr.dispatch("mousedown", 10, 10);
    expect(focus.focused).toBe(a);
  });

  it("blurs when mousedown misses every hit target", () => {
    const { root, a } = tree();
    a._eventHandlers.tabIndex = 0;
    a._eventHandlers.onMouseDown = () => {};
    const onBlur = vi.fn();
    a._eventHandlers.onBlur = onBlur;
    const focus = createFocusManager(root);
    const ptr = createPointerDispatcher(root, focus);
    ptr.dispatch("mousedown", 10, 10);
    ptr.dispatch("mousedown", 90, 90);
    expect(focus.focused).toBeNull();
    expect(onBlur).toHaveBeenCalledOnce();
  });

  it("blurs when mousedown lands on a node that is not focusable", () => {
    const { root, a, b } = tree();
    a._eventHandlers.tabIndex = 0;
    a._eventHandlers.onMouseDown = () => {};
    b._eventHandlers.onMouseDown = () => {};
    const focus = createFocusManager(root);
    const ptr = createPointerDispatcher(root, focus);
    ptr.dispatch("mousedown", 10, 10);
    expect(focus.focused).toBe(a);
    ptr.dispatch("mousedown", 60, 60);
    expect(focus.focused).toBeNull();
  });

  it("leaves focus and its scope alone for a press in a keepsFocus subtree", () => {
    const { root, a, b } = tree();
    a.props.focusScope = true;
    a._eventHandlers.tabIndex = 0;
    b.props.keepsFocus = true;
    const onClick = vi.fn();
    b._eventHandlers.onClick = onClick;
    const focus = createFocusManager(root);
    const ptr = createPointerDispatcher(root, focus);
    ptr.dispatch("mousedown", 10, 10);
    ptr.dispatch("mouseup", 10, 10);
    ptr.dispatch("mousedown", 60, 60);
    ptr.dispatch("mouseup", 60, 60);
    expect(onClick).toHaveBeenCalledOnce();
    expect(focus.focused).toBe(a);
    expect(focus.getActiveScope()).toBe(a);
  });
});

/** root > outer (capture) > inner (target), inner fills outer at (10,10)-(60,60). */
function nestedTree() {
  const root = createNode("_root");
  root.style = { width: 100, height: 100 };
  const outer = createNode("box");
  outer.style = { position: "absolute", left: 10, top: 10, width: 50, height: 50 };
  const inner = createNode("box");
  inner.style = { position: "absolute", left: 0, top: 0, width: 50, height: 50 };
  outer.parent = root;
  inner.parent = outer;
  root.children = [outer];
  outer.children = [inner];
  computeLayout(root, 100, 100, noMeasure);
  return { root, outer, inner };
}

describe("mousedown capture phase", () => {
  it("runs ancestors first, then the target, before the target's onMouseDown", () => {
    const { root, outer, inner } = nestedTree();
    const events: string[] = [];
    outer._eventHandlers.onMouseDownCapture = (e) => events.push(`outer@${e.localX},${e.localY}`);
    inner._eventHandlers.onMouseDownCapture = (e) => events.push(`inner@${e.localX},${e.localY}`);
    inner._eventHandlers.onMouseDown = (lx, ly) => events.push(`down@${lx},${ly}`);
    const ptr = createPointerDispatcher(root, createFocusManager(root));
    ptr.dispatch("mousedown", 30, 40);
    expect(events).toEqual(["outer@20,30", "inner@20,30", "down@20,30"]);
  });

  it("preventDefault swallows the press and the matching release", () => {
    const { root, outer, inner } = nestedTree();
    const events: string[] = [];
    outer._eventHandlers.onMouseDownCapture = (e) => {
      events.push("capture");
      e.preventDefault();
      expect(e.defaultPrevented).toBe(true);
    };
    inner._eventHandlers.onMouseDownCapture = () => events.push("inner-capture");
    inner._eventHandlers.onMouseDown = () => events.push("down");
    inner._eventHandlers.onMouseUp = () => events.push("up");
    inner._eventHandlers.onClick = () => events.push("click");
    inner._eventHandlers.onDrag = () => events.push("drag");
    const ptr = createPointerDispatcher(root, createFocusManager(root));
    ptr.dispatch("mousedown", 30, 30);
    ptr.dispatch("mousemove", 35, 35);
    ptr.dispatch("mouseup", 30, 30);
    expect(events).toEqual(["capture"]);
  });

  it("a swallowed press does not move keyboard focus to the target", () => {
    const { root, outer, inner } = nestedTree();
    inner._eventHandlers.tabIndex = 0;
    outer._eventHandlers.onMouseDownCapture = (e) => e.preventDefault();
    const focus = createFocusManager(root);
    const ptr = createPointerDispatcher(root, focus);
    ptr.dispatch("mousedown", 30, 30);
    expect(focus.focused).toBe(null);
  });

  it("a press inside a focus scope activates that scope even when swallowed", () => {
    const { root, outer, inner } = nestedTree();
    outer.props.focusScope = true;
    outer._eventHandlers.onMouseDownCapture = (e) => e.preventDefault();
    inner._eventHandlers.onClick = () => {};
    const focus = createFocusManager(root);
    const ptr = createPointerDispatcher(root, focus);
    ptr.dispatch("mousedown", 30, 30);
    expect(focus.getActiveScope()).toBe(outer);
  });

  it("a node with only a capture handler is still a hit target", () => {
    const { root, outer } = nestedTree();
    outer._eventHandlers.onMouseDownCapture = () => {};
    expect(hitTest(root, 30, 30)).toBe(outer);
  });
});

describe("scroll bubbling", () => {
  it("delivers wheel to the nearest ancestor with onScroll", () => {
    const { root, outer, inner } = nestedTree();
    const deltas: number[] = [];
    inner._eventHandlers.onClick = () => {};
    outer._eventHandlers.onScroll = (dy) => deltas.push(dy);
    const ptr = createPointerDispatcher(root, createFocusManager(root));
    expect(ptr.dispatch("scroll", 30, 30, { deltaY: 16 })).toBe(true);
    expect(deltas).toEqual([16]);
  });

  it("wheels an overflow:scroll pane that has no onScroll", () => {
    const root = createNode("_root");
    root.style = { width: 80, height: 80 };
    const pane = createNode("box");
    pane.style = { overflow: "scroll", width: 80, height: 40 };
    const content = createNode("box");
    content.style = { width: 80, height: 100 };
    pane.children = [content];
    content.parent = pane;
    root.children = [pane];
    pane.parent = root;
    computeLayout(root, 80, 80, noMeasure);

    const ptr = createPointerDispatcher(root, createFocusManager(root));
    expect(ptr.dispatch("scroll", 20, 20, { deltaY: 16 })).toBe(true);
    expect(pane._scrollOffset).toBe(16);
    expect(ptr.dispatch("scroll", 20, 20, { deltaY: 200 })).toBe(true);
    expect(pane._scrollOffset).toBe(60);
    expect(ptr.dispatch("scroll", 20, 20, { deltaY: 16 })).toBe(false);
    expect(pane._scrollOffset).toBe(60);
  });

  it("does not dirty layout when an overflow pane scrolls", () => {
    const root = createNode("_root");
    root.style = { width: 80, height: 80 };
    const pane = createNode("box");
    pane.style = { overflow: "scroll", width: 80, height: 40 };
    const content = createNode("box");
    content.style = { width: 80, height: 100 };
    pane.children = [content];
    content.parent = pane;
    root.children = [pane];
    pane.parent = root;
    computeLayout(root, 80, 80, noMeasure);
    expect(root._dirty).toBe(false);

    const ptr = createPointerDispatcher(root, createFocusManager(root));
    ptr.dispatch("scroll", 20, 20, { deltaY: 16 });
    expect(pane._scrollOffset).toBe(16);
    expect(root._dirty).toBe(false);
    expect(content.layout.y).toBe(0);
  });

  it("returns false when nothing claims the wheel", () => {
    const root = createNode("_root");
    root.style = { width: 80, height: 80 };
    computeLayout(root, 80, 80, noMeasure);
    const ptr = createPointerDispatcher(root, createFocusManager(root));
    expect(ptr.dispatch("scroll", 10, 10, { deltaY: 16 })).toBe(false);
    expect(ptr.dispatch("mousemove", 10, 10)).toBe(false);
    expect(ptr.dispatch("mousedown", 10, 10)).toBe(false);
  });

  it("walks to an ancestor that can still move", () => {
    const root = createNode("_root");
    root.style = { width: 80, height: 80 };
    const outer = createNode("box");
    outer.style = { overflow: "scroll", width: 80, height: 40 };
    const inner = createNode("box");
    inner.style = { overflow: "scroll", width: 80, height: 80 };
    const content = createNode("box");
    content.style = { width: 80, height: 160 };
    inner.children = [content];
    content.parent = inner;
    outer.children = [inner];
    inner.parent = outer;
    root.children = [outer];
    outer.parent = root;
    computeLayout(root, 80, 80, noMeasure);

    const ptr = createPointerDispatcher(root, createFocusManager(root));
    expect(ptr.dispatch("scroll", 20, 10, { deltaY: 200 })).toBe(true);
    expect(inner._scrollOffset).toBeGreaterThan(0);
    const innerMax = inner._scrollOffset;
    expect(ptr.dispatch("scroll", 20, 10, { deltaY: 16 })).toBe(true);
    expect(inner._scrollOffset).toBe(innerMax);
    expect(outer._scrollOffset).toBeGreaterThan(0);
  });

  it("returns false when a scroll handler throws", () => {
    const { root, outer } = nestedTree();
    const errors: unknown[] = [];
    outer._eventHandlers.onScroll = () => {
      throw new Error("boom");
    };
    const ptr = createPointerDispatcher(root, createFocusManager(root), (error) => {
      errors.push(error);
    });
    expect(ptr.dispatch("scroll", 30, 30, { deltaY: 16 })).toBe(false);
    expect(errors).toHaveLength(1);
  });

  it("leaves an owned pane's offset to its owner", () => {
    const root = createNode("_root");
    root.style = { width: 80, height: 80 };
    const pane = createNode("box");
    pane.style = { overflow: "scroll", width: 80, height: 40 };
    const wrapper = createNode("box");
    wrapper.style = { width: 80, height: 40 };
    pane.children = [wrapper];
    wrapper.parent = pane;
    root.children = [pane];
    pane.parent = root;
    computeLayout(root, 80, 80, noMeasure);
    const deltas: number[] = [];
    pane._eventHandlers.onScroll = (dy: number) => deltas.push(dy);
    setNodeProperty(pane, "scrollOffset", 30);

    const ptr = createPointerDispatcher(root, createFocusManager(root));
    expect(ptr.dispatch("scroll", 20, 20, { deltaY: 16 })).toBe(true);
    expect(deltas).toEqual([16]);
    expect(pane._scrollOffset).toBe(30);
  });

  it("resets overflow scroll when scrollKey changes", () => {
    const pane = createNode("box");
    pane.style = { overflow: "scroll" };
    pane._scrollOffset = 40;
    setNodeProperty(pane, "scrollKey", "/docs/fonts");
    expect(pane._scrollOffset).toBe(0);
    pane._scrollOffset = 40;
    setNodeProperty(pane, "scrollKey", "/docs/fonts");
    expect(pane._scrollOffset).toBe(40);
    setNodeProperty(pane, "scrollKey", "/docs");
    expect(pane._scrollOffset).toBe(0);
  });
});

function scrollTree() {
  const root = createNode("_root");
  root.style = { width: 80, height: 80 };
  const pane = createNode("box");
  pane.style = { overflow: "scroll", width: 80, height: 40 };
  const content = createNode("box");
  content.style = { width: 80, height: 100 };
  content._eventHandlers = {};
  pane.children = [content];
  content.parent = pane;
  root.children = [pane];
  pane.parent = root;
  computeLayout(root, 80, 80, noMeasure);
  return { root, pane, content };
}

describe("touch pan", () => {
  it("scrolls an overflow pane after slop", () => {
    const { root, pane } = scrollTree();
    const ptr = createPointerDispatcher(root, createFocusManager(root));
    ptr.dispatch("mousedown", 20, 20, { kind: "touch" });
    ptr.dispatch("mousemove", 20, 20 - (TOUCH_SLOP + 4), { kind: "touch" });
    expect(pane._scrollOffset).toBe(TOUCH_SLOP + 4);
  });

  it("does not scroll a mouse drag", () => {
    const { root, pane, content } = scrollTree();
    content._eventHandlers.onMouseDown = () => {};
    const ptr = createPointerDispatcher(root, createFocusManager(root));
    ptr.dispatch("mousedown", 20, 20);
    ptr.dispatch("mousemove", 20, 8);
    expect(pane._scrollOffset).toBe(0);
  });

  it("does not click after a pan", () => {
    const { root, content } = scrollTree();
    let clicked = 0;
    let left = 0;
    content._eventHandlers.onClick = () => {
      clicked++;
    };
    content._eventHandlers.onMouseDown = () => {};
    content._eventHandlers.onMouseLeave = () => {
      left++;
    };
    const ptr = createPointerDispatcher(root, createFocusManager(root));
    ptr.dispatch("mousedown", 20, 20, { kind: "touch" });
    ptr.dispatch("mousemove", 20, 6, { kind: "touch" });
    ptr.dispatch("mouseup", 20, 6, { kind: "touch" });
    expect(clicked).toBe(0);
    expect(left).toBe(1);
  });

  it("still clicks a tap that stays inside slop", () => {
    const { root, content } = scrollTree();
    let clicked = 0;
    content._eventHandlers.onClick = () => {
      clicked++;
    };
    content._eventHandlers.onMouseDown = () => {};
    const ptr = createPointerDispatcher(root, createFocusManager(root));
    ptr.dispatch("mousedown", 20, 20, { kind: "touch" });
    ptr.dispatch("mousemove", 20, 18, { kind: "touch" });
    ptr.dispatch("mouseup", 20, 18, { kind: "touch" });
    expect(clicked).toBe(1);
  });

  it("lets a horizontal drag reach onDrag", () => {
    const { root, pane, content } = scrollTree();
    const drags: number[] = [];
    content._eventHandlers.onMouseDown = () => {};
    content._eventHandlers.onDrag = (lx) => {
      drags.push(lx);
    };
    const ptr = createPointerDispatcher(root, createFocusManager(root));
    ptr.dispatch("mousedown", 20, 20, { kind: "touch" });
    ptr.dispatch("mousemove", 20 + TOUCH_SLOP + 6, 22, { kind: "touch" });
    expect(pane._scrollOffset).toBe(0);
    expect(drags.length).toBeGreaterThan(0);
  });

  it("does not click a cancelled press", () => {
    const { root, content } = scrollTree();
    let clicked = 0;
    content._eventHandlers.onClick = () => {
      clicked++;
    };
    content._eventHandlers.onMouseDown = () => {};
    content._eventHandlers.onMouseUp = () => {
      clicked++;
    };
    const ptr = createPointerDispatcher(root, createFocusManager(root));
    ptr.dispatch("mousedown", 20, 20, { kind: "touch" });
    ptr.dispatch("mouseup", 20, 20, { kind: "touch", cancel: true });
    expect(clicked).toBe(0);
  });
});

function fakeClock(): PointerScheduler & { advance(ms: number): void } {
  let now = 0;
  const frames: Array<(t: number) => void> = [];
  return {
    now: () => now,
    requestFrame(cb) {
      frames.push(cb);
      return frames.length;
    },
    cancelFrame() {
      frames.length = 0;
    },
    advance(ms) {
      now += ms;
      const batch = frames.splice(0);
      for (const cb of batch) cb(now);
    },
  };
}

describe("touch flick", () => {
  it("coasts after a fast vertical pan", () => {
    const { root, pane } = scrollTree();
    const clock = fakeClock();
    const ptr = createPointerDispatcher(root, createFocusManager(root), undefined, clock);
    ptr.dispatch("mousedown", 20, 30, { kind: "touch" });
    clock.advance(16);
    ptr.dispatch("mousemove", 20, 14, { kind: "touch" });
    const dragged = pane._scrollOffset;
    expect(dragged).toBeGreaterThan(0);
    ptr.dispatch("mouseup", 20, 14, { kind: "touch" });
    clock.advance(16);
    expect(pane._scrollOffset).toBeGreaterThan(dragged);
    expect(Number.isInteger(pane._scrollOffset)).toBe(true);
    ptr.stopFlick();
  });

  it("does not coast when the finger pauses", () => {
    const { root, pane } = scrollTree();
    const clock = fakeClock();
    const ptr = createPointerDispatcher(root, createFocusManager(root), undefined, clock);
    ptr.dispatch("mousedown", 20, 30, { kind: "touch" });
    clock.advance(16);
    ptr.dispatch("mousemove", 20, 14, { kind: "touch" });
    const dragged = pane._scrollOffset;
    clock.advance(120);
    ptr.dispatch("mouseup", 20, 14, { kind: "touch" });
    clock.advance(16);
    expect(pane._scrollOffset).toBe(dragged);
  });

  it("cancels a coast on the next press", () => {
    const { root, pane } = scrollTree();
    const clock = fakeClock();
    const ptr = createPointerDispatcher(root, createFocusManager(root), undefined, clock);
    ptr.dispatch("mousedown", 20, 30, { kind: "touch" });
    clock.advance(16);
    ptr.dispatch("mousemove", 20, 14, { kind: "touch" });
    ptr.dispatch("mouseup", 20, 14, { kind: "touch" });
    ptr.dispatch("mousedown", 20, 14, { kind: "touch" });
    const held = pane._scrollOffset;
    clock.advance(16);
    expect(pane._scrollOffset).toBe(held);
    ptr.stopFlick();
  });
});

describe("createDoubleClickTracker", () => {
  it("marks the second close down as a double, then starts a new pair", () => {
    const clicks = createDoubleClickTracker({ ms: 500, dist: 4 });
    expect(clicks.down(10, 10, 0)).toBe(false);
    expect(clicks.down(11, 10, 100)).toBe(true);
    expect(clicks.down(10, 10, 150)).toBe(false);
    expect(clicks.down(10, 10, 200)).toBe(true);
  });

  it("does not count a far or slow second down as a double", () => {
    const clicks = createDoubleClickTracker({ ms: 500, dist: 4 });
    expect(clicks.down(10, 10, 0)).toBe(false);
    expect(clicks.down(20, 10, 100)).toBe(false);
    expect(clicks.down(20, 10, 700)).toBe(false);
  });
});

describe("onMouseMove", () => {
  it("tracks an unpressed pointer and yields to onDrag during a press", () => {
    const { root, a } = tree();
    const events: string[] = [];
    a._eventHandlers.onMouseMove = (x, y) => events.push(`move ${x},${y}`);
    a._eventHandlers.onDrag = (x, y) => events.push(`drag ${x},${y}`);
    const ptr = createPointerDispatcher(root, createFocusManager(root));
    ptr.dispatch("mousemove", 5, 6);
    ptr.dispatch("mousedown", 5, 6);
    ptr.dispatch("mousemove", 7, 8);
    ptr.dispatch("mouseup", 7, 8);
    ptr.dispatch("mousemove", 9, 9);
    expect(events).toEqual(["move 5,6", "drag 7,8", "move 9,9"]);
  });
});
