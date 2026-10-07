import * as schemas from "./schema";
import { ServiceError } from "./errors";
import { hitTest, type UIInstance, type InspectionNode } from "@mockintosh/ui";
import type { PlatformKeyEvent, PlatformPointerEvent } from "../../platform/types";
import type { OSServices } from "../context";
import { getAllApps, getApp } from "../apps";
import { getWindows, getActiveWindowId, bringToFront } from "../state";
import { hasModalFront, isBlockedByModal } from "../layering";
import { missingCapabilities } from "../capabilities";
import { menus, runNamedMenu } from "./menus";
import { Kernel, defineOperation } from "./index";
import { Cancellation } from "./cancellation";
export interface UIHost {
  ui: UIInstance;
  beginGesture(): void;
  pointer(event: PlatformPointerEvent): void;
  key(event: PlatformKeyEvent): void;
  render(cancellation: Cancellation): Promise<void>;
  capture(): {
    width: number;
    height: number;
    rowBytes: number;
    bytes: number[];
  };
}
export function registerUIOperations(kernel: Kernel, os: OSServices, host: UIHost) {
  let queue: Promise<unknown> = Promise.resolve();
  const serialize = <T>(fn: () => Promise<T>, token: Cancellation) => {
    const run = queue.then(() => {
      token.check();
      return fn();
    });
    queue = run.catch(() => { });
    return run;
  };
  const add: typeof defineOperation = (name, description, properties, required, resultSchema, handler) => {
    const operation = defineOperation(name, description, properties, required, resultSchema,
      (args, execution) => serialize(() => handler(args, execution), execution.cancellation));
    kernel.register(operation);
    return operation;
  };
  const targetProperties = {
    id: schemas.integer,
    name: {
      type: "string"
    },
    window: {
      type: "string"
    }
  } as const;
  function target(args: Record<string, unknown>, action: string): InspectionNode {
    if (args.id === undefined && args.name === undefined) throw new ServiceError("invalid-argument", "Provide a node id or name");
    const matches = host.ui.inspect().filter(n => (args.id === undefined || n.id === args.id) && (args.name === undefined || n.name === args.name) && (args.window === undefined || n.windowId === args.window));
    if (!matches.length) throw new ServiceError("stale-reference", "UI target is no longer present");
    if (matches.length !== 1) throw new ServiceError("ambiguity", "Multiple controls match; specify a window or id");
    const node = matches[0];
    if (!node.enabled || !node.bounds.width || !node.bounds.height) throw new ServiceError("permission", "UI target is disabled, blocked, or clipped");
    if (node.windowId && node.windowId !== getActiveWindowId()) throw new ServiceError("permission", "Activate this window before interacting");
    if (!node.windowId && hasModalFront(getWindows())) throw new ServiceError("permission", "A modal window blocks the desktop");
    if (!node.actions.includes(action)) throw new ServiceError("unsupported-operation", `Target does not support ${action}`);
    const {
      x,
      y,
      width,
      height
    } = node.bounds;
    const hit = hitTest(host.ui.root, x + Math.floor(width / 2), y + Math.floor(height / 2));
    if (hit?.id !== node.id) throw new ServiceError("permission", "Target is occluded at its action point");
    return node;
  }
  add("apps", "List registered apps", {}, [], schemas.array(schemas.object({ id: schemas.string, title: schemas.string })), async () => getAllApps().map(a => ({
    id: a.id,
    title: a.title
  })));
  add("open", "Open an app", {
    app: {
      type: "string"
    }
  }, ["app"], schemas.object({ opened: schemas.string }), async (a, e) => {
    const t = e.cancellation;
    if (!getApp(a.app)) throw new ServiceError("missing-resource", "App is not registered");
    if (missingCapabilities(getApp(a.app)!.requires, os.capabilities).length) throw new ServiceError("unsupported-operation", "App requires unavailable host capabilities");
    os.openApp(a.app);
    await host.render(t);
    return {
      opened: a.app
    };
  });
  add("windows", "List visible windows", {}, [], schemas.array(schemas.object({ id: schemas.string, app: schemas.string, title: schemas.string, active: schemas.boolean }, ["id", "title", "active"])), async () => getWindows().map(w => ({
    id: w.id,
    app: w.appId,
    title: w.title,
    active: w.id === getActiveWindowId()
  })));
  add("activate", "Explicitly activate a window", {
    window: {
      type: "string"
    }
  }, ["window"], schemas.object({ active: schemas.string }), async (a, e) => {
    const t = e.cancellation;
    const win = getWindows().find(w => w.id === a.window);
    if (!win) throw new ServiceError("stale-reference", "Window no longer exists");
    if (isBlockedByModal(win, getWindows())) throw new ServiceError("permission", "Window is blocked by a modal");
    bringToFront(win.id);
    await host.render(t);
    return {
      active: win.id
    };
  });
  add("inspect", "Inspect immutable UI nodes", {
    window: {
      type: "string"
    }
  }, [], schemas.inspection, async (a, e) => {
    const t = e.cancellation;
    await host.render(t);
    return host.ui.inspect().filter(n => a.window === undefined || n.windowId === a.window);
  });
  for (const action of ["click", "dblclick", "drag"] as const) add(action, `Inject a ${action} through human pointer dispatch`, {
    ...targetProperties,
    ...(action === "drag" ? {
      x: {
        type: "number"
      },
      y: {
        type: "number"
      }
    } : {})
  }, action === "drag" ? ["x", "y"] : [], schemas.object({ id: schemas.integer }), async (a, e) => {
    const t = e.cancellation;
    await host.render(t);
    const node = target(a, action === "dblclick" ? "double-click" : action);
    let x = node.bounds.x + Math.floor(node.bounds.width / 2),
      y = node.bounds.y + Math.floor(node.bounds.height / 2);
    host.beginGesture();
    host.pointer({
      type: "move",
      x,
      y
    });
    try {
      host.pointer({
        type: "down",
        x,
        y
      });
      if (action === "drag") {
        t.check();
        // The schema requires x and y for drag.
        x = a.x as number;
        y = a.y as number;
        host.pointer({
          type: "move",
          x,
          y
        });
      }
      if (action === "dblclick") {
        host.pointer({
          type: "up",
          x,
          y
        });
        t.check();
        target(a, "double-click");
        host.pointer({
          type: "down",
          x,
          y
        });
      }
    } finally {
      host.pointer({
        type: "up",
        x,
        y
      });
    }
    await host.render(t);
    return {
      id: node.id
    };
  });
  add("type", "Type into the focused named field", {
    ...targetProperties,
    text: {
      type: "string"
    }
  }, ["text"], schemas.object({ typed: schemas.integer }), async (a, e) => {
    const t = e.cancellation;
    await host.render(t);
    const node = target(a, "type");
    if (!node.focused) throw new ServiceError("permission", "Click the field before typing");
    let characters = 0;
    for (const key of a.text) {
      if (++characters % 64 === 0) await t.delay(0); else await Promise.resolve();
      t.check();
      if (!target({
        id: node.id
      }, "type").focused) throw new ServiceError("permission", "Field lost focus");
      host.key({
        type: "down",
        key,
        modifiers: {
          shift: false,
          alt: false,
          ctrl: false,
          meta: false
        }
      });
      host.key({
        type: "up",
        key,
        modifiers: {
          shift: false,
          alt: false,
          ctrl: false,
          meta: false
        }
      });
    }
    await host.render(t);
    return {
      typed: a.text.length
    };
  });
  add("pointer", "Dispatch a complete raw pointer gesture", {
    gesture: { type: "string", enum: ["move", "click", "dblclick", "drag", "scroll"] },
    x: {
      type: "number"
    },
    y: {
      type: "number"
    },
    toX: {
      type: "number"
    },
    toY: {
      type: "number"
    },
    deltaY: {
      type: "number"
    }
  }, ["gesture", "x", "y"], schemas.object({ x: schemas.number, y: schemas.number }), async (a, e) => {
    const t = e.cancellation;
    if (!["move", "click", "dblclick", "drag", "scroll"].includes(a.gesture)) throw new ServiceError("invalid-argument", "Unsupported pointer gesture");
    if (a.gesture === "drag" && (typeof a.toX !== "number" || typeof a.toY !== "number")) throw new ServiceError("invalid-argument", "Drag requires toX and toY");
    await host.render(t);
    host.beginGesture();
    let x = a.x,
      y = a.y;
    host.pointer({
      type: "move",
      x,
      y
    });
    if (a.gesture === "scroll") host.pointer({
      type: "scroll",
      x,
      y,
      deltaY: a.deltaY ?? 0
    }); else if (a.gesture !== "move") {
      try {
        host.pointer({
          type: "down",
          x,
          y
        });
        if (a.gesture === "drag") {
          // Checked above: a drag has toX and toY.
          x = a.toX!;
          y = a.toY!;
          host.pointer({
            type: "move",
            x,
            y
          });
        }
        if (a.gesture === "dblclick") {
          host.pointer({
            type: "up",
            x,
            y
          });
          host.pointer({
            type: "down",
            x,
            y
          });
        }
      } finally {
        host.pointer({
          type: "up",
          x,
          y
        });
      }
    }
    await host.render(t);
    return {
      x,
      y
    };
  });
  add("key", "Inject a keyboard key", {
    key: {
      type: "string"
    },
    meta: {
      type: "boolean"
    },
    ctrl: {
      type: "boolean"
    },
    shift: {
      type: "boolean"
    },
    alt: {
      type: "boolean"
    }
  }, ["key"], schemas.object({ key: schemas.string }), async (a, e) => {
    const t = e.cancellation;
    const event: PlatformKeyEvent = {
      type: "down",
      key: a.key,
      modifiers: {
        meta: a.meta === true,
        ctrl: a.ctrl === true,
        shift: a.shift === true,
        alt: a.alt === true
      }
    };
    try {
      host.key(event);
    } finally {
      host.key({
        ...event,
        type: "up"
      });
    }
    await host.render(t);
    return {
      key: a.key
    };
  });
  add("menu", "Inspect menus or run a validated named action", {
    menu: {
      type: "string"
    },
    item: {
      type: "string"
    }
  }, [], schemas.menuResult, async (a, e) => {
    const t = e.cancellation;
    if (a.menu === undefined && a.item === undefined) return menus(os).map(m => ({
      label: m.label,
      items: m.items.map(i => JSON.parse(JSON.stringify(i)))
    }));
    if (typeof a.menu !== "string" || typeof a.item !== "string") throw new ServiceError("invalid-argument", "Provide menu and item");
    runNamedMenu(os, a.menu, a.item);
    await host.render(t);
    return {
      menu: a.menu,
      item: a.item
    };
  });
  add("render", "Wait for layout, painting, and OS animations", {}, [], schemas.object({ idle: { enum: [true] } }), async (_, e) => {
    const t = e.cancellation;
    await host.render(t);
    return {
      idle: true as const
    };
  });
  add("screenshot_save", "Save an idle framebuffer as binary PBM", {
    path: {
      type: "string"
    }
  }, ["path"], schemas.resource, async (a, e) => {
    const t = e.cancellation;
    await host.render(t);
    const frame = host.capture();
    const header = new TextEncoder().encode(`P4\n${frame.width} ${frame.height}\n`);
    const stride = Math.ceil(frame.width / 8),
      body = new Uint8Array(header.length + stride * frame.height);
    body.set(header);
    for (let y = 0; y < frame.height; y++) body.set(frame.bytes.slice(y * frame.rowBytes, y * frame.rowBytes + stride), header.length + y * stride);
    return e.disk.write(a.path, body);
  });
  add("screenshot", "Capture packed one-bit screen pixels after rendering", {}, [], schemas.frame, async (_, e) => {
    const t = e.cancellation;
    await host.render(t);
    return host.capture();
  });
}
