---
name: classic-mac-icons
description: >-
  Find, import, or draw 1-bit classic Mac icons as TypeScript sprites: a
  32×32 icon plus its hand-drawn 16×16 for the application menu. Use when the
  user wants an icon, sprite, or artwork for an app, dialog, folder, alert,
  chrome, or any Mockintosh UI, or a missing/blotchy 16×16 small icon.
---

# Classic Mac icons

Every icon is a pair: a masked **32×32** for the desktop and a hand-drawn **16×16** for the application menu (the 16×16 at the right end of the menu bar). An app without its own 16×16 gets `smallIcon()`'s majority-vote reduction of the 32×32, which turns shading into blotches.

Two sources, in order: the **catalog** (Apple's originals, many already paired), then **drawing** your own. Pixels stay in TypeScript (`defineSprite` / `fromGrid`). PNGs exist only as previews in the temp dir.

**Judge pixels from sheets, never from source.** A monospace grid is twice as tall as it is wide, so proportions in text lie. `icons:find` and `icons:preview` write contact-sheet PNGs (desktop, selected, app menu, ×8 grids). Read every page they print.

## Workflow

1. **Search.** Expand the request into terms (see [Intents](#intents)) and run `npm run icons:find -- <terms>`. Any term may match, and more matches rank higher. Read every `sheet:` page. Present the numbered hits with their `sizes`. Stop and wait for a pick, "none", or "draw it".
   - Hits from `system-7.5.3` are the System 7.5.3 families the Icon Gallery app shows. A `32x32 + 16x16` hit is Apple's own pair. Prefer it.
   - When the user asked for a new drawing, still search for close objects. Their pairs are your reference for step 3.
2. **Import** the pick: `npm run icons:import -- "<file>" --key icon/<slug>`. A System 7.5.3 family also writes `icon/<slug>-16x16` when it has one.
3. **Draw** whatever is still missing: the whole icon when nothing fit, or the 16×16 when the pick has only a 32×32. Follow [DRAWING.md](DRAWING.md).
4. **Wire it up.** For an app: `icon: "<key>"` and `smallIcon: "<key>-16x16"` in its `defineApp`, with the sprites in its `sprites` record. If you gave an unmasked 32×32 a transparent edge, remove its id from `UNMASKED` in `apps/icons.test.ts`. Then run `npm run apps:declarations`.
5. **Verify.** Run `npm run icons:preview -- <icons module>` (or `-- --app <id>`) and read the sheet. Then run `npx vitest run apps/icons.test.ts`.

Done when: the user has seen the sheets, the icon and its 16×16 are in the repo under one key pair, `icons:preview` prints no `!` line for them, and `apps/icons.test.ts` passes.

## Rules

- Catalog before drawing. Use a catalog hit's pixels as they are. Thresholded ryOS PNGs are the one conversion.
- Import only after an explicit pick.
- Pair keys as `<key>` + `<key>-16x16`. `icons:preview` pairs sprites by that suffix.
- Built-in OS icons go in `src/os/sprites/icons.ts` (where import writes them). An app's own icons go in `apps/<app>/icons.ts` as `fromGrid` grids.

## Commands

```bash
npm run icons:find -- trash folder disk
npm run icons:find -- application --category system --limit 6
npm run icons:import -- "system-7.5.3/system/-3993" --key icon/trash
npm run icons:preview -- apps/tank/icons.ts
npm run icons:preview -- --apps
npm run icons:gallery
```

`--app` and `--apps` read `apps/declarations.generated.json`, so run `npm run apps:declarations` after changing a `defineApp`. `icons:gallery` serves the ryOS set at http://127.0.0.1:8766/. The Icon Gallery app inside Mockintosh browses the System 7.5.3 set.

## Intents

Add these terms to the query (do not replace the user's words):

| Ask | Extra terms |
| --- | --- |
| trash | trash |
| folder / disk / volume | folder disk |
| document / file | document stationery edition |
| app icon | application |
| control panel | control panel |
| alias / shortcut | alias |
| help / balloon | balloon help |
| clipboard | clipboard |
