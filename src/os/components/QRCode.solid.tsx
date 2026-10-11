import { createMemo } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { encodeQR, type Sprite } from "@mockintosh/sdk";

/** White modules around the code that scanners need. */
const QUIET_MODULES = 4;

/** The largest whole-pixel module size that fits the code and its quiet zone in `box`. */
function qrScale(qr: Sprite, box: number): number {
  return Math.max(1, Math.floor(box / (qr.width + QUIET_MODULES * 2)));
}

function qrPixels(qr: Sprite, scale: number): Uint8Array {
  const size = qr.width * scale;
  const pixels = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      pixels[y * size + x] = qr.data[Math.floor(y / scale) * qr.width + Math.floor(x / scale)];
    }
  }
  return pixels;
}

/**
 * `link` as a QR code, in whole-pixel modules, as large as fits `box`
 * screen pixels with the quiet zone a scanner needs (place it in a
 * `box`-sized white box). The sign-in sheet's and the Computer Club's.
 */
export function QRCode(props: { link: string; box: number; name: string; onClick?: () => void }): JSX.Element {
  const drawn = createMemo(() => {
    const qr = encodeQR(props.link);
    const scale = qrScale(qr, props.box);
    return { size: qr.width * scale, pixels: qrPixels(qr, scale) };
  });
  return (
    <raster
      semantic={{ name: props.name, role: "image", value: props.link }}
      width={drawn().size}
      height={drawn().size}
      onClick={props.onClick}
      onPaint={({ blitPixels }) => blitPixels(drawn().pixels, drawn().size, drawn().size)}
    />
  );
}
