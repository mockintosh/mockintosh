/**
 * Capabilities — what this Macintosh can do, derived from the platform.
 *
 * Apps declare `requires`; the OS compares against this set before launching
 * (or, for installed bundles, before loading) and explains any gap to the
 * user in plain words.
 */
import type { Capability } from "@mockintosh/sdk";
import type { Platform } from "../platform/types";

export type CapabilitySet = ReadonlySet<Capability>;

export function platformCapabilities(platform: Platform): CapabilitySet {
  const caps = new Set<Capability>(platform.hostCapabilities);
  if (platform.fetch) caps.add("network");
  if (platform.clipboard) caps.add("clipboard");
  if (platform.printer || platform.printerLinks) caps.add("printer");
  if (platform.download) caps.add("download");
  if (platform.images) caps.add("images");
  if (platform.video) caps.add("video");
  if (platform.camera) caps.add("camera");
  if (platform.audio) caps.add("audio");
  if (platform.microphone) caps.add("microphone");
  if (platform.browser) caps.add("browser");
  return caps;
}

/** The capabilities in `requires` that `available` lacks, in declaration order. */
export function missingCapabilities(
  requires: readonly Capability[] | undefined,
  available: CapabilitySet
): Capability[] {
  return (requires ?? []).filter((c) => !available.has(c));
}

const DESCRIPTIONS: Record<Capability, string> = {
  network: "a network connection",
  clipboard: "a clipboard",
  printer: "a printer",
  download: "a way to save files to this computer",
  camera: "a camera",
  video: "video playback",
  images: "image decoding",
  audio: "a speaker",
  microphone: "a microphone",
  browser: "a web browser",
};

/** “"Photo Booth" needs a camera, which this Macintosh does not have.” */
export function describeMissingCapabilities(appTitle: string, missing: readonly Capability[]): string {
  const parts = missing.map((c) => DESCRIPTIONS[c]);
  const list =
    parts.length <= 1
      ? parts.join("")
      : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `"${appTitle}" needs ${list}, which this Macintosh does not have.`;
}
