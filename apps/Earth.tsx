import { createEffect, createSignal, defineApp, heldModifiers, onCleanup, onSettled, useApp, type MenubarItemDef } from "@mockintosh/sdk";
import type { JSX } from "@mockintosh/ui";
import { geography } from "./earth/geography";
import {
  EARTH_RADIUS_KM,
  MAX_RADIUS,
  clampView,
  eyeAltitude,
  fitRadius,
  flight,
  grab,
  minRadius,
  unproject,
  type Flight,
  type LonLat,
  type View,
} from "./earth/globe";
import { sprites } from "./earth/icons";
import { DESTINATIONS, type Destination } from "./earth/places";
import { EarthRenderer, skyFocal, type Layers, type Lighting } from "./earth/render";
import { moonDirection } from "./earth/sky";
import { SpaceRenderer } from "./earth/space";
import { CAMERA_NAMES, Voyage, type CameraMode, type Pacing } from "./earth/voyage";

const SETTINGS_KEY = "settings.json";
const DEG = Math.PI / 180;

/** Where Earth first opens: Australia and the Southern Ocean, the south pole just in sight. */
const HOME: LonLat = { lon: 147 * DEG, lat: -25 * DEG };

/** Seconds for a flick's spin to fall to a third. */
const SPIN_DECAY = 0.9;
/** Radians a second the Earth turns under Rotate. */
const ROTATE_RATE = 0.12;
/** A drag released after this long still counts as a flick. */
const FLICK_MS = 60;
const WHEEL_ZOOM = 0.0025;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Simulated time under Play Day: an hour a second. */
const PLAY_RATE = HOUR / 1000;
/** Milliseconds a step in time takes to sweep the terminator across. */
const TIME_STEP_MS = 450;

type Toggle = "grid" | "borders" | "places" | "atmosphere" | "stars";

interface Settings {
  grid: boolean;
  borders: boolean;
  places: boolean;
  atmosphere: boolean;
  stars: boolean;
  light: Lighting;
  rotate: boolean;
  view?: { lon: number; lat: number; zoom: number };
}

const DEFAULTS: Settings = { grid: true, borders: false, places: true, atmosphere: true, stars: true, light: "sun", rotate: false };

function Earth(_props: Record<string, unknown>): JSX.Element {
  const app = useApp();
  const win = app.window;

  const [settings, setSettings] = createSignal<Settings>(DEFAULTS);
  const [revision, setRevision] = createSignal(0);
  const [dragging, setDragging] = createSignal(false);
  const [label, setLabel] = createSignal("");
  /** Where the simulated clock is going, as an offset from the real one: 0 is now. */
  const [timeTarget, setTimeTarget] = createSignal(0);
  const [playing, setPlaying] = createSignal(false);
  /** The free-return flight, while it plays: what its menu shows. */
  const [mission, setMission] = createSignal<{
    paused: boolean;
    speed: number;
    speeds: [number, number];
    pacing: Pacing;
    mode: CameraMode;
    finished: boolean;
  } | null>(null);

  const isFullScreen = () => win.kind() === "fullscreen";
  const width = () => Math.max(1, win.width());
  const height = () => Math.max(1, win.height());

  const renderer = new EarthRenderer(geography());
  const space = new SpaceRenderer(geography());
  let voyage: Voyage | null = null;
  /** Where the globe and its clock were when the flight began, to go back to if it is ended early. */
  let beforeVoyage: { view: View; timeOffset: number } | null = null;
  let frame = { width: 1, height: 1, pixels: new Uint8Array(1) };
  /** The view as a zoom on the fitted Earth, so it survives the window changing size. */
  let view: View = { ...HOME, radius: fitRadius(width(), height()) };
  let zoom = 1;
  let flying: { flight: Flight; start: number } | null = null;
  let spin: { lon: number; lat: number } | null = null;
  let drag: { point: LonLat | null; x: number; y: number; samples: { t: number; lon: number; lat: number }[] } | null = null;
  /** Where the pointer last was over the globe, for the wheel to zoom about; null when it is elsewhere. */
  let pointer: { x: number; y: number } | null = null;
  let cancelFrame: (() => void) | null = null;
  let lastTick: number | null = null;
  let loaded = false;
  let saveAt = Infinity;
  /** Milliseconds the simulated clock runs ahead of the real one. */
  let timeOffset = 0;
  let timeStep: { from: number; start: number } | null = null;

  const simulatedTime = () => Date.now() + timeOffset;

  function setView(next: View): void {
    view = clampView(next, width(), height());
    zoom = view.radius / fitRadius(width(), height());
    saveAt = app.scheduler.now() + 800;
    redraw();
  }

  function redraw(): void {
    if (cancelFrame) return;
    cancelFrame = app.scheduler.requestFrame(tick);
  }

  /** Rotate turns the Earth only while its window is in front, as a game pauses. */
  const rotating = () => settings().rotate && win.isActive();

  function animating(): boolean {
    return voyage !== null || flying !== null || spin !== null || rotating() || timeStep !== null || playing();
  }

  function tick(now: number): void {
    cancelFrame = null;
    const dt = lastTick === null ? 0 : Math.min(0.1, (now - lastTick) / 1000);
    lastTick = animating() ? now : null;

    if (flying) {
      const t = (now - flying.start) / 1000 / flying.flight.duration;
      setView(flying.flight.at(t));
      if (t >= 1) flying = null;
    } else if (spin && !drag) {
      setView({ ...view, lon: view.lon + spin.lon * dt, lat: view.lat + spin.lat * dt });
      const keep = Math.exp(-dt / SPIN_DECAY);
      // A spin that runs into a pole stops turning that way.
      const atPole = Math.abs(view.lat) >= Math.PI / 2 - 1e-9;
      spin = { lon: spin.lon * keep, lat: atPole ? 0 : spin.lat * keep };
      if (Math.hypot(spin.lon, spin.lat) * view.radius < 2) spin = null;
    } else if (rotating() && !drag) {
      setView({ ...view, lon: view.lon - ROTATE_RATE * dt * Math.min(1, fitRadius(width(), height()) / view.radius) });
    }

    if (voyage) {
      const wasFinished = voyage.finished;
      voyage.advance(dt);
      timeOffset = voyage.time() - Date.now();
      if (voyage.finished !== wasFinished) showMission();
      if (frame.width !== width() || frame.height !== height()) frame = { width: width(), height: height(), pixels: new Uint8Array(width() * height()) };
      const scene = voyage.scene(width(), height());
      space.draw(frame, scene);
      setRevision((n) => n + 1);
      const { phase, clock } = scene.instruments;
      setLabel(`${phase.slice(1).join(", ").toLowerCase()}, ${clock}`);
      redraw();
      return;
    }
    if (playing()) timeOffset += PLAY_RATE * dt * 1000;
    else if (timeStep) {
      const t = Math.min(1, (now - timeStep.start) / TIME_STEP_MS);
      const eased = t * t * (3 - 2 * t);
      timeOffset = timeStep.from + (timeTarget() - timeStep.from) * eased;
      if (t >= 1) timeStep = null;
    }

    if (frame.width !== width() || frame.height !== height()) frame = { width: width(), height: height(), pixels: new Uint8Array(width() * height()) };
    const state = settings();
    const layers: Layers = { ...state, lighting: state.light, status: width() >= 220 && height() >= 80, time: simulatedTime() };
    renderer.draw(frame, view, layers);
    setRevision((n) => n + 1);
    setLabel(describe(view));

    if (loaded && now >= saveAt) {
      saveAt = Infinity;
      save();
    }
    if (animating() || saveAt !== Infinity) redraw();
  }

  function describe(at: View): string {
    const lat = at.lat / DEG;
    const lon = at.lon / DEG;
    const km = Math.round(eyeAltitude(at, width()));
    const where = `${Math.abs(lat).toFixed(2)}°${lat < 0 ? "S" : "N"} ${Math.abs(lon).toFixed(2)}°${lon < 0 ? "W" : "E"}, eye altitude ${km} km`;
    return settings().light === "sun" ? `${where}, ${new Date(simulatedTime()).toISOString().slice(0, 16)} UTC` : where;
  }

  /** Move the simulated clock by `ms`, sweeping there. */
  function shiftTime(ms: number): void {
    setPlaying(false);
    setTimeTarget((t) => (timeStep ? t : timeOffset) + ms);
    timeStep = { from: timeOffset, start: app.scheduler.now() };
    redraw();
  }

  /** Back to the real time. */
  function backToNow(): void {
    setPlaying(false);
    setTimeTarget(0);
    timeStep = { from: timeOffset, start: app.scheduler.now() };
    redraw();
  }

  function togglePlay(): void {
    if (playing()) {
      setPlaying(false);
      setTimeTarget(timeOffset);
    } else {
      timeStep = null;
      setPlaying(true);
      redraw();
    }
  }

  function save(): void {
    const saved: Settings = { ...settings(), view: { lon: view.lon / DEG, lat: view.lat / DEG, zoom } };
    void app.storage.write(SETTINGS_KEY, JSON.stringify(saved));
  }

  function stop(): void {
    flying = null;
    spin = null;
  }

  function flyTo(target: View): void {
    spin = null;
    const to = clampView(target, width(), height());
    flying = { flight: flight(view, to, fitRadius(width(), height())), start: app.scheduler.now() };
    redraw();
  }

  function goTo(place: Destination): void {
    flyTo({ lon: place.lon * DEG, lat: place.lat * DEG, radius: (width() / place.across) * EARTH_RADIUS_KM });
  }

  /**
   * Turn to see the Moon: from the far side of the Earth, looking past the
   * globe at it, turned just far enough aside that it clears the limb.
   */
  function toMoon(): void {
    const [mx, my, mz] = moonDirection(simulatedTime());
    const lon = Math.atan2(-my, -mx);
    const lat = Math.asin(-mz);
    const radius = fitRadius(width(), height());
    const aside = Math.atan((radius + 30) / skyFocal(width()));
    // Along the great circle eastwards from the point opposite the Moon.
    const [cx, cy, cz] = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
    const [ex, ey] = [-Math.sin(lon), Math.cos(lon)];
    const [x, y, z] = [cx * Math.cos(aside) + ex * Math.sin(aside), cy * Math.cos(aside) + ey * Math.sin(aside), cz * Math.cos(aside)];
    flyTo({ lon: Math.atan2(y, x), lat: Math.asin(Math.max(-1, Math.min(1, z))), radius });
  }

  /** Tell the Mission menu what changed. */
  function showMission(): void {
    setMission(
      voyage
        ? { paused: voyage.paused, speed: voyage.speed, speeds: voyage.speeds, pacing: voyage.pacing, mode: voyage.mode, finished: voyage.finished }
        : null,
    );
  }

  /** Fly to the Moon and back, on Apollo 8's timetable: the clock goes back to December 1968. */
  function startMission(): void {
    stop();
    setPlaying(false);
    timeStep = null;
    beforeVoyage = { view, timeOffset };
    voyage = new Voyage();
    lastTick = null;
    showMission();
    redraw();
  }

  /** Back to the globe: over the landing if the flight came home, else as it was before it began. */
  function endMission(): void {
    if (!voyage) return;
    if (voyage.finished) {
      setTimeTarget(timeOffset);
      setView({ ...voyage.landing(), radius: fitRadius(width(), height()) * 6 });
    } else if (beforeVoyage) {
      timeOffset = beforeVoyage.timeOffset;
      setTimeTarget(timeOffset);
      setView(beforeVoyage.view);
    }
    voyage = null;
    beforeVoyage = null;
    showMission();
    redraw();
  }

  function steerMission(change: (v: Voyage) => void): void {
    if (!voyage) return;
    change(voyage);
    showMission();
    redraw();
  }

  const missionSpeed = (factor: number) =>
    steerMission((v) => {
      const [slowest, fastest] = v.speeds;
      v.speed = Math.max(slowest, Math.min(fastest, v.speed * factor));
    });
  const missionPacing = (pacing: Pacing) => steerMission((v) => v.setPacing(pacing));
  /** The next (`step` 1) or previous (−1) of the Jump To moments from where the flight is now. */
  const missionEvent = (step: 1 | -1) =>
    steerMission((v) => {
      const event = step > 0 ? v.events.find((e) => e.t > v.t + 1) : [...v.events].reverse().find((e) => e.t < v.t - 30);
      if (event) v.jump(event.t);
    });
  const missionCamera = (mode: CameraMode) =>
    steerMission((v) => {
      v.mode = mode;
      v.yaw = 0;
      v.pitch = 0;
      v.zoom = 1;
    });

  function wholeEarth(): void {
    flyTo({ ...view, radius: fitRadius(width(), height()) });
  }

  /** Zoom by `factor`, keeping the ground under (x, y) where it is. */
  function zoomAbout(factor: number, x = width() / 2, y = height() / 2): void {
    stop();
    const radius = Math.max(minRadius(width(), height()), Math.min(MAX_RADIUS, view.radius * factor));
    const point = unproject(view, width(), height(), x, y);
    setView((point && grab(point, radius, width(), height(), x, y)) || { ...view, radius });
  }

  function zoomBy(factor: number): void {
    flyTo({ ...view, radius: (flying ? flying.flight.at(1).radius : view.radius) * factor });
  }

  function toggle(key: Toggle): void {
    setSettings((s) => ({ ...s, [key]: !s[key] }));
  }

  // The window changing size keeps the zoom, not the radius.
  createEffect(
    () => ({ w: width(), h: height() }),
    ({ w, h }) => {
      view = clampView({ ...view, radius: fitRadius(w, h) * zoom }, w, h);
      redraw();
    },
  );

  createEffect(
    () => settings(),
    () => {
      if (loaded) saveAt = app.scheduler.now();
      redraw();
    },
  );

  // Coming to the front picks Rotate up again.
  createEffect(
    () => win.isActive(),
    () => redraw(),
  );

  onSettled(() => {
    void app.storage.read(SETTINGS_KEY).then((text) => {
      try {
        const saved = JSON.parse(text ?? "{}") as Partial<Settings>;
        const next: Settings = { ...DEFAULTS };
        for (const key of ["grid", "borders", "places", "atmosphere", "stars", "rotate"] as const) if (typeof saved[key] === "boolean") next[key] = saved[key];
        if (saved.light === "studio" || saved.light === "sun") next.light = saved.light;
        setSettings(next);
        const v = saved.view;
        if (v && [v.lon, v.lat, v.zoom].every(Number.isFinite)) {
          setView({ lon: v.lon * DEG, lat: v.lat * DEG, radius: fitRadius(width(), height()) * v.zoom });
        }
      } catch {
        // A damaged settings file just means defaults.
      }
      loaded = true;
      saveAt = Infinity;
      redraw();
    });
    redraw();
  });

  // The sky follows the clock: the terminator and the stars move a quarter of a degree a minute.
  const sunClock = setInterval(() => {
    if (settings().light === "sun" || settings().stars) redraw();
  }, 60_000);

  onCleanup(() => {
    cancelFrame?.();
    clearInterval(sunClock);
  });

  createEffect(
    () => ({ s: settings(), full: isFullScreen(), live: timeTarget() === 0 && !playing(), play: playing(), m: mission() }),
    ({ s, full, live, play, m }) => {
      const destinations = DESTINATIONS.map((place): MenubarItemDef => ({ label: place.name, onClick: () => goTo(place) }));
      if (m) {
        app.setMenus([
          { label: "File", items: [{ label: "Quit", shortcut: "Q", onClick: () => app.quit() }] },
          {
            label: "Mission",
            items: [
              { label: m.paused ? "Play" : "Pause", shortcut: "P", disabled: m.finished, onClick: () => steerMission((v) => (v.paused = !v.paused)) },
              { label: "Faster", shortcut: "]", disabled: m.speed >= m.speeds[1], onClick: () => missionSpeed(2) },
              { label: "Slower", shortcut: "[", disabled: m.speed <= m.speeds[0], onClick: () => missionSpeed(0.5) },
              { type: "separator" },
              {
                type: "radiogroup",
                value: m.pacing,
                onValueChange: (value) => missionPacing(value as Pacing),
                items: [
                  { label: "Condensed", value: "condensed" },
                  { label: "Real Time", value: "realtime" },
                ],
              },
              {
                type: "submenu",
                label: "Jump To",
                items: (voyage?.events ?? []).map((event): MenubarItemDef => ({ label: event.name, onClick: () => steerMission((v) => v.jump(event.t)) })),
              },
              { type: "separator" },
              {
                type: "radiogroup",
                value: m.mode,
                onValueChange: (value) => missionCamera(value as CameraMode),
                items: (Object.keys(CAMERA_NAMES) as CameraMode[]).map((mode) => ({ label: CAMERA_NAMES[mode], value: mode })),
              },
              { type: "separator" },
              { label: "Start Over", onClick: () => steerMission((v) => v.restart()) },
              { label: "End Mission", onClick: endMission },
            ],
          },
          {
            label: "View",
            items: [{ label: full ? "Exit Full Screen" : "Full Screen", shortcut: "F", onClick: () => win.setFullScreen(!isFullScreen()) }],
          },
        ]);
        return;
      }
      app.setMenus([
        {
          label: "File",
          items: [{ label: "Quit", shortcut: "Q", onClick: () => app.quit() }],
        },
        {
          label: "View",
          items: [
            { label: "Zoom In", shortcut: "=", onClick: () => zoomBy(2) },
            { label: "Zoom Out", shortcut: "-", onClick: () => zoomBy(0.5) },
            { label: "Whole Earth", shortcut: "E", onClick: wholeEarth },
            { type: "separator" },
            { label: "Rotate", shortcut: "R", checked: s.rotate, onClick: () => setSettings((p) => ({ ...p, rotate: !p.rotate })) },
            { type: "separator" },
            { label: "Grid", checked: s.grid, onClick: () => toggle("grid") },
            { label: "Borders", checked: s.borders, onClick: () => toggle("borders") },
            { label: "Places", checked: s.places, onClick: () => toggle("places") },
            { label: "Atmosphere", checked: s.atmosphere, onClick: () => toggle("atmosphere") },
            { label: "Stars and Moon", checked: s.stars, onClick: () => toggle("stars") },
            { type: "separator" },
            {
              type: "radiogroup",
              value: s.light,
              onValueChange: (value) => setSettings((p) => ({ ...p, light: value as Lighting })),
              items: [
                { label: "Sunlight", value: "sun" },
                { label: "Studio Light", value: "studio" },
              ],
            },
            { type: "separator" },
            { label: full ? "Exit Full Screen" : "Full Screen", shortcut: "F", onClick: () => win.setFullScreen(!isFullScreen()) },
          ],
        },
        {
          label: "Time",
          items: [
            // ⌘N is the browser's own (a new window) and never reaches the page.
            { label: "Now", shortcut: "J", checked: live, onClick: backToNow },
            { label: "Play Day", shortcut: "P", checked: play, onClick: togglePlay },
            { type: "separator" },
            { label: "An Hour Earlier", shortcut: "[", onClick: () => shiftTime(-HOUR) },
            { label: "An Hour Later", shortcut: "]", onClick: () => shiftTime(HOUR) },
            { label: "A Day Earlier", onClick: () => shiftTime(-DAY) },
            { label: "A Day Later", onClick: () => shiftTime(DAY) },
            { label: "A Month Earlier", onClick: () => shiftTime(-30 * DAY) },
            { label: "A Month Later", onClick: () => shiftTime(30 * DAY) },
          ],
        },
        {
          label: "Go",
          items: [
            ...destinations,
            { type: "separator" },
            { label: "The Moon", shortcut: "M", onClick: toMoon },
            { label: "Apollo 8 Free Return", shortcut: "L", onClick: startMission },
            { label: "Home", shortcut: "H", onClick: () => flyTo({ ...HOME, radius: fitRadius(width(), height()) }) },
          ],
        },
      ]);
    },
  );

  const cameraKeys: Record<string, CameraMode> = { "1": "auto", "2": "moon", "3": "earth", "4": "window", "5": "overview" };

  const onKeyDown = (key: string, mods: { meta: boolean; ctrl: boolean; alt: boolean }) => {
    if (mods.meta || mods.ctrl) return;
    if (voyage) {
      if (key === " ") steerMission((v) => (v.paused = v.finished ? true : !v.paused));
      else if (key === "]") missionSpeed(2);
      else if (key === "[") missionSpeed(0.5);
      else if (cameraKeys[key]) missionCamera(cameraKeys[key]);
      else if (key === "r" || key === "R") steerMission((v) => v.restart());
      else if (key === "t" || key === "T") missionPacing(voyage.pacing === "realtime" ? "condensed" : "realtime");
      else if (key === ".") missionEvent(1);
      else if (key === ",") missionEvent(-1);
      else if (key === "Escape") endMission();
      return;
    }
    // A fifth of the window, in ground.
    const pan = (Math.min(width(), height()) * 0.2) / view.radius;
    const across = Math.max(0.2, Math.cos(view.lat));
    if (key === "ArrowLeft") flyTo({ ...view, lon: view.lon - pan / across });
    else if (key === "ArrowRight") flyTo({ ...view, lon: view.lon + pan / across });
    else if (key === "ArrowUp") flyTo({ ...view, lat: view.lat + pan });
    else if (key === "ArrowDown") flyTo({ ...view, lat: view.lat - pan });
    else if (key === "+" || key === "=") zoomBy(2);
    else if (key === "-" || key === "_") zoomBy(0.5);
    else if (key === "[") shiftTime(-HOUR);
    else if (key === "]") shiftTime(HOUR);
    else if (key === "{") shiftTime(-DAY);
    else if (key === "}") shiftTime(DAY);
    else if (key === " ") togglePlay();
    else if (key === "n" || key === "N") backToNow();
    else if (key === "Escape" && isFullScreen()) win.setFullScreen(false);
  };

  return (
    <box
      width={width()}
      height={height()}
      tabIndex={0}
      autoFocus
      semantic={{ name: "earth", role: "application" }}
      onKeyDown={onKeyDown}
    >
      <raster
        width={width()}
        height={height()}
        revision={revision()}
        cursor={dragging() ? "grabbing" : "grab"}
        semantic={{ name: "globe", role: "preview", value: label() }}
        onMouseDown={(x, y) => {
          stop();
          drag = { point: voyage ? null : unproject(view, width(), height(), x, y), x, y, samples: [] };
        }}
        onDragStart={() => setDragging(true)}
        onDrag={(x, y) => {
          if (!drag) return;
          if (voyage) {
            // Looking about from the spacecraft (or turning the overview): a window's width is about a half turn.
            const turn = Math.PI / width() / voyage.zoom;
            const v = voyage;
            v.yaw += (x - drag.x) * turn;
            v.pitch = Math.max(-1.5, Math.min(1.5, v.pitch + (y - drag.y) * turn));
            drag.x = x;
            drag.y = y;
            redraw();
            return;
          }
          const held = drag.point && grab(drag.point, view.radius, width(), height(), x, y);
          if (held) setView(held);
          else {
            // In space, or past where the ground can follow: turn by the distance dragged.
            const across = Math.max(0.2, Math.cos(view.lat));
            setView({ ...view, lon: view.lon - (x - drag.x) / view.radius / across, lat: view.lat + (y - drag.y) / view.radius });
            drag.point = null;
          }
          drag.x = x;
          drag.y = y;
          const t = app.scheduler.now();
          drag.samples.push({ t, lon: view.lon, lat: view.lat });
          while (drag.samples.length > 2 && t - drag.samples[0]!.t > 100) drag.samples.shift();
        }}
        onDragEnd={() => {
          setDragging(false);
          if (voyage) {
            drag = null;
            return;
          }
          const samples = drag?.samples ?? [];
          drag = null;
          const first = samples[0];
          const last = samples[samples.length - 1];
          const now = app.scheduler.now();
          if (!first || !last || last === first || now - last.t > FLICK_MS) return;
          const seconds = (last.t - first.t) / 1000;
          if (seconds <= 0) return;
          let dLon = last.lon - first.lon;
          if (dLon > Math.PI) dLon -= 2 * Math.PI;
          if (dLon < -Math.PI) dLon += 2 * Math.PI;
          // At most a turn a second, however fast the flick.
          const limit = (x: number) => Math.max(-2 * Math.PI, Math.min(2 * Math.PI, x));
          spin = { lon: limit(dLon / seconds), lat: limit((last.lat - first.lat) / seconds) };
          redraw();
        }}
        onMouseUp={() => {
          if (!dragging()) drag = null;
        }}
        onDoubleClick={(x, y) => {
          drag = null;
          if (voyage) {
            missionCamera(voyage.mode);
            return;
          }
          const out = heldModifiers().alt;
          const point = unproject(view, width(), height(), x, y);
          if (out) zoomBy(0.5);
          else if (point) flyTo({ ...point, radius: view.radius * 2 });
        }}
        onMouseMove={(x, y) => {
          pointer = { x, y };
        }}
        onMouseLeave={() => {
          pointer = null;
        }}
        onScroll={(deltaY) => {
          if (voyage) {
            const v = voyage;
            v.zoom = Math.max(0.5, Math.min(30, v.zoom * Math.exp(-deltaY * WHEEL_ZOOM)));
            redraw();
          } else zoomAbout(Math.exp(-deltaY * WHEEL_ZOOM), pointer?.x, pointer?.y);
        }}
        onPaint={(surface) => surface.blitPixels(frame.pixels, frame.width, frame.height)}
      />
    </box>
  );
}

export default defineApp({
  id: "earth",
  title: "Earth",
  icon: "earth/icon",
  sprites,
  about: {
    version: "1.0",
    description:
      "The whole Earth in one bit, after Google Earth: drag to turn the globe, scroll to come down to it, and fly anywhere from the Go menu. The Sun lights it as it does now, or at any hour the Time menu turns to, against the real stars, and Go flies Apollo 8's free return to the Moon and back, condensed or in real time. Imagery from NASA's Blue Marble; coastlines and borders from Natural Earth; stars from the Yale Bright Star Catalogue.",
  },
  defaultSize: { width: 480, height: 320 },
  minSize: { width: 200, height: 150 },
  scrollable: false,
  resizable: true,
  Component: Earth,
});
