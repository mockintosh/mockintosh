/**
 * POST /api/chat — the Assistant's model calls, for Computer Club members,
 * charged in credits. The answering itself is the OS's (`api/chat.ts`).
 */
import { CHAT_LIMITS, answerChat } from "../../../api/chat.js";
import { guardRequest } from "../../../api/_guard.js";
import { chargeChat, clubGuardEnv } from "./_club.js";
import { withCors } from "./_cors.js";

const handler = withCors(async (req) => {
  const guard = await guardRequest(req, CHAT_LIMITS, clubGuardEnv());
  if (!guard.ok) return guard.response;
  try {
    return await answerChat(req, guard, chargeChat(guard.caller));
  } finally {
    await guard.done();
  }
});

/** Vercel's Web-handler form: a default-exported function is called as Node's `(req, res)` instead. */
export default { fetch: handler };

export const maxDuration = 300;
