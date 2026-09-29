/**
 * Sprite files — `image/x-mockintosh-sprite` — are how apps keep 1-bit
 * pictures in the file system: a JSON body with the sprite's size and its
 * base64 2 bpp pixels (`encodeSprite`). PhotoBooth, Dither, MacPaint and
 * Surface write them; Preview opens them by default; the Finder shows them
 * with a picture icon.
 */
import { MIME, type FSFile, type NodeAttributes } from "@mockintosh/fs";
import { defineSprite, encodeSprite, type ImageFrame, type Sprite } from "@mockintosh/ui";
import type { AppFileSystem } from "./index";
import type { ImageService } from "./media";
import { paintToImageFrame, readPaintFile } from "./paintFile";

/** JSON body of a sprite file. */
export interface SpriteFileContent {
  width: number;
  height: number;
  /** Base64 2 bpp pixels, see `defineSprite`. */
  data: string;
}

function isSpriteFileContent(v: unknown): v is SpriteFileContent {
  const c = v as Partial<SpriteFileContent> | null;
  return !!c && typeof c.width === "number" && typeof c.height === "number" && typeof c.data === "string";
}

/** Decode a sprite file, or `null` if the body is not one. */
export async function readSpriteFile(fs: AppFileSystem, fileId: string): Promise<Sprite | null> {
  const content = await fs.readJSON<unknown>(fileId);
  if (!isSpriteFileContent(content)) return null;
  return defineSprite(content.width, content.height, content.data);
}

/**
 * Expand a 1-bit sprite to RGBA so adjust / dither / decode-style pipelines
 * can take a Photo Booth or Dither save. `1` = black → rgb 0; `0` = white → 255.
 */
export function spriteToImageFrame(sprite: Sprite): ImageFrame {
  const { width, height, data } = sprite;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, o = 0; i < data.length; i++, o += 4) {
    const v = data[i] ? 0 : 255;
    rgba[o] = v;
    rgba[o + 1] = v;
    rgba[o + 2] = v;
    rgba[o + 3] = 255;
  }
  return { width, height, rgba };
}

export interface ReadImageFileOptions {
  maxWidth?: number;
  maxHeight?: number;
}

/**
 * Load a still as RGBA. Sprite and MacPaint files are expanded locally — never
 * handed to `images.decode`, which would feed them to `createImageBitmap` and hang.
 */
export async function readImageFile(
  fs: AppFileSystem,
  images: ImageService | undefined,
  fileId: string,
  options?: ReadImageFileOptions,
): Promise<ImageFrame> {
  const file = fs.file(fileId);
  if (!file) throw new Error("The image could not be found.");
  if (file.type === MIME.sprite) {
    const sprite = await readSpriteFile(fs, fileId);
    if (!sprite) throw new Error(`Couldn't read "${file.name}".`);
    return spriteToImageFrame(sprite);
  }
  if (file.type === MIME.paint) {
    const doc = await readPaintFile(fs, fileId);
    if (!doc) throw new Error(`Couldn't read "${file.name}".`);
    return paintToImageFrame(doc);
  }
  if (!images) throw new Error("This Macintosh cannot decode images.");
  const bytes = await fs.readBytes(fileId);
  if (!bytes) throw new Error(`Couldn't read "${file.name}".`);
  return images.decode(bytes, file.type, options);
}

export interface WriteSpriteFileOptions {
  /** Attributes for the new node, e.g. a Finder `icon`. */
  attributes?: NodeAttributes;
}

/** Write `sprite` as a sprite file named `name` in the directory `parentId`. */
export function writeSpriteFile(
  fs: AppFileSystem,
  parentId: string,
  name: string,
  sprite: Sprite,
  options: WriteSpriteFileOptions = {}
): Promise<FSFile> {
  const content: SpriteFileContent = {
    width: sprite.width,
    height: sprite.height,
    data: encodeSprite(sprite),
  };
  return fs.writeJSON(parentId, name, content, { type: MIME.sprite, attributes: options.attributes });
}
