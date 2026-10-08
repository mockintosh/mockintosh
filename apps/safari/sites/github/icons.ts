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

/** The sprite names of the Star button's star: an outline to star with, filled once starred. */
export const GITHUB_STAR = "safari/github-star";
export const GITHUB_STARRED = "safari/github-starred";

/** Octicons' `star`, cut down to sit beside a button's label: a five-pointed outline. */
const star: Sprite = fromGrid(11, 11, [
  ".....#.....",
  "....#.#....",
  "....#.#....",
  "####...####",
  "#.........#",
  ".#.......#.",
  "..#.....#..",
  "..#.....#..",
  ".#...#...#.",
  ".#..#.#..#.",
  ".###...###.",
]);

/** Octicons' `star-fill`: the same star, filled. */
const starred: Sprite = fromGrid(11, 11, [
  ".....#.....",
  "....###....",
  "....###....",
  "###########",
  "###########",
  ".#########.",
  "..#######..",
  "..#######..",
  ".#########.",
  ".####.####.",
  ".###...###.",
]);

export const githubSprites: Record<string, Sprite> = { [GITHUB_MARK]: githubMark, [GITHUB_STAR]: star, [GITHUB_STARRED]: starred };
