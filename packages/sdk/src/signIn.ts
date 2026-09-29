/**
 * Sign in to an OAuth provider from the user's phone, the way TVs do: the OS
 * shows a QR code, the user signs in on their phone, and the app receives the
 * provider's authorization code. Nothing is typed on the Macintosh and the
 * app never opens a browser window.
 *
 * The provider must support the authorization code flow with PKCE, and the
 * app must register `redirectUri` with it. The app builds the authorize URL,
 * keeps the PKCE verifier, and exchanges the code itself; the OS only carries
 * the code from the phone to the Macintosh.
 */
export interface SignInService {
  /** The redirect URI to register with the provider and to send in the token exchange. */
  readonly redirectUri: string;
  /**
   * Show the system sign-in sheet for `url`, the provider's authorize URL
   * (`response_type=code`, `client_id`, `scope`, `code_challenge`, …). The OS
   * sets `redirect_uri` and `state`. Resolves with the parameters the provider
   * sent back (`code`, …), or `null` when the user cancels. Rejects when the
   * provider reports an error or `url`'s host is not in the app's `signIn.hosts`.
   */
  authorize(url: string): Promise<Record<string, string> | null>;
}

/** What an app declares about signing in; see `SolidApp.signIn`. */
export interface SignInDeclaration {
  /** Hosts of the authorize URLs the app may pass to `signIn.authorize` (`"accounts.spotify.com"`). */
  hosts: string[];
}
