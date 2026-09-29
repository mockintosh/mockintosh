/**
 * Phone sign-in — `useApp().signIn`. The app hands over a provider's
 * authorize URL; the OS checks it against the hosts the app declared in
 * `defineApp({ signIn })`, then puts up the sign-in sheet (`SignInSheet`),
 * which pairs through the platform's `SignInRelay` and shows the QR code.
 */
import type { SignInService } from "@mockintosh/sdk";

/** What the sheet needs to run one sign-in. */
export interface SignInSheetRequest {
  /** The provider's authorize URL, as the app built it. */
  url: string;
  /** `url`'s host, shown to the user. */
  host: string;
  appTitle: string;
}

/** Resolves with the provider's response parameters, `null` when the user cancels. */
export type ShowSignInSheet = (request: SignInSheetRequest) => Promise<Record<string, string> | null>;

/** The OS half of phone sign-in, present when the platform has a relay. */
export interface SystemSignIn {
  readonly redirectUri: string;
  /** Put up the sign-in sheet; it closes (as a cancel) when `instanceId`'s launch ends. */
  show(request: SignInSheetRequest, instanceId?: string): Promise<Record<string, string> | null>;
}

/** `https://host[:port]/…` → `host[:port]`, lowercased; `null` for other schemes or URLs carrying credentials. */
export function authorizeHost(url: string): string | null {
  const match = /^https:\/\/([^/?#@\s]+)(?:[/?#]|$)/i.exec(url);
  return match ? match[1].toLowerCase() : null;
}

export interface AppSignInOptions {
  redirectUri: string;
  appTitle: string;
  /** The app's `signIn.hosts`. */
  hosts: readonly string[];
  showSheet: ShowSignInSheet;
}

export function createAppSignIn(options: AppSignInOptions): SignInService {
  const allowed = new Set(options.hosts.map((host) => host.toLowerCase()));
  return {
    redirectUri: options.redirectUri,
    async authorize(url) {
      const host = authorizeHost(url);
      if (!host) throw new Error("Sign-in URLs must be https.");
      if (!allowed.has(host)) {
        throw new Error(`"${options.appTitle}" has not declared sign-in at ${host}; add it to signIn.hosts in defineApp.`);
      }
      return options.showSheet({ url, host, appTitle: options.appTitle });
    },
  };
}
