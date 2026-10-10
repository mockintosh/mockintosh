/**
 * The Mockintosh Computer Club: the account a person signs in to from the
 * Apple menu. Members pay for the AI the Macintosh offers (`/api/chat`,
 * `/api/generate-image`) in credits; a request without credits is refused
 * with `402` and `code: "out_of_credits"`, one without a membership with
 * `401` and `code: "not_a_member"`. An app that calls those shows the
 * balance with `status` and sends people to the Club window with `open`.
 */
export interface ClubService {
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
