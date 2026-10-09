/**
 * GET /api/apple-music/sign-in — the popup the Apple Music app opens to sign in.
 *
 * Apple has no OAuth redirect for Apple Music: MusicKit's `authorize()` opens
 * authorize.music.apple.com, which hands the Music User Token back through
 * `window.opener`. The desktop page is cross-origin isolated
 * (`Cross-Origin-Opener-Policy: same-origin`), which severs that link, so
 * this page runs MusicKit instead, without isolation, and passes the token
 * back on the same channel the OAuth callback uses (`browser.authorize`).
 * MusicKit also remembers the token in this origin's storage, which the
 * desktop's own MusicKit reads when it configures.
 *
 * The page needs a click of its own: Safari and Chrome only let a gesture
 * open the Apple popup.
 */

const MUSICKIT_URL = "https://js-cdn.music.apple.com/musickit/v3/musickit.js";

const PAGE = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="strict-origin-when-cross-origin">
<title>Sign In to Apple Music</title>
<style>
  body { font: 16px/1.45 -apple-system, system-ui, sans-serif; margin: 3em 1.5em; text-align: center; color: #000; background: #fff; }
  button { font: inherit; font-weight: 600; margin: 1em 0; padding: .6em 1.4em; border: 2px solid #000; border-radius: 10px; background: #fff; color: #000; cursor: pointer; }
  button:disabled { opacity: .4; cursor: default; }
  .small { font-size: 14px; color: #555; }
</style>
</head>
<body>
<p><strong>Mockintosh</strong> wants to play your Apple Music library.</p>
<button id="go" disabled>Sign In with Apple Music</button>
<p id="status" class="small">Loading MusicKit…</p>
<script>
(function () {
  // Inside a function: a global \`status\` would be window.status, a string.
  var go = document.getElementById("go");
  var status = document.getElementById("status");
  var music = null;

  function send(payload) {
    payload.type = "apple-music-callback";
    try {
      var channel = new BroadcastChannel("mockintosh-authorize");
      channel.postMessage(payload);
      channel.close();
    } catch (e) {}
    if (window.opener) window.opener.postMessage(payload, location.origin);
  }

  function fail(message) {
    status.textContent = message;
    go.disabled = true;
  }

  document.addEventListener("musickitloaded", function () {
    fetch("/api/apple-music/token")
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.developerToken) throw new Error(data.error || "No developer token.");
        return MusicKit.configure({ developerToken: data.developerToken, app: { name: "Mockintosh", build: "1.0" } });
      })
      .then(function (instance) {
        music = instance || MusicKit.getInstance();
        go.disabled = false;
        status.textContent = "Apple will ask you to sign in and allow access.";
      })
      .catch(function (e) { fail(e.message || String(e)); });
  });

  go.addEventListener("click", function () {
    go.disabled = true;
    status.textContent = "Waiting for Apple…";
    music.authorize()
      .then(function (token) {
        if (!token) throw new Error("Apple did not send a token.");
        send({ code: token });
        status.textContent = "Signed in. You can close this window.";
        window.close();
      })
      .catch(function (e) {
        go.disabled = false;
        status.textContent = "Sign-in failed: " + (e && (e.errorCode || e.message) || e);
      });
  });
})();
</script>
<script src="${MUSICKIT_URL}" async></script>
</body>
</html>`;

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
  return new Response(PAGE, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      // Keep the opener link MusicKit's popup reports back through (see above).
      "Cross-Origin-Opener-Policy": "unsafe-none",
      "Cross-Origin-Embedder-Policy": "unsafe-none",
    },
  });
}

export const config = { runtime: "edge" };
