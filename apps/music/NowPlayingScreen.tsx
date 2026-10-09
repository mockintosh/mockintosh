import { Show } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { Button } from "@mockintosh/ui";
import { Artwork, type ArtworkLoader } from "./Artwork";
import { Position, Transport, TrackTitle, Volume, type Player } from "./NowPlayingBar";

const PAD = 8;
const GAP = 6;
/** The Close button's row. */
const CLOSE_H = 22;
/** The track and its controls: titles, position, transport, volume. */
const CONTROLS_H = 110;
/** The controls' narrowest: the transport, with room either side for the slider's times. */
const CONTROLS_W = 190;
const MIN_ART = 64;

export interface NowPlayingScreenProps {
  width: number;
  height: number;
  loader: ArtworkLoader;
  player: Player;
  onClose: () => void;
}

/**
 * The window given over to what's playing: the artwork as large as the
 * window allows, with the track and its controls beside it in a wide
 * window or under it in a tall one, whichever leaves the artwork larger.
 */
export function NowPlayingScreen(props: NowPlayingScreenProps): JSX.Element {
  const below = () => Math.min(props.width - PAD * 2, props.height - PAD * 2 - CLOSE_H - CONTROLS_H - GAP * 2);
  const beside = () => Math.min(props.height - PAD * 2 - CLOSE_H - GAP, props.width - PAD * 2 - GAP - CONTROLS_W);
  const sideBySide = () => beside() > below();
  const art = () => Math.max(MIN_ART, sideBySide() ? beside() : below());
  const controlsW = () => (sideBySide() ? props.width - PAD * 2 - GAP - art() : Math.min(props.width - PAD * 2, Math.max(CONTROLS_W, art())));

  const detail = () => {
    const shown = props.player.shown;
    return shown ? [shown.artist, shown.album].filter(Boolean).join(" — ") : "";
  };
  const controls = () => (
    <box width={controlsW()} flexDirection="column" alignItems="center" gap={GAP}>
      <box width={controlsW()} flexDirection="column" alignItems="center">
        <TrackTitle player={props.player} width={controlsW()} font="menu" detail={detail()} />
      </box>
      <box width={controlsW()} flexDirection="row">
        <Position player={props.player} />
      </box>
      <Transport player={props.player} />
      <box alignSelf="center">
        <Volume player={props.player} width={Math.min(120, controlsW())} />
      </box>
    </box>
  );
  const artwork = () => <Artwork loader={props.loader} url={props.player.shown?.artworkUrl ?? null} size={art()} />;

  return (
    <box
      width={props.width}
      height={props.height}
      padding={PAD}
      flexDirection="column"
      gap={GAP}
      background={0}
      semantic={{ name: "music-now-playing-screen" }}
    >
      <box alignSelf="flex-start">
        <Button label="Close" onClick={props.onClose} />
      </box>
      <Show
        when={sideBySide()}
        fallback={
          <box flexGrow={1} flexDirection="column" alignItems="center" gap={GAP}>
            {artwork()}
            {controls()}
          </box>
        }
      >
        <box flexGrow={1} flexDirection="row" alignItems="center" gap={GAP}>
          {artwork()}
          {controls()}
        </box>
      </Show>
    </box>
  );
}
