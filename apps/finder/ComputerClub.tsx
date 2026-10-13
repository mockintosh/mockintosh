/**
 * Mockintosh Computer Club — join, sign in and out. Members can use the
 * Assistant. Signed out, the window is a 1984-style magazine spread: the
 * Club's picture, "Introducing the Computer Club." in New York, and the
 * way in beside it. On Mockintosh's own sites the window asks for an email and
 * the code the Club sends; anywhere else it connects on the Club's page,
 * with a code to check and a QR code for a phone. A Finder-hosted window
 * like the Chooser, opened from the Apple menu ("Join Mockintosh Computer
 * Club…" until this computer is signed in, then "Computer Club…").
 * Accounts are `os.club` (src/os/club.ts); see docs/computer-club-plan.md.
 */
import { For, Show, createEffect, createSignal, onCleanup } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { Button, TextInput, useApp } from "@mockintosh/sdk";
import { useOS, type OSServices } from "../../src/os/context";
import { CLUB_NAME, type SystemClub } from "../../src/os/club";
import type { ClubConfig, ClubConnection, ClubCredits, ClubMember } from "../../src/platform/types";
import { QRCode } from "../../src/os/components/QRCode.solid";
import { FINDER_APP_ID, getWindows, updateOSWindow } from "../../src/os/state";
import { CLUB_AD_PICTURE } from "./clubAdPicture";
import { openSystemWindow } from "../../src/os/systemWindows";
import { Divider, PAD, Row } from "./printerUi";

export const JOIN_CLUB_LABEL = `Join ${CLUB_NAME}…`;
export const CLUB_MENU_LABEL = "Computer Club…";

/** The member card's window. */
const SIZE = { width: 300, height: 300 };
/** Between the picture and the words beside it. */
const AD_GAP = 12;
/** The column beside the picture: the headline, then the way in. */
const AD_COLUMN_W = 234;
/** The signed-out window: the picture and its column, as a spread. */
const AD_SIZE = { width: PAD * 2 + CLUB_AD_PICTURE.width + AD_GAP + AD_COLUMN_W, height: PAD * 2 + CLUB_AD_PICTURE.height };
const FIELD_LABEL_W = 60;
/** The connect panel's QR code box: 2px modules for the Club's link (a version 5 code), within the spread's column. */
const CONNECT_QR_BOX = 100;

const LATEST_DATE_W = 44;
/** Latest changes the card lists; the Club's account page has more. */
const LATEST_SHOWN = 5;

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

/** The window's size for the member, or for the spread while nobody is signed in. */
function windowSize(os: OSServices): { width: number; height: number } {
  return os.club?.member() ? SIZE : AD_SIZE;
}

export function ComputerClub(_props: Record<string, unknown>): JSX.Element {
  const app = useApp();
  const os = useOS();
  const win = app.window;
  /** Signed out (or not known yet): the spread. */
  const spread = () => !!os.club && !os.club.member();
  /** Connecting on the Club's page: the spread drops its subhead to make room for the code. */
  const [connecting, setConnecting] = createSignal(false, { ownedWrite: true });
  const textWidth = () => (spread() ? AD_COLUMN_W : win.width() - PAD * 2);

  // Signed in: a connection under way is over.
  createEffect(
    () => !!os.club?.member(),
    (signedIn) => {
      if (signedIn) setConnecting(false);
    },
  );

  // Grow into the spread on signing out, back to the card on signing in; stay on screen.
  createEffect(
    () => windowSize(os),
    (size) => {
      const current = getWindows().find((w) => w.id === win.id);
      if (!current) return;
      // Leave room for the frame and its shadow at the screen's right edge.
      const x = Math.max(0, Math.min(current.x, os.resolution.width - size.width - 4));
      if (current.width === size.width && current.height === size.height && current.x === x) return;
      updateOSWindow(win.id, { width: size.width, height: size.height, x });
    },
  );

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
            fallback={
              <Spread>
                <text font="body" width={textWidth()}>Checking your membership…</text>
              </Spread>
            }
          >
            <Show
              when={club().member()}
              fallback={
                <Spread>
                  <SignedOut club={club()} />
                </Spread>
              }
            >
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
          disabled={props.disabled}
          width={textWidth() - FIELD_LABEL_W - 4}
        />
      </box>
    );
  }

  /**
   * The magazine spread: the picture, and beside it the headline in New
   * York, the subhead, and `children` (the way in).
   */
  function Spread(props: { children: JSX.Element }): JSX.Element {
    return (
      <box flexDirection="row" gap={AD_GAP} alignItems="flex-start">
        <image
          semantic={{ name: "club-picture", role: "image", value: "A compact Macintosh saying Mockintosh, with its keyboard and mouse" }}
          width={CLUB_AD_PICTURE.width}
          height={CLUB_AD_PICTURE.height}
          src={CLUB_AD_PICTURE}
        />
        <box width={AD_COLUMN_W} flexDirection="column" gap={8}>
          <box flexDirection="column">
            <text font="newark" size={24} width={AD_COLUMN_W} semantic={{ name: "club-headline", role: "heading" }}>
              Introducing the Computer Club.
            </text>
            <Show when={!connecting()}>
              <text font="newark" size={12} width={AD_COLUMN_W}>Members only. Everyone welcome.</text>
            </Show>
          </box>
          {props.children}
        </box>
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

  /** Signing in: on Mockintosh's own sites by email code, elsewhere by connecting on the Club's page. */
  function SignedOut(props: { club: SystemClub }): JSX.Element {
    const [config, setConfig] = createSignal<ClubConfig | null>(null, { ownedWrite: true });
    const [unreachable, setUnreachable] = createSignal(false, { ownedWrite: true });
    props.club.config().then(setConfig, () => setUnreachable(true));

    return (
      <Show when={!connecting()} fallback={<Connect club={props.club} onCancel={() => setConnecting(false)} />}>
        <Show
          when={config()}
          fallback={
            <text font="body" width={textWidth()}>
              {unreachable() ? `The ${CLUB_NAME} didn't answer. Close this window and try again in a moment.` : "Asking the Computer Club…"}
            </text>
          }
        >
          {(found) =>
            found().signIn === "form" ? (
              <EmailSignIn club={props.club} providers={found().providers} onConnect={() => setConnecting(true)} />
            ) : (
              <>
                <text font="body" width={textWidth()}>
                  {`Members use the Assistant. Connect this Mockintosh on the ${CLUB_NAME}'s website, where you can join too: it's free, with credits to start.`}
                </text>
                <Buttons>
                  <Button name="club-connect" label="Connect…" ring onClick={() => setConnecting(true)} />
                </Buttons>
              </>
            )
          }
        </Show>
      </Show>
    );
  }

  /** Mockintosh's own sites: an email address, then the code the Club sends there. */
  function EmailSignIn(props: { club: SystemClub; providers: ClubConfig["providers"]; onConnect: () => void }): JSX.Element {
    const [panel, setPanel] = createSignal<"email" | "code">("email", { ownedWrite: true });
    const [email, setEmail] = createSignal("", { ownedWrite: true });
    const [username, setUsername] = createSignal("", { ownedWrite: true });
    const [code, setCode] = createSignal("", { ownedWrite: true });
    const { busy, run } = useBusy();

    function send(): void {
      void run(async () => {
        const address = email().trim();
        if (!address) throw new Error("Type your email address.");
        await props.club.sendCode(address, username().trim() || undefined);
        setCode("");
        setPanel("code");
      });
    }

    function signIn(): void {
      void run(async () => {
        if (!code().trim()) throw new Error("Type the code from the email.");
        await props.club.signInWithCode(email().trim(), code(), username().trim() || undefined);
      });
    }

    return (
      <>
        <Show when={panel() === "email"}>
          <text font="body" width={textWidth()}>
            Members use the Assistant. Type your email and the Club sends you a code. New here? Choose a username too: it names your own disk. Joining is free, with credits to start.
          </text>
          <Field label="Email" name="club-email" value={email()} onChange={setEmail} onSubmit={send} disabled={busy()} />
          <Field label="Username" name="club-username" value={username()} onChange={setUsername} onSubmit={send} disabled={busy()} />
          <Buttons>
            <Show when={props.providers.length > 0}>
              <Button
                name="club-use-provider"
                label={props.providers.length > 1 ? "GitHub or Google…" : props.providers[0] === "github" ? "GitHub…" : "Google…"}
                disabled={busy()}
                onClick={props.onConnect}
              />
            </Show>
            <Button name="club-send-code" label="Send Code" ring disabled={busy()} onClick={send} />
          </Buttons>
        </Show>
        <Show when={panel() === "code"}>
          <text font="body" width={textWidth()} semantic={{ name: "club-code-sent", role: "status" }}>
            {`The Club sent a six-digit code to ${email().trim()}. Type it here; it works for ten minutes.`}
          </text>
          <Field label="Code" name="club-code" value={code()} onChange={setCode} onSubmit={signIn} disabled={busy()} />
          <Buttons>
            <Button name="club-back" label="Back" disabled={busy()} onClick={() => setPanel("email")} />
            <Button name="club-send-again" label="Send Again" disabled={busy()} onClick={send} />
            <Button name="club-sign-in" label="Sign In" ring disabled={busy()} onClick={signIn} />
          </Buttons>
        </Show>
      </>
    );
  }

  /**
   * Connecting on the Club's page: a code, its page as a QR code for a
   * phone and as a link for this computer's browser, and polling until
   * the member allows it there.
   */
  function Connect(props: { club: SystemClub; onCancel: () => void }): JSX.Element {
    type State =
      | { phase: "starting" }
      | { phase: "waiting"; connection: ClubConnection }
      | { phase: "over"; message: string };
    const [state, setState] = createSignal<State>({ phase: "starting" }, { ownedWrite: true });
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    onCleanup(() => {
      attempt++;
      clearTimeout(timer);
    });

    async function begin(): Promise<void> {
      const current = ++attempt;
      const live = () => current === attempt;
      clearTimeout(timer);
      setState({ phase: "starting" });
      try {
        const connection = await props.club.connect();
        if (!live()) return;
        setState({ phase: "waiting", connection });
        const expired = () => void setState({ phase: "over", message: "This code has expired. Get a new one to try again." });
        const poll = async (): Promise<void> => {
          if (!live()) return;
          if (Date.now() >= connection.expiresAt) return expired();
          // A dropped request is not an answer; ask again on the next beat.
          const answer = await connection.poll().catch(() => "pending" as const);
          if (!live()) return;
          // Connected: the window turns into the member card by itself.
          if (answer === "denied") setState({ phase: "over", message: "The Club's page turned this Mockintosh down." });
          else if (answer === "expired") expired();
          else if (answer === "pending") timer = setTimeout(() => void poll(), connection.pollIntervalMs);
        };
        timer = setTimeout(() => void poll(), connection.pollIntervalMs);
      } catch (error) {
        if (live()) setState({ phase: "over", message: error instanceof Error ? error.message : String(error) });
      }
    }
    void begin();

    const waiting = () => {
      const s = state();
      return s.phase === "waiting" ? s.connection : null;
    };
    const status = () => {
      const s = state();
      return s.phase === "over" ? s.message : "Asking the Computer Club for a code…";
    };
    const open = (url: string) => void os.browser?.openExternal(url);
    const sideWidth = () => textWidth() - CONNECT_QR_BOX - 8;

    return (
      <>
        <Show
          when={waiting()}
          fallback={
            <text font="body" width={textWidth()} semantic={{ name: "club-connect-status", role: "status" }}>
              {status()}
            </text>
          }
        >
          {(connection) => (
            <>
              <text font="body" width={textWidth()}>{`Sign in or join on the ${CLUB_NAME}'s page.`}</text>
              <box flexDirection="row" gap={8} alignItems="center">
                <box width={CONNECT_QR_BOX} height={CONNECT_QR_BOX} alignItems="center" justifyContent="center" borderColor={1} borderWidth={1}>
                  <QRCode link={connection().url} box={CONNECT_QR_BOX} name="club-connect-qr" onClick={() => open(connection().url)} />
                </box>
                <box flexDirection="column" gap={4} width={sideWidth()}>
                  <text font="body" wrap width={sideWidth()}>Check that it shows this code:</text>
                  <text font="menu" semantic={{ name: "club-connect-code", role: "status" }}>{connection().code}</text>
                  <text font="body" wrap width={sideWidth()}>Scan it with your phone's camera,</text>
                  <Show when={os.browser}>
                    <text
                      font="body"
                      wrap
                      width={sideWidth()}
                      underline
                      cursor="pointer"
                      semantic={{ name: "club-connect-browser", role: "link" }}
                      onClick={() => open(connection().url)}
                    >
                      or open the page in this computer's browser.
                    </text>
                  </Show>
                </box>
              </box>
            </>
          )}
        </Show>
        <Buttons>
          <Button name="club-connect-cancel" label="Cancel" onClick={props.onCancel} />
          <Show when={state().phase === "over"}>
            <Button name="club-connect-again" label="New Code" ring onClick={() => void begin()} />
          </Show>
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
        <Row label="Member" name="club-member" value={props.member.username ?? props.member.name} />
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
          <For each={props.club.credits()!.recent.slice(0, LATEST_SHOWN)}>
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
    size: windowSize(os),
    // A panel, not a document: the spread and the card each fit their window.
    scrollable: false,
    Component: ComputerClub,
  });
}
