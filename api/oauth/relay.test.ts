import { describe, expect, it } from "vitest";
import start from "./start";
import pair from "./pair";
import callback from "./callback";
import poll from "./poll";

const ORIGIN = "https://mac.example";
const AUTHORIZE =
  "https://accounts.example.com/authorize?response_type=code&client_id=abc&code_challenge=xyz" +
  `&redirect_uri=${encodeURIComponent(`${ORIGIN}/api/oauth/callback`)}`;

async function begin(url = AUTHORIZE, appTitle = "Player") {
  const resp = await start(
    new Request(`${ORIGIN}/api/oauth/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, appTitle }),
    })
  );
  return { resp, body: (await resp.json()) as { id: string; poll_token: string; url: string; error?: string } };
}

function pollFor(id: string, token: string) {
  return poll(
    new Request(`${ORIGIN}/api/oauth/poll?id=${id}`, { headers: { Authorization: `Bearer ${token}` } })
  ).then((r) => r.json() as Promise<{ status: string; params?: Record<string, string> }>);
}

describe("OAuth sign-in relay", () => {
  it("carries the provider's code from the phone to the poller, once", async () => {
    const { body } = await begin();
    expect(await pollFor(body.id, body.poll_token)).toEqual({ status: "pending" });

    const page = await pair(new Request(`${ORIGIN}/api/oauth/pair?id=${body.id}`));
    const html = await page.text();
    expect(html).toContain("<strong>Player</strong>");
    expect(html).toContain("<strong>accounts.example.com</strong>");
    const href = /href="([^"]+)"/.exec(html)![1].replace(/&#38;/g, "&");
    expect(new URL(href).searchParams.get("state")).toBe(body.id);
    // The same address, for signing in with the Macintosh's own browser.
    expect(body.url).toBe(href);

    const done = await callback(new Request(`${ORIGIN}/api/oauth/callback?code=secret-code&state=${body.id}`));
    expect(await done.text()).toContain("signed in");

    expect(await pollFor(body.id, body.poll_token)).toEqual({ status: "complete", params: { code: "secret-code" } });
    expect(await pollFor(body.id, body.poll_token)).toEqual({ status: "expired" });
  });

  it("answers only the Macintosh holding the poll token", async () => {
    const { body } = await begin();
    await callback(new Request(`${ORIGIN}/api/oauth/callback?code=c&state=${body.id}`));
    expect(await pollFor(body.id, "A".repeat(22))).toEqual({ status: "expired" });
    expect((await pollFor(body.id, body.poll_token)).status).toBe("complete");
  });

  it("passes provider errors through and accepts only one answer", async () => {
    const { body } = await begin();
    await callback(new Request(`${ORIGIN}/api/oauth/callback?error=access_denied&state=${body.id}`));
    const late = await callback(new Request(`${ORIGIN}/api/oauth/callback?code=c&state=${body.id}`));
    expect(late.status).toBe(410);
    expect(await pollFor(body.id, body.poll_token)).toEqual({ status: "complete", params: { error: "access_denied" } });
  });

  it("refuses sign-in URLs that are not https or do not return to the relay", async () => {
    expect((await begin(AUTHORIZE.replace("https:", "http:"))).resp.status).toBe(400);
    expect((await begin("https://accounts.example.com/authorize?redirect_uri=https%3A%2F%2Fevil.example%2F")).resp.status).toBe(400);
    expect((await begin(AUTHORIZE, "")).resp.status).toBe(400);
  });

  it("escapes the app title on the phone page", async () => {
    const { body } = await begin(AUTHORIZE, "<script>x</script>");
    const html = await (await pair(new Request(`${ORIGIN}/api/oauth/pair?id=${body.id}`))).text();
    expect(html).not.toContain("<script>x");
  });
});
