import { Show, onCleanup, onSettled } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { DialogButton, Spacer, createSignal } from "@mockintosh/ui";
import type { SignInPollResult, SignInRelay } from "../../platform/types";
import type { SignInSheetRequest } from "../signIn";
import { useWindow } from "../windowContext";
import { QRCode } from "./QRCode.solid";

export interface SignInSheetProps {
  request: SignInSheetRequest;
  relay: SignInRelay;
  /** Opens a page in this computer's browser, where the host has one: then the user can sign in here instead of on a phone. */
  openExternal?: (url: string) => void;
  resolve: (params: Record<string, string> | null) => void;
  reject: (error: Error) => void;
}

type SheetState =
  | { phase: "starting" }
  | { phase: "showing"; link: string; browserLink: string }
  | { phase: "expired" }
  | { phase: "failed"; message: string };

/** Largest QR code, quiet zone included, in screen pixels: 3px modules up to version 6 (41 modules), what a relay link needs. */
const QR_BOX = 148;
const PADDING = 12;
const GAP = 12;

/**
 * The system sign-in sheet: pairs with the relay, shows the QR code the user
 * scans with their phone, and polls until the provider answers. Closing the
 * window cancels.
 */
export function SignInSheet(props: SignInSheetProps): JSX.Element {
  const win = useWindow();
  const [state, setState] = createSignal<SheetState>({ phase: "starting" }, { ownedWrite: true });
  let settled = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function settle(outcome: { params: Record<string, string> | null } | { error: Error }): void {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if ("error" in outcome) props.reject(outcome.error);
    else props.resolve(outcome.params);
    win.close();
  }

  function finish(params: Record<string, string>): void {
    if (!params.error) settle({ params });
    else if (params.error === "access_denied") settle({ params: null });
    else settle({ error: new Error(params.error_description ?? params.error) });
  }

  async function begin(): Promise<void> {
    const current = ++attempt;
    const live = () => !settled && current === attempt;
    clearTimeout(timer);
    setState({ phase: "starting" });
    try {
      const pairing = await props.relay.start({ url: props.request.url, appTitle: props.request.appTitle });
      if (!live()) return;
      setState({ phase: "showing", link: pairing.link, browserLink: pairing.browserLink });
      const deadline = Date.now() + pairing.expiresInMs;
      const poll = async () => {
        if (!live()) return;
        if (Date.now() >= deadline) {
          setState({ phase: "expired" });
          return;
        }
        // A dropped request is not an answer; try again on the next beat.
        const result: SignInPollResult = await pairing.poll().catch(() => ({ status: "pending" }) as const);
        if (!live()) return;
        if (result.status === "complete") finish(result.params);
        else if (result.status === "expired") setState({ phase: "expired" });
        else timer = setTimeout(() => void poll(), pairing.pollIntervalMs);
      };
      timer = setTimeout(() => void poll(), pairing.pollIntervalMs);
    } catch (error) {
      if (live()) setState({ phase: "failed", message: error instanceof Error ? error.message : String(error) });
    }
  }

  onSettled(() => void begin());
  onCleanup(() => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    props.resolve(null);
  });

  const showing = () => {
    const s = state();
    return s.phase === "showing" ? s : null;
  };
  const failure = () => {
    const s = state();
    return s.phase === "failed" ? s.message : null;
  };
  const textWidth = () => win.width() - PADDING * 2 - QR_BOX - GAP;

  return (
    <box
      width={win.width()}
      height={win.height()}
      padding={PADDING}
      flexDirection="row"
      gap={GAP}
      tabIndex={0}
      autoFocus
      onKeyDown={(key) => {
        if (key === "Escape") settle({ params: null });
      }}
    >
      <box width={QR_BOX} height={QR_BOX} alignItems="center" justifyContent="center" borderColor={1} borderWidth={1}>
        <Show
          when={showing()}
          fallback={
            <text font="body" wrap>
              {state().phase === "starting" ? "Connecting…" : state().phase === "expired" ? "Code expired" : "No code"}
            </text>
          }
        >
          {(s) => (
            <QRCode link={s().link} box={QR_BOX} name="sign-in-qr" onClick={() => props.openExternal?.(s().browserLink)} />
          )}
        </Show>
      </box>
      <box width={textWidth()} flexDirection="column" gap={6}>
        <text font="menu" wrap width={textWidth()}>{`Sign in to ${props.request.host}`}</text>
        <text font="body" wrap width={textWidth()}>
          {failure() ??
            (state().phase === "expired"
              ? "This code has expired. Get a new one to try again."
              : `Scan the code with your phone's camera to sign in for "${props.request.appTitle}".`)}
        </text>
        <Show when={props.openExternal && showing()}>
          {(s) => (
            <text
              font="body"
              wrap
              width={textWidth()}
              underline
              cursor="pointer"
              semantic={{ name: "sign-in-browser", role: "link" }}
              onClick={() => props.openExternal?.(s().browserLink)}
            >
              Or sign in with this computer's browser
            </text>
          )}
        </Show>
        <Spacer />
        <box flexDirection="row" gap={10}>
          <DialogButton label="Cancel" onClick={() => settle({ params: null })} />
          <Show when={state().phase === "expired" || state().phase === "failed"}>
            <DialogButton label="New Code" default onClick={() => void begin()} />
          </Show>
        </box>
      </box>
    </box>
  );
}
