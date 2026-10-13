/**
 * What the shared spend guard and AI routes (`api/_guard.ts`, `api/chat.ts`,
 * `api/generate-image.ts` at the repo root) need from the Club: who a
 * request's bearer token belongs to, their credits, and charging them.
 */
import { guardEnvFromProcess, type Caller, type GuardEnv } from "../../../api/_guard.js";
import type { ChargeCall } from "../../../api/chat.js";
import { clubAuth, memberFromRequest } from "./_auth.js";
import { chargeCaller, clubCredits } from "./_credits.js";
import { chatUsage, imageUsage } from "./_pricing.js";

/** A session's daily cap covers the last 24 hours of its spending. */
const DAY_MS = 24 * 60 * 60 * 1000;

function needCredits() {
  const credits = clubCredits();
  if (!credits) throw new Error("No database for credits");
  return credits;
}

/** The guard's environment here: members by session token, credits, caps, and any site may call. */
export function clubGuardEnv(): GuardEnv {
  // The session's cap, from `member` to `capLeft` within one request.
  const caps = new Map<string, number | null>();
  return {
    ...guardEnvFromProcess(),
    async member(req) {
      const member = await memberFromRequest(clubAuth(), req);
      if (!member) return null;
      caps.set(member.session.id, member.session.dailyCap);
      return { id: member.id, sessionId: member.session.id };
    },
    async balance(memberId) {
      return needCredits().balance(memberId);
    },
    async capLeft(caller) {
      const cap = caller.sessionId ? caps.get(caller.sessionId) : null;
      caps.delete(caller.sessionId ?? "");
      if (cap == null || !caller.sessionId) return null;
      return cap - (await needCredits().spentBy(caller.sessionId, Date.now() - DAY_MS));
    },
    checkOrigin: false,
  };
}

/** Charges a chat answer to the caller, once per gateway generation. */
export function chargeChat(caller: Caller): ChargeCall {
  return (model, response) => {
    const id = (response as { id?: unknown } | null)?.id;
    return chargeCaller(caller, chatUsage(model, response), `usage:${typeof id === "string" ? id : crypto.randomUUID()}`);
  };
}

/** Charges an image to the caller, once per gateway generation. */
export function chargeImage(caller: Caller): ChargeCall {
  return (model, response) => {
    const id = (response as { providerMetadata?: { gateway?: { generationId?: unknown } } } | null)?.providerMetadata
      ?.gateway?.generationId;
    return chargeCaller(caller, imageUsage(model, response), `usage:${typeof id === "string" ? id : crypto.randomUUID()}`);
  };
}
