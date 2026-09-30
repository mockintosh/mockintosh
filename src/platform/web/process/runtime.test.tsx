import { describe, expect, it } from "vitest";
import { defineApp } from "@mockintosh/sdk";
import { getBit } from "@mockintosh/quickdraw/bits";
import type { HostToProcess, ProcessStart, ProcessToHost } from "../../../os/process/protocol";
import { runProcess, type ProcessScope } from "./runtime";

/** A worker scope that keeps what the process posts and lets the test post to it. */
function fakeScope() {
  const posted: ProcessToHost[] = [];
  const scope: ProcessScope = {
    postMessage: (message) => void posted.push(message),
    onmessage: null,
  };
  const send = (data: HostToProcess) => scope.onmessage!({ data } as MessageEvent<HostToProcess>);
  return { scope, posted, send };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

const START: Omit<ProcessStart, "appId" | "source"> = {
  props: {},
  screen: { width: 512, height: 342 },
  env: { origin: "http://test", config: {} },
  capabilities: [],
  audio: false,
  download: false,
  video: false,
  sprites: {},
};

describe("an app process", () => {
  it("draws each of its windows into its own picture and routes input to the right one", async () => {
    const pressed: string[] = [];
    const app = defineApp<{ name?: string; ink?: 0 | 1 }>({
      id: "two-windows",
      title: "Two Windows",
      icon: "x",
      defaultSize: { width: 24, height: 10 },
      Component: (props) => (
        <box width={24} height={10} background={props.ink ?? 0} onMouseDown={() => pressed.push(props.name ?? "?")} />
      ),
      onOpen(ctx) {
        ctx.openWindow({ props: { name: "black", ink: 1 } });
        ctx.openWindow({ props: { name: "white", ink: 0 } });
      },
    });

    const { scope, posted, send } = fakeScope();
    runProcess(scope, async () => app);
    send({ t: "start", start: { ...START, appId: app.id, source: { kind: "bundled", id: app.id } } });
    await settle();

    const opens = posted.filter((m) => m.t === "call" && m.method === "window.open") as Extract<ProcessToHost, { t: "call" }>[];
    expect(opens).toHaveLength(2);
    expect(posted.some((m) => m.t === "started")).toBe(true);
    const [black, white] = opens.map((m) => m.args[0] as string);

    const state = { width: 24, height: 10, active: false, kind: "document" as const };
    send({ t: "window.attach", key: black!, state: { ...state, active: true } });
    send({ t: "window.attach", key: white!, state });
    await settle();

    const frames = posted.filter((m) => m.t === "frame") as Extract<ProcessToHost, { t: "frame" }>[];
    const latest = (key: string) => frames.filter((f) => f.key === key).at(-1)!;
    const pixel = (key: string, x: number, y: number) => {
      const f = latest(key);
      return getBit({ baseAddr: new Uint8Array(f.buffer), rowBytes: f.rowBytes, bounds: { top: 0, left: 0, bottom: f.height, right: f.width } }, x, y);
    };
    expect(latest(black!).width).toBe(24);
    expect(pixel(black!, 5, 5)).toBe(1);
    expect(pixel(white!, 5, 5)).toBe(0);

    const modifiers = { shift: false, ctrl: false, alt: false, meta: false };
    send({ t: "pointer", key: white!, kind: "mousedown", x: 3, y: 3, modifiers, seq: 1 });
    send({ t: "pointer", key: white!, kind: "mouseup", x: 3, y: 3, modifiers, seq: 2 });
    send({ t: "pointer", key: black!, kind: "mousedown", x: 3, y: 3, modifiers, seq: 3 });
    expect(pressed).toEqual(["white", "black"]);

    send({ t: "stop" });
    expect(posted.at(-1)).toEqual({ t: "stopped" });
  });

  it("reports an app it can't load", async () => {
    const { scope, posted, send } = fakeScope();
    runProcess(scope, async () => undefined);
    send({ t: "start", start: { ...START, appId: "missing", source: { kind: "bundled", id: "missing" } } });
    await settle();
    expect(posted).toEqual([{ t: "failed", error: "No app module for missing" }]);
  });
});
