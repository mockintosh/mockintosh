import { createEffect, createSignal, onCleanup, onSettled } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { defineApp, useApp } from "@mockintosh/sdk";
import { createGame, step, type Controls, type Game } from "./tank/game";
import { sprites } from "./tank/icons";
import { TankView, type Style } from "./tank/view";

const SETTINGS_KEY = "settings.json";

const KEYS: Record<string, keyof Controls> = {
  ArrowUp: "forward",
  w: "forward",
  ArrowDown: "back",
  s: "back",
  ArrowLeft: "left",
  a: "left",
  ArrowRight: "right",
  d: "right",
  " ": "fire",
};

function Tank(_props: Record<string, unknown>): JSX.Element {
  const app = useApp();
  const win = app.window;

  const [style, setStyle] = createSignal<Style>("patterns");
  const [paused, setPaused] = createSignal(false);
  const [revision, setRevision] = createSignal(0);
  const [best, setBest] = createSignal(0);

  const isFullScreen = () => win.kind() === "fullscreen";
  /** Play stops while another window is in front, as it should on a Macintosh. */
  const running = () => !paused() && win.isActive();

  let game: Game = createGame();
  const view = new TankView();
  const held = new Set<keyof Controls>();
  let frame = { width: 1, height: 1, pixels: new Uint8Array(1) };
  let cancelFrame: (() => void) | null = null;
  let lastTick: number | null = null;
  let loaded = false;

  function newGame(): void {
    game = createGame();
    setPaused(false);
  }

  function tick(now: number): void {
    cancelFrame = app.scheduler.requestFrame(tick);
    const dt = lastTick === null ? 0 : Math.min(0.05, (now - lastTick) / 1000);
    lastTick = now;
    if (running()) {
      step(game, { forward: held.has("forward"), back: held.has("back"), left: held.has("left"), right: held.has("right"), fire: held.has("fire") }, dt);
      if (game.player.score > best()) setBest(game.player.score);
    }
    const width = Math.max(1, win.width());
    const height = Math.max(1, win.height());
    if (frame.width !== width || frame.height !== height) frame = { width, height, pixels: new Uint8Array(width * height) };
    view.draw(frame, game, style());
    setRevision((n) => n + 1);
  }

  onSettled(() => {
    cancelFrame = app.scheduler.requestFrame(tick);
    void app.storage.read(SETTINGS_KEY).then((text) => {
      try {
        const saved = JSON.parse(text ?? "{}") as { style?: unknown; best?: unknown };
        if (saved.style === "patterns" || saved.style === "vector") setStyle(saved.style);
        if (typeof saved.best === "number") setBest(saved.best);
      } catch {
        // A damaged settings file just means defaults.
      }
      loaded = true;
    });
  });

  onCleanup(() => cancelFrame?.());

  createEffect(
    () => ({ style: style(), best: best() }),
    (settings) => {
      if (loaded) void app.storage.write(SETTINGS_KEY, JSON.stringify(settings));
    },
  );

  // Keys held when the window loses focus would never see their key-up.
  createEffect(
    () => win.isActive(),
    (active) => {
      if (!active) held.clear();
    },
  );

  createEffect(
    () => ({ style: style(), paused: paused(), full: isFullScreen(), best: best() }),
    (state) => {
      app.setMenus([
        {
          label: "Game",
          items: [
            { label: "New Game", shortcut: "N", onClick: newGame },
            { label: state.paused ? "Resume" : "Pause", shortcut: "P", onClick: () => setPaused((p) => !p) },
            { type: "separator" },
            { label: `Best Score: ${state.best}`, disabled: true },
            { type: "separator" },
            { label: "Quit", shortcut: "Q", onClick: () => app.quit() },
          ],
        },
        {
          label: "View",
          items: [
            {
              label: state.full ? "Exit Full Screen" : "Full Screen",
              shortcut: "F",
              onClick: () => win.setFullScreen(!isFullScreen()),
            },
            { type: "separator" },
            {
              type: "radiogroup",
              value: state.style,
              onValueChange: (value) => setStyle(value as Style),
              items: [
                { label: "Patterns", value: "patterns" },
                { label: "Vector", value: "vector" },
              ],
            },
          ],
        },
      ]);
    },
  );

  const onKeyDown = (key: string, mods: { meta: boolean; ctrl: boolean; alt: boolean }) => {
    if (mods.meta || mods.ctrl || mods.alt) return;
    const control = KEYS[key] ?? KEYS[key.toLowerCase()];
    if (control) held.add(control);
    else if (key === "Enter" && game.over) newGame();
    else if (key === "p" || key === "P") setPaused((p) => !p);
    else if (key === "Escape" && isFullScreen()) win.setFullScreen(false);
  };

  const onKeyUp = (key: string) => {
    const control = KEYS[key] ?? KEYS[key.toLowerCase()];
    if (control) held.delete(control);
  };

  return (
    <box
      width={win.width()}
      height={win.height()}
      tabIndex={0}
      autoFocus
      semantic={{ name: "tank", role: "application" }}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
    >
      <raster
        width={win.width()}
        height={win.height()}
        revision={revision()}
        semantic={{ name: "gunsight", role: "preview", value: game.over ? "game over" : `score ${game.player.score}` }}
        onPaint={(surface) => surface.blitPixels(frame.pixels, frame.width, frame.height)}
      />
    </box>
  );
}

export default defineApp({
  id: "tank",
  title: "Tank",
  icon: "tank/icon",
  smallIcon: "tank/icon-16x16",
  sprites,
  about: {
    version: "1.0",
    description:
      "A tank battle on a plain that wraps around, drawn by a little 1-bit polygon engine: flat faces stamped from a 33-step pattern ramp and outlined in black, as Playdate games do. Arrows drive, Space fires.",
  },
  defaultSize: { width: 440, height: 290 },
  minSize: { width: 240, height: 160 },
  scrollable: false,
  resizable: true,
  Component: Tank,
});
