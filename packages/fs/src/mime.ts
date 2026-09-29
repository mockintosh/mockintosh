import { MIME } from "./types";

const BY_EXTENSION: Readonly<Record<string, string>> = {
  txt: MIME.text,
  md: MIME.markdown,
  markdown: MIME.markdown,
  html: MIME.html,
  htm: MIME.html,
  json: MIME.json,
  deck: MIME.deck,
  canvas: MIME.canvas,
  png: "image/png",
  pbm: "image/x-portable-bitmap",
  pntg: MIME.paint,
  mac: MIME.paint,
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  mp4: "video/mp4",
  mp3: "audio/mpeg",
  wav: "audio/wav",
};

/** Browser stills Preview (and, as alternates, Dither / Trace) open. */
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;

export function isImageType(type: string): boolean {
  return (IMAGE_TYPES as readonly string[]).includes(type);
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}

/** MIME type from a file name; `application/octet-stream` when unknown. */
export function inferMimeType(name: string): string {
  return BY_EXTENSION[extensionOf(name)] ?? MIME.binary;
}

/** Whether bodies of this type are UTF-8 text (safe to `readText`). */
export function isTextType(type: string): boolean {
  return (
    type.startsWith("text/") ||
    type === MIME.json ||
    type === MIME.deck ||
    type === MIME.canvas ||
    type === MIME.sprite ||
    type === MIME.appShortcut ||
    type === MIME.app ||
    type.endsWith("+json") ||
    type.endsWith("+xml")
  );
}
