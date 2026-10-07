import {
  For,
  Show,
  TextInput,
  createEffect,
  createMemo,
  createSignal,
  defineApp,
  heldModifiers,
  measureText,
  onCleanup,
  onSettled,
  showPrintDialog,
  spacedFontName,
  uniqueChildName,
  useApp,
  writeSpriteFile,
  type MenubarItemDef,
  type PrintDialogChoice,
  type PrintableImage,
} from "@mockintosh/sdk";
import type { JSX } from "@mockintosh/ui";
import { Bitmap } from "./maps/bitmap";
import { DirectionsPanel, directionsFieldsBottom, type Endpoint as EndpointField } from "./maps/DirectionsPanel";
import { DirectionsError, TRAVEL_MODES, calloutPoints, findRoutes, formatDuration, type Route, type TravelMode } from "./maps/directions";
import { sprites } from "./maps/icons";
import { metresPerPixel, project, unproject, zoomToFit, type LatLon } from "./maps/mercator";
import { CITIES, HISTORY, HOME, WORLD, type Landmark } from "./maps/places";
import { MAX_PITCH, MIN_PITCH, PITCH_3D, Perspective } from "./maps/perspective";
import { PlaceInfo, kindLabel, type PlaceInfoState } from "./maps/PlaceInfo";
import { SearchError, searchPlaces, type Place } from "./maps/search";
import { TileSource } from "./maps/tiles";
import { GpuBuildings } from "./maps/gpuBuildings";
import { BADGE_HALF, BADGE_SIZE, drawCentred, drawCompass, drawMarks, drawMarksInto, resultLetter, type Mark } from "./maps/marks";
import { FIELD_H, Icon, MARGIN, fitted } from "./maps/ui";
import {
  BUILDINGS_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  MapRenderer,
  cameraAt,
  cameraCentre,
  clampZoom,
  normalizeCamera,
  panCamera,
  zoomCamera,
  type Box,
  type Camera,
  type MapOverlays,
  type MapRoute,
  type Pin,
} from "./maps/view";

/** The zoom buttons: two cells, one above the other. */
const ZOOM_W = 20;
const ZOOM_CELL_H = 18;
/** The zoom buttons' box: two cells, the rule between them and the border. */
const ZOOM_H = ZOOM_CELL_H * 2 + 3;
/** The 3D button, under the zoom buttons. */
const TILT_TOP = MARGIN + ZOOM_H + 6;
const TILT_H = ZOOM_CELL_H + 2;
/** The view tilts to 3D, and back, over this long. */
const TILT_ANIMATION_MS = 320;
/** However long a frame takes, it moves a swing on by no more than this. */
const SWING_STEP_MS = 40;
/** The compass, under the 3D button while the view is in 3D. */
const COMPASS_TOP = TILT_TOP + TILT_H + 6;
const COMPASS_SIZE = ZOOM_W + 1;
/** Option-dragging turns the view this much per pixel across, and tilts it this much per pixel down. */
const TURN_PER_PX = Math.PI / 240;
const TILT_PER_PX = Math.PI / 600;
/** Option and the arrow keys turn and tilt the view by these steps. */
const TURN_STEP = Math.PI / 12;
const TILT_STEP = Math.PI / 36;
const TAU = 2 * Math.PI;
/** The magnifying glass in the search field, and the gap after it. */
const SEARCH_ICON_W = 14;
const SEARCH_PLACEHOLDER = "Search";
/** The search field opens to its full width, and closes again, over this long. */
const SEARCH_ANIMATION_MS = 160;
const RESULT_ROW_H = 26;
const RESULT_ROWS = 6;
/** Between a result's letter and its name. */
const RESULT_GAP = 5;
/** Search results are shown together no closer than this. */
const RESULTS_ZOOM = 16;
/** Panels over the map: their share of its width, within these. */
const PANEL_MIN_W = 150;
const PANEL_MAX_W = 190;
/** The grow box over the map's bottom-right corner (`growBox: "overlay"`). */
const GROW_BOX = 15;
const SETTINGS_KEY = "view.json";
/**
 * The wheel zooms a step as soon as a scroll starts: a mouse notch is 100
 * on one machine and 4 on another, so no amount can be waited for. Within
 * a scroll, each further this much travel is another step, no sooner than
 * `WHEEL_REPEAT_MS` apart, so a trackpad's coasting doesn't run away. A
 * pause of `WHEEL_PAUSE_MS` starts a new scroll.
 */
const WHEEL_STEP = 50;
const WHEEL_REPEAT_MS = 120;
const WHEEL_PAUSE_MS = 200;
/** A press that moves less than this is a click, not a drag. */
const CLICK_SLOP = 3;
/**
 * A pan let go while moving glides on a little, as on a phone: its speed,
 * measured over the last `GLIDE_SAMPLE_MS` of the drag, falls by this share
 * each millisecond until it's under `GLIDE_STOP` pixels a millisecond. That
 * carries the map about an eighth of a second's travel on, far less than
 * the kit's touch scrolling (UIScrollView's 0.998) does. Slower than
 * `GLIDE_START` when let go, or held still for `GLIDE_HELD_MS` first, it
 * stops where it is.
 */
const GLIDE_DECAY = 0.992;
const GLIDE_SAMPLE_MS = 80;
const GLIDE_HELD_MS = 80;
const GLIDE_START = 0.08;
const GLIDE_STOP = 0.015;
/** Pixels a millisecond: a flick no faster than this. */
const GLIDE_MAX = 3;
/** A label clicked on is looked up within this many pixels of where it is. */
const LOOKUP_RADIUS_PX = 60;
/** A route's other end is searched around this far each way, in degrees: about 50 km. */
const NEARBY_DEGREES = 0.5;
/** Clicking a step shows its turn at least this close. */
const STEP_ZOOM = 16;
/** Arrow keys move the map this fraction of the view. */
const ARROW_PAN = 0.25;

interface SavedView {
  lat?: unknown;
  lon?: unknown;
  zoom?: unknown;
  labels?: unknown;
  pin?: unknown;
  mode?: unknown;
  tilt?: unknown;
  pitch?: unknown;
  bearing?: unknown;
  orthographic?: unknown;
}

function savedPin(value: unknown): Pin | null {
  if (!value || typeof value !== "object") return null;
  const { lat, lon, name } = value as Record<string, unknown>;
  return typeof lat === "number" && typeof lon === "number" && typeof name === "string" ? { lat, lon, name } : null;
}

/** A place the directions go from or to: something found, or the place on show. */
interface Endpoint extends LatLon {
  name: string;
}

type Field = "search" | EndpointField;

function placeInfo(place: Place): PlaceInfoState {
  return { name: place.name, kind: place.kind, lat: place.lat, lon: place.lon, details: place.details, loading: false };
}

function Maps(_props: Record<string, unknown>): JSX.Element {
  const app = useApp();
  const win = app.window;

  const [camera, setCamera] = createSignal<Camera>(cameraAt(HOME, HOME.zoom));
  const [labels, setLabels] = createSignal(true);
  const [pin, setPin] = createSignal<Pin | null>(null);
  const [ticks, setTicks] = createSignal(0);
  const [dragging, setDragging] = createSignal(false);

  // Search, in a field floating over the map; its matches are listed under it.
  const [query, setQuery] = createSignal("");
  const [results, setResults] = createSignal<Place[] | null>(null);
  /** Which field the results on show were found for. */
  const [resultsFor, setResultsFor] = createSignal<Field>("search");
  const [hovered, setHovered] = createSignal(-1);
  const [searching, setSearching] = createSignal(false);
  const [notice, setNotice] = createSignal<string | null>(null);
  const [searchFocused, setSearchFocused] = createSignal(false);

  // 3D: asked for with the 3D button, shown once close enough for buildings.
  const [want3d, setWant3d] = createSignal(false);
  /** The tilt the 3D view takes, as the user last left it. */
  const [tilt, setTilt] = createSignal(PITCH_3D);
  /** How the view is tilted and which way it faces now. */
  const [pitch, setPitch] = createSignal(0);
  const [bearing, setBearing] = createSignal(0);
  /** The 3D view drawn without perspective, to compare. */
  const [orthographic, setOrthographic] = createSignal(false);
  const can3d = () => camera().zoom >= BUILDINGS_ZOOM;
  const is3d = () => want3d() && can3d();

  /** The place whose info is open, in a panel under the search field. */
  const [place, setPlace] = createSignal<PlaceInfoState | null>(null);

  // Directions, in a panel down the left that takes the search field's place.
  const [directions, setDirections] = createSignal(false);
  const [fromText, setFromText] = createSignal("");
  const [toText, setToText] = createSignal("");
  const [from, setFrom] = createSignal<Endpoint | null>(null);
  const [to, setTo] = createSignal<Endpoint | null>(null);
  const [mode, setMode] = createSignal<TravelMode>("car");
  const [routes, setRoutes] = createSignal<Route[]>([]);
  const [selected, setSelected] = createSignal(0);
  const [routing, setRouting] = createSignal(false);
  const [routeError, setRouteError] = createSignal<string | null>(null);
  const [showSteps, setShowSteps] = createSignal(false);
  const [step, setStep] = createSignal(-1);
  const [listScroll, setListScroll] = createSignal(0);
  const [routedAt, setRoutedAt] = createSignal(new Date());

  const isFullScreen = () => win.kind() === "fullscreen";
  const viewWidth = () => Math.max(1, win.width());
  const viewHeight = () => Math.max(1, win.height());
  const panelWidth = () =>
    Math.max(60, Math.min(viewWidth() - 2 * MARGIN - ZOOM_W - 2 * MARGIN, Math.max(PANEL_MIN_W, Math.min(PANEL_MAX_W, Math.round(viewWidth() * 0.42)))));
  /** How much of the map's left a panel covers. */
  const inset = () => (directions() || place() ? MARGIN + panelWidth() + 1 : 0);
  const zoomLeft = () => viewWidth() - MARGIN - ZOOM_W - 1;

  // The search field is just wide enough for its glass and "Search" until
  // it's typed in: focused, or holding a search, it opens to the panels' width.
  const searchCollapsed = () => SEARCH_ICON_W + 6 + measureText(SEARCH_PLACEHOLDER, "body") + 6;
  const searchTarget = () => (searchFocused() || query().trim() !== "" ? panelWidth() : searchCollapsed());
  const [searchWidth, setSearchWidth] = createSignal(searchCollapsed());
  let searchAnimation: (() => void) | null = null;
  createEffect(searchTarget, (to) => {
    searchAnimation?.();
    const from = searchWidth();
    if (from === to) return;
    const start = app.scheduler.now();
    const frame = () => {
      const t = Math.min(1, (app.scheduler.now() - start) / SEARCH_ANIMATION_MS);
      // Fast at first, settling into place.
      setSearchWidth(Math.round(from + (to - from) * (1 - (1 - t) ** 3)));
      searchAnimation = t < 1 ? app.scheduler.requestFrame(frame) : null;
    };
    searchAnimation = app.scheduler.requestFrame(frame);
  });
  onCleanup(() => searchAnimation?.());

  // The view swings into 3D and back, and round to north, rather than jumping.
  let viewAnimation: (() => void) | null = null;
  /** Where the view is swinging to; a turn or tilt asked for mid-swing starts from there. */
  const aim = { pitch: 0, bearing: 0 };
  /** Swing the view to `toPitch` and `toBearing`, then `done`. */
  function animateView(toPitch: number, toBearing: number, done?: () => void): void {
    viewAnimation?.();
    viewAnimation = null;
    pendingZoom = null;
    aim.pitch = toPitch;
    aim.bearing = toBearing;
    const fromPitch = pitch();
    const fromBearing = bearing();
    // The short way round.
    const turn = ((((toBearing - fromBearing) % TAU) + TAU + Math.PI) % TAU) - Math.PI;
    if (fromPitch === toPitch && turn === 0) {
      done?.();
      return;
    }
    // The swing's own clock, which a slow frame moves on by no more than
    // `SWING_STEP_MS`: while tiles are drawn, it slows rather than jumping to its end.
    let elapsed = 0;
    let last = app.scheduler.now();
    const frame = () => {
      const now = app.scheduler.now();
      elapsed += Math.min(now - last, SWING_STEP_MS);
      last = now;
      const t = Math.min(1, elapsed / TILT_ANIMATION_MS);
      // Off at once, settling into place: the swing answers the click straight away.
      const eased = 1 - (1 - t) ** 3;
      setPitch(fromPitch + (toPitch - fromPitch) * eased);
      setBearing(t < 1 ? fromBearing + turn * eased : (((toBearing % TAU) + TAU) % TAU));
      viewAnimation = t < 1 ? app.scheduler.requestFrame(frame) : null;
      if (t >= 1) done?.();
    };
    viewAnimation = app.scheduler.requestFrame(frame);
  }
  /** A zoom out of 3D waiting for the view to tilt back first: how many steps, about which point. */
  let pendingZoom: { steps: number; x: number; y: number } | null = null;
  onCleanup(() => viewAnimation?.());
  // Into 3D at the tilt last left, and back to the flat map, facing the same way.
  createEffect(is3d, (on) => animateView(on ? tilt() : 0, aim.bearing));

  /** Turn the view by hand: there at once, no swinging. */
  function setView(toPitch: number, toBearing: number): void {
    viewAnimation?.();
    viewAnimation = null;
    aim.pitch = toPitch;
    aim.bearing = (((toBearing % TAU) + TAU) % TAU);
    setPitch(toPitch);
    setBearing(aim.bearing);
  }

  /** Turn the map by `delta` radians, clockwise, flat or in 3D. */
  function turnBy(delta: number): void {
    animateView(aim.pitch, aim.bearing + delta);
  }

  /** Tilt the 3D view by `delta` radians, further from looking straight down. */
  function tiltBy(delta: number): void {
    if (!is3d()) return;
    const next = Math.max(MIN_PITCH, Math.min(MAX_PITCH, tilt() + delta));
    setTilt(next);
    animateView(next, aim.bearing);
  }

  function faceNorth(): void {
    animateView(aim.pitch, 0);
  }

  /** The tilted view as it is now, for turning a point on the screen into one on the ground. */
  const perspective = () => new Perspective(viewWidth(), viewHeight(), pitch(), bearing(), orthographic());

  /** Boxes over the map where its labels would be hidden. */
  const covered = (): Box[] => {
    const boxes: Box[] = [
      [zoomLeft(), MARGIN, zoomLeft() + ZOOM_W + 1, MARGIN + ZOOM_H],
      [zoomLeft(), TILT_TOP, zoomLeft() + ZOOM_W + 1, TILT_TOP + TILT_H],
    ];
    boxes.push([zoomLeft(), COMPASS_TOP, zoomLeft() + COMPASS_SIZE, COMPASS_TOP + COMPASS_SIZE]);
    if (directions()) boxes.push([MARGIN, MARGIN, MARGIN + panelWidth() + 1, viewHeight() - MARGIN + 1]);
    else if (place()) boxes.push([MARGIN, MARGIN, MARGIN + panelWidth() + 1, viewHeight() - MARGIN]);
    else {
      // Where the field ends up, not where it is mid-animation: the map is drawn once, not every frame.
      boxes.push([MARGIN, MARGIN, MARGIN + searchTarget() + 1, MARGIN + FIELD_H + 1]);
    }
    return boxes;
  };

  const mapRoutes = createMemo((): MapRoute[] => {
    const found = routes();
    const anchors = calloutPoints(found);
    return found.map((route, index) => ({ points: route.points, callout: { at: anchors[index]!, text: formatDuration(route.duration) } }));
  });

  // The map is drawn at paint time, outside the reactive graph; Save and
  // Print draw the same picture again.
  const source = new TileSource({ fetch: app.fetch!, now: () => app.scheduler.now(), onChange: redraw });
  const renderer = new MapRenderer(source, () => app.scheduler.now());
  let frame = new Bitmap(1, 1);
  let cancelRedraw: (() => void) | null = null;
  let loaded = false;
  let lastPrint: PrintDialogChoice | undefined;
  /** What the results on show were found for: Return again opens the highlighted one. */
  let searched = "";

  /** Draw again on the next frame: a tile arrived, or one is still to be drawn. */
  function redraw(): void {
    if (cancelRedraw) return;
    cancelRedraw = app.scheduler.requestFrame(() => {
      cancelRedraw = null;
      setTicks((n) => n + 1);
    });
  }
  onCleanup(() => cancelRedraw?.());

  /**
   * The map's revision: a new number whenever anything it shows changes, so
   * the raster draws again. Returning only `ticks()` would hand back the
   * same value when, say, just the tilt moved, and nothing would repaint.
   */
  let revisions = 0;
  const revision = createMemo(() => {
    camera();
    labels();
    pin();
    mapRoutes();
    selected();
    step();
    pitch();
    bearing();
    orthographic();
    covered();
    inset();
    results();
    hovered();
    viewWidth();
    viewHeight();
    ticks();
    return ++revisions;
  });

  /** What's drawn over the map; `bare` leaves out room for the panels. */
  function overlays(bare: boolean): MapOverlays {
    return {
      labels: labels(),
      pin: pin(),
      corner: GROW_BOX,
      routes: mapRoutes(),
      selectedRoute: selected(),
      mark: routes()[selected()]?.steps[step()]?.at ?? null,
      covered: bare ? [] : covered(),
      inset: bare ? 0 : inset(),
      pitch: pitch(),
      bearing: bearing(),
      orthographic: orthographic(),
      // The list isn't in a saved picture, so its letters aren't either.
      results: bare ? [] : (results() ?? []),
      highlighted: hovered(),
    };
  }

  /**
   * The map revision `frame` shows, or -1. The window repaints the map
   * whenever something over it does (the search field's caret blinking,
   * a button's highlight), and that needn't draw the whole map again.
   */
  let painted = -1;
  /** What goes over `frame`, drawn with QuickDraw when it's shown. */
  let frameMarks: readonly Mark[] = [];

  /** The map, drawn on the CPU; `bare` leaves out room for the panels, for a picture to save or print. */
  function paint(bare = false): Bitmap {
    const width = viewWidth();
    const height = viewHeight();
    const wanted = revision();
    if (!bare && wanted === painted && frame.width === width && frame.height === height) return frame;
    if (frame.width !== width || frame.height !== height) frame = new Bitmap(width, height);
    const drawn = renderer.render(frame, normalizeCamera(camera(), height), overlays(bare));
    frameMarks = renderer.marks;
    // A picture without the panels' room isn't the map on show.
    painted = bare ? -1 : wanted;
    if (!drawn) redraw();
    return frame;
  }

  // The graphics processor draws the 3D buildings whenever there is one;
  // without one, or if it fails, the CPU does. Its pictures come back a
  // moment later, so the map shows the last one finished while the next is
  // drawn, into a second bitmap.
  let gpu: GpuBuildings | null = null;
  /** The graphics processor couldn't be used: the CPU draws everything from now on. */
  let gpuFailed = !app.gpu;
  let closed = false;
  void app.gpu
    ?.rasterizer()
    .then((raster) => GpuBuildings.open(raster))
    .then(
      (opened) => {
        if (closed) return opened.close();
        gpu = opened;
        redraw();
      },
      () => {
        gpuFailed = true;
      },
    );
  onCleanup(() => {
    closed = true;
    gpu?.close();
  });
  /** The GPU's last finished picture, and the bitmap the next is drawn into. */
  let shown: Bitmap | null = null;
  let shownMarks: readonly Mark[] = [];
  let back = new Bitmap(1, 1);
  let gpuBusy = false;
  /** The map revision the GPU last drew, or is drawing. */
  let gpuRevision = -1;
  /** Bumped as each GPU picture comes back, to show it. */
  const [gpuPictures, setGpuPictures] = createSignal(0);

  /**
   * The map to show, and what goes over it: the GPU's latest picture, a new
   * one asked for if the map has changed since.
   */
  function picture(): { bitmap: Bitmap; marks: readonly Mark[] } {
    const cpu = () => ({ bitmap: paint(), marks: frameMarks });
    if (gpuFailed || !gpu) return cpu();
    const width = viewWidth();
    const height = viewHeight();
    const wanted = revision();
    if (!gpuBusy && wanted !== gpuRevision) {
      gpuBusy = true;
      gpuRevision = wanted;
      if (back.width !== width || back.height !== height) back = new Bitmap(width, height);
      const target = back;
      renderer.renderWith(gpu, target, normalizeCamera(camera(), height), overlays(false)).then(
        (drawn) => {
          back = shown ?? new Bitmap(1, 1);
          shown = target;
          shownMarks = renderer.marks;
          if (!drawn) redraw();
        },
        () => {
          // Lost, or never worked: the CPU takes over.
          gpuFailed = true;
        },
      ).finally(() => {
        gpuBusy = false;
        setGpuPictures((n) => n + 1);
      });
    }
    // Until the GPU has a picture this size, the CPU draws one.
    return shown && shown.width === width && shown.height === height ? { bitmap: shown, marks: shownMarks } : cpu();
  }

  /** Move the map there, stopping any glide. */
  function move(next: Camera): void {
    stopGlide();
    setCamera(normalizeCamera(next, viewHeight()));
  }

  /** Zoom by whole steps, keeping the ground under (x, y) on the view where it is. */
  function zoomBy(steps: number, x = viewWidth() / 2, y = viewHeight() / 2): void {
    setNotice(null);
    if (pendingZoom) {
      // Further out while tilting back: zoomed together, once it's flat. Back in: tilt up again instead.
      if (steps < 0) pendingZoom.steps += steps;
      else animateView(tilt(), aim.bearing);
      return;
    }
    const [ox, oy] = groundOffset(x, y);
    const sx = ox + viewWidth() / 2;
    const sy = oy + viewHeight() / 2;
    // Out of 3D: tilt back where everything is drawn, then zoom out flat,
    // rather than swinging over a zoom whose tiles are still to come.
    if (is3d() && camera().zoom + steps < BUILDINGS_ZOOM && pitch() > 0) {
      animateView(0, aim.bearing, () => {
        const wanted = pendingZoom;
        pendingZoom = null;
        if (wanted) move(zoomCamera(camera(), wanted.steps, wanted.x, wanted.y, viewWidth(), viewHeight()));
      });
      pendingZoom = { steps, x: sx, y: sy };
      return;
    }
    move(zoomCamera(camera(), steps, sx, sy, viewWidth(), viewHeight()));
  }

  /** How far the ground under view point (x, y) is from the middle, in world pixels: tilted, not the same as on the screen. */
  function groundOffset(x: number, y: number): [number, number] {
    if (pitch() === 0 && bearing() === 0) return [x - viewWidth() / 2, y - viewHeight() / 2];
    return perspective().ground(x, y) ?? [0, 0];
  }

  /**
   * Centre `point` at `zoom` in the part of the map no panel covers.
   * `covering` is how much of the left a panel will cover, when it opens
   * with this move.
   */
  function centreOn(point: LatLon, zoom: number, covering = inset()): void {
    const at = cameraAt(point, zoom);
    move({ ...at, x: at.x - covering / 2 });
  }

  /** The largest zoom showing `bounds` in the part of the map no panel covers. */
  function fitZoom(bounds: { south: number; north: number; west: number; east: number }, covering: number): number {
    return zoomToFit(bounds, (viewWidth() - covering) * 0.85, viewHeight() * 0.8, MIN_ZOOM, MAX_ZOOM);
  }

  function goTo(landmark: Landmark): void {
    setResults(null);
    move(cameraAt(landmark, landmark.zoom));
  }

  /**
   * Open a place's info, with the pin on it. The info takes the search
   * field's place; the field comes back empty and closed when it shuts.
   */
  function openPlace(info: PlaceInfoState): void {
    setResults(null);
    setNotice(null);
    setQuery("");
    setSearchFocused(false);
    searchAnimation?.();
    searchAnimation = null;
    setSearchWidth(searchCollapsed());
    setPlace(info);
    setPin({ lat: info.lat, lon: info.lon, name: info.name });
  }

  function closePlace(): void {
    lookupRequest++;
    setPlace(null);
    setPin(null);
  }

  /** A search result: its info, and the map showing it. */
  function show(found: Place): void {
    openPlace(placeInfo(found));
    const covering = MARGIN + panelWidth() + 1;
    // Fit what the place spans, within the zooms its kind is shown at.
    const fit = found.bounds ? fitZoom(found.bounds, covering) : found.zoom.max;
    centreOn(found, clampZoom(Math.max(found.zoom.min, Math.min(found.zoom.max, fit))), covering);
  }

  /** A place clicked on the map: its info at once, its details once OpenStreetMap has been asked. */
  let lookupRequest = 0;
  async function openClicked(name: string, kind: string, at: LatLon): Promise<void> {
    openPlace({ name, kind: kindLabel(kind), lat: at.lat, lon: at.lon, details: null, loading: true });
    // Keep the place clear of the panel that just opened over the map's left.
    const covering = MARGIN + panelWidth() + 1;
    const x = project(at, camera().zoom).x - (camera().x - viewWidth() / 2);
    if (x < covering + 20) move({ ...camera(), x: camera().x - (covering + 40 - x) });
    const request = ++lookupRequest;
    const radius = (metresPerPixel(at.lat, camera().zoom) * LOOKUP_RADIUS_PX) / 111_320;
    let found: Place | undefined;
    try {
      [found] = await searchPlaces(app.fetch!, name, { lat: at.lat, lon: at.lon, radius: Math.max(0.002, radius), bounded: true });
    } catch {
      // The label's own name and kind are info enough.
    }
    if (request !== lookupRequest) return;
    setPlace({
      name,
      kind: found?.kind || kindLabel(kind),
      lat: at.lat,
      lon: at.lon,
      details: found?.details ?? null,
      loading: false,
    });
  }

  async function search(text: string): Promise<void> {
    const wanted = text.trim();
    if (!wanted || searching()) return;
    setSearching(true);
    setNotice(null);
    setResults(null);
    try {
      const places = await searchPlaces(app.fetch!, wanted);
      searched = wanted;
      if (places.length === 0) setNotice(`No places match “${wanted}”.`);
      else if (places.length === 1) show(places[0]!);
      else {
        setHovered(0);
        setResultsFor("search");
        setResults(places.slice(0, RESULT_ROWS));
        fitResults(places.slice(0, RESULT_ROWS));
      }
    } catch (err) {
      setNotice(err instanceof SearchError ? err.message : "Maps couldn't search.");
    } finally {
      setSearching(false);
    }
  }

  // ── Directions ───────────────────────────────────────────────────────

  /** Where a route's end is: the place found for what its field says, until the text changes. */
  const endpoint = (field: EndpointField): Endpoint | null => {
    const found = field === "from" ? from() : to();
    const text = (field === "from" ? fromText() : toText()).trim();
    return found && found.name === text ? found : null;
  };

  function setEndpoint(field: EndpointField, found: Endpoint): void {
    setResults(null);
    if (field === "from") {
      setFrom(found);
      setFromText(found.name);
      void findDirections(found, endpoint("to"));
    } else {
      setTo(found);
      setToText(found.name);
      void findDirections(endpoint("from"), found);
    }
  }

  /** Find the place typed in a directions field; several matches are offered to pick from. */
  async function lookUp(field: EndpointField, text: string): Promise<void> {
    const wanted = text.trim();
    if (!wanted || searching()) return;
    if (endpoint(field)) {
      void findDirections(endpoint("from"), endpoint("to"));
      return;
    }
    setSearching(true);
    setResults(null);
    setRouteError(null);
    // A start is most likely near the end, and an end near the start.
    const other = endpoint(field === "from" ? "to" : "from");
    try {
      const places = await searchPlaces(app.fetch!, wanted, other ? { lat: other.lat, lon: other.lon, radius: NEARBY_DEGREES } : undefined);
      searched = wanted;
      if (places.length === 0) failLookUp(`No places match “${wanted}”.`);
      else if (places.length === 1) setEndpoint(field, places[0]!);
      else {
        setHovered(0);
        setResultsFor(field);
        setResults(places.slice(0, RESULT_ROWS));
        fitResults(places.slice(0, RESULT_ROWS));
      }
    } catch (err) {
      failLookUp(err instanceof SearchError ? err.message : "Maps couldn't search.");
    } finally {
      setSearching(false);
    }
  }

  /** A route's end that can't be found: the routes to the old one go, and the panel says why. */
  function failLookUp(message: string): void {
    routeRequest++;
    setRoutes([]);
    setRouting(false);
    setShowSteps(false);
    setStep(-1);
    setRouteError(message);
  }

  /**
   * The ways between the two ends, once both are known, fitted in the map.
   * The ends and mode are passed in: a signal just set still reads its old
   * value until the update is applied.
   */
  let routeRequest = 0;
  async function findDirections(start: Endpoint | null, end: Endpoint | null, travel = mode()): Promise<void> {
    if (!start || !end) return;
    const request = ++routeRequest;
    setRouting(true);
    setRouteError(null);
    setRoutes([]);
    setSelected(0);
    setShowSteps(false);
    setStep(-1);
    setListScroll(0);
    try {
      const found = await findRoutes(app.fetch!, start, end, travel);
      if (request !== routeRequest) return;
      setRoutes(found);
      setRoutedAt(new Date());
      setPin({ lat: end.lat, lon: end.lon, name: end.name });
      fitRoutes(found);
    } catch (err) {
      if (request !== routeRequest) return;
      setRouteError(err instanceof DirectionsError ? err.message : "Maps couldn't find directions.");
    } finally {
      if (request === routeRequest) setRouting(false);
    }
  }

  /** Show every result's letter on the map, clear of the list over its left. */
  function fitResults(found: readonly Place[]): void {
    const box = { south: Infinity, north: -Infinity, west: Infinity, east: -Infinity };
    for (const { lat, lon } of found) {
      box.south = Math.min(box.south, lat);
      box.north = Math.max(box.north, lat);
      box.west = Math.min(box.west, lon);
      box.east = Math.max(box.east, lon);
    }
    const covering = MARGIN + Math.max(resultWidth(), directions() ? panelWidth() : 0) + 1;
    // Results close together aren't zoomed in on further than a street's worth.
    const zoom = clampZoom(Math.min(RESULTS_ZOOM, fitZoom(box, covering)));
    const nw = project({ lat: box.north, lon: box.west }, zoom);
    const se = project({ lat: box.south, lon: box.east }, zoom);
    centreOn(unproject({ x: (nw.x + se.x) / 2, y: (nw.y + se.y) / 2 }, zoom), zoom, covering);
  }

  function fitRoutes(found: readonly Route[]): void {
    const box = { south: Infinity, north: -Infinity, west: Infinity, east: -Infinity };
    for (const { bounds } of found) {
      box.south = Math.min(box.south, bounds.south);
      box.north = Math.max(box.north, bounds.north);
      box.west = Math.min(box.west, bounds.west);
      box.east = Math.max(box.east, bounds.east);
    }
    const covering = MARGIN + panelWidth() + 1;
    const zoom = clampZoom(Math.min(MAX_ZOOM - 1, fitZoom(box, covering)));
    const nw = project({ lat: box.north, lon: box.west }, zoom);
    const se = project({ lat: box.south, lon: box.east }, zoom);
    centreOn(unproject({ x: (nw.x + se.x) / 2, y: (nw.y + se.y) / 2 }, zoom), zoom, covering);
  }

  /** The place whose info was open when directions were asked for; it comes back when they close. */
  let infoBeforeDirections: PlaceInfoState | null = null;

  /** Directions, to the place whose info is open if one is. */
  function startDirections(): void {
    setResults(null);
    setNotice(null);
    if (directions()) return;
    const destination = place();
    infoBeforeDirections = destination;
    setPlace(null);
    setDirections(true);
    if (destination) setEndpoint("to", { lat: destination.lat, lon: destination.lon, name: destination.name });
  }

  function closeDirections(): void {
    routeRequest++;
    setDirections(false);
    setResults(null);
    setRoutes([]);
    setRouting(false);
    setRouteError(null);
    setShowSteps(false);
    setStep(-1);
    if (infoBeforeDirections) openPlace(infoBeforeDirections);
    else setPin(null);
    infoBeforeDirections = null;
  }

  function reverseRoute(): void {
    const start = endpoint("from");
    const end = endpoint("to");
    const [startText, endText] = [fromText(), toText()];
    setFrom(end ?? from());
    setTo(start ?? to());
    setFromText(endText);
    setToText(startText);
    void findDirections(end, start);
  }

  function changeMode(next: TravelMode): void {
    if (next === mode()) return;
    setMode(next);
    void findDirections(endpoint("from"), endpoint("to"), next);
  }

  function selectRoute(index: number): void {
    if (index === selected()) return;
    setSelected(index);
    setStep(-1);
  }

  /** Show step `index` of the chosen route: its turn in the middle of the map. */
  function showStep(index: number): void {
    const found = routes()[selected()]?.steps[index];
    if (!found) return;
    setStep(index);
    centreOn(found.at, Math.max(camera().zoom, STEP_ZOOM));
  }

  // ── Saving and printing ──────────────────────────────────────────────

  const pictureName = () => (directions() && toText() ? `To ${toText()}` : (pin()?.name ?? "Map"));

  async function savePicture(): Promise<void> {
    const desktop = app.fs.locate("desktop");
    if (!desktop) return;
    const picture = paint(true);
    drawMarksInto(picture, frameMarks);
    try {
      await writeSpriteFile(
        app.fs,
        desktop.id,
        uniqueChildName(app.fs, desktop.id, `${pictureName()} Map`.slice(0, 31)),
        { width: picture.width, height: picture.height, data: new Uint8Array(picture.pixels) },
        { attributes: { icon: "maps/icon" } },
      );
    } catch (err) {
      await app.os.showDialog({ message: `Couldn't save: ${err instanceof Error ? err.message : String(err)}`, buttons: ["OK"] });
    } finally {
      redraw();
    }
  }

  async function printMap(): Promise<void> {
    if (!app.print) return;
    const picture = paint(true);
    drawMarksInto(picture, frameMarks);
    const image: PrintableImage = { width: picture.width, height: picture.height, data: new Uint8Array(picture.pixels) };
    redraw();
    try {
      // Inside the try: the menu doesn't wait for this, so a dialog that
      // fails to open would otherwise fail without a word.
      const choice = await showPrintDialog(app, { image, documentName: pictureName(), options: lastPrint });
      if (!choice) return;
      lastPrint = choice;
      await app.print.printPicture(image, choice);
    } catch (err) {
      await app.os.showDialog({ message: `Couldn't print: ${err instanceof Error ? err.message : String(err)}`, buttons: ["OK"] });
    }
  }

  // ── Settings ─────────────────────────────────────────────────────────

  onSettled(() => {
    void app.storage
      .read(SETTINGS_KEY)
      .then((text) => {
        const saved = JSON.parse(text ?? "{}") as SavedView;
        if (typeof saved.lat === "number" && typeof saved.lon === "number" && typeof saved.zoom === "number") {
          move(cameraAt({ lat: saved.lat, lon: saved.lon }, saved.zoom));
        }
        if (typeof saved.labels === "boolean") setLabels(saved.labels);
        if (typeof saved.pitch === "number") setTilt(Math.max(MIN_PITCH, Math.min(MAX_PITCH, saved.pitch)));
        // Facing as it was, flat or in 3D.
        if (typeof saved.bearing === "number") setView(0, saved.bearing);
        if (typeof saved.tilt === "boolean") setWant3d(saved.tilt);
        if (typeof saved.orthographic === "boolean") setOrthographic(saved.orthographic);
        setPin(savedPin(saved.pin));
        if (TRAVEL_MODES.some((m) => m.mode === saved.mode)) setMode(saved.mode as TravelMode);
      })
      .catch(() => {
        // Unreadable or damaged settings just mean starting at home.
      })
      .finally(() => {
        loaded = true;
      });
  });

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  createEffect(
    () => ({
      centre: cameraCentre(camera()),
      zoom: camera().zoom,
      labels: labels(),
      pin: pin(),
      mode: mode(),
      tilt: want3d(),
      pitch: tilt(),
      bearing: bearing(),
      orthographic: orthographic(),
    }),
    (view) => {
      if (!loaded) return;
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveTimer = null;
        const { centre, zoom, labels: showLabels, pin: placed, mode: travel, tilt: tilted, pitch: angle, bearing: facing, orthographic: flatOn } = view;
        const saved = { lat: centre.lat, lon: centre.lon, zoom, labels: showLabels, pin: placed, mode: travel, tilt: tilted, pitch: angle, bearing: facing, orthographic: flatOn };
        void app.storage.write(SETTINGS_KEY, JSON.stringify(saved));
      }, 600);
    },
  );
  onCleanup(() => {
    if (saveTimer) clearTimeout(saveTimer);
  });

  // ── Menus ────────────────────────────────────────────────────────────

  createEffect(
    () => ({
      zoom: camera().zoom,
      labels: labels(),
      pin: pin() !== null,
      full: isFullScreen(),
      directions: directions(),
      mode: mode(),
      tilt: is3d(),
      canTilt: can3d(),
      north: bearing() === 0,
      orthographic: orthographic(),
    }),
    (state) => {
      const landmark = (spot: Landmark): MenubarItemDef => ({ label: spot.name, onClick: () => goTo(spot) });
      app.setMenus([
        {
          label: "File",
          items: [
            { label: "Save Picture", shortcut: "S", onClick: () => void savePicture() },
            ...(app.print ? [{ label: "Print…", shortcut: "P", onClick: () => void printMap() }] : []),
            { type: "separator" },
            { label: "Quit", shortcut: "Q", onClick: () => app.quit() },
          ],
        },
        {
          label: "View",
          items: [
            { label: "Zoom In", shortcut: "=", disabled: state.zoom >= MAX_ZOOM, onClick: () => zoomBy(1) },
            { label: "Zoom Out", shortcut: "-", disabled: state.zoom <= MIN_ZOOM, onClick: () => zoomBy(-1) },
            { type: "separator" },
            { label: "Show Labels", checked: state.labels, onClick: () => setLabels((on) => !on) },
            { label: "3D", checked: state.tilt, disabled: !state.canTilt, onClick: toggle3d },
            { label: "Orthographic", checked: state.orthographic, disabled: !state.tilt, onClick: () => setOrthographic((on) => !on) },
            { label: "Turn Left", shortcut: "[", onClick: () => turnBy(-TURN_STEP) },
            { label: "Turn Right", shortcut: "]", onClick: () => turnBy(TURN_STEP) },
            { label: "Face North", disabled: state.north, onClick: faceNorth },
            { label: "Remove Pin", disabled: !state.pin || state.directions, onClick: closePlace },
            { type: "separator" },
            {
              label: state.full ? "Exit Full Screen" : "Full Screen",
              shortcut: "F",
              onClick: () => win.setFullScreen(!isFullScreen()),
            },
          ],
        },
        {
          label: "Go",
          items: [
            state.directions
              ? { label: "Hide Directions", shortcut: "D", onClick: closeDirections }
              : { label: "Directions", shortcut: "D", onClick: startDirections },
            { label: "Reverse Route", shortcut: "R", disabled: !state.directions, onClick: reverseRoute },
            ...TRAVEL_MODES.map(
              ({ mode: travel, label }): MenubarItemDef => ({ label, checked: state.mode === travel, onClick: () => changeMode(travel) }),
            ),
            { type: "separator" },
            ...HISTORY.map(landmark),
            { type: "separator" },
            ...CITIES.map(landmark),
            { type: "separator" },
            { label: WORLD.name, onClick: () => goTo(WORLD) },
          ],
        },
      ]);
    },
  );

  /** Tilt into 3D, or back to the flat map. */
  function toggle3d(): void {
    if (can3d()) setWant3d(!is3d());
  }

  // ── Mouse and keys ───────────────────────────────────────────────────

  /** The scroll in progress: travel since its last step, and when it last moved and stepped. */
  const wheel = { travel: 0, at: -Infinity, steppedAt: -Infinity };
  /**
   * A press on the map; with Option held, it turns (and in 3D tilts) the
   * view rather than moving it. `caught` is a press that stopped a glide:
   * let go, it isn't a click.
   */
  let drag: { x: number; y: number; camera: Camera; moved: boolean; caught: boolean; turn: { pitch: number; bearing: number } | null } | null = null;
  /** Where the pointer was, and when, over the end of a pan: how fast it was going when let go. */
  let panTrail: Array<{ t: number; x: number; y: number }> = [];
  let glide: (() => void) | null = null;
  onCleanup(() => glide?.());

  function stopGlide(): boolean {
    if (!glide) return false;
    glide();
    glide = null;
    return true;
  }

  /** The ground under view point (x, y), as `groundOffset`, or `null` above the horizon. */
  function groundUnder(x: number, y: number): [number, number] | null {
    if (pitch() === 0 && bearing() === 0) return [x - viewWidth() / 2, y - viewHeight() / 2];
    return perspective().ground(x, y);
  }

  /**
   * A pan let go: if it was still moving, the map glides on the way it
   * went, slowing, the ground where it was let go sliding as the pointer would have.
   */
  function glideFrom(now: number): void {
    const last = panTrail.at(-1);
    // Moves the app hears in one frame share its time: measured from one heard earlier.
    const first = last && panTrail.find((p) => p.t >= now - GLIDE_SAMPLE_MS && p.t < last.t);
    panTrail = [];
    if (!last || !first || now - last.t > GLIDE_HELD_MS) return;
    let vx = (last.x - first.x) / (last.t - first.t);
    let vy = (last.y - first.y) / (last.t - first.t);
    const speed = Math.hypot(vx, vy);
    if (speed < GLIDE_START) return;
    if (speed > GLIDE_MAX) {
      vx *= GLIDE_MAX / speed;
      vy *= GLIDE_MAX / speed;
    }
    // The point let go of, and how far it has slid on.
    let x = last.x;
    let y = last.y;
    let before = now;
    const frame = () => {
      const at = app.scheduler.now();
      // A slow frame glides on no further than a quick one would: no jumps while tiles are drawn.
      const dt = Math.min(at - before, SWING_STEP_MS);
      before = at;
      const from = groundUnder(x, y);
      const to = groundUnder(x + vx * dt, y + vy * dt);
      if (!from || !to) {
        glide = null;
        return;
      }
      setCamera(normalizeCamera(panCamera(camera(), to[0] - from[0], to[1] - from[1], viewHeight()), viewHeight()));
      const decay = GLIDE_DECAY ** dt;
      vx *= decay;
      vy *= decay;
      glide = Math.hypot(vx, vy) < GLIDE_STOP ? null : app.scheduler.requestFrame(frame);
    };
    glide = app.scheduler.requestFrame(frame);
  }

  /** Zoom about the pointer, (x, y) on the map. */
  function onWheel(deltaY: number, x: number, y: number): void {
    if (deltaY === 0) return;
    const now = app.scheduler.now();
    const fresh = now - wheel.at > WHEEL_PAUSE_MS || Math.sign(deltaY) !== Math.sign(wheel.travel || deltaY);
    wheel.at = now;
    wheel.travel = fresh ? 0 : wheel.travel + deltaY;
    if (!fresh && (Math.abs(wheel.travel) < WHEEL_STEP || now - wheel.steppedAt < WHEEL_REPEAT_MS)) return;
    wheel.travel = 0;
    wheel.steppedAt = now;
    zoomBy(deltaY < 0 ? 1 : -1, x, y);
  }

  /** A click on the map: a route's time picks the route, a name opens its place, anywhere else closes the info. */
  function onMapClick(x: number, y: number): void {
    const hit = renderer.hitTest(x, y);
    const shown = results();
    if (shown) {
      if (hit?.type === "result" && shown[hit.index]) pick(shown[hit.index]!);
      else dismiss();
      return;
    }
    if (hit?.type === "route") {
      selectRoute(hit.index);
      return;
    }
    if (directions()) return;
    if (hit?.type === "place") {
      const current = place();
      if (hit.kind === "pin") {
        const placed = pin();
        if (!current && placed) void openClicked(placed.name, "", placed);
        return;
      }
      if (current && current.name === hit.name) return;
      void openClicked(hit.name, hit.kind, hit);
      return;
    }
    if (place()) closePlace();
  }

  const onKeyDown = (key: string, mods: { meta: boolean; ctrl: boolean; alt: boolean }) => {
    if (mods.meta || mods.ctrl) return;
    const stepX = Math.round(viewWidth() * ARROW_PAN);
    const stepY = Math.round(viewHeight() * ARROW_PAN);
    // Towards the ground a step across or up the screen, whichever way the view faces.
    const pan = (dx: number, dy: number) => {
      const [ox, oy] = groundOffset(viewWidth() / 2 + dx, viewHeight() / 2 + dy);
      move({ ...camera(), x: camera().x + ox, y: camera().y + oy });
    };
    // Option and the arrows turn the map; in 3D, up and down tilt it too.
    if (mods.alt && key.startsWith("Arrow")) {
      if (key === "ArrowLeft") turnBy(-TURN_STEP);
      else if (key === "ArrowRight") turnBy(TURN_STEP);
      else if (key === "ArrowUp") tiltBy(TILT_STEP);
      else if (key === "ArrowDown") tiltBy(-TILT_STEP);
    } else if (key === "ArrowLeft") pan(-stepX, 0);
    else if (key === "ArrowRight") pan(stepX, 0);
    else if (key === "ArrowUp") pan(0, -stepY);
    else if (key === "ArrowDown") pan(0, stepY);
    else if (key === "+" || key === "=") zoomBy(1);
    else if (key === "-" || key === "_") zoomBy(-1);
    else if (key === "Escape") {
      if (results() || notice()) dismiss();
      else if (directions()) closeDirections();
      else if (place()) closePlace();
      else if (isFullScreen()) win.setFullScreen(false);
    }
  };

  function pick(found: Place): void {
    const field = resultsFor();
    if (field === "search") show(found);
    else setEndpoint(field, found);
  }

  /** Return in a field: open the highlighted result if these are its results, or look the text up. */
  function submit(field: Field, text: string): void {
    const shown = results();
    if (shown && resultsFor() === field && text.trim() === searched) pick(shown[hovered()] ?? shown[0]!);
    else if (field === "search") void search(text);
    else void lookUp(field, text);
  }

  function moveHighlight(field: Field, delta: number): void {
    const shown = results();
    if (shown && resultsFor() === field) setHovered((i) => Math.max(0, Math.min(shown.length - 1, i + delta)));
  }

  function dismiss(): void {
    setResults(null);
    setNotice(null);
  }

  const resultsTop = () => (resultsFor() === "search" ? MARGIN + FIELD_H + 2 : MARGIN + directionsFieldsBottom() + 2);
  const resultWidth = () => Math.min(viewWidth() - 2 * MARGIN - 2, Math.max(220, panelWidth()));
  /** A result's name and detail, right of its letter. */
  const resultTextWidth = () => resultWidth() - 10 - BADGE_SIZE - RESULT_GAP;

  return (
    <box
      width={viewWidth()}
      height={viewHeight()}
      tabIndex={0}
      autoFocus
      semantic={{ name: "maps", role: "application" }}
      onKeyDown={onKeyDown}
    >
      <raster
        width={viewWidth()}
        height={viewHeight()}
        // Both only count up, so their sum is new whenever either is.
        revision={revision() + gpuPictures()}
        cursor={dragging() ? "grabbing" : "grab"}
        semantic={{
          name: "map",
          role: "preview",
          value: `zoom ${camera().zoom}, ${cameraCentre(camera()).lat.toFixed(4)}, ${cameraCentre(camera()).lon.toFixed(4)}${
            is3d()
              ? `, 3D${orthographic() ? " orthographic" : ""} facing ${Math.round((bearing() * 180) / Math.PI)}°, tilted ${Math.round((pitch() * 180) / Math.PI)}°`
              : bearing() !== 0
                ? `, facing ${Math.round((bearing() * 180) / Math.PI)}°`
                : ""
          }`,
        }}
        onMouseDown={(x, y) => {
          // A press catches a gliding map where it is.
          const caught = stopGlide();
          drag = { x, y, camera: camera(), moved: false, caught, turn: heldModifiers().alt ? { pitch: pitch(), bearing: bearing() } : null };
          panTrail = [];
          // The results stay while the map is dragged about to look them over; a click puts them away.
          setNotice(null);
        }}
        onDragStart={() => setDragging(true)}
        onDrag={(x, y) => {
          if (!drag) return;
          if (Math.abs(x - drag.x) > CLICK_SLOP || Math.abs(y - drag.y) > CLICK_SLOP) drag.moved = true;
          if (!drag.moved) return;
          if (drag.turn) {
            // Across turns the map; in 3D, down tilts it towards looking straight down.
            const turned = drag.turn.bearing - (x - drag.x) * TURN_PER_PX;
            if (!is3d()) {
              setView(0, turned);
              return;
            }
            const next = Math.max(MIN_PITCH, Math.min(MAX_PITCH, drag.turn.pitch - (y - drag.y) * TILT_PER_PX));
            setTilt(next);
            setView(next, turned);
            return;
          }
          // The ground under the pointer stays under it, tilted or not.
          const [fromX, fromY] = groundOffset(drag.x, drag.y);
          const [toX, toY] = groundOffset(x, y);
          move(panCamera(drag.camera, toX - fromX, toY - fromY, viewHeight()));
          const now = app.scheduler.now();
          panTrail.push({ t: now, x, y });
          while (panTrail.length > 2 && panTrail[0]!.t < now - GLIDE_SAMPLE_MS) panTrail.shift();
        }}
        onDragEnd={() => {
          setDragging(false);
          if (drag?.moved && !drag.turn) glideFrom(app.scheduler.now());
        }}
        onClick={(x, y) => {
          const clicked = drag !== null && !drag.moved && !drag.caught;
          drag = null;
          if (clicked) onMapClick(x, y);
        }}
        onDoubleClick={(x, y) => {
          zoomBy(heldModifiers().alt ? -1 : 1, x, y);
          // The second click's press began a drag from the camera before
          // this zoom; a twitch of the mouse would pan back from it.
          drag = null;
        }}
        onScroll={onWheel}
        onPaint={(surface) => {
          const { bitmap, marks } = picture();
          surface.blitPixels(bitmap.pixels, bitmap.width, bitmap.height);
          drawMarks(surface.port, marks, surface.rect.x, surface.rect.y);
        }}
      />

      {/* Zoom buttons, + over −, at the top right. */}
      <box
        position="absolute"
        left={zoomLeft()}
        top={MARGIN}
        width={ZOOM_W + 1}
        height={ZOOM_CELL_H * 2 + 3}
        borderWidth={1}
        borderColor={1}
        shadow
        background={0}
        flexDirection="column"
      >
        <ZoomCell name="maps-zoom-in" label="+" disabled={camera().zoom >= MAX_ZOOM} onClick={() => zoomBy(1)} />
        <box height={1} background={1} />
        <ZoomCell name="maps-zoom-out" label="−" disabled={camera().zoom <= MIN_ZOOM} onClick={() => zoomBy(-1)} />
      </box>

      {/* 3D, under the zoom buttons: once close enough for buildings to stand up. */}
      <box
        position="absolute"
        left={zoomLeft()}
        top={TILT_TOP}
        width={ZOOM_W + 1}
        height={TILT_H}
        borderWidth={1}
        borderColor={1}
        shadow
        background={0}
      >
        <ZoomCell name="maps-3d" label={is3d() ? "2D" : "3D"} disabled={!can3d()} onClick={toggle3d} />
      </box>

      {/* The compass, always: its needle points north; click to face north again, drag to turn. */}
      <Compass
        left={zoomLeft()}
        top={COMPASS_TOP}
        bearing={bearing()}
        onClick={faceNorth}
        onTurn={(start, dx) => {
          setView(pitch(), start - dx * TURN_PER_PX);
        }}
      />

      <Show
        when={directions()}
        fallback={
          <Show
            when={place()}
            fallback={
              <box
                position="absolute"
                left={MARGIN}
                top={MARGIN}
                width={searchWidth()}
                height={FIELD_H}
                overflow="hidden"
                borderWidth={1}
                borderColor={1}
                shadow
                background={0}
                flexDirection="row"
                alignItems="center"
                paddingLeft={4}
                gap={3}
              >
                <Icon name="maps/search" />
                <TextInput
                  name="maps-search"
                  value={query()}
                  onChange={setQuery}
                  onSubmit={(text) => submit("search", text)}
                  onHistory={(delta) => moveHighlight("search", delta)}
                  onCancel={dismiss}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => setSearchFocused(false)}
                  placeholder={searching() ? "Searching…" : SEARCH_PLACEHOLDER}
                  font="body"
                  width={Math.max(20, searchWidth() - 6 - SEARCH_ICON_W)}
                  padding={1}
                  borderless
                  selectAllOnFocus
                />
              </box>
            }
          >
            {(info) => (
              <PlaceInfo
                place={info()}
                left={MARGIN}
                top={MARGIN}
                width={panelWidth()}
                maxHeight={viewHeight() - 2 * MARGIN}
                onClose={closePlace}
                onDirections={startDirections}
                onWebsite={(url) => app.os.openApp("safari", { url })}
              />
            )}
          </Show>
        }
      >
        <DirectionsPanel
          left={MARGIN}
          top={MARGIN}
          width={panelWidth()}
          height={viewHeight() - 2 * MARGIN}
          mode={mode()}
          onMode={changeMode}
          fromText={fromText()}
          toText={toText()}
          onText={(field, text) => (field === "from" ? setFromText(text) : setToText(text))}
          onSubmit={submit}
          onHistory={moveHighlight}
          onCancel={dismiss}
          onSwap={reverseRoute}
          onClose={closeDirections}
          routes={routes()}
          routing={routing()}
          error={routeError()}
          selected={selected()}
          onSelect={selectRoute}
          showSteps={showSteps()}
          onShowSteps={(on) => {
            setShowSteps(on);
            setListScroll(0);
          }}
          step={step()}
          onStep={showStep}
          scroll={listScroll()}
          onScroll={setListScroll}
          now={routedAt()}
        />
      </Show>

      <Show when={notice()}>
        {(text) => (
          <box
            position="absolute"
            left={MARGIN}
            top={MARGIN + FIELD_H + 4}
            borderWidth={1}
            borderColor={1}
            shadow
            background={0}
            paddingLeft={6}
            paddingRight={6}
            paddingTop={3}
            paddingBottom={3}
            onClick={() => setNotice(null)}
          >
            <text font="body">{text()}</text>
          </box>
        )}
      </Show>

      <Show when={results()}>
        {(places) => (
          <box
            position="absolute"
            left={MARGIN}
            top={resultsTop()}
            width={resultWidth()}
            borderWidth={1}
            borderColor={1}
            shadow
            background={0}
            flexDirection="column"
            semantic={{ name: "maps-results", role: "list" }}
          >
            <For each={places()}>
              {(found, index) => (
                <box
                  height={RESULT_ROW_H}
                  paddingLeft={4}
                  paddingRight={4}
                  flexDirection="row"
                  alignItems="center"
                  gap={RESULT_GAP}
                  background={hovered() === index() ? 1 : 0}
                  cursor="pointer"
                  semantic={{ name: `maps-result-${index()}`, role: "button", value: `${resultLetter(index())}: ${found.name}` }}
                  onMouseEnter={() => setHovered(index())}
                  onClick={() => pick(found)}
                >
                  <ResultBadge index={index()} inverted={hovered() === index()} />
                  <box flexDirection="column" justifyContent="center">
                    <text font="menu" spacing={1} color={hovered() === index() ? 0 : 1}>
                      {fitted(found.name, resultTextWidth(), spacedFontName("menu", 1))}
                    </text>
                    <text font="body" color={hovered() === index() ? 0 : 1}>
                      {fitted(found.distance === undefined ? found.detail : `${distanceAway(found.distance)} · ${found.detail}`, resultTextWidth(), "body")}
                    </text>
                  </box>
                </box>
              )}
            </For>
          </box>
        )}
      </Show>
    </box>
  );
}

/**
 * A compass, its black needle pointing north on the screen, which turns as
 * the view does. A click faces north; a drag across turns the view.
 */
function Compass(props: {
  left: number;
  top: number;
  bearing: number;
  onClick: () => void;
  onTurn: (start: number, dx: number) => void;
}): JSX.Element {
  const size = COMPASS_SIZE;
  let press: { x: number; bearing: number; moved: boolean } | null = null;
  return (
    <raster
      position="absolute"
      left={props.left}
      top={props.top}
      width={size}
      height={size}
      revision={props.bearing}
      cursor="pointer"
      semantic={{ name: "maps-compass", role: "button", value: `${Math.round((props.bearing * 180) / Math.PI)}°` }}
      onPaint={(surface) => drawCompass(surface.port, surface.rect.x, surface.rect.y, size, props.bearing)}
      onMouseDown={(x) => {
        press = { x, bearing: props.bearing, moved: false };
      }}
      onDrag={(x) => {
        if (!press) return;
        if (Math.abs(x - press.x) > CLICK_SLOP) press.moved = true;
        if (press.moved) props.onTurn(press.bearing, x - press.x);
      }}
      onClick={() => {
        const clicked = press !== null && !press.moved;
        press = null;
        if (clicked) props.onClick();
      }}
    />
  );
}

/** How far a result is from the route's other end: "350 m", "4.2 km", "4,130 km". */
function distanceAway(km: number): string {
  if (km < 1) return `${Math.round(km * 100) * 10} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km).toLocaleString("en-US")} km`;
}

/** A search result's letter in the list, as its badge on the map shows it; `inverted` with its row when that's highlighted. */
function ResultBadge(props: { index: number; inverted: boolean }): JSX.Element {
  return (
    <raster
      width={BADGE_SIZE}
      height={BADGE_SIZE}
      revision={props.index * 2 + (props.inverted ? 1 : 0)}
      onPaint={(surface) =>
        drawMarks(
          surface.port,
          [{ type: "badge", x: BADGE_HALF, y: BADGE_HALF, index: props.index, highlighted: false, inverted: props.inverted }],
          surface.rect.x,
          surface.rect.y,
        )
      }
    />
  );
}

/** One of the zoom buttons: its sign, black while pressed. */
function ZoomCell(props: { name: string; label: string; disabled: boolean; onClick: () => void }): JSX.Element {
  const [pressed, setPressed] = createSignal(false);
  const lit = () => pressed() && !props.disabled;
  return (
    <box
      width={ZOOM_W - 1}
      height={ZOOM_CELL_H}
      alignItems="center"
      justifyContent="center"
      background={lit() ? 1 : 0}
      cursor={props.disabled ? "default" : "pointer"}
      semantic={{ name: props.name, role: "button", enabled: !props.disabled }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
      onClick={() => {
        if (!props.disabled) props.onClick();
      }}
    >
      {/*
        The sign's own ink in the cell's middle, drawn with QuickDraw: a
        text box would centre its line, accents' room and all. Grayed when
        it can't be used, as a disabled menu item is: 3D zoomed out too far,
        + or − at the end of the zooms.
      */}
      <raster
        width={ZOOM_W - 1}
        height={ZOOM_CELL_H}
        revision={(lit() ? 1 : 0) + (props.disabled ? 2 : 0) + (props.label === "2D" ? 4 : 0)}
        onPaint={(surface) => drawCentred(surface.port, props.label, surface.rect, lit(), props.disabled)}
      />
    </box>
  );
}

export default defineApp({
  id: "maps",
  title: "Maps",
  icon: "maps/icon",
  smallIcon: "maps/icon-16x16",
  sprites,
  requires: ["network"],
  about: {
    version: "1.0",
    description:
      "Street maps of the whole world from OpenStreetMap, drawn in one bit. Drag to move, double-click or scroll to zoom, click a place or search for one to see its info, and get directions by car, bike or on foot. Map data © OpenStreetMap contributors, tiles by OpenFreeMap, search by Nominatim, directions by OSRM on FOSSGIS servers.",
  },
  defaultSize: { width: 460, height: 290 },
  minSize: { width: 240, height: 180 },
  scrollable: false,
  resizable: true,
  // The map runs to the frame; the grow box sits over its corner.
  growBox: "overlay",
  Component: Maps,
});
