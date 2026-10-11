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

/** The guard's environment here: members by session token, credits, and any site may call. */
export function clubGuardEnv(): GuardEnv {
  return {
    ...guardEnvFromProcess(),
    member: (req) => memberFromRequest(clubAuth(), req),
    async balance(memberId) {
      const credits = clubCredits();
      if (!credits) throw new Error("No database for credits");
      return credits.balance(memberId);
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
