import { Show, onCleanup, onSettled } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { Button, Spacer, createSignal } from "@mockintosh/ui";
import { encodeQR, type Sprite } from "@mockintosh/sdk";
import type { SignInPollResult, SignInRelay } from "../../platform/types";
import type { SignInSheetRequest } from "../signIn";
import { useWindow } from "../windowContext";

export interface SignInSheetProps {
  request: SignInSheetRequest;
  relay: SignInRelay;
  /** Opens the QR code's link on this computer when it is clicked, where the host can. */
  openExternal?: (url: string) => void;
  resolve: (params: Record<string, string> | null) => void;
  reject: (error: Error) => void;
}

type SheetState =
  | { phase: "starting" }
  | { phase: "showing"; link: string; qr: Sprite }
  | { phase: "expired" }
  | { phase: "failed"; message: string };

/** Largest QR code, quiet zone included, in screen pixels: 3px modules up to version 6 (41 modules), what a relay link needs. */
const QR_BOX = 148;
const PADDING = 12;
const GAP = 12;
/** White modules around the code that scanners need. */
const QUIET_MODULES = 4;

function qrScale(qr: Sprite): number {
  return Math.max(1, Math.floor(QR_BOX / (qr.width + QUIET_MODULES * 2)));
}

function qrPixels(qr: Sprite, scale: number): Uint8Array {
  const size = qr.width * scale;
  const pixels = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      pixels[y * size + x] = qr.data[Math.floor(y / scale) * qr.width + Math.floor(x / scale)];
    }
  }
  return pixels;
}

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
      setState({ phase: "showing", link: pairing.link, qr: encodeQR(pairing.link) });
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
          {(s) => {
            const scale = qrScale(s().qr);
            const size = s().qr.width * scale;
            const pixels = qrPixels(s().qr, scale);
            return (
              <raster
                semantic={{ name: "sign-in-qr", role: "image", value: s().link }}
                width={size}
                height={size}
                onClick={() => props.openExternal?.(s().link)}
                onPaint={({ blitPixels }) => blitPixels(pixels, size, size)}
              />
            );
          }}
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
        <Spacer />
        <box flexDirection="row" gap={10}>
          <Button label="Cancel" font="menu" height={20} borderRadius={5} onClick={() => settle({ params: null })} />
          <Show when={state().phase === "expired" || state().phase === "failed"}>
            <Button label="New Code" font="menu" height={20} borderRadius={5} ring onClick={() => void begin()} />
          </Show>
        </box>
      </box>
    </box>
  );
}
