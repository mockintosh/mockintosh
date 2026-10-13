import type { FetchRequest, FetchResponse } from "./index";

/**
 * The Mockintosh Computer Club: the account a person signs in to from the
 * Apple menu, a service of its own. Members pay for its AI (`/api/chat`,
 * `/api/generate-image`) in credits; a request without credits is refused
 * with `402` and `code: "out_of_credits"`, one over the daily cap the
 * member set for this Macintosh with `402` and `code: "over_daily_cap"`,
 * one without a membership with `401` and `code: "not_a_member"`. An app calls the Club with `fetch`,
 * shows the balance with `status`, and sends people to the Club window
 * with `open`.
 */
export interface ClubService {
  /**
   * A request to one of the Club's endpoints (`"/api/chat"`), carrying the
   * member's session, which the app never sees.
   */
  fetch(path: string, init?: FetchRequest): Promise<FetchResponse>;
  /** Whether this computer is signed in to the Club, and its credits then. */
  status(): Promise<ClubStatus>;
  /** Open the Computer Club window, where people join, sign in and see their credits. */
  open(): void;
}

export interface ClubStatus {
  member: boolean;
  /** The member's credits; `null` when signed out or the server can't say. */
  credits: number | null;
}
