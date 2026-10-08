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

/** The sprite name of the header search field's magnifying glass. */
export const GITHUB_SEARCH = "safari/github-search";

/** The magnifying glass Maps insets in its search field, 11 × 10: an 8-pixel lens, its handle leaving the lower right. */
const search: Sprite = fromGrid(11, 10, [
  "..####.....",
  ".#....#....",
  "#......#...",
  "#......#...",
  "#......#...",
  "#......#...",
  ".#....#....",
  "..####.##..",
  "........##.",
  ".........##",
]);

/** The sprite name of the Fork button's icon. */
export const GITHUB_FORK = "safari/github-fork";

/** Octicons' `repo-forked`, cut down to the stars' size: two rings branching from a stem into a third. */
const fork: Sprite = fromGrid(10, 11, [
  ".##....##.",
  "#..#..#..#",
  "#..#..#..#",
  ".##....##.",
  "..#....#..",
  "...#..#...",
  "....##....",
  "....##....",
  "...#..#...",
  "...#..#...",
  "....##....",
]);

export const githubSprites: Record<string, Sprite> = {
  [GITHUB_MARK]: githubMark,
  [GITHUB_STAR]: star,
  [GITHUB_STARRED]: starred,
  [GITHUB_SEARCH]: search,
  [GITHUB_FORK]: fork,
};
