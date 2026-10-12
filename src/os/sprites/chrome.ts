import { defineSprite, fromGrid, type Sprite } from "@mockintosh/ui";

/**
 * Scroll arrows as System 7's CDEF 1 draws them (System 7.0.1, the bitmaps
 * Apple's own Standard File screenshots show), each with its pressed state.
 * System 6's had a 1px point and a 13px-wide head.
 */
const ARROW_UP: Sprite = fromGrid(16, 16, [
  "################",
  "#oooooooooooooo#",
  "#oooooooooooooo#",
  "#oooooo##oooooo#",
  "#ooooo#oo#ooooo#",
  "#oooo#oooo#oooo#",
  "#ooo#oooooo#ooo#",
  "#oo#oooooooo#oo#",
  "#o####oooo####o#",
  "#oooo#oooo#oooo#",
  "#oooo#oooo#oooo#",
  "#oooo#oooo#oooo#",
  "#oooo######oooo#",
  "#oooooooooooooo#",
  "#oooooooooooooo#",
  "################",
]);
const ARROW_UP_PRESSED: Sprite = fromGrid(16, 16, [
  "################",
  "#oooooooooooooo#",
  "#oooooooooooooo#",
  "#oooooo##oooooo#",
  "#ooooo####ooooo#",
  "#oooo######oooo#",
  "#ooo########ooo#",
  "#oo##########oo#",
  "#o############o#",
  "#oooo######oooo#",
  "#oooo######oooo#",
  "#oooo######oooo#",
  "#oooo######oooo#",
  "#oooooooooooooo#",
  "#oooooooooooooo#",
  "################",
]);
const ARROW_DOWN: Sprite = fromGrid(16, 16, [
  "################",
  "#oooooooooooooo#",
  "#oooooooooooooo#",
  "#oooo######oooo#",
  "#oooo#oooo#oooo#",
  "#oooo#oooo#oooo#",
  "#oooo#oooo#oooo#",
  "#o####oooo####o#",
  "#oo#oooooooo#oo#",
  "#ooo#oooooo#ooo#",
  "#oooo#oooo#oooo#",
  "#ooooo#oo#ooooo#",
  "#oooooo##oooooo#",
  "#oooooooooooooo#",
  "#oooooooooooooo#",
  "################",
]);
const ARROW_DOWN_PRESSED: Sprite = fromGrid(16, 16, [
  "################",
  "#oooooooooooooo#",
  "#oooooooooooooo#",
  "#oooo######oooo#",
  "#oooo######oooo#",
  "#oooo######oooo#",
  "#oooo######oooo#",
  "#o############o#",
  "#oo##########oo#",
  "#ooo########ooo#",
  "#oooo######oooo#",
  "#ooooo####ooooo#",
  "#oooooo##oooooo#",
  "#oooooooooooooo#",
  "#oooooooooooooo#",
  "################",
]);
const ARROW_LEFT: Sprite = fromGrid(16, 16, [
  "################",
  "#oooooooooooooo#",
  "#oooooo#ooooooo#",
  "#ooooo##ooooooo#",
  "#oooo#o#ooooooo#",
  "#ooo#oo#####ooo#",
  "#oo#ooooooo#ooo#",
  "#o#oooooooo#ooo#",
  "#o#oooooooo#ooo#",
  "#oo#ooooooo#ooo#",
  "#ooo#oo#####ooo#",
  "#oooo#o#ooooooo#",
  "#ooooo##ooooooo#",
  "#oooooo#ooooooo#",
  "#oooooooooooooo#",
  "################",
]);
const ARROW_LEFT_PRESSED: Sprite = fromGrid(16, 16, [
  "################",
  "#oooooooooooooo#",
  "#oooooo#ooooooo#",
  "#ooooo##ooooooo#",
  "#oooo###ooooooo#",
  "#ooo########ooo#",
  "#oo#########ooo#",
  "#o##########ooo#",
  "#o##########ooo#",
  "#oo#########ooo#",
  "#ooo########ooo#",
  "#oooo###ooooooo#",
  "#ooooo##ooooooo#",
  "#oooooo#ooooooo#",
  "#oooooooooooooo#",
  "################",
]);
const ARROW_RIGHT: Sprite = fromGrid(16, 16, [
  "################",
  "#oooooooooooooo#",
  "#ooooooo#oooooo#",
  "#ooooooo##ooooo#",
  "#ooooooo#o#oooo#",
  "#ooo#####oo#ooo#",
  "#ooo#ooooooo#oo#",
  "#ooo#oooooooo#o#",
  "#ooo#oooooooo#o#",
  "#ooo#ooooooo#oo#",
  "#ooo#####oo#ooo#",
  "#ooooooo#o#oooo#",
  "#ooooooo##ooooo#",
  "#ooooooo#oooooo#",
  "#oooooooooooooo#",
  "################",
]);
const ARROW_RIGHT_PRESSED: Sprite = fromGrid(16, 16, [
  "################",
  "#oooooooooooooo#",
  "#ooooooo#oooooo#",
  "#ooooooo##ooooo#",
  "#ooooooo###oooo#",
  "#ooo########ooo#",
  "#ooo#########oo#",
  "#ooo##########o#",
  "#ooo##########o#",
  "#ooo#########oo#",
  "#ooo########ooo#",
  "#ooooooo###oooo#",
  "#ooooooo##ooooo#",
  "#ooooooo#oooooo#",
  "#oooooooooooooo#",
  "################",
]);

const CHROME_CLOSE = defineSprite(
  11,
  11,
  "qqqqVVVpVVWlVVaVVVpVVWlVVaVVVpVVWlVVaqqqgA=="
);
const CHROME_CLOSING = defineSprite(
  11,
  11,
  "qqqqVZVpllmlmZaVVVqpWqlVVaWZlpllmlWVaqqqgA=="
);
const CHROME_RESIZE = defineSprite(
  16,
  16,
  "qqqqqpVVVVaVVVVWlqqlVpZVZVaWVWqmllVlZpZVZWaWVWVmlqqlZpVlVWaVZVVmlWVVZpVqqqaVVVVWqqqqqg=="
);
const CHROME_ZOOM = defineSprite(
  11,
  11,
  "qqqqVWVpVZWlVlaVWVpVZWqqlaVVVpVVWlVVaqqqgA=="
);

export const chromeSprites: Record<string, Sprite> = {
  "chrome/up": ARROW_UP,
  "chrome/up-pressed": ARROW_UP_PRESSED,
  "chrome/down": ARROW_DOWN,
  "chrome/down-pressed": ARROW_DOWN_PRESSED,
  "chrome/left": ARROW_LEFT,
  "chrome/left-pressed": ARROW_LEFT_PRESSED,
  "chrome/right": ARROW_RIGHT,
  "chrome/right-pressed": ARROW_RIGHT_PRESSED,
  "chrome/close": CHROME_CLOSE,
  "chrome/closing": CHROME_CLOSING,
  "chrome/resize": CHROME_RESIZE,
  "chrome/zoom": CHROME_ZOOM,
};
