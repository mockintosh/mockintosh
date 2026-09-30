#!/usr/bin/env python3
"""Convert AngelCode BMFont bitmap fonts (text .fnt + PNG atlas) into Decker %%FNT1 faces.

Each glyph is placed on a cell `lineHeight` tall with the baseline at `base`,
at its xoffset / yoffset, and cut from the atlas by alpha (>= 128 is ink).
Cells grow only where ink actually leaves the line (atlas rects carry
transparent padding). Glyphs whose ink overhangs their advance (f, j, y)
keep their advance through an `_OVERHANGS` table: ordinal → [advance, originX]. Only Decker's ordinals are kept (ASCII plus
DROM_CHARS); BMFont kerning pairs are dropped, as %%FNT1 has no kerning.

Usage:
  python3 scripts/import-bmfont.py
"""

from __future__ import annotations

import base64
import re
from dataclasses import dataclass
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DROM_PATH = ROOT / "packages/ui/src/fonts/drom.ts"
FONTS = ROOT / "public/fonts"
FACES = ROOT / "packages/ui/src/fonts/faces"

# family key, output module, [(export name, source .fnt, point size)]
IMPORTS = [
    ("jiskan", "jiskan.ts", [("BUILTIN_FONT_JISKAN_16", "Jiskan16.fnt", 16)]),
]


def read_drom_chars() -> str:
    source = DROM_PATH.read_text(encoding="utf-8")
    match = re.search(r'const DROM_CHARS =\s*"([^"]*)"', source)
    if not match:
        raise SystemExit(f"Could not parse DROM_CHARS from {DROM_PATH}")
    return match.group(1)


def ordinal_by_codepoint() -> dict[int, int]:
    mapping = {code: code for code in range(32, 127)}
    for index, ch in enumerate(read_drom_chars()):
        mapping[ord(ch)] = 127 + index
    return mapping


def parse_line(line: str) -> tuple[str, dict[str, str]]:
    tag, _, rest = line.partition(" ")
    fields = dict(re.findall(r'(\w+)=("[^"]*"|\S+)', rest))
    return tag, {k: v.strip('"') for k, v in fields.items()}


@dataclass
class Glyph:
    ordinal: int
    advance: int
    ink: list[tuple[int, int]]  # (x, y) relative to the pen, y from the line top


@dataclass
class Strike:
    size: int
    width: int
    height: int
    ascent: int
    descent: int
    glyphs: int
    data: str
    overhangs: dict[int, tuple[int, int]]


def convert(path: Path, size: int) -> Strike:
    common: dict[str, str] = {}
    page_file = ""
    chars: list[dict[str, str]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        tag, fields = parse_line(line)
        if tag == "common":
            common = fields
        elif tag == "page":
            page_file = fields["file"]
        elif tag == "char":
            chars.append(fields)
    line_height = int(common["lineHeight"])
    base = int(common["base"])
    atlas = Image.open(path.parent / page_file).convert("RGBA").getchannel("A")
    ordinals = ordinal_by_codepoint()

    glyphs: list[Glyph] = []
    for c in chars:
        ordinal = ordinals.get(int(c["id"]))
        if ordinal is None:
            continue
        x, y, w, h = (int(c[k]) for k in ("x", "y", "width", "height"))
        dx, dy = int(c["xoffset"]), int(c["yoffset"])
        ink = [
            (dx + i, dy + j)
            for j in range(h)
            for i in range(w)
            if atlas.getpixel((x + i, y + j)) >= 128
        ]
        glyphs.append(Glyph(ordinal, int(c["xadvance"]), ink))

    top = min([0] + [py for g in glyphs for _, py in g.ink])
    bottom = max([line_height] + [py + 1 for g in glyphs for _, py in g.ink])
    height = bottom - top
    cells = []
    overhangs: dict[int, tuple[int, int]] = {}
    for g in glyphs:
        left = min([0] + [px for px, _ in g.ink])
        right = max([g.advance] + [px + 1 for px, _ in g.ink])
        cells.append((g, left, max(1, right - left)))
        if left < 0 or right > g.advance:
            overhangs[g.ordinal] = (g.advance, -left)
    max_width = max(width for _, _, width in cells)
    if max_width > 255 or height > 255:
        raise SystemExit(f"{path.name}: {max_width}x{height} cell exceeds %%FNT1's one-byte sizes")

    byte_width = (max_width + 7) // 8
    out = bytearray([max_width, height, 0])
    for g, left, width in sorted(cells, key=lambda cell: cell[0].ordinal):
        packed = bytearray(byte_width * height)
        for px, py in g.ink:
            col, row = px - left, py - top
            packed[row * byte_width + (col >> 3)] |= 0x80 >> (col & 7)
        out += bytes([g.ordinal, width]) + packed
    ascent = base - top
    return Strike(
        size=size,
        width=max_width,
        height=height,
        ascent=ascent,
        descent=height - ascent,
        glyphs=len(cells),
        data="%%FNT1" + base64.b64encode(bytes(out)).decode("ascii"),
        overhangs=overhangs,
    )


def main() -> None:
    for family, module, sizes in IMPORTS:
        lines = [
            f"// Generated from public/fonts ({', '.join(src for _, src, _ in sizes)}). Do not hand-edit.",
            "//   python3 scripts/import-bmfont.py",
            "//",
        ]
        body = []
        for export, source, size in sizes:
            strike = convert(FONTS / source, size)
            lines.append(
                f"// {family} {size}: cell {strike.width}×{strike.height} "
                f"(ascent {strike.ascent} + descent {strike.descent}), {strike.glyphs} glyphs."
            )
            body.append(f'export const {export} = "{strike.data}";')
            body.append(
                f"export const {export}_INFO = {{ ascent: {strike.ascent}, descent: {strike.descent}, leading: 0 }};"
            )
            table = ", ".join(f"{o}: [{a}, {x}]" for o, (a, x) in sorted(strike.overhangs.items()))
            if table:
                body.append(
                    f"/** Ordinal → [advance, originX] for glyphs whose ink overhangs their advance. */\n"
                    f"export const {export}_OVERHANGS: Readonly<Record<number, readonly [number, number]>> = {{ {table} }};"
                )
            print(f"{family} {size}: {strike.width}x{strike.height}, {strike.glyphs} glyphs")
        (FACES / module).write_text("\n".join(lines + body) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
