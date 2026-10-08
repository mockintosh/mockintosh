import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "@mockintosh/sdk";
import type { InspectionNode } from "@mockintosh/ui";
import { bootOS, type BootedOS } from "./boot";
import { createHeadlessPlatform, type HeadlessPlatform } from "../platform/headless";
import type { SignInPollResult, SignInRelay, SignInStartRequest } from "../platform/types";
import { registerApp } from "./apps";
import { getWindows } from "./state";
import { authorizeHost } from "./signIn";

const AUTHORIZE = "https://accounts.example.com/authorize?response_type=code&client_id=abc";

function scriptedRelay() {
  const answers: SignInPollResult[] = [];
  const started: SignInStartRequest[] = [];
  const relay: SignInRelay = {
    redirectUri: "https://mac.example/api/oauth/callback",
    async start(request) {
      started.push(request);
      return {
        link: "https://mac.example/api/oauth/pair?id=abc",
        browserLink: `${request.url}&state=abc`,
        expiresInMs: 60_000,
        pollIntervalMs: 1000,
        poll: async () => answers.shift() ?? { status: "pending" },
      };
    },
  };
  return { relay, answers, started };
}

const sheets = () => getWindows().filter((w) => w.appId === "__signin__");

describe("authorizeHost", () => {
  it("reads the host of https URLs only", () => {
    expect(authorizeHost("https://Accounts.Spotify.com/authorize?x=1")).toBe("accounts.spotify.com");
    expect(authorizeHost("https://auth.example:8443")).toBe("auth.example:8443");
    expect(authorizeHost("http://accounts.spotify.com/authorize")).toBeNull();
    expect(authorizeHost("https://user@evil.example/")).toBeNull();
  });
});

describe("useApp().signIn", () => {
  let platform: HeadlessPlatform;
  let os: BootedOS;
  let script: ReturnType<typeof scriptedRelay>;
  let app: AppContext;
  let opened: string[];

  beforeEach(async () => {
    vi.useFakeTimers();
    script = scriptedRelay();
    opened = [];
    const browser = {
      openExternal: async (url: string) => void opened.push(url),
      authorize: async () => ({}),
      loadScript: async () => undefined,
    };
    platform = createHeadlessPlatform({ width: 512, height: 342, signInRelay: script.relay, browser });
    os = await bootOS(platform);
    vi.advanceTimersByTime(1000);
    platform.tick();
    registerApp({
      id: "test-sign-in",
      title: "Player",
      icon: "icon/computer",
      requires: ["sign-in"],
      signIn: { hosts: ["accounts.example.com"] },
      defaultSize: { width: 100, height: 60 },
      Component: () => null,
      onOpen(context) {
        app = context;
        context.openWindow();
      },
    });
    os.services.openApp("test-sign-in");
    platform.tick();
  });

  afterEach(() => {
    os.shutdown();
    vi.useRealTimers();
  });

  async function settle(ms = 0): Promise<void> {
    platform.tick();
    await vi.advanceTimersByTimeAsync(ms);
    platform.tick();
  }

  it("exposes the relay's redirect URI and the capability", () => {
    expect(os.services.capabilities.has("sign-in")).toBe(true);
    expect(app.signIn?.redirectUri).toBe("https://mac.example/api/oauth/callback");
  });

  it("refuses hosts the app did not declare", async () => {
    await expect(app.signIn!.authorize("https://evil.example/authorize")).rejects.toThrow(/not declared/);
    expect(sheets()).toHaveLength(0);
  });

  it("shows the sheet, pairs with the app's URL, and resolves with the provider's answer", async () => {
    const result = app.signIn!.authorize(AUTHORIZE);
    await settle();
    expect(sheets()).toHaveLength(1);
    expect(script.started).toEqual([{ url: AUTHORIZE, appTitle: "Player" }]);

    await settle(1000);
    expect(sheets()).toHaveLength(1);

    script.answers.push({ status: "complete", params: { code: "the-code" } });
    await settle(1000);
    await expect(result).resolves.toEqual({ code: "the-code" });
    expect(sheets()).toHaveLength(0);
  });

  it("offers this computer's browser instead of the phone, for the same pairing", async () => {
    const result = app.signIn!.authorize(AUTHORIZE);
    await settle();
    const nodes = (await os.kernel.invoke(os.kernel.createSession(), "inspect", {})) as InspectionNode[];
    const link = nodes.find((node) => node.name === "sign-in-browser");
    expect(link?.text).toBe("Or sign in with this computer's browser");
    const { x, y, width, height } = link!.bounds;
    platform.click(x + Math.floor(width / 2), y + Math.floor(height / 2));
    await settle();
    expect(opened).toEqual([`${AUTHORIZE}&state=abc`]);

    // The sheet keeps polling, so finishing in the browser answers it.
    script.answers.push({ status: "complete", params: { code: "the-code" } });
    await settle(1000);
    await expect(result).resolves.toEqual({ code: "the-code" });
  });

  it("rejects with the provider's error, and treats a denial as a cancel", async () => {
    const failed = app.signIn!.authorize(AUTHORIZE).catch((error: Error) => error);
    await settle();
    script.answers.push({ status: "complete", params: { error: "server_error", error_description: "Try later" } });
    await settle(1000);
    expect(await failed).toEqual(new Error("Try later"));

    const denied = app.signIn!.authorize(AUTHORIZE);
    await settle();
    script.answers.push({ status: "complete", params: { error: "access_denied" } });
    await settle(1000);
    await expect(denied).resolves.toBeNull();
  });

  it("resolves null when the sheet is closed or the app quits", async () => {
    const closed = app.signIn!.authorize(AUTHORIZE);
    await settle();
    os.services.closeWindow(sheets()[0].id);
    await settle();
    await expect(closed).resolves.toBeNull();

    const quit = app.signIn!.authorize(AUTHORIZE);
    await settle();
    app.quit();
    await settle();
    await expect(quit).resolves.toBeNull();
    expect(sheets()).toHaveLength(0);
  });
});
