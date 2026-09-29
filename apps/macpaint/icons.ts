/**
 * MacPaint's Finder sprites. Split out of the app so the App Store can show
 * the icon, and existing documents can keep theirs, before the app is installed.
 */
import type { Sprite } from "@mockintosh/sdk";
import { APP_ICON, DOCUMENT_ICON } from "./art";

export const sprites: Record<string, Sprite> = {
  "macpaint/icon": APP_ICON,
  "macpaint/document": DOCUMENT_ICON,
};
