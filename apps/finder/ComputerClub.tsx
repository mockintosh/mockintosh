/**
 * Mockintosh Computer Club — join, sign in and out. Members can use the
 * Assistant. A Finder-hosted window like the Chooser, opened from the
 * Apple menu ("Join Mockintosh Computer Club…" until this computer is
 * signed in, then "Computer Club…"). Accounts are `os.club`
 * (src/os/club.ts); see docs/computer-club-plan.md.
 */
import { For, Show, createSignal, onCleanup } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { Button, TextInput, useApp } from "@mockintosh/sdk";
import { useOS, type OSServices } from "../../src/os/context";
import { CLUB_NAME, type SystemClub } from "../../src/os/club";
import type { ClubCredits, ClubMember } from "../../src/platform/types";
import { FINDER_APP_ID } from "../../src/os/state";
import { openSystemWindow } from "../../src/os/systemWindows";
import { Divider, PAD, Row } from "./printerUi";

export const JOIN_CLUB_LABEL = `Join ${CLUB_NAME}…`;
export const CLUB_MENU_LABEL = "Computer Club…";

const SIZE = { width: 300, height: 300 };
const FIELD_LABEL_W = 60;
/**
 * How often the window tries signing in while it waits for the emailed
 * link. The Club allows 3 sign-in attempts per 10 seconds from one address;
 * one a quarter-minute leaves room for the member's own Sign In.
 */
const VERIFY_POLL_MS = 15_000;
/** When it stops trying: the link expires after an hour. */
const VERIFY_POLL_LIMIT_MS = 60 * 60 * 1000;

type Panel = "join" | "sign-in" | "check-email";

const LATEST_DATE_W = 44;

const formatDate = (ms: number) =>
  new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
const formatShortDate = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const formatCredits = (credits: number) => credits.toLocaleString("en-US");
const formatDelta = (delta: number) => `${delta > 0 ? "+" : "−"}${formatCredits(Math.abs(delta))}`;

/** What a ledger entry was for, in a few words. */
function entryLabel(entry: ClubCredits["recent"][number]): string {
  switch (entry.kind) {
    case "grant":
      return "Welcome credits";
    case "purchase":
      return "Bought credits";
    case "refund":
      return "Refund";
    case "adjust":
      return "Adjustment";
    case "usage":
      return entry.model?.includes("image") ? "Assistant picture" : "Assistant reply";
  }
}

export function ComputerClub(_props: Record<string, unknown>): JSX.Element {
  const app = useApp();
  const os = useOS();
  const win = app.window;
  const textWidth = () => win.width() - PAD * 2;

  return (
    <box
      width={win.width()}
      padding={PAD}
      flexDirection="column"
      gap={8}
      background={0}
      onLayout={({ width, height }) => win.setContentSize(width, height)}
    >
      <Show
        when={os.club}
        fallback={<text font="body" width={textWidth()}>{`This Macintosh can't reach the ${CLUB_NAME}.`}</text>}
      >
        {(club) => (
          <Show
            when={club().member() !== undefined}
            fallback={<text font="body">Checking your membership…</text>}
          >
            <Show when={club().member()} fallback={<SignedOut club={club()} />}>
              {(member) => <MemberCard club={club()} member={member()} />}
            </Show>
          </Show>
        )}
      </Show>
    </box>
  );

  /** Runs `step` with the buttons disabled; a failure gets a stop alert. */
  function useBusy() {
    const [busy, setBusy] = createSignal(false, { ownedWrite: true });
    async function run(step: () => Promise<void>): Promise<void> {
      if (busy()) return;
      setBusy(true);
      let failure: string | null = null;
      try {
        await step();
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
      } finally {
        setBusy(false);
      }
      if (failure !== null) await app.os.showDialog({ message: failure, buttons: ["OK"], variant: "stop" });
    }
    return { busy, run };
  }

  function Field(props: {
    label: string;
    name: string;
    value: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
    password?: boolean;
    disabled: boolean;
  }): JSX.Element {
    return (
      <box flexDirection="row" gap={4} alignItems="center">
        <box width={FIELD_LABEL_W}>
          <text font="body" nowrap>{props.label}</text>
        </box>
        <TextInput
          name={props.name}
          value={props.value}
          onChange={props.onChange}
          onSubmit={props.onSubmit}
          password={props.password}
          disabled={props.disabled}
          width={textWidth() - FIELD_LABEL_W - 4}
        />
      </box>
    );
  }

  function Buttons(props: { children: JSX.Element }): JSX.Element {
    return (
      <box flexDirection="row" gap={6} alignItems="center">
        <box flexGrow={1} />
        {props.children}
      </box>
    );
  }

  function SignedOut(props: { club: SystemClub }): JSX.Element {
    const [panel, setPanel] = createSignal<Panel>("join", { ownedWrite: true });
    const [name, setName] = createSignal("", { ownedWrite: true });
    const [email, setEmail] = createSignal("", { ownedWrite: true });
    const [password, setPassword] = createSignal("", { ownedWrite: true });
    const { busy, run } = useBusy();

    async function signIn(): Promise<void> {
      const result = await props.club.signIn(email().trim(), password());
      if (result.status === "unverified") setPanel("check-email");
      else if (result.status === "wrong-password") {
        await app.os.showDialog({
          message: "That email and password don't match a membership. Check them, or choose Forgot Password….",
          buttons: ["OK"],
          variant: "caution",
        });
      }
    }

    function join(): void {
      void run(async () => {
        if (!name().trim() || !email().trim() || !password()) throw new Error("Fill in your name, email and a password.");
        await props.club.join({ name: name().trim(), email: email().trim(), password: password() });
        setPanel("check-email");
      });
    }

    function forgot(): void {
      void run(async () => {
        const address = email().trim();
        if (!address) throw new Error("Type your email first, then choose Forgot Password… again.");
        await props.club.forgotPassword(address);
        await app.os.showDialog({
          message: `If ${address} has a membership, it has an email with a link for choosing a new password.`,
          buttons: ["OK"],
          variant: "note",
        });
      });
    }

    return (
      <>
        <Show when={panel() === "join"}>
          <text font="body" width={textWidth()}>
            Members can use the Assistant. Joining is free: give your name, your email and a password for this club.
          </text>
          <Field label="Name" name="club-name" value={name()} onChange={setName} onSubmit={join} disabled={busy()} />
          <Field label="Email" name="club-email" value={email()} onChange={setEmail} onSubmit={join} disabled={busy()} />
          <Field
            label="Password"
            name="club-password"
            value={password()}
            onChange={setPassword}
            onSubmit={join}
            password
            disabled={busy()}
          />
          <Buttons>
            <Button name="club-show-sign-in" label="I'm a Member…" disabled={busy()} onClick={() => setPanel("sign-in")} />
            <Button name="club-join" label="Join" ring disabled={busy()} onClick={join} />
          </Buttons>
        </Show>
        <Show when={panel() === "sign-in"}>
          <text font="body" width={textWidth()}>Sign in with the email and password you joined with.</text>
          <Field
            label="Email"
            name="club-email"
            value={email()}
            onChange={setEmail}
            onSubmit={() => void run(signIn)}
            disabled={busy()}
          />
          <Field
            label="Password"
            name="club-password"
            value={password()}
            onChange={setPassword}
            onSubmit={() => void run(signIn)}
            password
            disabled={busy()}
          />
          <Buttons>
            <Button name="club-forgot" label="Forgot Password…" disabled={busy()} onClick={forgot} />
            <Button name="club-show-join" label="Join…" disabled={busy()} onClick={() => setPanel("join")} />
            <Button name="club-sign-in" label="Sign In" ring disabled={busy()} onClick={() => void run(signIn)} />
          </Buttons>
        </Show>
        <Show when={panel() === "check-email"}>
          <CheckEmail
            club={props.club}
            email={email().trim()}
            password={password()}
            onBack={() => setPanel("sign-in")}
          />
        </Show>
      </>
    );
  }

  /**
   * Waiting for the welcome email's link: tries signing in every few
   * seconds, which succeeds once the address is verified, wherever the
   * link was opened.
   */
  function CheckEmail(props: { club: SystemClub; email: string; password: string; onBack: () => void }): JSX.Element {
    const { busy, run } = useBusy();
    const started = Date.now();
    let trying = false;
    const timer = setInterval(() => {
      if (Date.now() - started > VERIFY_POLL_LIMIT_MS) return clearInterval(timer);
      if (trying || busy()) return;
      trying = true;
      void props.club
        .signIn(props.email, props.password)
        .then((result) => {
          if (result.status === "wrong-password") clearInterval(timer);
        })
        .catch(() => {})
        .finally(() => (trying = false));
    }, VERIFY_POLL_MS);
    onCleanup(() => clearInterval(timer));

    return (
      <>
        <text font="body" width={textWidth()} semantic={{ name: "club-check-email", role: "status" }}>
          {`We sent a link to ${props.email}. Open it to confirm your address, on this computer or your phone. This window signs you in once you have.`}
        </text>
        <Buttons>
          <Button name="club-back" label="Back" disabled={busy()} onClick={props.onBack} />
          <Button
            name="club-resend"
            label="Send Again"
            disabled={busy()}
            onClick={() =>
              void run(async () => {
                await props.club.resendVerification(props.email);
                await app.os.showDialog({ message: `Sent another link to ${props.email}.`, buttons: ["OK"], variant: "note" });
              })
            }
          />
        </Buttons>
      </>
    );
  }

  function MemberCard(props: { club: SystemClub; member: ClubMember }): JSX.Element {
    const { busy, run } = useBusy();
    return (
      <>
        <text font="body" width={textWidth()}>
          {`Welcome to the ${CLUB_NAME}. Your credits pay for the Assistant's replies and pictures.`}
        </text>
        <Divider />
        <Row label="Member" name="club-member" value={props.member.name} />
        <Row label="Email" name="club-member-email" value={props.member.email} />
        <Row label="Since" name="club-member-since" value={formatDate(props.member.since)} />
        <Row
          label="Credits"
          name="club-credits"
          value={props.club.credits() ? formatCredits(props.club.credits()!.balance) : "…"}
        />
        <Show when={props.club.credits()?.recent.length}>
          <Divider />
          <text font="body" nowrap>Latest</text>
          <For each={props.club.credits()!.recent}>
            {(entry) => (
              <box flexDirection="row" gap={4}>
                <box width={LATEST_DATE_W}>
                  <text font="body" nowrap>{formatShortDate(entry.at)}</text>
                </box>
                <box flexGrow={1}>
                  <text font="body" nowrap>{entryLabel(entry)}</text>
                </box>
                <text font="body" nowrap>{formatDelta(entry.delta)}</text>
              </box>
            )}
          </For>
        </Show>
        <Divider />
        <Buttons>
          <Button name="club-sign-out" label="Sign Out" disabled={busy()} onClick={() => void run(() => props.club.signOut())} />
        </Buttons>
      </>
    );
  }
}

export function openComputerClub(os: OSServices): string {
  void os.club?.refresh();
  return openSystemWindow(os, FINDER_APP_ID, {
    title: "Computer Club",
    kind: "document",
    size: SIZE,
    scrollable: true,
    Component: ComputerClub,
  });
}
