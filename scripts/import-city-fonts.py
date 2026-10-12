#!/usr/bin/env python3
"""Bake original Macintosh city-font bitmap strikes into Decker %%FNT1 faces.

Sources (not committed):

  System 6.0.8 Fonts suitcase — Chicago, Geneva, New York, Monaco, Venice,
  London, Athens, San Francisco, Cairo, Los Angeles at every plain size
  listed in the FOND.

  LOSTFONTS suitcase — Toronto (removed from System 6).

Chicago, Geneva, Monaco and New York come from System 7.5.3 instead
(`scripts/import-system-fonts.py`) and are not written here.

Usage:
  python3 scripts/import-city-fonts.py
  python3 scripts/import-city-fonts.py --fonts /path/to/appledouble-or-rsrc
"""

from __future__ import annotations

import argparse
import base64
import os
import re
import struct
import sys
import tempfile
from pathlib import Path

import rsrcfork

sys.path.insert(0, str(Path(__file__).resolve().parent))
from dcmp3 import decompress_dcmp3  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
DROM_PATH = ROOT / "packages/ui/src/fonts/drom.ts"
OUT_DIR = ROOT / "packages/ui/src/fonts/faces/city"

DEFAULT_FONTS = Path("/tmp/macfonts-src/originals/__MACOSX/._System 6.0.8 Fonts~")
DEFAULT_TORONTO = Path("/tmp/macfonts-src/originals/__MACOSX/._LOSTFONTS")

CITY_FAMILIES = {
    "chicago": "chicago",
    "geneva": "geneva",
    "new york": "newYork",
    "monaco": "monaco",
    "venice": "venice",
    "london": "london",
    "athens": "athens",
    "san francisco": "sanFrancisco",
    "toronto": "toronto",
    "cairo": "cairo",
    "los angeles": "losAngeles",
}

# Imported from System 7.5.3 by import-system-fonts.py.
SYSTEM_753_FAMILIES = {"chicago", "geneva", "monaco", "newYork"}

APPLEDOUBLE_MAGIC = b"\x00\x05\x16\x07"
APPLEDOUBLE_RSRC = 2


def appledouble_rsrc(data: bytes) -> bytes | None:
    if data[:4] != APPLEDOUBLE_MAGIC or len(data) < 26:
        return None
    n = struct.unpack(">H", data[24:26])[0]
    for i in range(n):
        off = 26 + i * 12
        if off + 12 > len(data):
            break
        eid, eoff, elen = struct.unpack(">III", data[off : off + 12])
        if eid == APPLEDOUBLE_RSRC:
            return data[eoff : eoff + elen]
    return None


def parse_macbinary(data: bytes) -> bytes:
    if len(data) < 128 or data[0] != 0:
        return data
    data_len = struct.unpack(">I", data[83:87])[0]
    rsrc_len = struct.unpack(">I", data[87:91])[0]
    data_pad = (data_len + 127) & ~127
    return data[128 + data_pad : 128 + data_pad + rsrc_len]


def resource_bytes(res) -> bytes:
    raw = bytes(res.data_raw)
    try:
        info = res.compressed_info
    except Exception:
        info = None
    if not info:
        return raw
    if getattr(info, "dcmp_id", None) != 3:
        return raw
    return decompress_dcmp3(raw[info.header_length :], info.decompressed_length)


def load_rsrc_blob(path: Path) -> bytes:
    blob = path.read_bytes()
    ad = appledouble_rsrc(blob)
    if ad is not None:
        return ad
    if blob[:1] == b"\x00" and len(blob) >= 128:
        return parse_macbinary(blob)
    return blob


def open_resources(path: Path):
    blob = load_rsrc_blob(path)
    fd, tmp = tempfile.mkstemp(suffix=".rsrc")
    try:
        os.write(fd, blob)
        os.close(fd)
        return rsrcfork.ResourceFile.open(tmp, fork="data"), tmp
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def read_drom_chars() -> str:
    source = DROM_PATH.read_text(encoding="utf-8")
    match = re.search(r'const DROM_CHARS =\s*"([^"]*)"', source)
    if not match:
        raise SystemExit(f"Could not parse DROM_CHARS from {DROM_PATH}")
    return match.group(1)


def decker_ordinal(ch: str, drom: str) -> int | None:
    code = ord(ch)
    if code == 10 or 32 <= code <= 126:
        return code
    index = drom.find(ch)
    if index >= 0:
        return 127 + index
    return None


def parse_font(raw: bytes) -> dict:
    (
        _font_type,
        first_char,
        last_char,
        wid_max,
        _kern_max,
        _n_descent,
        _f_rect_width,
        f_rect_height,
        _ow_t_loc,
        ascent,
        descent,
        leading,
        row_words,
    ) = struct.unpack(">13h", raw[:26])
    strike_bytes = row_words * 2 * f_rect_height
    n_loc = last_char - first_char + 3
    n_ow = last_char - first_char + 2
    loc_off = 26 + strike_bytes
    ow_off = loc_off + n_loc * 2
    loc = [struct.unpack(">H", raw[loc_off + i * 2 : loc_off + i * 2 + 2])[0] for i in range(n_loc)]
    ow = [struct.unpack(">h", raw[ow_off + i * 2 : ow_off + i * 2 + 2])[0] for i in range(n_ow)]
    return {
        "first": first_char,
        "last": last_char,
        "widMax": wid_max,
        "fRectHeight": f_rect_height,
        "ascent": ascent,
        "descent": descent,
        "leading": leading,
        "rowWords": row_words,
        "loc": loc,
        "ow": ow,
        "bitImage": raw[26 : 26 + strike_bytes],
    }


def bit_at(font: dict, x: int, y: int) -> bool:
    if y < 0 or y >= font["fRectHeight"] or x < 0:
        return False
    row_bytes = font["rowWords"] * 2
    index = y * row_bytes + (x >> 3)
    if index >= len(font["bitImage"]):
        return False
    byte = font["bitImage"][index]
    return bool((byte >> (7 - (x & 7))) & 1)


def glyph_image(font: dict, code: int) -> tuple[int, int, int] | None:
    index = code - font["first"]
    if index < 0 or index >= len(font["ow"]):
        return None
    ow = font["ow"][index]
    if ow == -1:
        return None
    x0 = font["loc"][index]
    x1 = font["loc"][index + 1]
    return x0, x1, ow


def crop_top_rows(font: dict) -> int:
    crop = 0
    for y in range(font["fRectHeight"]):
        ink = False
        for code in range(font["first"], font["last"] + 1):
            image = glyph_image(font, code)
            if image is None:
                continue
            x0, x1, _ow = image
            for x in range(x0, x1):
                if bit_at(font, x, y):
                    ink = True
                    break
            if ink:
                break
        if ink:
            break
        crop += 1
    return min(crop, max(0, font["fRectHeight"] - 1))


def pack_glyph(font: dict, code: int, cell_height: int, max_width: int, crop_top: int) -> tuple[int, bytes] | None:
    image = glyph_image(font, code)
    if image is None:
        return None
    x0, x1, ow = image
    offset = (ow >> 8) & 0xFF
    if offset >= 128:
        offset -= 256
    advance = ow & 0xFF
    if advance < 1:
        return None
    image_width = x1 - x0
    byte_width = (max_width + 7) // 8
    packed = bytearray(byte_width * cell_height)
    for y in range(cell_height):
        src_y = y + crop_top
        for x in range(image_width):
            dest_x = offset + x
            if dest_x < 0 or dest_x >= max_width:
                continue
            if bit_at(font, x0 + x, src_y):
                packed[y * byte_width + (dest_x >> 3)] |= 1 << (7 - (dest_x & 7))
    return advance, bytes(packed)


def encode_fnt1(max_width: int, height: int, spacing: int, glyphs: list[tuple[int, int, bytes]]) -> str:
    payload = bytearray([max_width, height, spacing])
    stride = ((max_width + 7) // 8) * height
    for ordinal, width, data in glyphs:
        if len(data) != stride:
            raise SystemExit(f"glyph {ordinal} packed to {len(data)} bytes, expected {stride}")
        payload.append(ordinal)
        payload.append(width)
        payload.extend(data)
    return "%%FNT1" + base64.b64encode(payload).decode("ascii")


def ts_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


def export_const(family: str, size: int) -> str:
    return f"BUILTIN_FONT_{family.upper()}_{size}"


def file_stem(family: str, size: int) -> str:
    return f"{family}_{size}"


def fond_strikes(rf) -> list[tuple[str, int, int]]:
    found: list[tuple[str, int, int]] = []
    if b"FOND" not in rf:
        return found
    for _rid, res in rf[b"FOND"].items():
        name = res.name.decode("mac_roman") if res.name else ""
        family = CITY_FAMILIES.get(name.lower())
        if not family:
            continue
        raw = resource_bytes(res)
        if len(raw) < 54:
            continue
        n = struct.unpack(">h", raw[52:54])[0] + 1
        for i in range(n):
            off = 54 + i * 6
            if off + 6 > len(raw):
                break
            size, style, font_id = struct.unpack(">hhh", raw[off : off + 6])
            if style != 0 or size <= 0 or size > 24:
                continue
            found.append((family, size, font_id))
    return found


def font_id_strikes(rf) -> list[tuple[str, int, int]]:
    """Old FONT id encoding: family in bits 7–14, size in bits 0–6."""
    found: list[tuple[str, int, int]] = []
    if b"FONT" not in rf:
        return found
    names: dict[int, str] = {}
    for rid, res in rf[b"FONT"].items():
        family_id = (rid >> 7) & 0xFF
        size = rid & 0x7F
        if size == 0 and res.name:
            names[family_id] = res.name.decode("mac_roman")
    for rid, res in rf[b"FONT"].items():
        family_id = (rid >> 7) & 0xFF
        size = rid & 0x7F
        if size <= 0 or size > 24:
            continue
        raw_name = names.get(family_id, "")
        family = CITY_FAMILIES.get(raw_name.lower())
        if not family:
            continue
        found.append((family, size, rid))
    return found


def load_font_resource(rf, font_id: int) -> bytes:
    if b"FONT" in rf and font_id in rf[b"FONT"]:
        return resource_bytes(rf[b"FONT"][font_id])
    if b"NFNT" in rf and font_id in rf[b"NFNT"]:
        return resource_bytes(rf[b"NFNT"][font_id])
    raise KeyError(font_id)


def collect_from(path: Path) -> list[tuple[str, int, dict]]:
    rf, tmp = open_resources(path)
    try:
        strikes = fond_strikes(rf)
        if not strikes:
            strikes = font_id_strikes(rf)
        out: list[tuple[str, int, dict]] = []
        for family, size, font_id in strikes:
            raw = load_font_resource(rf, font_id)
            if len(raw) < 26:
                continue
            out.append((family, size, parse_font(raw)))
        return out
    finally:
        rf.close()
        try:
            os.unlink(tmp)
        except OSError:
            pass


def bake(family: str, size: int, font: dict, drom: str) -> tuple[str, dict]:
    crop_top = crop_top_rows(font)
    cell_height = font["fRectHeight"] - crop_top
    max_width = font["widMax"]
    glyphs: list[tuple[int, int, bytes]] = []
    seen: set[int] = set()
    for code in range(font["first"], font["last"] + 1):
        try:
            ch = bytes([code]).decode("mac_roman")
        except UnicodeDecodeError:
            continue
        ordinal = decker_ordinal(ch, drom)
        if ordinal is None:
            continue
        packed = pack_glyph(font, code, cell_height, max_width, crop_top)
        if packed is None or ordinal in seen:
            continue
        seen.add(ordinal)
        advance, data = packed
        glyphs.append((ordinal, advance, data))
    glyphs.sort(key=lambda item: item[0])
    record = encode_fnt1(max_width, cell_height, 0, glyphs)
    meta = {
        "ascent": font["ascent"],
        "descent": font["descent"],
        "leading": font["leading"],
        "cellHeight": cell_height,
        "maxWidth": max_width,
        "cropTop": crop_top,
        "glyphs": len(glyphs),
    }
    return record, meta


def write_strike(family: str, size: int, record: str, meta: dict, source: str) -> Path:
    const = export_const(family, size)
    path = OUT_DIR / f"{file_stem(family, size)}.ts"
    path.write_text(
        f"""\
// Generated from {source} {family} {size}. Do not hand-edit.
//   python3 scripts/import-city-fonts.py
//
// FONT header: ascent {meta["ascent"]}, descent {meta["descent"]}, leading {meta["leading"]}.
// Cell {meta["maxWidth"]}×{meta["cellHeight"]} after cropping {meta["cropTop"]} blank rows, {meta["glyphs"]} glyphs.
export const {const} = "{ts_escape(record)}";
""",
        encoding="utf-8",
    )
    return path


def write_generated(entries: list[tuple[str, int, dict]]) -> None:
    imports: list[str] = []
    rows: list[str] = []
    for family, size, meta in entries:
        const = export_const(family, size)
        stem = file_stem(family, size)
        imports.append(f'import {{ {const} }} from "./{stem}";')
        rows.append(
            "  { "
            f'family: "{family}", size: {size}, data: {const}, '
            f'info: {{ ascent: {meta["ascent"]}, descent: {meta["descent"]}, leading: {meta["leading"]} }} '
            "},"
        )
    path = OUT_DIR / "generated.ts"
    header = "\n".join(imports)
    body = "\n".join(rows)
    path.write_text(
        "// Generated by scripts/import-city-fonts.py. Do not hand-edit.\n\n"
        f"{header}\n\n"
        "export interface CityStrike {\n"
        "  family: string;\n"
        "  size: number;\n"
        "  data: string;\n"
        "  info: { ascent: number; descent: number; leading: number };\n"
        "}\n\n"
        "export const CITY_GENERATED: readonly CityStrike[] = [\n"
        f"{body}\n"
        "];\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fonts", type=Path, default=DEFAULT_FONTS, help="System 6 Fonts suitcase (AppleDouble or rsrc)")
    parser.add_argument("--toronto", type=Path, default=DEFAULT_TORONTO, help="LOSTFONTS suitcase with Toronto")
    args = parser.parse_args()
    if not args.fonts.is_file():
        raise SystemExit(f"missing Fonts suitcase: {args.fonts}")

    drom = read_drom_chars()
    collected: dict[tuple[str, int], tuple[dict, str]] = {}
    for path, label in ((args.fonts, "System 6.0.8 Fonts"), (args.toronto, "LOSTFONTS")):
        if not path.is_file():
            if path == args.toronto:
                print(f"skip Toronto source (missing): {path}")
                continue
            raise SystemExit(f"missing {label}: {path}")
        for family, size, font in collect_from(path):
            key = (family, size)
            if key[0] in SYSTEM_753_FAMILIES or key in collected:
                continue
            collected[key] = (font, label)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    written: list[tuple[str, int, dict]] = []
    for family, size in sorted(collected, key=lambda item: (item[0], item[1])):
        font, source = collected[(family, size)]
        record, meta = bake(family, size, font, drom)
        path = write_strike(family, size, record, meta, source)
        written.append((family, size, meta))
        print(
            f"Wrote {path.name} — {meta['glyphs']} glyphs, "
            f"{meta['maxWidth']}×{meta['cellHeight']} cell, "
            f"ascent {meta['ascent']} descent {meta['descent']} leading {meta['leading']}"
        )

    write_generated(written)
    print(f"Wrote {len(written)} city strikes → {OUT_DIR}")


if __name__ == "__main__":
    main()
