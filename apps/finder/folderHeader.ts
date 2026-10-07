/**
 * Where a folder window's header figures go ("3 items", "2,427K in disk",
 * "7,648K available"), as System 6 placed them. In a wide window the count
 * sits at the left, the disk figure in the middle and the free space against
 * the right edge. When that would make them collide, they run on from the
 * left with a fixed gap, and the frame cuts off whatever doesn't fit.
 */

/** The count's inset from the band's left edge. */
export const HEADER_LEFT = 15;
/** Room between a right-aligned "available" and the frame. */
export const HEADER_RIGHT = 5;
/** Space after one figure's advance before the next one starts. */
export const HEADER_GAP = 7;

/**
 * Left edge of each figure, in band coordinates.
 * @param bandWidth the header band's width, frame to frame
 * @param widths each figure's advance width
 */
export function folderHeaderLayout(
  bandWidth: number,
  widths: readonly [number, number, number],
): [number, number, number] {
  const [count, disk, free] = widths;
  const countX = HEADER_LEFT;
  const diskX = Math.max(Math.floor((bandWidth - disk) / 2), countX + count + HEADER_GAP);
  const freeX = Math.max(bandWidth - HEADER_RIGHT - free, diskX + disk + HEADER_GAP);
  return [countX, diskX, freeX];
}
