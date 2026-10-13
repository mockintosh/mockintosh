/**
 * POST /api/generate-image — the Assistant's pictures, for Computer Club
 * members, charged in credits. The generating itself is the OS's
 * (`api/generate-image.ts`).
 */
import { IMAGE_LIMITS, generateImage } from "../../../api/generate-image.js";
import { guardRequest } from "../../../api/_guard.js";
import { chargeImage, clubGuardEnv } from "./_club.js";
import { withCors } from "./_cors.js";

const handler = withCors(async (req) => {
  const guard = await guardRequest(req, IMAGE_LIMITS, clubGuardEnv());
  if (!guard.ok) return guard.response;
  try {
    return await generateImage(req, guard, chargeImage(guard.caller));
  } finally {
    await guard.done();
  }
});

/** Vercel's Web-handler form: a default-exported function is called as Node's `(req, res)` instead. */
export default { fetch: handler };

export const maxDuration = 120;
