import { fromGrid, type Sprite } from "@mockintosh/sdk";

/** The sprite name GitHub pages draw their header mark by. */
export const GITHUB_MARK = "safari/github-mark-16x16";

/**
 * GitHub's mark, the Octicons `mark-github` 16×16 path rasterized at
 * half coverage and cleaned by hand: the cat in paper, cut from a disc.
 */
const githubMark: Sprite = fromGrid(16, 16, [
  ".....######.....",
  "...##########...",
  "..##o######o##..",
  ".###o######o###.",
  ".###oooooooo###.",
  "####oooooooo####",
  "###oooooooooo###",
  "###oooooooooo###",
  "###oooooooooo###",
  "###oooooooooo###",
  "####oooooooo####",
  ".#####oooo#####.",
  ".##o##oooo#####.",
  "..##oooooo####..",
  "...###oooo###...",
  ".....#oooo#.....",
]);

export const githubSprites: Record<string, Sprite> = { [GITHUB_MARK]: githubMark };
