import { defineSprite, type Sprite } from "@mockintosh/sdk";

/** ryos: system-7/system/system-generic-application-system.png · threshold */
export const APP_ICON: Sprite = defineSprite(
  32,
  32,
  "AAAAAgAAAAAAAAAJgAAAAAAAACVgAAAAAAAAlVgAAAAAAAJVVgAAAAAACVVVgAAAAAAlVVVgAAAAAJVVVVgAAAACVVVVVgAAAAlVVVVVgAAAJVVVVVVgAACVVVVVVVgAAlVVVVVVVgAJVVVVVVVVgCVVVVVaqlVglVVVVWVVlVglVVVVlVVlVglVVVZaVVlYAlVVVqWVVmAAlVWpaqqVqgAlVVlaVVVqAAlVVlVVVWoAAlVVlVVVagAAlVVpVVVqAAAlVVaqqWoAAAlVVVgCqgAAAlVVYAAqAAAAlVWAAAAAAAAlVgAAAAAAAAlYAAAAAAAAAmAAAAAAAAAAgAAAAA==",
);

/** System 7.5.3: System -3996 Application · ics# (the 16×16 Apple drew for this icon) */
export const APP_ICON_16: Sprite = defineSprite(
  16,
  16,
  "AAAAAAACAAAACYAAACVgAACVWAACVVYACVVVgCVVaWCVVZZYJVZlqAlpqmgCVlVoAJWqqAAlYCgACYAAAAIAAA=="
);

export const sprites: Record<string, Sprite> = {
  "trace/icon": APP_ICON,
  "trace/icon-16x16": APP_ICON_16,
};
