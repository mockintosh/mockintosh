# Fonts

How Mockintosh finds, scales and draws type, the System 7 techniques it borrows, and what we might do next. For the app-facing API (`<text font size>`, `useApp().fonts`), see the App Developer Guide's Fonts section.

## The model

The Font Manager (`packages/ui/src/fonts/registry.ts`) knows **families**, as a System 7 FOND did. A family holds:

- **Bitmap strikes**, by size and style (plain, bold, italic, bold italic). Stored as Decker `%%FNT1` records; `DeckerFont` in memory.
- **Outlines**, by style: TrueType (`glyf`) or PostScript-flavoured OpenType (`CFF `), parsed into an `OutlineFace`.
- **Settings**: kerning, hinting, dropout control, preserveGlyph, preferOutline.

Family keys are lowercase letters and digits (`familyKey("Futura PT")` → `"futurapt"`); built-ins keep their historical keys (`newYork`). Every family has a `displayName` for menus. The roles `body`, `menu` and `mono` alias Geneva 9, Chicago 12 and Monaco 9.

### Where families come from

- **Built in:** compiled into `@mockintosh/ui` (`fonts/families.ts`, `fonts/faces/`): Chicago, Geneva, Monaco, New York, the city fonts, Lisa, Geist Pixel, Redaction (20, 35) and Jiskan (16). Redaction and Jiskan come from the AngelCode BMFont files in `public/fonts` via `npm run fonts:import-bmfont`; glyphs whose ink overhangs their advance keep it through an overhang table, and BMFont kerning pairs are dropped.
- **System Folder › Fonts** (`src/os/fontFolder.ts`): every `.suit` suitcase, loose `.ttf` / `.otf` / `.ttc`, and `family-size.fnt` strike in it is installed at boot and again whenever the folder changes. Loose outlines join a family by their own family name and `OS/2` style bits. A folder named "Fonts" made before the role existed is adopted. Files that fail log `Fonts: couldn't install …`.
- **Run time:** `app.fonts.register(name, data, size)` installs a strike for this boot only; `app.fonts.install(suitcase)` writes a suitcase into the Fonts folder.

`onFontsChanged` fires after any install or removal: the UI relayouts, and MacPaint and Canvas rebuild their Font menus.

### Suitcases

A `.suit` file (`fonts/suitcase.ts`) is one family as JSON: `strikes` (`size`, `style`, `%%FNT1` data), `outlines` (`style`, base64 font bytes) and `settings`. Foundry builds them (TTConverter's job): open a TTF, add the Bold / Italic files, keep chosen sizes as hand-editable bitmaps, install.

## Answering a request

`getFont` / `getRealFace` / `getFontForScaling` follow the System 7 Font Manager:

1. **Style matching.** Pick the closest real face the caller asked for (italic weighs 8, bold 4); only the remaining styles are synthesized (bold smear, italic shear, outline, shadow).
2. **Exact bitmap strike** at that size wins, unless the family prefers outlines (`SetOutlinePreferred`). Hand-tuned pixels beat the scaler.
3. **Outline** scaled to exactly that size.
4. **Bitmap-only family, QuickDraw caller:** stretch a strike, chosen 2× the size, then ½, then the next larger, then the largest. UI `<text>` instead snaps to the nearest strike.
5. **Nothing:** fall back to Geneva.

`hostSwapFont` (`fonts/strike.ts`) is QuickDraw's `_SwapFont`; it keeps the last 12 width tables, as the original did.

## The scaler

`packages/ui/src/fonts/truetype/`, pure TypeScript, identical on every platform:

- `sfnt.ts` reads tables: cmap 4 / 12 (and symbol fonts), `OS/2` / `head` style and metrics, composite glyphs (including point matching), `kern` and GPOS pair kerning. `cff.ts` runs Type 2 charstrings.
- `autohint.ts` grid-fits for 1-bit output, after FreeType's autofit: blue zones (baseline, x-height, cap height, ascender, descender) snap to whole rows, the x-height rounds up below 16 ppem, overshoots collapse at small sizes, and stems of equal design width get equal pixel widths. Untouched points are interpolated the way TrueType's IUP does. Active up to 40 ppem. The fonts' own bytecode is not run.
- `raster.ts` fills pixel centres (non-zero winding) with SCANTYPE 1 dropout control in both directions, so stems thinner than a pixel survive.
- `scaler.ts` sizes the line box (the strike's cell). Its height is the font's own line spacing, `hhea` ascender − descender + line gap; the gap is inside the line, not FontInfo leading. The ascent covers the tallest of the 256 characters a strike holds (accented capitals), paid for from the line gap first: many OpenType fonts (Adobe's convention) split one em between ascender and descender and keep accent room in the gap, so without this their caps sit against the top of the line and Å's ring falls outside it. Descent takes the rest of the line, and at least the descender and the deepest glyph. Bitmap fonts are unaffected; their line box is drawn into them.
- Ink that still leaves the line box (characters beyond the 256, such as Ǻ or stacked accents) keeps its shape with PreserveGlyph on (our default): strikes carry `inkAbove` / `inkBelow` rows outside the cell, the QuickDraw strike's font rectangle includes them, and line height and FontInfo are unchanged, as on the Mac. Off (System 7's compatibility default), the glyph is squeezed to fit. Baked `%%FNT1` strikes have no rows outside the cell, so Foundry grows the cell instead.

### Strikes from outlines

`outlineStrike.ts` builds a `DeckerFont` whose widths come from the font's metrics and whose pixels are rendered **one glyph at a time on first use** (about 40 µs a glyph), which is how a 68000 coped. `FontStrike.prepare` lets `DrText` ask for glyphs it is about to blit. Scaled strikes live in an 8 MB LRU.

- **Beyond 256 characters:** Decker's ordinals (ASCII, `DROM_CHARS`, Mockintosh symbols) are page 0; any other code point lives on a page strike keyed `codePoint >> 8`, named `family\u0001p<page>` for `TextFont`. `drawUiText` splits a line into runs at page changes.
- **Advances and overhangs:** strikes carry NFNT-style `advances` and `originX`, packed into the QuickDraw strike's offset/width table and `kernMax`, so italic ink can overhang without loosening spacing.
- **Kerning** is applied by UI text (`textAdvance`, `uiTextRuns`), which splits draw runs where a pair moves the pen. QuickDraw `DrawText` from apps such as MacPaint does not kern, as on the original.

## What System 7 did

The research behind this, from *Inside Macintosh: Text* ch. 4 ([font requests](https://developer.apple.com/library/archive/documentation/mac/Text/Text-195.html), [scaling](https://developer.apple.com/library/archive/documentation/mac/Text/Text-196.html), [outline rendering](https://developer.apple.com/library/archive/documentation/mac/Text/Text-199.html), [preserving glyph shapes](https://developer.apple.com/library/archive/documentation/mac/Text/Text-205.html)) and [TrueType on vintage hardware](https://personal.garrettfuller.org/blog/2022/05/19/tidbits-truetype-on-vintage-hardware/):

| Technique | Here |
|---|---|
| FOND family tying `NFNT` strikes and `sfnt` outlines, in suitcases | families, `.suit` |
| Request order: exact bitmap → outline → 2× / ½ / larger / smaller → fallbacks | `getFont`, `getFontForScaling` |
| `SetOutlinePreferred` (default: bitmaps win) | `preferOutline` |
| Style matching by weight, synthesize the rest | `getRealFace` |
| Rasterize on first use, cache glyph bitmaps | `outlineStrike.ts` |
| Pixel-centre fill, instructions, dropout control | `raster.ts`, `autohint.ts` in place of bytecode |
| `SetPreserveGlyph` (System 7 default: squeeze to fit) | `preserveGlyph`, on by default: ink overflows the line box |
| Fixed-point widths, 12 cached width tables | `cachedWidthTable` |
| Printer-resolution outlines | not yet (see below) |
| TTConverter / ATM pre-baking | Foundry |

## Future ideas

### Built-in fonts as suitcases in the Fonts folder

Today every built-in family is compiled in, and System Folder › Fonts holds only what the user adds. System 7.1, which introduced the Fonts folder, kept the fonts the interface depends on in the System file and shipped the rest as ordinary suitcases in the folder. We could do the same:

- **Stay built in:** Chicago, Geneva, Monaco. Menus and the `body` / `mono` roles depend on them, so they must not be removable.
- **Become suitcases:** New York, Venice, London, Athens, San Francisco, Toronto, Cairo, Los Angeles, Lisa, Geist Pixel. `bootstrapFileSystem` writes one `.suit` per family on first boot (as it does the desktop shortcuts), and the registry stops registering them from built-in data; `fontFolder.ts` then installs them like any other suitcase.

It buys a Fonts folder that shows what is installed, removing a font by dragging it out, and Foundry editing of built-in families. It costs:

- A few tens of KB of copies on every disk.
- **Staleness:** when we improve a built-in strike, disks keep the old copy. Tag each shipped suitcase (e.g. an `attributes.shipped` version) and replace it on boot when the user hasn't modified it.
- An edited suitcase overrides the shipped design, so a user can break a family; deleting the file and rebooting should restore it.

### A TrueType bytecode interpreter

Run the fonts' own `fpgm` / `prep` / glyph programs instead of autohinting. Only worth it for classic fonts hand-hinted for black-and-white screens (Chicago-era TrueType, early Verdana and Georgia); for everything else the autohinter is as good. Roughly 2k lines plus testing against FreeType.

### Printing at device resolution

The thermal printers run at 203 dpi, but text reaches them as 72-dpi screen bitmaps. The Font Manager could render outline families at printer resolution (numer/denom 203/72), and bitmap families could use a 2× strike when one exists, as the ImageWriter's Best mode did.

### Size menus that show real sizes

Mac size menus drew sizes a font actually has in outline style. MacPaint and Canvas could do the same from `FontFamilyInfo.sizes` and `scalable`.
