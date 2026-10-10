# Mockintosh Computer Club: accounts and AI credits

Plan, 9 October 2026. Phase 1 (accounts) is built, not yet deployed; the rest are proposals. Provisioned so far: a free Neon database `mockintosh-club` in us-east-1 (next to the functions in `iad1`), connected to the `mockintosh` project as `DATABASE_URL`, and Resend sending from `mail.mockintosh.com` with `RESEND_API_KEY`. Better Auth's tables are created. Polar is still to be set up. Companion to the [server infrastructure plan](server-infrastructure-plan.md) and the Polar section of [FUTURE.md](../FUTURE.md).

## Context

The Assistant spends the project's AI Gateway money. Today the only protection is a shared `API_ACCESS_TOKEN` in `api/_guard.ts`, and the browser never sends it. So on mockintosh.com every Assistant message gets a 401 "Sign-in required." (`apps/Assistant.tsx:72` posts to `/api/chat` without the header). Nothing records who spent what. The guard counts requests per IP; it never reads `usage` from the gateway response.

We want people to **join an account from inside the Mac**, sign in with email/password or a provider of their choice, get a small free grant, and **buy credits** that the Assistant and image generation draw down. Mockintosh itself still boots and works without an account (`docs/kernel-plan.md:135`); only AI features need membership.

Decisions so far:
- **Name:** "Mockintosh Computer Club", joined from the Apple menu.
- **Sign-in:** email/password, plus GitHub and Google.
- **Payments:** Polar.sh, the merchant of record already proposed in `FUTURE.md`.
- **Free grant:** a small one on joining.
- **fx agent:** not metered in v1.

## Architecture

```
Apple menu ▸ Join Mockintosh Computer Club…  ─▶  Computer Club window (Finder-hosted, main thread)
                                                   │ email/password: native canvas form
                                                   │ GitHub/Google: QR sheet, or "use this computer's browser"
                                                   ▼
            /api/auth/*  Better Auth (Node fn) ──▶ Postgres (Neon): users, sessions, device codes,
                 │  device authorization (RFC 8628)          credit_balance, credit_ledger
                 │  Polar plugin: customer, checkout, portal, webhooks ──▶ Polar.sh
            /api/chat, /api/generate-image
                 guard: session cookie ▸ balance > floor ▸ call gateway ▸ debit actual usage
```

### Core choices

- **Better Auth** handles identity (`better-auth`, run in a Vercel Node function via `auth.handler(request)`).
  - It's framework-agnostic and headless. Mockintosh draws its own 1-bit UI on a canvas, so Clerk-style DOM components don't fit.
  - It has built-in email/password with verification and reset, plus social providers.
  - Its **`deviceAuthorization` plugin** (RFC 8628) maps onto our existing QR sign-in sheet. The Mac shows a code and QR; the phone (or a tab in this browser) signs in and approves; the Mac polls `/device/token` and receives a session token. Social sign-in takes the same path whether it happens on the phone or in this computer's browser.
  - It has an official Polar plugin, **`@polar-sh/better-auth`**. It creates the Polar customer on sign-up (external id = user id), and provides checkout, the customer portal, and signed webhooks with `onOrderPaid`. It requires Better Auth 1.7+ and Node 22+; this repo runs Node 24.
- **Postgres via Neon** (Vercel Marketplace), which matches the direction in `docs/server-infrastructure-plan.md`. We keep the credit ledger in our own database, not in Polar meters, so each request can check and debit its balance atomically without a Polar round trip.
- **Resend** sends verification and password-reset email from `mail.mockintosh.com` (e.g. `club@mail.mockintosh.com`), on the existing Resend account. `RESEND_API_KEY` should be a sending-only key limited to that domain. (Not the Vercel Marketplace install, which would create a separate, Vercel-billed Resend team.)
- **The session is an httpOnly, SameSite=Lax cookie on mockintosh.com.**
  - Worker apps' same-origin `fetch` sends it automatically, so the Assistant's request code barely changes.
  - Script can't read the token, so it can't leave the machine.
  - After a device-flow sign-in, a small `/api/auth/club/adopt` endpoint exchanges the polled bearer token for that cookie. That way no token sits in OPFS.

## Data model (applied with `npm run db:migrate`)

- **Better Auth's tables**: `user`, `session`, `account`, `verification` (and `deviceCode` in phase 4). `scripts/db-migrate.ts` compares them with the database and changes it in place (`-- --print` shows the SQL). Our own tables (below) go in `db/migrations/*.sql`, applied by the same script in phase 2.
- **`credit_balance(user_id PK → user, balance BIGINT NOT NULL)`**.
- **`credit_ledger(id, user_id, delta BIGINT, kind TEXT CHECK (kind IN ('grant','purchase','usage','refund','adjust')), ref TEXT UNIQUE, model TEXT, input_tokens INT, output_tokens INT, cost_microusd BIGINT, created_at)`**.
  - `ref` is the idempotency key. It holds the Polar order id, `signup:<userId>`, or the request id.
  - Every balance change is one transaction: insert the ledger row, then `UPDATE credit_balance`.
- **Units**: store credits as integers. Assume 1 credit = $0.001 of retail value, with the model cost × markup set in `api/_pricing.ts`. The UI shows "credits" (exact pack sizes and prices are open questions below).

## Server work

| File | Change |
|---|---|
| `api/_db.ts` (new) | A Neon `Pool` (works on Node) wrapped by Kysely, shared by Better Auth and the ledger |
| `api/_auth.ts` (new) | `betterAuth({...})` configuration (detailed below) |
| `api/auth/[...all].ts` (new) | `export default (req) => auth.handler(req)`. Confirm that Vercel's `api/` routing and `scripts/dev-api.ts` both handle the catch-all; otherwise list the routes explicitly. |
| `api/_credits.ts` (new) | `balance`, `grant(user, amount, kind, ref)` (idempotent through `ref`), `charge(user, usage, ref)`, `recentUsage(user)` |
| `api/_pricing.ts` (new) | Per-model input, cached-input and output prices, plus the markup and a fixed image price. Use the gateway-reported cost if the response includes one; otherwise compute it from `usage`. |
| `api/_guard.ts` | Split authentication into `authenticate(req)` (detailed below). Rate limits key on user id instead of IP. Add a per-account cap on concurrent requests (a Redis counter) to bound overdraft. Keep the origin check (CSRF protection for cookie POSTs), the body cap and the global limits. |
| `api/chat.ts` | After a successful response, read `data.usage` and call `charge`. Return 402 with `{ code: "out_of_credits" }` when the guard refuses on balance. |
| `api/generate-image.ts` | Move from Edge to Node (Edge is deprecated) and charge the fixed image price. |
| `api/club/*` (new) | Small HTML pages: `device` (approve code; sign in with GitHub, Google or email), `verify-email`, `reset-password`, `thanks` (after checkout). Plain HTML forms in the style of the `api/oauth/*` pages, using the existing `relay.js` 1-bit redraw for text and buttons. |
| `scripts/dev-api.ts` | Route the new handlers. Load the Neon dev-branch URL from `.env.local`. |

**`api/_auth.ts` configuration:**
- `emailAndPassword: { enabled: true, requireEmailVerification: true }`, with send hooks that call Resend
- `socialProviders: { github, google }`. GitHub needs a new OAuth app because the Safari one's callback is the loopback relay.
- `plugins`:
  - `deviceAuthorization({ verificationUri: "/club/device" })`
  - `polar({ client, createCustomerOnSignUp: true, use: [checkout({ products: creditPacks }), portal(), webhooks({ secret, onOrderPaid }) ] })`
- `onOrderPaid` calls `grant(user, pack.credits, "purchase", order.id)`. Polar retries failed webhooks, so the grant must be idempotent; the unique `ref` handles that.
- **Free grant**: once the email is verified (immediately for social sign-ups), `grant(user, FREE_GRANT, "grant", "signup:<id>")`. Cap new grants per IP per day in Redis to slow down people creating many accounts.

**`authenticate(req)` in `api/_guard.ts`** returns one of:
- `{ kind: "service" }` for the `API_ACCESS_TOKEN` bearer. It stays unmetered and is used by `scripts/agent-eval.ts`.
- `{ kind: "member", user }` from `auth.api.getSession({ headers })`.
- 401 when neither is present.

## OS and app work

- **Platform service** `src/platform/web/club.ts`, added to `Platform` in `src/platform/types.ts`.
  - It wraps `better-auth/client` with `deviceAuthorizationClient()` and `polarClient()`.
  - Calls: `session()`, `signUp`, `signIn`, `signOut`, `startDeviceSignIn()` / `pollDevice()`, `balance()`, `usage()`, `checkout(pack)` (returns a URL) and `portal()`.
- **OS service** `OSServices.club` in `src/os/context.ts`.
  - It holds signals: `member` (name, email, since) and `credits`.
  - It refreshes them when the window gains focus and after each AI call.
- **Computer Club window** `apps/finder/ComputerClub.tsx`, opened with `openSystemWindow`. Follow `apps/finder/Chooser.tsx` and `apps/finder/printerUi.tsx`, using `Row`, `Section` and `Divider`.
  - **Signed out**: "Join" / "Sign In" tabs. Join has name, email and password `TextInput` fields (with `password`). Below that, "Join with GitHub…" and "Join with Google…".
  - The social buttons open a device-code sheet modelled on `src/os/components/SignInSheet.solid.tsx`: a QR code, the user code, and "Or sign in with this computer's browser". Register it as a hidden `__club_signin__` app in `src/os/boot.ts`, next to `__signin__`.
  - **Signed in**: a membership card (name, member since, credits), then "Buy Credits…" (radio buttons for the pack, then a sheet that opens Polar checkout in this browser's tab or by QR on a phone), recent usage in a `Table`, "Manage Purchases…" (the Polar portal), and Sign Out.
- **Apple menu** in `src/os/kernel/menus.ts`: "Join Mockintosh Computer Club…" when signed out, "Computer Club…" when signed in.
- **App-facing service**, so the Assistant (which runs in a worker) can show the balance and open the club window.
  - Add a capability `"club"`: in the `Capability` union (`packages/sdk/src/index.ts`), in `DESCRIPTIONS` in `src/os/capabilities.ts`, and in `SERVED` in `src/os/process/eligible.ts`.
  - Add a `club` namespace in `src/os/process/host.ts`, and a proxy in `src/platform/web/process/runtime.tsx` exposing `useApp().club?: { status(): Promise<{ member: boolean; credits: number }>; open(): void }`.
  - Regenerate declarations with `npm run apps:declarations`.
- **Assistant** (`apps/Assistant.tsx`):
  - On 401, show "The Assistant is a Computer Club perk." with buttons **Join…** and Cancel.
  - On 402, show "You're out of credits." with buttons **Buy Credits…** and Cancel.
  - Show the remaining credits in the window after each reply.

## Phases (each one shippable)

1. **Accounts.** Add Better Auth with email/password, the migrations, the Club window (join, sign in, sign out), the Apple menu item, and session auth in the guard. Members can use the Assistant within the existing rate limits.
2. **Credits.** Add the ledger, pricing and metering in chat and image, the free grant, 402 handling, and balance and usage in the Club window and the Assistant. **Do not open to the public before this phase.**
3. **Purchases.** Create the Polar products (credit packs) and add the plugin, the checkout sheet, the webhook grant, the portal link and the thanks page.
4. **GitHub and Google.** Add device authorization, the `/club/device` page, the QR sheet and cookie adoption.
5. **Docs.** Fix the stale `api/checkout` / `api/verify-purchase` line in `ARCHITECTURE.md:432` and describe the Club. Update the Polar section of `FUTURE.md`: app licenses can now attach to a member. Update `todo.md:5`.

## Risks and limits

- **Same-origin apps can spend credits.** App Store and user-built apps run on the same origin, so any of them can `fetch("/api/chat")` with the member's cookie. Mitigations in v1:
  - the per-account concurrency cap and an optional daily spend cap in the Club window;
  - the usage list shows each charge.
  
  Later, put AI calls behind the `club` capability (OS-mediated requests plus a consent prompt for non-bundled apps).
- **Overdraft.** We check the balance before the call and debit after it, so a balance can dip a little below zero. That's bounded by the output cap (32k tokens) times the concurrency cap. This is acceptable; the next request is refused.
- **Abuse of the free grant.** The grant requires a verified email and is capped per IP per day. The global daily limits stay as a backstop.
- **Legal.** Add terms, a privacy page and account deletion (Better Auth `deleteUser`; the Polar plugin deletes the customer). Polar handles VAT, receipts and refunds; refunds go through the `order.refunded` webhook to a `refund` ledger row.

## Open decisions (defaults assumed above)

- Credit pack sizes and prices, and the markup over gateway cost.
- The free grant size (the default is about 20 typical chat replies).
- Whether to add Apple sign-in later; it needs a paid developer account.

## Verification

- **Unit tests** (Vitest, `api/**/*.test.ts`), with the ledger running on PGlite and Kysely:
  - grants are idempotent; concurrent charges stay consistent;
  - `onOrderPaid` replay grants once (fixture payloads with a test signature);
  - pricing from `usage`;
  - guard results: 401 with no session, 402 at zero balance, the service token passes.
- **`npm run typecheck && npm run knip && npm test`**.
- **End to end, locally**:
  - Run `npm run dev` and `npm run dev:api` (launch configs `mockintosh` and `mockintosh-api`) against a Neon dev branch, Polar **sandbox** and Resend.
  - In the browser pane: Apple menu ▸ Join, create an account, verify the email, then send an Assistant message. The credits drop, and the ledger row matches the gateway `usage`.
  - Drive the balance to zero and confirm the 402 alert.
  - Social sign-in through "this computer's browser".
- **Purchase on a Vercel preview deployment** (Polar webhooks need a public URL): buy a pack in Polar sandbox with a test card, confirm the webhook grant appears once in the ledger, and that the Club window updates. Replay the webhook from the Polar dashboard and confirm there is no double grant.
