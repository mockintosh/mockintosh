/**
 * Reading a .zip without unpacking it: the central directory says where
 * each entry is, and an entry is inflated when something reads it. A
 * program's bundle (Python and its standard library) ships as one zip.
 */
import { InMemoryFs } from "just-bash/browser";
import { inflateRaw } from "./platform";

interface Entry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

export class ZipArchive {
  readonly entries = new Map<string, Entry>();
  private view: DataView;

  constructor(private bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // End of central directory: the last 0x06054b50 within the trailing 64 KiB.
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (this.view.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error("Not a zip archive");
    const count = this.view.getUint16(eocd + 10, true);
    let at = this.view.getUint32(eocd + 16, true);
    const decoder = new TextDecoder();
    for (let i = 0; i < count; i++) {
      if (this.view.getUint32(at, true) !== 0x02014b50) throw new Error("Damaged zip directory");
      const method = this.view.getUint16(at + 10, true);
      const compressedSize = this.view.getUint32(at + 20, true);
      const size = this.view.getUint32(at + 24, true);
      const nameLength = this.view.getUint16(at + 28, true);
      const extraLength = this.view.getUint16(at + 30, true);
      const commentLength = this.view.getUint16(at + 32, true);
      const localOffset = this.view.getUint32(at + 42, true);
      const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
      this.entries.set(name, { name, method, compressedSize, size, localOffset });
      at += 46 + nameLength + extraLength + commentLength;
    }
  }

  /** The entry's bytes, inflated. */
  async read(name: string): Promise<Uint8Array> {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`ENOENT: no such file in archive, open '${name}'`);
    const local = entry.localOffset;
    const start = local + 30 + this.view.getUint16(local + 26, true) + this.view.getUint16(local + 28, true);
    const compressed = this.bytes.subarray(start, start + entry.compressedSize);
    if (entry.method === 0) return compressed.slice();
    if (entry.method !== 8) throw new Error(`Unsupported zip compression ${entry.method} for ${name}`);
    return inflateRaw(compressed);
  }
}

/**
 * The archive's entries under `from` (a folder in the zip) as a read-only
 * file system tree, inflated on first read.
 */
export function zipFileSystem(archive: ZipArchive, from: string): InMemoryFs {
  const files: Record<string, () => Promise<Uint8Array>> = {};
  const prefix = from.endsWith("/") ? from : `${from}/`;
  for (const name of archive.entries.keys()) {
    if (!name.startsWith(prefix) || name.endsWith("/")) continue;
    files[`/${name.slice(prefix.length)}`] = () => archive.read(name);
  }
  return new InMemoryFs(files);
}
