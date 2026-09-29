import { describe, it, expect } from "vitest";
import { computeLayout, type MeasureFunc } from "../src/layout";
import { notifyLayoutChanges } from "../src/layoutObserver";
import { createNode, markDirty, type CanvasNode, type LayoutSize } from "../src/nodes";

const noMeasure: MeasureFunc = () => ({ width: 0, height: 0 });

function tree(childHeight: number): { root: CanvasNode; content: CanvasNode; child: CanvasNode; sizes: LayoutSize[] } {
  const root = createNode("_root");
  const content = createNode("box");
  const child = createNode("box");
  const sizes: LayoutSize[] = [];
  content.style = { width: 100, flexDirection: "column" };
  content.props["onLayout"] = (size: LayoutSize) => sizes.push(size);
  child.style = { height: childHeight };
  child.parent = content;
  content.children.push(child);
  content.parent = root;
  root.children.push(content);
  return { root, content, child, sizes };
}

const microtask = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe("notifyLayoutChanges", () => {
  it("reports the first layout, then only size changes, after a microtask", async () => {
    const { root, child, sizes } = tree(40);
    computeLayout(root, 200, 100, noMeasure);
    notifyLayoutChanges(root);
    expect(sizes).toEqual([]);
    await microtask();
    expect(sizes).toEqual([{ x: 0, y: 0, width: 100, height: 40 }]);

    markDirty(child);
    computeLayout(root, 200, 100, noMeasure);
    notifyLayoutChanges(root);
    await microtask();
    expect(sizes).toHaveLength(1);

    child.style.height = 300;
    markDirty(child);
    computeLayout(root, 200, 100, noMeasure);
    notifyLayoutChanges(root);
    await microtask();
    expect(sizes).toEqual([
      { x: 0, y: 0, width: 100, height: 40 },
      { x: 0, y: 0, width: 100, height: 300 },
    ]);
  });
});
