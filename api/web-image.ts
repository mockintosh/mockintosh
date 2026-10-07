import { fromOwnSite } from "./_guard.js";
import { RemoteError, fetchRemote } from "./_web/fetch.js";

const MAX_IMAGE_BYTES = 8_000_000;
/** Formats the Macintosh's image decoder reads. SVG and friends are refused. */
const DECODABLE = new Set(["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp", "image/bmp"]);

/**
 * `GET /api/web-image?url=…` — an image from a web page, for Safari to
 * decode and dither. Pages are cross-origin; the browser cannot read them.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
  if (!fromOwnSite(req)) return new Response("Forbidden", { status: 403 });
  const target = new URL(req.url).searchParams.get("url");
  if (!target) return new Response("Missing url", { status: 400 });
  try {
    const remote = await fetchRemote(target, { accept: "image/png,image/jpeg,image/gif,image/webp,*/*;q=0.5", maxBytes: MAX_IMAGE_BYTES });
    const type = remote.contentType.split(";")[0]!.trim().toLowerCase();
    if (!DECODABLE.has(type)) return new Response(`Not a decodable image (${type || "unknown"})`, { status: 415 });
    return new Response(remote.bytes, {
      status: 200,
      headers: { "Content-Type": type, "Cache-Control": "public, max-age=86400" },
    });
  } catch (error) {
    const status = error instanceof RemoteError ? 502 : 500;
    return new Response(error instanceof Error ? error.message : "Could not load image", { status });
  }
}
