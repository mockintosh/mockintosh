# Mockintosh Computer Club: accounts and AI credits

Plan, 9 October 2026; revised 11 October 2026 to make the Club a separate service. Phases 1 (accounts), 2 (credits), 3 (the separate service) and 4 (signing in on the Club) are built; GitHub and Google sign-in wait for their OAuth apps. The Club runs at `club.mockintosh.com` (Vercel project `mockintosh-club`, root `sites/club`, connected to the repo), from this branch; mockintosh.com uses it once this branch's OS is deployed there. Everything from phase 4 on is a proposal. The Club's project has the Neon database `mockintosh-club` (us-east-1, next to the functions in `iad1`) as `DATABASE_URL`, the Upstash Redis store for its counters, `BETTER_AUTH_SECRET`, and `RESEND_API_KEY` for `mail.mockintosh.com`; the AI Gateway answers to its own OIDC token. Polar is not set up yet. Companion to the [server infrastructure plan](server-infrastructure-plan.md).

## Context

The Assistant and image generation spend money at the AI Gateway. Before this work the only protection was a shared `API_ACCESS_TOKEN` the browser never sent, so the hosted Assistant answered every message with a 401, and nothing recorded who spent what.

The Mockintosh Computer Club is the answer: people join from the Apple menu, get welcome credits, and buy more; the Assistant charges each reply. Mockintosh itself keeps booting and working without an account (`docs/kernel-plan.md`); only the paid AI needs one.

Mockintosh is open source, and most people running their own copy don't want a database, an email provider and a payment processor. So the Club becomes **a separate service at its own URL** that a Mockintosh is pointed at, or not. The OS needs no secrets; everything that costs money lives in the Club.

## Decisions

- **Name:** "Mockintosh Computer Club", joined from the Apple menu.
- **Accounts:** Better Auth on Neon Postgres; mail through Resend from `mail.mockintosh.com`.
- **Payments:** Polar.sh as merchant of record. Packs of **$10, $20 and $50** (10,000, 20,000 and 50,000 credits), VAT added at checkout rather than included.
- **Prices:** a call costs **2×** what the gateway reports it cost us, in credits of a tenth of a cent, rounded up, at least 1. On a $10 pack bought with a non-US card, Polar's fees (5% + 50¢, +1.5%) take about 12%, which leaves about $3.85 after the AI it buys; that also pays for welcome credits and failed calls.
- **Welcome credits: 500**, once the email is verified, at most 3 per IP address per day. Measured in October 2026: a reply costs about 15–20 credits when the gateway has the Assistant's 17,500-token prompt cached, and about 175 when it doesn't. 500 is roughly 20–30 replies.
- **Overdraft:** a member may have 3 requests in flight; each is charged once it is done.
- **The Club is a separate service** (`club.mockintosh.com`), its own Vercel project from this repo. Copies of Mockintosh run by others may use it, with the member's consent.
- **Sign-in on copies we don't run happens on the Club's own pages**, in a real browser window, never in a form the copy draws.
- **The payment step happens on Polar's own page**, usually on the member's phone via a QR code; everything before and after it is drawn by the Mac.
- **fx** (Terminal's coding agent) is not metered; it keeps using the user's own AI Gateway key.
- **Copies built from this repo use our Club by default** (`CLUB_URL` defaults to `https://club.mockintosh.com`), so the Assistant works out of the box and their users pay us for the AI. Setting `CLUB_URL` to nothing gives `key` mode.
- **Apple sign-in comes later**, next to GitHub and Google, through the same popup; there is a paid Apple developer account for it.

## What's built (phases 1 to 4)

- **The Club service** (`sites/club`, its own workspace with its own dependencies):
  - **Accounts:** `api/_auth.ts` (Better Auth: no passwords; a six-digit code emailed to the member, which also makes a new member; GitHub and Google once `GITHUB_CLIENT_ID`/`_SECRET` and `GOOGLE_CLIENT_ID`/`_SECRET` are set; device codes for connecting a Mac; 30-day sessions, as bearer tokens for Macs and as a cookie on the Club's pages; each session records its `site` and an optional `dailyCap`), `api/auth/[...all].ts` (which names a connecting Mac after the site in its `Origin`), `api/config.ts` (`form` or `connect` for the asking origin, and the providers), `api/_email.ts` (Resend), `api/_db.ts` (Neon pool through Kysely).
  - **The Club's pages:** `/` (`api/account.ts`: sign in or join, credits and the latest changes, the connected Macs with a daily limit and Disconnect, Sign Out) and `/connect` (`api/connect.ts`: sign in, then "foo.example's Mockintosh wants to use your Computer Club credits", the code to compare, Connect or Don't Connect), sharing `api/_pages.ts` (plain HTML forms that post back to the page, same-origin only) and `api/_sessions.ts`.
  - **Credits:** `api/_credits.ts` (balance, ledger, idempotent grants and charges, each charge recording the session that spent it, welcome credits when a member is created with a verified email), `api/_pricing.ts` (cost from the gateway's response, 2×), `api/credits.ts` (balance and latest changes).
  - **Daily caps:** the guard refuses a session that spent its cap in the last 24 hours (`402`, `over_daily_cap`), from the ledger's `session_id`.
  - **The AI:** `api/chat.ts` and `api/generate-image.ts` run the OS's own answering code (the root `api/chat.ts` and `api/generate-image.ts`) behind the shared guard (`api/_guard.ts`, with the Club's hooks in `api/_club.ts`), and charge after each answer.
  - **CORS:** `api/_cors.ts` answers any site, without cookies; preflights are cached a day.
  - **Schema:** `db/migrate.ts` (Better Auth's tables, then `db/migrations/*.sql`), run by `npm run db:migrate`.
  - **Local:** `npm run dev:club` on port 3002 (`scripts/dev.ts`, sharing `scripts/functionServer.ts` with the OS's `dev:api`), on a PGlite database in `sites/club/.dev-db` when `DATABASE_URL` is unset; `vercel.json` (rewrites `/` and `/connect` to their functions) and `public/` for its Vercel project.
- **The OS:** `api/config.ts` names the Club (`src/shared/hostConfig.ts`); the root `api/chat.ts` and `api/generate-image.ts` take only the scripts' token for now (phase 5 adds `key` and `open`).
- **On the Mac:**
  - The web platform asks `/api/config` at boot (`fetchHostConfig`) and has a Club only when it names one.
  - `src/platform/web/club.ts` talks to the Club's URL with the bearer token, kept in the page's `localStorage`, which app processes (workers) can't reach.
  - The Apple menu's "Join Mockintosh Computer Club…" / "Computer Club…", and the Club window (`apps/finder/ComputerClub.tsx`), backed by `os.club` (`src/os/club.ts`). On Mockintosh's own sites it asks for an email and the emailed code; elsewhere "Connect…" shows a code, the Club's page as a QR code for a phone, and a link for this computer's browser, and polls until the member allows it. Signed in: the member card with credits and the latest changes, which follow each app request, and Sign Out.
  - `useApp().club` with capability `club`: `status`, `open`, and `fetch`, which sends a request to the Club with the session, so apps never see it.
  - The Assistant calls the Club through `club.fetch`, and shows its balance and the Join… / Computer Club… alerts.
- **Differences from the design below, for now:**
  - The token lives in `localStorage` rather than a system file.
  - The Assistant's prompt is still built by the Club from its copy of the OS (the Mac doesn't send its own yet).
  - A daily cap is set on the account page after connecting, not on the connect page.
  - GitHub and Google show on the Club's pages, and as "GitHub or Google…" in the Club window (through the connect page), only once their OAuth apps exist: GitHub's callback is `https://club.mockintosh.com/api/auth/callback/github`, Google's `…/callback/google`.
  - The connect page's site name comes from the request's `Origin`. A copy's server can send any `Origin`, so it is a label, not proof; the code shown in both places is what ties the page to the Mac.

## Target architecture: the Club as a separate service

```
any Mockintosh (mockintosh.com, or anyone's copy)        club.mockintosh.com (own Vercel project)
┌──────────────────────────────────────┐                ┌──────────────────────────────────────────────┐
│ static OS + free routes               │   HTTPS,       │ accounts (Better Auth) ─────────── Neon        │
│ (Safari's browse/web-image, relay)    │   CORS,        │ credits, pricing                              │
│ no database, no AI key                │   Bearer ────▶ │ /chat, /generate-image ─────────── AI Gateway  │
│ Club URL from its config              │   token        │ checkout sessions, webhooks ────── Polar       │
└──────────────────────────────────────┘                │ connect, verify, reset, pay pages ─ Resend     │
                                                         └──────────────────────────────────────────────┘
```

### What lives where

- **The OS deployment** keeps only what costs nothing: the static OS, Safari's `/api/browse` and `/api/web-image`, the phone sign-in relay for apps (`/api/oauth/*`) and `/api/github/token`. Its Redis store stays for the relay and Safari's limits.
- **The Club** has everything that costs money or holds personal data: accounts, credits, the AI endpoints, Polar, email, and its own pages. It owns `DATABASE_URL`, `BETTER_AUTH_SECRET`, `RESEND_API_KEY`, the AI Gateway credential, the Polar token and webhook secret, and its own Redis counters.

### How a Mockintosh finds its Club

The OS's `GET /api/config` answers `{ club: "https://club.mockintosh.com" | null, ai: "club" | "key" | "open" }`, from the OS deployment's environment (`CLUB_URL`, defaulting to our Club, and `AI_ACCESS`). One build serves every configuration; nothing is baked in at build time.

- **`club`:** members pay in credits, through the Club at `club`.
- **`key`** (the default when there's no Club): each user brings their own AI Gateway key, set in the Assistant ("Set AI Gateway Key…", kept in its Preferences folder, like Spotify's Client ID). The OS deployment's `/api/chat` forwards the request with that key and keeps nothing; the server needs no secret and no database.
- **`open`:** the OS deployment's own key pays, with rate limits only. For a copy nobody else can reach, e.g. behind Vercel's deployment protection; it is never a default.

With no Club, `Platform.club` is absent, so the Apple menu item, the Club window and the `club` capability disappear by themselves.

### Talking to the Club

- **Bearer tokens, not cookies.** Browsers block third-party cookies, and Safari blocks them outright, so a copy on another site can't carry a Club cookie. The Mac sends `Authorization: Bearer <token>` (Better Auth's `bearer` plugin) to every Club endpoint.
- **CORS.** The Club answers any origin for its API, without cookies (`Access-Control-Allow-Origin` echoing the origin, `Authorization` and `Content-Type` allowed, `set-auth-token` exposed). `Access-Control-Max-Age: 86400` keeps the preflight a once-a-day request per Mac. The OS's cross-origin isolation (`COEP: credentialless`) doesn't affect CORS requests.
- **Who holds the token.** The OS, where app processes can't reach it (today the page's `localStorage`, which workers have no access to). Apps never see it: `useApp().club` gains `fetch(path, init)` for Club endpoints, which the OS sends with the token, so the Assistant calls `club.fetch("/chat", …)` instead of its own `/api/chat`. A token on disk can be read by code running on the same origin, unlike the httpOnly cookie, so each token is limited:
  - one per connected Mac, named after its site ("mockintosh.com", "foo.example"), listed on the Club's account page with Disconnect;
  - an optional daily spending cap per token, set when connecting;
  - revoked on Sign Out.
- **The Assistant's prompt.** Today `api/chat.ts` builds it from this repo's docs and SDK types, which ties the prompt to one OS version. With copies on other versions, the Mac sends its own Mockintosh context and the Club adds a short fixed preamble. Members pay for every token either way, so the Club becoming a general model proxy for anyone with credits is acceptable; the terms say so.

### Signing in

Three ways in, chosen by what the Club's `GET /config` says for the asking origin:

1. **On the Club's own sites (mockintosh.com and its previews): a form on the Mac.** The Club accepts its email sign-in routes only from an `Origin` on its allowlist; a page can't forge that header. The form asks for an email address, the Club emails a six-digit code, and the member types it in (Better Auth's `email-otp` plugin). Joining and signing in become the same two steps, with no password to remember. A canvas form is invisible to password managers, which is why codes replace passwords; with 30-day sessions a code is rarely needed.
2. **On every other copy: "Connect to the Computer Club…".** The device-code sign-in (Better Auth's `deviceAuthorization`, RFC 8628):
   1. The Mac asks the Club for a code and opens a real browser popup at `club.mockintosh.com/connect?code=ABCD-1234` (`browser.openExternal`), or shows that link as a QR code for a phone, reusing the sign-in sheet (`src/os/components/SignInSheet.solid.tsx`).
   2. The member joins or signs in there, with email, GitHub or Google; a password manager works, and the real address bar shows it's the Club.
   3. The page asks: "foo.example's Mockintosh wants to use your Computer Club credits. Code ABCD-1234."
   4. The Mac, polling the Club, receives its token. The code in both places lets the member check that the Mac and the page belong together; the popup can't tell the Mac itself, since cross-origin isolation cuts the link between them.
3. **GitHub and Google, everywhere,** through that same popup or QR code: OAuth has to pass through the provider's site.

Mockintosh's own Safari is not a way in: it fetches pages through the copy's server and draws them itself, so it is the copy's code, with the address bar as pixels the copy chose. A Club page laid over the canvas in an iframe has no address bar either, and the Club would have to allow being framed. Only a real browser window proves the page is the Club's.

### Buying credits

Everything up to the payment and after it is drawn by the Mac; the payment itself happens on Polar's page, usually on the phone:

1. **In the Club window,** "Buy Credits…": choose a pack and see the price; optionally give a country and VAT number for an exact total.
2. **The Club creates a Polar checkout session** with the product, the member's email, their Club id as Polar's external customer id, and any billing details, so Polar's page arrives filled in.
3. **The Mac shows a sheet,** like the sign-in sheet: "Scan to pay with your phone", a QR code, "10,000 credits — $10 + VAT", and "Or pay in this computer's browser".
4. **The QR code holds a short Club link,** `club.mockintosh.com/pay/K7Q2`. It shows one confirming line ("10,000 credits for Ada, $10 + VAT. Continue to payment") and then sends the phone on to Polar's checkout. The link never forwards blindly, a Polar address is too long for the sheet's QR code, and an old code can say "This code has expired" instead of showing Polar's error. A link lasts 15 minutes; the sheet offers New Code.
5. **On Polar's page,** with Polar's address showing: Apple Pay, Google Pay or a card, and the bank's check (3-D Secure) where it needs one. Opened in Chrome on a computer, Polar's Apple Pay button offers Apple's own QR code for an iPhone by itself.
6. **The Mac polls** the checkout's status ("Waiting for payment…", then "Paid") and closes the sheet on the new balance. **Credits come only from Polar's `order.paid` webhook**, applied once per order through the ledger's unique `ref`; a Mac that was closed or reloaded loses nothing. Refunds arrive as `order.refunded` and become a `refund` row.
7. **"Manage Purchases…"** in the Club window opens Polar's customer portal for receipts and refunds.

A checkout drawn entirely on the canvas isn't possible: confirming a paid Polar checkout needs a Stripe confirmation token, which only Stripe's own card fields create, and those are iframes that must stay Stripe's (card numbers never touching our code keeps us in PCI's lightest category, SAQ A). A Stripe field laid over a canvas-drawn checkout remains a possible later polish for mockintosh.com, if a prototype shows Stripe's frames load under the page's cross-origin isolation.

### Code layout

- **`sites/club/`**: the Club's own Vercel project, like `sites/ui`. From today's `api/`: `_auth`, `_credits`, `_pricing`, `_db`, `_email`, `chat`, `generate-image`, `club/*`, `auth/[...all]`, and `db/`. New: `connect`, `pay/[code]`, `config`, the Polar webhook and checkout-session routes, and the account page (connected Macs, Disconnect).
- **`packages/protocol`**: the types both sides share: the chat protocol (already there), Club config, credits, checkout status.
- **The OS:** `src/platform/web/club.ts` becomes a client of the Club's API (base URL plus token); `os.club`, the Club window, the Apple menu item and `useApp().club` stay. `api/_guard.ts` keeps `fromOwnSite` for the free routes and gains the `key` and `open` modes for `/api/chat`.
- **Development:** `npm run dev` and `npm run dev:club` side by side, the OS's config pointing at `http://localhost:<club port>`.

### Running your own Mockintosh

- **As it comes:** `CLUB_URL` defaults to our Club. Your users join it, connect through the popup, and pay us for the AI. Nothing to run.
- **`CLUB_URL` set to nothing:** no Club anywhere in the interface; the Assistant asks each user for an AI Gateway key. No database, no email, no payments.
- **Your own Club:** deploy `sites/club` with your own Neon, Resend, Polar and AI Gateway, and point `CLUB_URL` at it.
- **`AI_ACCESS=open`:** your server's key pays, for a deployment only you can reach.

## Data model (applied with `npm run db:migrate`)

- **Better Auth's tables:** `user`, `session` (plus `site` and `dailyCap`), `account`, `verification`, `deviceCode`. A session doubles as a connected Mac: its token is the Mac's bearer token, and the site it connected from is stored with it.
- **`credit_balance(user_id → user, balance)`** and **`credit_ledger(user_id, delta, kind, ref UNIQUE, model, input_tokens, output_tokens, cost_microusd, session_id, created_at)`** (built). `ref` is the idempotency key: `welcome:<user>`, `usage:<generation id>`, a Polar order id.
- **`pay_link(code PK, user_id → user, checkout_id, checkout_url, credits, expires_at)`** (phase 6): the short links in the QR codes.
- **A spending cap per token** (built): `session.dailyCap`, checked by the guard against the session's `usage` rows of the last 24 hours.
- **Units:** 1 credit = $0.001 of retail value.

## Phases (each one shippable)

1. **Accounts** (built). Better Auth with email and password (replaced by emailed codes in phase 4), the Club window, the Apple menu item, session auth in the guard.
2. **Credits** (built). The ledger, pricing, charging in chat and image, welcome credits, 402 handling, balance and latest changes in the Club window and the Assistant. **Don't open to the public before this.**
3. **The Club as a separate service** (built, runs locally). Move the Club into `sites/club`; bearer tokens and CORS instead of the cookie; `useApp().club.fetch` and the Assistant calling the Club; the OS's `/api/config`. The Mac's existing forms keep working against the Club, so the move can be tested on its own. The Club's Vercel project is live at `club.mockintosh.com`. Two things deploying taught: Vercel calls a default-exported function as Node's `(req, res)`, so every Node function exports `default { fetch }`; and outside Next.js a `[...all]` file matches one path segment, so the Club's `vercel.json` rewrites `/api/auth/*` to it.
4. **Signing in on the Club** (built). Email codes in the Mac's form on the Club's own sites (the origin allowlist and `GET /api/config`); "Connect…" with the QR code or this computer's browser, the connect page and its consent line; GitHub and Google (waiting for their OAuth apps); the account page with connected Macs, Disconnect and per-Mac daily limits. Needs `npm run db:migrate` against the Club's database before it deploys.
5. **Copies without a Club.** `key` mode with "Set AI Gateway Key…" in the Assistant, `open` mode, no Club interface when unconfigured, and a "Running your own Mockintosh" section in the README.
6. **Buying credits.** Polar products and checkout sessions, the pack choice in the Club window, the payment sheet with its QR code and short `pay` links, the `order.paid` / `order.refunded` webhooks, and "Manage Purchases…".
7. **Docs and cleanup.** `ARCHITECTURE.md`, `FUTURE.md` (paid apps' licences can belong to a member and use the same checkout), `todo.md`.

## Risks and limits

- **Tokens on disk.** Code on the Mac's origin, including App Store and user-built apps, could read the token from OPFS. Limited by one token per Mac, Disconnect, per-token spending caps, and the latest-changes list showing every charge. Later: keep the token only in the OS's memory and storage that apps can't reach.
- **Apps spending credits.** Any app that can reach `useApp().club.fetch` spends the member's credits. Later: a consent prompt the first time an app that didn't come with Mockintosh uses it.
- **Overdraft.** Balances are checked before a call and charged after it, so one can dip below zero by at most the in-flight cap times one call's maximum (32,000 output tokens).
- **Abuse of welcome credits.** They need a verified email and are capped per IP per day; the global daily limits stay as a backstop. Bots can't be stopped with a CAPTCHA widget in a canvas form; if needed, sign-up moves to the Club's page, or Vercel's BotID, which needs no widget.
- **A general model proxy.** Copies send their own prompts, so the Club proxies any chat a member pays for. Acceptable at 2×; the terms say so.
- **Legal.** Terms, a privacy page and account deletion on the Club (Better Auth's `deleteUser`; Polar's customer goes with it). Polar handles VAT, receipts and refunds.

## Verification

- **Unit tests** (Vitest; the ledger and accounts on PGlite through Kysely): idempotent grants and charges; replayed `order.paid` webhooks grant once (fixture payloads with a test signature); pricing from the gateway's `usage`; the guard's 401, 402 and in-flight answers; the Club's CORS answers and origin allowlist; `key` mode forwarding the user's key and never the server's; `open` refused without its setting.
- **`npm run typecheck && npm run knip && npm test`**, knip run from an ordinary checkout.
- **End to end, locally,** with the OS and the Club as two dev servers, a Neon branch for development, Polar's sandbox and Resend: join from the Mac with an email code; connect a second copy (another port) through the popup and approve it; send Assistant messages and watch the balance and the ledger; reach zero and see the 402 alert; Disconnect a Mac and see its next request refused.
- **Buying, on Vercel previews** (Polar's webhooks need a public URL): scan the sheet's QR code with a phone, pay with a sandbox card or Apple Pay, see "Paid" on the Mac and the credits once in the ledger; replay the webhook from Polar's dashboard and see no second grant; let a `pay` link expire and see its page say so.
