# Fonts

How Mockintosh finds, scales and draws type, the System 7 techniques it borrows, and what we might do next. For the app-facing API (`<text font size>`, `useApp().fonts`), see the App Developer Guide's Fonts section.

## The model

The Font Manager (`packages/ui/src/fonts/registry.ts`) knows **families**, as a System 7 FOND did. A family holds:

- **Bitmap strikes**, by size and style (plain, bold, italic, bold italic). Stored as `%%MFN1` records (`fonts/codec.ts`, glyphs keyed by code point); `BitmapFace` in memory. Decker's older `%%FNT0` / `%%FNT1` records still load (`fonts/legacy.ts`).
- **Outlines**, by style: TrueType (`glyf`) or PostScript-flavoured OpenType (`CFF `), parsed into an `OutlineFace`.
- **Settings**: kerning, hinting, dropout control, preserveGlyph, preferOutline.

Family keys are lowercase letters and digits (`familyKey("Futura PT")` → `"futurapt"`); built-ins keep their historical keys (`newYork`). Every family has a `displayName` for menus. The roles `body`, `menu` and `mono` alias Geneva 9, Chicago 12 and Monaco 9.

Chicago 12 draws 2px between glyphs, as the Mac's NFNT does (`i` advances 4, `H` 8). A font name with a `~sN` suffix (`spacedFontName("menu", 1)` → `"menu~s1"`) is that face with `N` pixels between glyphs instead. `getFont`, `getRealFace`, `getFontForScaling` and `resolveFaceRef` strip the suffix, look up the face and return a cached copy with `spacing` replaced, so measuring, wrapping and the QuickDraw strike (its own family id, by name) all agree. `<text spacing={n}>` is that suffix on the node's font. System chrome uses Chicago's own 2px; app content sets 1.

### Where families come from

- **Built in:** compiled into `@mockintosh/ui` (`fonts/families.ts`, `fonts/faces/`): Chicago, Geneva, Monaco, New York and the city fonts. A built-in strike is a styled face when its `FontStrikeSpec` sets `style` (1 bold, 2 italic).
- **Font library:** Redaction, Geist, Lisa and Jiskan aren't built in. They're suitcases in `public/fonts/library/`, listed by its `index.json`, and the App Store's Fonts section installs one by downloading it into System Folder › Fonts (`src/os/fontLibrary.ts`). See [The font library](#the-font-library).
- **System Folder › Fonts** (`src/os/fontFolder.ts`): every `.suit` suitcase, loose `.ttf` / `.otf` / `.ttc`, and `family-size.fnt` strike in it is installed at boot and again whenever the folder changes. Loose outlines join a family by their own family name and `OS/2` style bits. A folder named "Fonts" made before the role existed is adopted. Files that fail log `Fonts: couldn't install …`.
- **Run time:** `app.fonts.register(name, data, size)` installs a strike for this boot only; `app.fonts.install(suitcase)` writes a suitcase into the Fonts folder.

`onFontsChanged` fires after any install or removal: the UI relayouts, and MacPaint and Canvas rebuild their Font menus.

### Apple's System 7.5.3 strikes

Chicago 12, Geneva (9–24), Monaco (9, 12) and New York (9–24) are Apple's own NFNT/FONT bitmaps from System 7.5.3, with every Mac OS Roman character Apple drew (™, accented letters, curly quotes, ligatures), plus Apple's hand-drawn Geneva 9 Italic, the one styled bitmap strike System 7.5.3 ships. `scripts/import-system-fonts.py` reads them out of a System 7.5.3 disk image (`python3 scripts/import-system-fonts.py --image path/to/System7_5_3.img`; needs `pip install machfs rsrcfork`) into `fonts/faces/system/`. It keeps the cell geometry the earlier strikes had (its `LAYOUT` table), puts rows of ink above the cell (accents on capitals) in `inkAbove`, and fills letters Apple lacks (Ł, Ő, Ș, € and the like) in Geneva 9, Chicago 12 and Monaco 9 from Decker's drawings (`scripts/decker-fonts.ts`), on page strikes. Bold Geneva 9 and 12 are smeared from these (`scripts/import-geneva-bold.ts`).

### The city fonts

Venice 14, London 18, Athens 18, San Francisco 18, Cairo 18 and Los Angeles 12 and 24 are Apple's FONTs from the Fonts suitcase on the System 6.0.8 System Additions disk, read the same way into `fonts/faces/city/` (`python3 scripts/import-city-fonts.py --image path/to/MacOS_6.0.8_System_Additions.img`), with every Mac OS Roman character each strike has and its missing-character box. Toronto (9–24) isn't on any System 6 disk; its strikes came from the LOSTFONTS suitcase and are kept as committed unless `--toronto` names a suitcase that has it.

### The font library

`npm run fonts:library` (`scripts/build-font-library.py`) builds one suitcase per family into `public/fonts/library/`, every strike an `%%MFN1` record with every character its source draws, plus `index.json` for the App Store:

- **Redaction** (SIL OFL): every pixel cut, Regular, Bold and Italic, each at the size where its grid is one pixel (Redaction 100 → 10, 70 → 14, 50 → 20, 35 → 29, 20 → 50, 10 → 100), from the `@fontsource/redaction-<cut>` packages.
- **Geist** (SIL OFL): Geist Pixel Square at 24, from the `geist` package.
- **Lisa** (Kreative Relay Free Use): LisaTerminal Paper Raw at 12, from Kreative's `lisa1.zip` (`--lisa`); without it the suitcase in the library is kept.
- **Jiskan** 16, from the AngelCode BMFont in `public/fonts`.

The outline sources draw every point on a pixel grid with straight edges, so each pixel is sampled at its centre, which is exact. Each strike keeps the line box it has always had; ink outside it is `inkAbove` / `inkBelow`. A suitcase strike carries its FontInfo (`info`), and a suitcase its `defaultSize`; a bitmap family is named in font menus by its suitcase's family name.

### Missing characters

A character no strike draws, and the Emoji family doesn't either, shows the font's missing-character glyph, a hollow box, as QuickDraw drew the glyph after `lastChar`. Bitmap strikes keep it at slot 0 (`MISSING_SLOT`); `ensureMissingGlyph` draws one for strikes that lack it. Outline strikes use the font's own `.notdef`. Curly quotes, dashes and odd spaces a font lacks still fall back to their ASCII look-alikes first.

### Emoji

Every face falls back to the **Emoji** family for characters it doesn't draw: black-and-white emoji baked from Google's [Noto Emoji](https://github.com/google/fonts/tree/main/ofl/notoemoji) (SIL OFL, `fonts/faces/emoji/LICENSE-NotoEmoji.txt`) by `npm run fonts:emoji -- --font path/to/NotoEmoji[wght].ttf` (`scripts/build-emoji-font.ts`; `--preview out.png` draws a sample sheet instead). It is built in but kept out of font menus.

- **Strikes:** one per cell height (10, 12, 14, 16, 20, 24), each emoji a square cell advancing one column more. A face draws emoji from the largest strike that fits its cell (Geneva 9 → 10, Chicago 12 → 12, Monaco 12 → 14), bottom-aligned, plain whatever the style: `uiTextRuns` gives an emoji run its own `TextFont`, `TextSize` and an empty `TextFace`. Coverage is sampled 8× and thresholded; below 16 rows, dropout control keeps Noto's hairlines whole.
- **Loading:** each strike is a chunk of its own (29 KB gzipped at 10px, 89 KB at 24), loaded the first time text needs an emoji at that size, together with the sequence table (12 KB) (`loadEmoji` in `fonts/emoji.ts`). Until then those emoji draw as missing boxes; loading fires `onFontsChanged`, and the text layout caches compare `fontsVersion()`, so text lays out again.
- **Order:** a character draws from the face itself, then a lookalike, then Emoji, then the missing box. U+FE0F (emoji presentation) tries Emoji first, so `™️` is the emoji and `™` Chicago's.
- **Sequences:** text is walked by character, not by code unit (`fonts/emojiClusters.ts`): a base with its variation selector, skin tone, keycap or tags, regional-indicator pairs, and anything joined by U+200D are one character for drawing, wrapping, clicks, ← → and ⌫. A sequence is looked up whole, without variation selectors, in `EMOJI_SEQUENCES` (Noto's `ccmp` ligatures): it names a code point, the base emoji's when Noto draws the sequence as its base (Noto has no skin tones, so 👍🏽 is 👍), or a private-use one from U+F0000 (flags, families, keycaps). A sequence it lacks draws its parts, without joiners, selectors and tones. Joiners, selectors, bidi marks and tags on their own draw nothing.
- **Typing:** a key whose `key` is one emoji is a keypress, like a letter (`isTypedKey`), and pasted emoji go in whole. The macOS Character Viewer types only into editable page elements, so it doesn't reach the canvas yet; paste works.

### Suitcases

A `.suit` file (`fonts/suitcase.ts`) is one family as JSON: `strikes` (`size`, `style`, `%%MFN1` data), `outlines` (`style`, base64 font bytes) and `settings`. Foundry builds them (TTConverter's job): open a TTF, add the Bold / Italic files, keep chosen sizes as hand-editable bitmaps, install.

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
- Ink that still leaves the line box (characters beyond the 256, such as Ǻ or stacked accents) keeps its shape with PreserveGlyph on (our default): strikes carry `inkAbove` / `inkBelow` rows outside the cell, the QuickDraw strike's font rectangle includes them, and line height and FontInfo are unchanged, as on the Mac. Off (System 7's compatibility default), the glyph is squeezed to fit. Foundry's editable drafts have no rows outside the cell, so baking one grows the cell instead.

### Strikes from outlines

`outlineStrike.ts` builds a `BitmapFace` whose widths come from the font's metrics and whose pixels are rendered **one glyph at a time on first use** (about 40 µs a glyph), which is how a 68000 coped. `FontStrike.prepare` lets `DrText` ask for glyphs it is about to blit. Scaled strikes live in an 8 MB LRU.

- **Beyond 256 characters:** page 0 is Mac OS Roman (`fonts/charmap.ts`), with Chicago's ⌘ ✓ ◆ (and Mockintosh's ⇧ ⌥) in the control range and the missing glyph at slot 0; any other code point lives on page `(codePoint >> 8) + 1`, named `family\u0001p<page>` for `TextFont`. Bitmap and outline faces share this: a bitmap face carries its pages in `BitmapFace.pages`. `drawUiText` splits a line into runs at page changes.
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
- **Become suitcases:** New York, Venice, London, Athens, San Francisco, Toronto, Cairo, Los Angeles. `bootstrapFileSystem` writes one `.suit` per family on first boot (as it does the desktop shortcuts), and the registry stops registering them from built-in data; `fontFolder.ts` then installs them like any other suitcase.

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
