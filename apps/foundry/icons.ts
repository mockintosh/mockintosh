import { defineSprite, type Sprite } from "@mockintosh/sdk";

/**
 * Adobe Type Manager 4.0.2 installer ICN# 6208 — Mac OS 8 catalog.
 * Serif “A” in a rounded square; the catalogs have no suitcase / FONT ICN#.
 */
export const APP_ICON: Sprite = defineSprite(
  32,
  32,
  "VVVVVVVVVVWqqqqqqqqqqlVVVVVVVVVVqqqqqqqqqqpVVVVVVVWVlaqqqqqqqlWqVVVVVVVZVZWqqqqqqqVVqlVVVVVVlVWVqqqqqqpVVapVVVVVWVVVlaqqqqqlVVWqVVVVVZVVVZWqqqqqVVVVqlVVVVlVWVWVqqqqpVVpVapVVVWVVZlVlaqqqlVWqVWqVVVZVVlZVZWqqqVVaqlVqlVVlVVVVVWVqqpVVVVVVapVWVVVVVVVlaqlVWqqqVWqVZVVlVVZVZWqVVaqqqlVqllVWVVVWVWVpVVqqqqpVaqVVZVVVVlVlaqqqqqqqqqqVVVVVVVVVVWqqqqqqqqqqg==",
);

export const sprites: Record<string, Sprite> = {
  "foundry/icon": APP_ICON,
};
