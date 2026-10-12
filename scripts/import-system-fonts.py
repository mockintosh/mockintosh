#!/usr/bin/env python3
"""Bake the System 7.5.3 bitmap fonts into Mockintosh `%%MFN1` faces.

Reads Chicago, Geneva, Monaco and New York straight from a System 7.5.3
disk image: the System file's FONTs (Geneva 9 and 12, Monaco 9) and the
NFNTs in the Fonts folder's suitcases, every plain size each FOND lists.
Every glyph Apple drew comes across, keyed by its Unicode character
(Mac OS Roman, plus Chicago's ⌘ ✓ ◆ in the control range), with the
strike's own missing-character box.

Each strike keeps the cell Mockintosh has always laid it out in (`LAYOUT`):
rows Apple's font rectangle has above that cell, where capitals carry their
accents, become `inkAbove` instead of being cropped away. Advances are
Apple's, less the strike's `spacing`.

Geneva 9, Chicago 12 and Monaco 9 also keep the Central European letters
Decker drew for them (Ł, Ś, Ș, …) that Apple's strikes don't have; those
come from `scripts/decker-fonts.ts` and land on page strikes.

The disk image is not committed. Default source:

  /tmp/system753/System7_5_3.img

Usage:
  python3 scripts/import-system-fonts.py
  python3 scripts/import-system-fonts.py --image /path/to/System7_5_3.img

Needs `pip install machfs rsrcfork`.
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

import machfs
import rsrcfork

ROOT = Path(__file__).resolve().parents[1]
FONTS = ROOT / "packages/ui/src/fonts"
CHARMAP_PATH = FONTS / "charmap.ts"
DECKER_PATH = ROOT / "scripts/decker-fonts.ts"
OUT_DIR = FONTS / "faces/system"
DEFAULT_IMAGE = Path("/tmp/system753/System7_5_3.img")

# FOND family → registry key, and the suitcase in System Folder:Fonts.
FAMILIES = {
    "Chicago": "chicago",
    "Geneva": "geneva",
    "Monaco": "monaco",
    "New York": "newYork",
}

# (family, size) → (rows of Apple's rectangle above the cell, cell rows, spacing).
# The cells are the ones these strikes have always had, so text lays out as before.
LAYOUT = {
    ("chicago", 12): (2, 13, 2),
    ("geneva", 9): (2, 10, 1),
    ("geneva", 10): (0, 12, 0),
    ("geneva", 12): (2, 13, 0),
    ("geneva", 14): (0, 18, 0),
    ("geneva", 18): (0, 22, 0),
    ("geneva", 20): (0, 24, 0),
    ("geneva", 24): (0, 28, 0),
    ("monaco", 9): (0, 11, 1),
    ("monaco", 12): (0, 15, 0),
    ("newYork", 9): (0, 12, 0),
    ("newYork", 10): (0, 12, 0),
    ("newYork", 12): (0, 15, 0),
    ("newYork", 14): (0, 17, 0),
    ("newYork", 18): (0, 21, 0),
    ("newYork", 20): (0, 22, 0),
    ("newYork", 24): (0, 26, 0),
}

# Decker records whose extra letters supplement Apple's strike.
DECKER_SUPPLEMENTS = {
    ("geneva", 9): "BUILTIN_FONT_BODY",
    ("chicago", 12): "BUILTIN_FONT_MENU",
    ("monaco", 9): "BUILTIN_FONT_MONO",
}

# Chicago's menu symbols. 0x14 (the Apple logo) is also Mac OS Roman 0xF0.
CONTROL_SYMBOLS = {0x11: 0x2318, 0x12: 0x2713, 0x13: 0x25C6}

MISSING_CODE = 0xFFFFFF


def mac_roman_high() -> str:
    source = CHARMAP_PATH.read_text(encoding="utf-8")
    match = re.search(r"const MAC_ROMAN_HIGH =\s*((?:\"[^\"]*\"\s*\+?\s*)+);", source)
    if not match:
        raise SystemExit(f"Could not parse MAC_ROMAN_HIGH from {CHARMAP_PATH}")
    text = "".join(re.findall(r"\"([^\"]*)\"", match.group(1)))
    text = re.sub(r"\\u([0-9A-Fa-f]{4})", lambda m: chr(int(m.group(1), 16)), text)
    if len(text) != 128:
        raise SystemExit(f"MAC_ROMAN_HIGH has {len(text)} characters, expected 128")
    return text


def code_point_for(code: int, high: str) -> int | None:
    if 32 <= code <= 126:
        return code
    if code >= 0x80:
        return ord(high[code - 0x80])
    return CONTROL_SYMBOLS.get(code)


# --- Disk image -------------------------------------------------------------


def read_volume(image: Path) -> machfs.Volume:
    data = image.read_bytes()
    for offset in range(0, len(data) - 1026, 512):
        if data[offset + 1024 : offset + 1026] == b"BD":
            volume = machfs.Volume()
            volume.read(data[offset:])
            return volume
    raise SystemExit(f"{image}: no HFS volume found")


def open_rsrc(fork: bytes) -> rsrcfork.ResourceFile:
    fd, tmp = tempfile.mkstemp(suffix=".rsrc")
    os.write(fd, fork)
    os.close(fd)
    rf = rsrcfork.ResourceFile.open(tmp, fork="data")
    os.unlink(tmp)
    return rf


def fond_sizes(rf: rsrcfork.ResourceFile, family: str) -> list[tuple[int, int]]:
    """(size, resource ID) for each plain bitmap strike the FOND lists."""
    if b"FOND" not in rf:
        return []
    for res in rf[b"FOND"].values():
        if res.name != family.encode("mac_roman"):
            continue
        d = res.data
        n = struct.unpack(">h", d[52:54])[0] + 1
        entries = [struct.unpack(">3h", d[54 + i * 6 : 60 + i * 6]) for i in range(n)]
        return [(size, rid) for size, style, rid in entries if size > 0 and style == 0]
    return []


def has_font(rf: rsrcfork.ResourceFile, rid: int) -> bool:
    return any(kind in rf and rid in rf[kind] for kind in (b"NFNT", b"FONT"))


def strike_ids(system: rsrcfork.ResourceFile, suitcase: rsrcfork.ResourceFile, family: str) -> dict[int, tuple[int, rsrcfork.ResourceFile]]:
    """size → (resource ID, file): the System file's own strikes first (what it draws with), else the suitcase's.
    Chicago 12 is listed in the System FOND but lives in ROM; the suitcase has it."""
    sizes = {size: (rid, suitcase) for size, rid in fond_sizes(suitcase, family)}
    for size, rid in fond_sizes(system, family):
        if has_font(system, rid):
            sizes[size] = (rid, system)
    return sizes


def font_resource(sources: list[rsrcfork.ResourceFile], rid: int) -> bytes:
    for rf in sources:
        for kind in (b"NFNT", b"FONT"):
            if kind in rf and rid in rf[kind]:
                return bytes(rf[kind][rid].data)
    raise SystemExit(f"No NFNT or FONT {rid}")


# --- NFNT -------------------------------------------------------------------


def parse_nfnt(raw: bytes) -> dict:
    (_type, first, last, wid_max, kern_max, _ndesc, _frw, frh, _owtloc, ascent, descent, leading, row_words) = (
        struct.unpack(">13h", raw[:26])
    )
    strike = row_words * 2 * frh
    n_loc = last - first + 3
    loc_off = 26 + strike
    ow_off = loc_off + n_loc * 2
    loc = [struct.unpack(">H", raw[loc_off + i * 2 : loc_off + i * 2 + 2])[0] for i in range(n_loc)]
    ow = [struct.unpack(">h", raw[ow_off + i * 2 : ow_off + i * 2 + 2])[0] for i in range(n_loc - 1)]
    return {
        "first": first,
        "last": last,
        "kernMax": kern_max,
        "height": frh,
        "ascent": ascent,
        "descent": descent,
        "leading": leading,
        "rowBytes": row_words * 2,
        "image": raw[26 : 26 + strike],
        "loc": loc,
        "ow": ow,
    }


def nfnt_glyph(font: dict, index: int, spacing: int) -> dict | None:
    """Glyph `index` (0 = firstChar; last + 1 - first is the missing glyph) as a cell."""
    ow = font["ow"][index]
    if ow == -1:
        return None
    offset = (ow >> 8) & 0xFF
    advance = ow & 0xFF
    x0, x1 = font["loc"][index], font["loc"][index + 1]
    left = font["kernMax"] + offset
    image_width = x1 - x0
    lo = min(0, left)
    hi = max(advance - spacing, left + image_width, lo + 1)
    width = hi - lo
    rows = font["height"]
    pixels = bytearray(width * rows)
    for y in range(rows):
        for x in range(image_width):
            sx = x0 + x
            if font["image"][y * font["rowBytes"] + (sx >> 3)] & (0x80 >> (sx & 7)):
                pixels[y * width + (left - lo + x)] = 1
    return {"width": width, "advance": max(0, advance - spacing), "originX": -lo, "pixels": bytes(pixels)}


# --- Decker supplements -----------------------------------------------------

LEGACY_SYMBOLS = "⌘✓•⇧⌥"


def decker_glyphs(const: str) -> tuple[dict, list[dict]]:
    source = DECKER_PATH.read_text(encoding="utf-8")
    drom_match = re.search(r'const LEGACY_CHARS =\s*"([^"]*)"', (FONTS / "legacy.ts").read_text(encoding="utf-8"))
    if not drom_match:
        raise SystemExit("Could not parse LEGACY_CHARS from legacy.ts")
    drom = drom_match.group(1)
    match = re.search(rf'export const {const} = "([^"]+)"', source)
    if not match:
        raise SystemExit(f"Could not find {const} in {DECKER_PATH}")
    b = base64.b64decode(match.group(1)[6:])
    max_width, height, spacing = b[0], b[1], b[2]
    byte_width = (max_width + 7) // 8
    stride = byte_width * height
    glyphs = []
    p = 3
    while p + 2 + stride <= len(b):
        ordinal, width = b[p], b[p + 1]
        rows = b[p + 2 : p + 2 + stride]
        p += 2 + stride
        if 32 <= ordinal <= 126:
            cp = ordinal
        elif 127 <= ordinal < 127 + len(drom):
            cp = ord(drom[ordinal - 127])
        elif 241 <= ordinal < 241 + len(LEGACY_SYMBOLS):
            cp = ord(LEGACY_SYMBOLS[ordinal - 241])
        else:
            continue
        pixels = bytearray(width * height)
        for y in range(height):
            for x in range(width):
                if rows[y * byte_width + (x >> 3)] & (0x80 >> (x & 7)):
                    pixels[y * width + x] = 1
        glyphs.append({"codePoint": cp, "width": width, "pixels": bytes(pixels)})
    return {"height": height, "spacing": spacing}, glyphs


# --- Output -----------------------------------------------------------------


def encode(height: int, above: int, below: int, spacing: int, glyphs: list[dict]) -> str:
    rows = above + height + below
    out = bytearray([height, above, below, spacing, (len(glyphs) >> 8) & 0xFF, len(glyphs) & 0xFF])
    for g in glyphs:
        code = g["codePoint"]
        out += bytes([(code >> 16) & 0xFF, (code >> 8) & 0xFF, code & 0xFF, g["width"], g["advance"], g["originX"]])
        byte_width = (g["width"] + 7) // 8
        for y in range(rows):
            for bx in range(byte_width):
                byte = 0
                for bit in range(8):
                    x = bx * 8 + bit
                    if x < g["width"] and g["pixels"][y * g["width"] + x]:
                        byte |= 0x80 >> bit
                out.append(byte)
    return "%%MFN1" + base64.b64encode(bytes(out)).decode("ascii")


def const_name(family: str, size: int) -> str:
    return f"SYSTEM_FONT_{re.sub(r'([a-z])([A-Z])', r'\1_\2', family).upper()}_{size}"


# Header leading the layout was tuned against, where it differs from the
# strike's own (Chicago 12's NFNT says 1; menus and controls lay out with 0).
LEADING = {("chicago", 12): 0}


def bake(family: str, size: int, raw: bytes, high: str) -> tuple[str, dict, int, int]:
    font = parse_nfnt(raw)
    crop, height, spacing = LAYOUT[(family, size)]
    below = font["height"] - crop - height
    if below < 0:
        raise SystemExit(f"{family} {size}: {font['height']} rows don't fit cell {height} below {crop}")
    glyphs: list[dict] = []
    have: set[int] = set()
    for code in range(font["first"], font["last"] + 2):
        index = code - font["first"]
        missing = code == font["last"] + 1
        cp = MISSING_CODE if missing else code_point_for(code, high)
        if cp is None or cp in have:
            continue
        glyph = nfnt_glyph(font, index, spacing)
        if glyph is None:
            continue
        glyph["codePoint"] = cp
        glyphs.append(glyph)
        have.add(cp)
    apple = len(glyphs)
    const = DECKER_SUPPLEMENTS.get((family, size))
    if const:
        deck, extra = decker_glyphs(const)
        if deck["height"] != height:
            raise SystemExit(f"{family} {size}: Decker's cell is {deck['height']} rows, expected {height}")
        rows = crop + height + below
        for g in extra:
            if g["codePoint"] in have:
                continue
            pixels = bytearray(g["width"] * rows)
            pixels[crop * g["width"] : (crop + height) * g["width"]] = g["pixels"]
            # Advance is the cell, as it was: the strike adds its spacing.
            glyphs.append(
                {"codePoint": g["codePoint"], "width": g["width"], "advance": g["width"], "originX": 0, "pixels": bytes(pixels)}
            )
            have.add(g["codePoint"])
    record = encode(height, crop, below, spacing, glyphs)
    info = {"ascent": font["ascent"], "descent": font["descent"], "leading": LEADING.get((family, size), font["leading"])}
    return record, info, apple, len(glyphs) - apple


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--image", type=Path, default=DEFAULT_IMAGE)
    args = parser.parse_args()
    high = mac_roman_high()
    volume = read_volume(args.image)
    system_folder = volume["System Folder"]
    system = open_rsrc(system_folder["System"].rsrc)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    entries = []
    for fond_name, family in FAMILIES.items():
        suitcase = open_rsrc(system_folder["Fonts"][fond_name].rsrc)
        sizes = strike_ids(system, suitcase, fond_name)
        for size in sorted(sizes):
            if (family, size) not in LAYOUT:
                raise SystemExit(f"No LAYOUT for {family} {size}")
            rid, source = sizes[size]
            raw = font_resource([source], rid)
            record, info, apple, decker = bake(family, size, raw, high)
            name = const_name(family, size)
            path = OUT_DIR / f"{family}_{size}.ts"
            kind = "FONT" if source is system else "NFNT"
            extra = f", plus {decker} of Decker's letters Apple's strike lacks" if decker else ""
            path.write_text(
                f"// Generated from System 7.5.3 {kind} {rid} ({fond_name} {size}). Do not hand-edit.\n"
                f"//   python3 scripts/import-system-fonts.py\n"
                f"//\n"
                f"// FONT header: ascent {info['ascent']}, descent {info['descent']}, leading {info['leading']}.\n"
                f"// {apple} glyphs{extra}.\n"
                f'export const {name} = "{record}";\n',
                encoding="utf-8",
            )
            entries.append((family, size, name, info))
            print(f"{family} {size}: {apple} Apple glyphs{extra}")
    lines = ["// Generated by scripts/import-system-fonts.py. Do not hand-edit.", ""]
    for family, size, name, _ in entries:
        lines.append(f'import {{ {name} }} from "./{family}_{size}";')
    lines += [
        "",
        "export interface SystemStrike {",
        "  family: string;",
        "  size: number;",
        "  data: string;",
        "  info: { ascent: number; descent: number; leading: number };",
        "}",
        "",
        "/** Chicago, Geneva, Monaco and New York as System 7.5.3 ships them. */",
        "export const SYSTEM_STRIKES: readonly SystemStrike[] = [",
    ]
    for family, size, name, info in entries:
        lines.append(
            f'  {{ family: "{family}", size: {size}, data: {name}, info: {{ ascent: {info["ascent"]}, descent: {info["descent"]}, leading: {info["leading"]} }} }},'
        )
    lines += ["];", ""]
    (OUT_DIR / "generated.ts").write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    main()
