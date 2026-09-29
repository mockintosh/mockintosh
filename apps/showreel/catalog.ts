import { HAMMER_REEL } from "./hammer/reel";
import { HELLO_REEL } from "./hello/reel";
import { KEEPER_REEL } from "./keeper/reel";
import { ONE_BIT_REEL } from "./onebit/reel";
import type { ReelDefinition } from "./reels";

/** The reels the player can show, in menu order. */
export const REELS: readonly ReelDefinition[] = [ONE_BIT_REEL, KEEPER_REEL, HELLO_REEL, HAMMER_REEL];
