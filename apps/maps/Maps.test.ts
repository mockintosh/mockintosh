/**
 * Maps' File › Print… on a headless Macintosh with a fake printer, the way
 * Preview's is tested: the Print dialog opens, and Print sends the map to
 * the printer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrinterTransport } from "@mockintosh/print";
import type { InspectionNode } from "@mockintosh/ui";
import { bootOS, type BootedOS } from "@/src/os/boot";
import { registerApp } from "@/src/os/apps";
import { createHeadlessPlatform, type HeadlessPlatform } from "@/src/platform/headless";
import Maps from "../Maps";

interface FakePrinter extends PrinterTransport {
  writes: Uint8Array[];
}

function fakePrinter(): FakePrinter {
  let connected = false;
  const writes: Uint8Array[] = [];
  return {
    writes,
    get connected() {
      return connected;
    },
    get deviceName() {
      return connected ? "Fake Printer" : null;
    },
    async connect() {
      connected = true;
    },
    async choose() {
      connected = true;
    },
    async forget() {
      connected = false;
    },
    async write(bytes) {
      writes.push(bytes);
    },
    async disconnect() {
      connected = false;
    },
  };
}

describe("Maps › Print…", () => {
  let platform: HeadlessPlatform;
  let printer: FakePrinter;
  let os: BootedOS;

  beforeEach(async () => {
    vi.useFakeTimers();
    platform = createHeadlessPlatform({ width: 640, height: 480 });
    printer = fakePrinter();
    platform.printer = printer;
    // No tiles: the map is as blank as it is before the first one arrives.
    platform.fetch = async () => {
      throw new Error("offline");
    };
    os = await bootOS(platform);
    vi.advanceTimersByTime(1000);
    platform.tick();
    registerApp(Maps);
    os.services.openApp("maps");
    await settle();
  });

  afterEach(() => {
    os.shutdown();
    vi.useRealTimers();
  });

  async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) {
      platform.tick();
      await vi.advanceTimersByTimeAsync(50);
    }
    platform.tick();
  }

  /** Every byte sent to the printer since the last call. */
  function printed(): number[] {
    const bytes = printer.writes.flatMap((w) => Array.from(w));
    printer.writes.length = 0;
    return bytes;
  }

  const session = () => os.kernel.createSession();

  async function nodes(): Promise<InspectionNode[]> {
    return (await os.kernel.invoke(session(), "inspect", {})) as InspectionNode[];
  }

  async function node(name: string): Promise<InspectionNode | undefined> {
    return (await nodes()).find((n) => n.name === name);
  }

  /** A real mouse click at the middle of the node, as a user would make it. */
  async function click(name: string): Promise<void> {
    const target = await node(name);
    expect(target, name).toBeDefined();
    const { x, y, width, height } = target!.bounds;
    platform.click(x + Math.floor(width / 2), y + Math.floor(height / 2));
    await settle();
  }

  async function choosePrint(): Promise<void> {
    await os.kernel.invoke(session(), "menu", { menu: "File", item: "Print…" });
    await settle();
  }

  it("opens the Print dialog for the map and prints it", async () => {
    await choosePrint();
    expect(await node("print"), "the Print dialog opened").toBeDefined();
    expect(printer.writes).toHaveLength(0);

    await click("print");
    await vi.advanceTimersByTimeAsync(2000);

    expect(await node("print")).toBeUndefined();
    expect(printed().length).toBeGreaterThan(0);
  });

  it("prints nothing when cancelled", async () => {
    await choosePrint();
    await click("cancel");
    await vi.advanceTimersByTimeAsync(2000);
    expect(await node("print")).toBeUndefined();
    expect(printer.writes).toHaveLength(0);
  });
});
