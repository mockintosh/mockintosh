/**
 * The Mockintosh Computer Club, as the OS sees it: who this computer is
 * signed in as, for the Apple menu and the Club window. Accounts live on
 * the host's server (`Platform.club`); this keeps the answer in a signal.
 */
import { createSignal, type Accessor } from "solid-js";
import type { ClubAccounts, ClubMember, ClubSignInResult } from "../platform/types";

export const CLUB_NAME = "Mockintosh Computer Club";

export interface SystemClub {
  /** The signed-in member; `null` when signed out, `undefined` until the server has answered. */
  member: Accessor<ClubMember | null | undefined>;
  /** Ask the server again (the session may have ended elsewhere). */
  refresh(): Promise<void>;
  join(details: { name: string; email: string; password: string }): Promise<void>;
  resendVerification(email: string): Promise<void>;
  signIn(email: string, password: string): Promise<ClubSignInResult>;
  signOut(): Promise<void>;
  forgotPassword(email: string): Promise<void>;
}

export function createSystemClub(accounts: ClubAccounts): SystemClub {
  const [member, setMember] = createSignal<ClubMember | null | undefined>(undefined, { ownedWrite: true });

  async function refresh(): Promise<void> {
    try {
      setMember(await accounts.session());
    } catch {
      // Unreachable server: keep what we knew, or treat a first answer as signed out.
      if (member() === undefined) setMember(null);
    }
  }

  void refresh();

  return {
    member,
    refresh,
    join: (details) => accounts.join(details),
    resendVerification: (email) => accounts.resendVerification(email),
    async signIn(email, password) {
      const result = await accounts.signIn(email, password);
      if (result.status === "signed-in") setMember(result.member);
      return result;
    },
    async signOut() {
      await accounts.signOut();
      setMember(null);
    },
    forgotPassword: (email) => accounts.forgotPassword(email),
  };
}
