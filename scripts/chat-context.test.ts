/**
 * The ChatGippity SDK context is built from the App Developer Guide and the
 * shipped sources. It isn't committed (`npm run context` writes it), so this
 * checks the builder: the guide goes in verbatim, beside the digest and map.
 */
import fs from "fs";
import { describe, expect, it } from "vitest";
import { buildChatContext, GUIDE_PATH } from "./build-chat-context";

describe("ChatGippity SDK context", () => {
  it("embeds the current App Developer Guide, the type digest and the source map", () => {
    const context = buildChatContext();
    expect(context).toContain(`export const APP_DEV_GUIDE = ${JSON.stringify(fs.readFileSync(GUIDE_PATH, "utf8"))};`);
    expect(context).toContain("export const TYPE_DIGEST = ");
    expect(context).toContain("export const SOURCE_MAP = ");
  });
});
