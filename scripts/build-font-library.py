#!/usr/bin/env python3
"""Build the font library: downloadable suitcases in `public/fonts/library/`.

These families aren't built into Mockintosh. The App Store lists them from
`index.json`, and installing one copies its `.suit` into System Folder › Fonts.
Every strike is an `%%MFN1` record keyed by Unicode, with every character
the source draws.

  Redaction    every pixel cut of Redaction (SIL OFL), Regular, Bold and
               Italic, each at the size where its grid is one pixel:
               Redaction 100 → 10, 70 → 14, 50 → 20, 35 → 29, 20 → 50, 10 → 100.
               Sources: `@fontsource/redaction-<cut>` (npm).
  Geist Pixel  Geist Pixel Square (SIL OFL) on its 38-unit grid, at 24.
               Source: the `geist` npm package.
  Lisa         LisaTerminal Paper Raw (Kreative Relay Free Use 1.2f) on its
               100-unit grid, at 12. Source: lisa1.zip from kreativekorp.com
               (`1X1Y/LisaTerminalPaperRaw.ttf`). Without `--lisa`, the
               suitcase already in the library is kept.
  Jiskan       Jiskan 16 from the AngelCode BMFont in `public/fonts`.

The outline fonts draw every point on a pixel grid with straight edges, so
each pixel is sampled at its centre (nonzero winding), which is exact.
Each strike keeps the line box it has always had (`LAYOUT`); ink outside it
becomes `inkAbove` / `inkBelow`.

Usage:
  npm pack geist @fontsource/redaction-{10,20,35,50,70,100}   # then unpack each
  python3 scripts/build-font-library.py --geist path/to/GeistPixel-Square.woff2 \\
      --redaction path/to/unpacked/@fontsource [--lisa path/to/LisaTerminalPaperRaw.ttf]

Needs `pip install fonttools brotli pillow`.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
from pathlib import Path

from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.ttLib import TTFont
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
LIBRARY = ROOT / "public/fonts/library"
JISKAN_FNT = ROOT / "public/fonts/Jiskan16.fnt"

_spec = importlib.util.spec_from_file_location("import_system_fonts", ROOT / "scripts/import-system-fonts.py")
sysfonts = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sysfonts)

# (family key, size, style) → (ascent, descent): the line box each strike has always had.
LAYOUT = {
    ("redaction", 10, 0): (10, 3), ("redaction", 14, 0): (14, 5), ("redaction", 20, 0): (19, 6),
    ("redaction", 29, 0): (28, 9), ("redaction", 50, 0): (47, 15), ("redaction", 100, 0): (95, 30),
    ("redaction", 10, 1): (10, 3), ("redaction", 14, 1): (14, 5), ("redaction", 20, 1): (19, 6),
    ("redaction", 29, 1): (28, 9), ("redaction", 50, 1): (48, 15), ("redaction", 100, 1): (97, 30),
    ("redaction", 10, 2): (10, 3), ("redaction", 14, 2): (14, 5), ("redaction", 20, 2): (18, 6),
    ("redaction", 29, 2): (27, 9), ("redaction", 50, 2): (47, 15), ("redaction", 100, 2): (95, 30),
    ("geistpixel", 24, 0): (25, 6),
    ("lisa", 12, 0): (10, 2),
    ("jiskan", 16, 0): (14, 3),
}

# The size a font menu picks each family at.
DEFAULT_SIZES = {"redaction": 20, "geistpixel": 24, "lisa": 12, "jiskan": 16}

REDACTION_CUTS = (100, 70, 50, 35, 20, 10)
# Suitcase style bits → fontsource file suffix.
REDACTION_STYLES = {0: "400-normal", 1: "700-normal", 2: "400-italic"}

ABOUT = {
    "redaction": {
        "family": "Redaction",
        "file": "redaction.suit",
        "designer": "MCKL",
        "description": "Redaction's pixel cuts, from 10 to 100 points, in Regular, Bold and Italic.",
        "license": "SIL Open Font License 1.1",
        "licenseFile": "LICENSE-Redaction.txt",
    },
    "geistpixel": {
        "family": "Geist Pixel",
        "file": "geist-pixel.suit",
        "designer": "Vercel",
        "description": "The Square cut of Geist Pixel.",
        "license": "SIL Open Font License 1.1",
        "licenseFile": "LICENSE-GeistPixel.txt",
    },
    "lisa": {
        "family": "Lisa",
        "file": "lisa.suit",
        "designer": "Kreative Software",
        "description": "The Apple Lisa's terminal font.",
        "license": "Kreative Relay Free Use License 1.2f",
        "licenseFile": "LICENSE-LisaTerminal.txt",
    },
    "jiskan": {
        "family": "Jiskan",
        "file": "jiskan.suit",
        "designer": "X11 Japanese bitmap fonts",
        "description": "The Latin letters of Jiskan 16.",
        "license": "Public domain",
    },
}


# --- Strikes from ink -------------------------------------------------------


def glyph_from_ink(cp: int, advance: int, ink: list[tuple[int, int]], ascent: int, above: int, rows: int) -> dict:
    """`ink` is (x from the pen, y up from the baseline) pixels."""
    left = min([0] + [x for x, _ in ink])
    right = max([advance, left + 1] + [x + 1 for x, _ in ink])
    width = right - left
    pixels = bytearray(width * rows)
    for x, y in ink:
        pixels[(above + ascent - 1 - y) * width + (x - left)] = 1
    return {"codePoint": cp, "width": width, "advance": advance, "originX": -left, "pixels": bytes(pixels)}


def strike(glyphs: list[tuple[int, int, list[tuple[int, int]]]], ascent: int, descent: int) -> tuple[str, dict, int]:
    """(code point, advance, ink) glyphs on a line box `ascent` + `descent` tall → `%%MFN1`."""
    above = max([0] + [y + 1 - ascent for _, _, ink in glyphs for _, y in ink])
    below = max([0] + [-y - descent for _, _, ink in glyphs for _, y in ink])
    rows = above + ascent + descent + below
    out = [glyph_from_ink(cp, adv, ink, ascent, above, rows) for cp, adv, ink in sorted(glyphs)]
    info = {"ascent": ascent, "descent": descent, "leading": 0}
    return sysfonts.encode(ascent + descent, above, below, 0, out), info, len(out)


# --- Pixel-grid outline fonts ----------------------------------------------


def contours_of(glyph_set, name: str, label: str) -> list[list[tuple[float, float]]]:
    pen = DecomposingRecordingPen(glyph_set)
    glyph_set[name].draw(pen)
    contours: list[list[tuple[float, float]]] = []
    for op, args in pen.value:
        if op == "moveTo":
            contours.append([args[0]])
        elif op == "lineTo":
            contours[-1].append(args[0])
        elif op in ("closePath", "endPath"):
            continue
        else:
            raise SystemExit(f"{label}: curved outline ({op})")
    return contours


def inside(contours: list[list[tuple[float, float]]], x: float, y: float) -> bool:
    winding = 0
    for contour in contours:
        for i, (x0, y0) in enumerate(contour):
            x1, y1 = contour[(i + 1) % len(contour)]
            if (y1 > y) if y0 <= y else (y1 <= y):
                cross = (x1 - x0) * (y - y0) - (x - x0) * (y1 - y0)
                if (cross > 0) if y1 > y0 else (cross < 0):
                    winding += 1 if y1 > y0 else -1
    return winding != 0


def grid_glyphs(path: Path, grid: int) -> list[tuple[int, int, list[tuple[int, int]]]]:
    """Every character the font maps, sampled one pixel per `grid` units."""
    font = TTFont(path)
    glyph_set = font.getGlyphSet()
    hmtx = font["hmtx"]
    out = []
    for cp, name in sorted(font.getBestCmap().items()):
        if cp < 32 or 0x7F <= cp < 0xA0:
            continue
        label = f"{path.name} U+{cp:04X}"
        contours = [[(x / grid, y / grid) for x, y in c] for c in contours_of(glyph_set, name, label)]
        ink = []
        points = [p for c in contours for p in c]
        if points:
            xs, ys = [p[0] for p in points], [p[1] for p in points]
            for y in range(int(min(ys)) - 1, int(max(ys)) + 1):
                for x in range(int(min(xs)) - 1, int(max(xs)) + 1):
                    if inside(contours, x + 0.5, y + 0.5):
                        ink.append((x, y))
        out.append((cp, round(hmtx[name][0] / grid), ink))
    return out


# --- BMFont -----------------------------------------------------------------


def bmfont_glyphs(path: Path) -> list[tuple[int, int, list[tuple[int, int]]]]:
    common: dict[str, str] = {}
    page = ""
    chars = []
    for line in path.read_text(encoding="utf-8").splitlines():
        tag, _, rest = line.partition(" ")
        fields = dict(re.findall(r'(\w+)=("[^"]*"|\S+)', rest))
        fields = {k: v.strip('"') for k, v in fields.items()}
        if tag == "common":
            common = fields
        elif tag == "page":
            page = fields["file"]
        elif tag == "char":
            chars.append(fields)
    base = int(common["base"])
    atlas = Image.open(path.parent / page).convert("RGBA").getchannel("A")
    out = []
    for c in chars:
        cp = int(c["id"])
        if cp < 32:
            continue
        x, y, w, h = (int(c[k]) for k in ("x", "y", "width", "height"))
        dx, dy = int(c["xoffset"]), int(c["yoffset"])
        ink = [(dx + i, base - 1 - (dy + j)) for j in range(h) for i in range(w) if atlas.getpixel((x + i, y + j)) >= 128]
        out.append((cp, int(c["xadvance"]), ink))
    return out


# --- Output -----------------------------------------------------------------


def write_suitcase(key: str, strikes: list[dict]) -> int:
    about = ABOUT[key]
    suitcase = {
        "format": "mockintosh-suitcase",
        "version": 1,
        "family": about["family"],
        "defaultSize": DEFAULT_SIZES[key],
        "strikes": sorted(strikes, key=lambda s: (s["style"], s["size"])),
        "outlines": [],
    }
    text = json.dumps(suitcase, indent=1) + "\n"
    (LIBRARY / about["file"]).write_text(text, encoding="utf-8")
    return len(text.encode("utf-8"))


def bake(key: str, size: int, style: int, glyphs) -> dict:
    ascent, descent = LAYOUT[(key, size, style)]
    record, info, count = strike(glyphs, ascent, descent)
    print(f"{key} {size}{' style ' + str(style) if style else ''}: {count} glyphs")
    return {"size": size, "style": style, "data": record, "info": info}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--geist", type=Path, required=True, help="GeistPixel-Square .ttf / .woff2")
    parser.add_argument("--redaction", type=Path, required=True, help="folder holding the unpacked @fontsource/redaction-<cut> packages")
    parser.add_argument("--lisa", type=Path, help="LisaTerminalPaperRaw.ttf (otherwise lisa.suit is kept)")
    args = parser.parse_args()
    LIBRARY.mkdir(parents=True, exist_ok=True)

    redaction = []
    for style, suffix in REDACTION_STYLES.items():
        for cut in REDACTION_CUTS:
            files = list(args.redaction.glob(f"**/redaction-{cut}-latin-{suffix}.woff2"))
            if not files:
                raise SystemExit(f"No redaction-{cut}-latin-{suffix}.woff2 under {args.redaction}")
            redaction.append(bake("redaction", round(1000 / cut), style, grid_glyphs(files[0], cut)))
    write_suitcase("redaction", redaction)
    write_suitcase("geistpixel", [bake("geistpixel", 24, 0, grid_glyphs(args.geist, 38))])
    if args.lisa:
        write_suitcase("lisa", [bake("lisa", 12, 0, grid_glyphs(args.lisa, 100))])
    elif not (LIBRARY / ABOUT["lisa"]["file"]).exists():
        raise SystemExit("No lisa.suit in the library yet: pass --lisa")
    write_suitcase("jiskan", [bake("jiskan", 16, 0, bmfont_glyphs(JISKAN_FNT))])

    catalog = []
    for key, about in ABOUT.items():
        path = LIBRARY / about["file"]
        suitcase = json.loads(path.read_text(encoding="utf-8"))
        styles = sorted({s["style"] for s in suitcase["strikes"]})
        entry = {k: v for k, v in about.items()}
        entry["sizes"] = sorted({s["size"] for s in suitcase["strikes"]})
        entry["styles"] = [["Regular", "Bold", "Italic", "Bold Italic"][s] for s in styles]
        entry["bytes"] = path.stat().st_size
        catalog.append(entry)
    (LIBRARY / "index.json").write_text(json.dumps({"version": 1, "fonts": catalog}, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    for about in ABOUT.values():
        if "licenseFile" in about and not (LIBRARY / about["licenseFile"]).exists():
            raise SystemExit(f"Missing {LIBRARY / about['licenseFile']}")


if __name__ == "__main__":
    main()
