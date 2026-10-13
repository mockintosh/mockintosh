import { describe, expect, it, vi } from "vitest";
import type { FetchResponse } from "@mockintosh/sdk";
import type { ClubAccounts, ClubMember } from "../platform/types";
import { createSystemClub } from "./club";

const MEMBER: ClubMember = { id: "member-1", name: "Ada", username: "Ada", email: "ada@example.com", since: 0 };

function response(status: number): FetchResponse {
  return new Response("{}", { status }) as unknown as FetchResponse;
}

function accounts(status: number) {
  let signedIn: ClubMember | null = MEMBER;
  const fake = {
    session: vi.fn(async () => signedIn),
    credits: vi.fn(async () => (signedIn ? { balance: 319, recent: [] } : null)),
    fetch: vi.fn(async () => {
      if (status === 401) signedIn = null;
      return response(status);
    }),
  };
  return fake as typeof fake & ClubAccounts;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createSystemClub", () => {
  it("fetches credits again after an app's request", async () => {
    const fake = accounts(200);
    const club = createSystemClub(fake);
    await club.refresh();
    await settle();
    fake.credits.mockClear();

    expect((await club.fetch("/api/chat", { method: "POST" })).status).toBe(200);
    await settle();
    expect(fake.credits).toHaveBeenCalledTimes(1);
  });

  it("asks who is signed in when an app's request is refused", async () => {
    const fake = accounts(401);
    const club = createSystemClub(fake);
    await club.refresh();
    await settle();
    fake.session.mockClear();

    await club.fetch("/api/chat", { method: "POST" });
    await settle();
    expect(fake.session).toHaveBeenCalledTimes(1);
    expect((await club.refresh()).member).toBeNull();
  });
});
