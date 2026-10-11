/**
 * The Mockintosh Computer Club, as the OS sees it: who this computer is
 * signed in as and their credits, for the Apple menu, the Club window and
 * apps' `useApp().club`. Accounts live on the host's server
 * (`Platform.club`); this keeps the answers in signals.
 */
import { createSignal, type Accessor } from "solid-js";
import type { FetchRequest, FetchResponse } from "@mockintosh/sdk";
import type { ClubAccounts, ClubCredits, ClubMember, ClubSignInResult } from "../platform/types";

export const CLUB_NAME = "Mockintosh Computer Club";

export interface SystemClub {
  /** The signed-in member; `null` when signed out, `undefined` until the server has answered. */
  member: Accessor<ClubMember | null | undefined>;
  /** Their credits and latest changes; `null` when signed out or not yet known. */
  credits: Accessor<ClubCredits | null>;
  /**
   * Ask the server again (the session may have ended elsewhere), credits
   * included. Resolves with what it found: read that, not the signals,
   * which may not show it until Solid flushes.
   */
  refresh(): Promise<{ member: ClubMember | null; credits: ClubCredits | null }>;
  join(details: { name: string; email: string; password: string }): Promise<void>;
  resendVerification(email: string): Promise<void>;
  signIn(email: string, password: string): Promise<ClubSignInResult>;
  signOut(): Promise<void>;
  forgotPassword(email: string): Promise<void>;
  /** A request to the Club for an app, with this computer's session (`useApp().club.fetch`). */
  fetch(path: string, init?: FetchRequest): Promise<FetchResponse>;
}

export function createSystemClub(accounts: ClubAccounts): SystemClub {
  const [member, setMember] = createSignal<ClubMember | null | undefined>(undefined, { ownedWrite: true });
  const [credits, setCredits] = createSignal<ClubCredits | null>(null, { ownedWrite: true });

  /**
   * Credits for `signedIn`, the member as this call knows them: a signal
   * written moments ago may not read back until Solid flushes.
   */
  async function refreshCredits(signedIn: boolean): Promise<ClubCredits | null> {
    try {
      const latest = signedIn ? await accounts.credits() : null;
      setCredits(latest);
      return latest;
    } catch {
      // Keep the last balance we saw; the window says it again on the next refresh.
      return signedIn ? credits() : null;
    }
  }

  async function refresh(): Promise<{ member: ClubMember | null; credits: ClubCredits | null }> {
    let current: ClubMember | null;
    try {
      current = await accounts.session();
      setMember(current);
    } catch {
      // Unreachable server: keep what we knew, or treat a first answer as signed out.
      current = member() ?? null;
      if (member() === undefined) setMember(null);
    }
    return { member: current, credits: await refreshCredits(!!current) };
  }

  void refresh();

  return {
    member,
    credits,
    refresh,
    join: (details) => accounts.join(details),
    resendVerification: (email) => accounts.resendVerification(email),
    async signIn(email, password) {
      const result = await accounts.signIn(email, password);
      if (result.status === "signed-in") {
        setMember(result.member);
        await refreshCredits(true);
      }
      return result;
    },
    async signOut() {
      await accounts.signOut();
      setMember(null);
      setCredits(null);
    },
    forgotPassword: (email) => accounts.forgotPassword(email),
    async fetch(path, init) {
      const resp = await accounts.fetch(path, init);
      // An app's request may have spent credits, or found the session over:
      // the Club window and menu catch up without waiting to be reopened.
      if (resp.status === 401) void refresh();
      else if (member()) void refreshCredits(true);
      return resp;
    },
  };
}
