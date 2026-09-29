/**
 * Focus system unit tests.
 */

import { describe, it, expect, vi } from "vitest";
import { createFocusManager, applyPendingAutoFocus, registerFocusRoot, requestAutoFocus } from "../src/focus";
import { createNode, type CanvasNode } from "../src/nodes";

function makeFocusableNode(tabIndex: number) {
  const node = createNode("box");
  node._eventHandlers.tabIndex = tabIndex;
  return node;
}

const MOD = { shift: false, ctrl: false, alt: false, meta: false };

describe("FocusManager — focus / blur", () => {
  it("focus() sets the focused node", () => {
    const root = createNode("_root");
    const a = makeFocusableNode(0);
    root.children = [a];
    a.parent = root;

    const mgr = createFocusManager(root);
    mgr.focus(a);
    expect(mgr.focused).toBe(a);
  });

  it("blur() clears focused node", () => {
    const root = createNode("_root");
    const a = makeFocusableNode(0);
    root.children = [a];
    a.parent = root;

    const mgr = createFocusManager(root);
    mgr.focus(a);
    mgr.blur();
    expect(mgr.focused).toBeNull();
  });

  it("onFocus fires when focused", () => {
    const root = createNode("_root");
    const a = makeFocusableNode(0);
    const onFocus = vi.fn();
    a._eventHandlers.onFocus = onFocus;
    root.children = [a];
    a.parent = root;

    const mgr = createFocusManager(root);
    mgr.focus(a);
    expect(onFocus).toHaveBeenCalledOnce();
  });

  it("onBlur fires on old node when focus changes", () => {
    const root = createNode("_root");
    const a = makeFocusableNode(0);
    const b = makeFocusableNode(1);
    const onBlur = vi.fn();
    a._eventHandlers.onBlur = onBlur;
    root.children = [a, b];
    a.parent = root;
    b.parent = root;

    const mgr = createFocusManager(root);
    mgr.focus(a);
    mgr.focus(b);
    expect(onBlur).toHaveBeenCalledOnce();
  });
});

describe("FocusManager — Tab navigation", () => {
  it("Tab moves focus to next element in tabIndex order", () => {
    const root = createNode("_root");
    const a = makeFocusableNode(0);
    const b = makeFocusableNode(1);
    root.children = [a, b];
    a.parent = root;
    b.parent = root;

    const mgr = createFocusManager(root);
    mgr.focus(a);
    mgr.dispatchKeyboard("keydown", "Tab", MOD);
    expect(mgr.focused).toBe(b);
  });

  it("Tab wraps around from last to first", () => {
    const root = createNode("_root");
    const a = makeFocusableNode(0);
    const b = makeFocusableNode(1);
    root.children = [a, b];
    a.parent = root;
    b.parent = root;

    const mgr = createFocusManager(root);
    mgr.focus(b);
    mgr.dispatchKeyboard("keydown", "Tab", MOD);
    expect(mgr.focused).toBe(a);
  });

  it("Shift+Tab moves backwards", () => {
    const root = createNode("_root");
    const a = makeFocusableNode(0);
    const b = makeFocusableNode(1);
    root.children = [a, b];
    a.parent = root;
    b.parent = root;

    const mgr = createFocusManager(root);
    mgr.focus(b);
    mgr.dispatchKeyboard("keydown", "Tab", { ...MOD, shift: true });
    expect(mgr.focused).toBe(a);
  });

  it("non-focusable nodes are skipped", () => {
    const root = createNode("_root");
    const a = makeFocusableNode(0);
    const notFocusable = createNode("box"); // no tabIndex
    const b = makeFocusableNode(1);
    root.children = [a, notFocusable, b];
    a.parent = root;
    notFocusable.parent = root;
    b.parent = root;

    const mgr = createFocusManager(root);
    mgr.focus(a);
    mgr.dispatchKeyboard("keydown", "Tab", MOD);
    expect(mgr.focused).toBe(b);
  });
});

describe("FocusManager — keyboard dispatch", () => {
  it("routes keydown to focused element", () => {
    const root = createNode("_root");
    const a = makeFocusableNode(0);
    const handler = vi.fn();
    a._eventHandlers.onKeyDown = handler;
    root.children = [a];
    a.parent = root;

    const mgr = createFocusManager(root);
    mgr.focus(a);
    mgr.dispatchKeyboard("keydown", "Enter", MOD);
    expect(handler).toHaveBeenCalledWith("Enter", MOD);
  });

  it("does not dispatch when no element is focused", () => {
    const root = createNode("_root");
    const a = makeFocusableNode(0);
    const handler = vi.fn();
    a._eventHandlers.onKeyDown = handler;
    root.children = [a];
    a.parent = root;

    const mgr = createFocusManager(root);
    // No focus call
    mgr.dispatchKeyboard("keydown", "Enter", MOD);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("applyPendingAutoFocus", () => {
  function mount(parent: CanvasNode, child: CanvasNode): CanvasNode {
    parent.children.push(child);
    child.parent = parent;
    return child;
  }

  function autoFocused(tabIndex = 0): CanvasNode {
    const node = makeFocusableNode(tabIndex);
    node._eventHandlers.autoFocus = true;
    requestAutoFocus(node);
    return node;
  }

  it("focuses an autoFocus node mounted after the first render, and activates its scope", () => {
    const root = createNode("_root");
    registerFocusRoot(root);
    const mgr = createFocusManager(root);
    applyPendingAutoFocus(root, mgr);
    expect(mgr.focused).toBeNull();

    const win = mount(root, createNode("box"));
    win.props["focusScope"] = true;
    const panel = mount(win, autoFocused());
    applyPendingAutoFocus(root, mgr);
    expect(mgr.focused).toBe(panel);
    expect(mgr.getActiveScope()).toBe(win);
  });

  it("leaves focus alone when a control inside the autoFocus container already has it", () => {
    const root = createNode("_root");
    registerFocusRoot(root);
    const mgr = createFocusManager(root);
    const dialog = autoFocused();
    const field = makeFocusableNode(0);
    mount(root, dialog);
    mount(dialog, field);
    mgr.focus(field);
    applyPendingAutoFocus(root, mgr);
    expect(mgr.focused).toBe(field);
  });

  it("keeps nodes queued for another UI tree and drops ones never mounted", () => {
    const rootA = createNode("_root");
    const rootB = createNode("_root");
    registerFocusRoot(rootA);
    registerFocusRoot(rootB);
    const mgrA = createFocusManager(rootA);
    const mgrB = createFocusManager(rootB);

    const orphan = autoFocused();
    const inB = mount(rootB, autoFocused());
    applyPendingAutoFocus(rootA, mgrA);
    expect(mgrA.focused).toBeNull();

    mount(rootA, orphan);
    applyPendingAutoFocus(rootA, mgrA);
    expect(mgrA.focused).toBeNull();

    applyPendingAutoFocus(rootB, mgrB);
    expect(mgrB.focused).toBe(inB);
  });
});
