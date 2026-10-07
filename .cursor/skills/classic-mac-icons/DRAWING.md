# Drawing Mac icons

Reached from step 3 of [SKILL.md](SKILL.md). Draw a 32×32, a 16×16, or both, as `fromGrid` rows: `#` ink, `o` paper, `.` clear.

## The loop

Draft → `npm run icons:preview -- apps/<app>/icons.ts` → read the sheet → fix → repeat. Write drafts straight into the app's `icons.ts` under their final keys (`<app>/icon`, `<app>/icon-16x16`), since the preview imports that module. Read the sheet at two distances:

- the **×8 grids** for single pixels: stray specks, doubled diagonals, uneven curves;
- the **desktop / selected / app menu** panels (×2, real size) for the gestalt: does it read as the object, and do the 16×16 and the 32×32 read as the same object?

## Choose a method

Pick per shape, and mix them freely:

- **Construct** anything round, symmetric or diagonal with `IconCanvas` (`scripts/icons/draw.ts`): lines, ellipses, polygons, floods, patterns, `mirrorX`, `outline`. It prints grid rows. Paste them in, then finish by hand.

  ```bash
  npx tsx -e 'import { IconCanvas } from "./scripts/icons/draw";
  const c = new IconCanvas(32);
  c.fillEllipse(15.5, 15.5, 14, 14, "paper").ellipse(15.5, 15.5, 14, 14);
  console.log(c.toGridSource("GLOBE"));'
  ```

- **Hand-place** rows for small detail, lettering, and nearly every 16×16. Edit one row at a time and re-preview. Counting characters across a row is reliable. Judging a shape by looking down the column of text is not.
- **Derive** from real data when the subject has some (Earth draws its continents from the app's own coastlines). Rasterise it, then hand-clean.

Even sizes have no centre pixel. Centre a symmetric shape on 15.5 (or 7.5 for the 16×16). A 1px axis line can only sit half a pixel off centre, so either make it 2px wide or let the asymmetry show on purpose.

## 32×32

- **Silhouette**: a 1px ink outline around one solid shape, 1–2px margin to the box. The mask is the silhouette filled in, so everything outside it is `.` and nothing inside is.
- **Interior**: paper by default, ink for solid parts. 1-bit patterns (`IconCanvas.pattern`, e.g. `["#o", "o#"]`) work for shading at this size.
- **View**: frontal, or the shallow three-quarter view System 7 used for objects. Keep one consistent view per icon, with depth shown by a thicker right/bottom edge rather than true perspective.
- **Lines**: steps in an even rhythm (1:1, 1:2, 1:3) so diagonals look straight, with no pixel doubled at a step.
- **Selected**: the sheet's selected panel inverts the inside of the mask. Detail must survive that too.

## 16×16

Redraw it from scratch rather than shrinking the 32×32. Majority-vote shrinking is exactly the blotchiness this drawing replaces.

- Keep the silhouette and one or two features that name the object. Drop the rest.
- Use solid ink and paper only, with no patterns. A checkerboard at this size reads as dirt, and `icons:preview` flags it.
- Use 1px outlines and at least 1px of paper between features. Enclosed paper areas need at least 2×2 pixels to read.
- Study Apple's pairs before drawing. `npm run icons:find -- folder trash document application` shows how each 32×32 was simplified (the Folder keeps only its tab, the Trash keeps its lid and three ribs).

Done when: `icons:preview` prints no `!` line for the pair. On the sheet, the desktop and app-menu panels read as the subject, the 16×16 reads as the 32×32's object, and neither ×8 grid shows a stray pixel you did not mean.
