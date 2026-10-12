/**
 * Motion documents (`.motion`, `MIME.motion`): what a reel is to the Finder.
 * A reel is code that paints and scores itself, so the file doesn't hold
 * the picture: it names the reel Showreel plays from it, the way a QuickTime
 * movie names the codec its frames need.
 */
export interface MotionDocument {
  version: 1;
  /** A `ReelDefinition.id`. */
  reel: string;
}

/** The reel id a motion file names, or null when it names none. */
export function motionReel(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) return null;
  const reel = (raw as Partial<MotionDocument>).reel;
  return typeof reel === "string" && reel.length > 0 ? reel : null;
}
