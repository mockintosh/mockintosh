/**
 * How a Mockintosh deployment is set up, as `GET /api/config` answers and
 * the web platform reads at boot: which Computer Club it uses, and how its
 * AI is paid for (docs/computer-club-plan.md).
 */

/** The Club copies of Mockintosh use unless they name another, or none. */
export const OFFICIAL_CLUB_URL = "https://club.mockintosh.com";

export interface HostConfig {
  /** The Computer Club's origin, or `null` for none. */
  club: string | null;
  /**
   * Who pays for the AI: Club members in credits (`club`), each user with
   * their own AI Gateway key (`key`), or the deployment's own key (`open`).
   */
  ai: "club" | "key" | "open";
}

/** What a Mac assumes when it can't ask, e.g. served as plain files. */
export const DEFAULT_HOST_CONFIG: HostConfig = { club: OFFICIAL_CLUB_URL, ai: "club" };

/** A config from the wire, or the default for anything malformed. */
export function parseHostConfig(value: unknown): HostConfig {
  const v = value as Partial<HostConfig> | null;
  if (!v || typeof v !== "object") return DEFAULT_HOST_CONFIG;
  const club = typeof v.club === "string" && /^https?:\/\/[^/]+$/.test(v.club) ? v.club : null;
  if (v.club !== null && club === null) return DEFAULT_HOST_CONFIG;
  const ai = v.ai === "club" || v.ai === "key" || v.ai === "open" ? v.ai : club ? "club" : "key";
  return { club, ai: ai === "club" && !club ? "key" : ai };
}
