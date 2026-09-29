/**
 * Preview's File › Print… on a headless Macintosh with a fake printer: the
 * Print dialog shows the picture's size and sends exactly what
 * `printPicture` would with the orientation and scale chosen in it, or
 * nothing when cancelled.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrinterTransport } from "@mockintosh/print";
import type { InspectionNode } from "@mockintosh/ui";
import { writeSpriteFile } from "@mockintosh/sdk";
import { bootOS, type BootedOS } from "@/src/os/boot";
import { registerApp } from "@/src/os/apps";
import { createHeadlessPlatform, type HeadlessPlatform } from "@/src/platform/headless";
import Preview from "../Preview";

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

const PICTURE = { width: 40, height: 20, data: new Uint8Array(40 * 20).fill(1) };

describe("Preview › Print…", () => {
  let platform: HeadlessPlatform;
  let printer: FakePrinter;
  let os: BootedOS;

  beforeEach(async () => {
    vi.useFakeTimers();
    platform = createHeadlessPlatform({ width: 640, height: 480 });
    printer = fakePrinter();
    platform.printer = printer;
    os = await bootOS(platform);
    vi.advanceTimersByTime(1000);
    platform.tick();
    registerApp(Preview);
    const desktop = os.services.fs.locate("desktop")!;
    const file = await writeSpriteFile(os.services.fs, desktop.id, "Bars", PICTURE);
    os.services.openApp("preview", { fileId: file.id, title: "Bars" });
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

  it("shows the picture's size in pixels and the orientation auto would pick", async () => {
    await choosePrint();
    expect((await nodes()).some((n) => n.text === "40 x 20 pixels")).toBe(true);
    // On its side the picture fills the paper at 28× rather than 14×.
    expect((await node("orientation"))?.value).toBe("landscape");
    expect((await node("scale"))?.value).toBe("auto");
    expect(printer.writes).toHaveLength(0);
  });

  it("prints with the chosen orientation and scale", async () => {
    await choosePrint();
    await click("orientation:portrait");
    await click("scale");
    await click("scale:2");
    expect((await node("scale"))?.value).toBe("2");
    await click("print");
    await vi.advanceTimersByTimeAsync(2000);

    expect(await node("print")).toBeUndefined();
    const fromDialog = printed();

    const print = os.services.printers!;
    await print.printPicture(PICTURE, { scale: 2, orientation: "portrait" });
    const upright2x = printed();
    await print.printPicture(PICTURE);
    const unchosen = printed();

    expect(fromDialog).toEqual(upright2x);
    expect(fromDialog).not.toEqual(unchosen);
  });

  it("prints nothing when cancelled", async () => {
    await choosePrint();
    await click("cancel");
    await vi.advanceTimersByTimeAsync(2000);
    expect(await node("print")).toBeUndefined();
    expect(printer.writes).toHaveLength(0);
  });
});
