/**
 * Directions: routes from OSRM on the FOSSGIS servers that openstreetmap.org
 * itself routes with (https://routing.openstreetmap.de), one request per
 * route asked for, as their usage policy allows. The turn-by-turn text is
 * made here from OSRM's maneuvers, in English.
 */
import type { FetchFunction } from "@mockintosh/sdk";
import type { LatLon } from "./mercator";

export type TravelMode = "car" | "bike" | "foot";

export const TRAVEL_MODES: readonly { mode: TravelMode; label: string; verb: string }[] = [
  { mode: "car", label: "Drive", verb: "by car" },
  { mode: "bike", label: "Cycle", verb: "by bike" },
  { mode: "foot", label: "Walk", verb: "on foot" },
];

const OSRM_URL = "https://routing.openstreetmap.de";

export interface RouteStep {
  /** "Turn left onto Main Street". */
  text: string;
  /** How far this step goes, to the next one, in metres. */
  distance: number;
  /** Where the step starts. */
  at: LatLon;
}

export interface Route {
  /** The line to draw, start to end. */
  points: LatLon[];
  /** Metres. */
  distance: number;
  /** Seconds. */
  duration: number;
  steps: RouteStep[];
  bounds: { south: number; north: number; west: number; east: number };
  /** "I 280, CA 85": the roads that make up most of it. */
  via: string;
  /** Some road on it charges a toll. */
  tolls: boolean;
}

export class DirectionsError extends Error {}

/** Points of an encoded polyline (Google's format, as OSRM sends with `geometries=polyline`). */
export function decodePolyline(encoded: string, precision = 5): LatLon[] {
  const factor = 10 ** precision;
  const points: LatLon[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  const next = (): number => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    lat += next();
    lon += next();
    points.push({ lat: lat / factor, lon: lon / factor });
  }
  return points;
}

const COMPASS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];

function compass(bearing: number): string {
  return COMPASS[Math.round((((bearing % 360) + 360) % 360) / 45) % 8]!;
}

function ordinal(n: number): string {
  const words = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"];
  return words[n - 1] ?? `${n}th`;
}

export interface OsrmManeuver {
  type?: string;
  modifier?: string;
  bearing_after?: number;
  exit?: number;
  location?: [number, number];
}

export interface OsrmStep {
  intersections?: { classes?: string[] }[];
  name?: string;
  ref?: string;
  destinations?: string;
  exits?: string;
  rotary_name?: string;
  distance?: number;
  maneuver?: OsrmManeuver;
}

/** The instruction for one OSRM step; `destination` names where the route ends. */
export function instruction(step: OsrmStep, destination: string): string {
  const m = step.maneuver ?? {};
  const type = m.type ?? "turn";
  const modifier = m.modifier ?? "straight";
  const road = step.name?.trim() || step.ref?.split(";")[0]?.trim() || "";
  const onto = road ? ` onto ${road}` : "";
  const toward = step.destinations ? ` toward ${step.destinations.split(",")[0]!.trim()}` : "";
  const side = modifier === "left" || modifier === "right" ? ` on the ${modifier}` : "";
  const turn = (): string => {
    if (modifier === "uturn") return `Make a U-turn${onto}`;
    if (modifier === "straight") return `Continue straight${onto}`;
    return `Turn ${modifier}${onto}`;
  };

  switch (type) {
    case "depart":
      return `Head ${compass(m.bearing_after ?? 0)}${road ? ` on ${road}` : ""}`;
    case "arrive":
      return `Arrive at ${destination}${side}`;
    case "turn":
    case "end of road":
      return turn();
    case "continue":
      if (modifier === "straight") return `Continue${road ? ` on ${road}` : ""}`;
      if (modifier === "uturn") return turn();
      return road ? `Turn ${modifier} to stay on ${road}` : turn();
    case "new name":
      return road ? `Continue onto ${road}` : "Continue";
    case "merge":
      return `Merge${modifier.includes("left") ? " left" : modifier.includes("right") ? " right" : ""}${onto || toward}`;
    case "on ramp":
      return `Take the ramp${onto}${toward}`;
    case "off ramp":
      return `Take ${step.exits ? `exit ${step.exits.split(";")[0]}` : "the exit"}${toward || onto}`;
    case "fork":
      return `Keep ${modifier.includes("left") ? "left" : modifier.includes("right") ? "right" : "straight"} at the fork${onto || toward}`;
    case "roundabout":
    case "rotary": {
      const what = step.rotary_name ? step.rotary_name : "the roundabout";
      return m.exit ? `At ${what}, take the ${ordinal(m.exit)} exit${onto}` : `Enter ${what}${onto}`;
    }
    case "roundabout turn":
      return modifier === "straight" ? `At the roundabout, continue straight${onto}` : `At the roundabout, turn ${modifier}${onto}`;
    case "exit roundabout":
    case "exit rotary":
      return `Exit the roundabout${onto}`;
    default:
      return road ? `Continue onto ${road}` : "Continue";
  }
}

interface OsrmRoute {
  distance?: number;
  duration?: number;
  geometry?: string;
  legs?: { summary?: string; steps?: OsrmStep[] }[];
}

interface OsrmResponse {
  code?: string;
  message?: string;
  routes?: OsrmRoute[];
}

/** The routes in an OSRM answer, fastest first; none when it found none. */
export function parseRoutes(json: unknown, destination: string): Route[] {
  const answer = json as OsrmResponse;
  if (answer?.code !== "Ok") return [];
  return (answer.routes ?? [])
    .map((route) => parseRoute(route, destination))
    .filter((route): route is Route => route !== null)
    .sort((a, b) => a.duration - b.duration);
}

function parseRoute(route: OsrmRoute, destination: string): Route | null {
  if (typeof route.geometry !== "string") return null;
  const points = decodePolyline(route.geometry);
  if (points.length < 2) return null;
  const steps: RouteStep[] = [];
  let tolls = false;
  for (const leg of route.legs ?? []) {
    for (const step of leg.steps ?? []) {
      if (step.intersections?.some((crossing) => crossing.classes?.includes("toll"))) tolls = true;
      const [lon, lat] = step.maneuver?.location ?? [points[0]!.lon, points[0]!.lat];
      const text = instruction(step, destination);
      const distance = step.distance ?? 0;
      // A step that goes nowhere ("continue" for a metre) only clutters the list.
      if (distance < 1 && step.maneuver?.type !== "arrive" && step.maneuver?.type !== "depart") continue;
      steps.push({ text, distance, at: { lat, lon } });
    }
  }
  let south = Infinity, north = -Infinity, west = Infinity, east = -Infinity;
  for (const p of points) {
    south = Math.min(south, p.lat);
    north = Math.max(north, p.lat);
    west = Math.min(west, p.lon);
    east = Math.max(east, p.lon);
  }
  const via = (route.legs ?? []).map((leg) => leg.summary?.trim() ?? "").filter(Boolean).join(", ");
  return { points, distance: route.distance ?? 0, duration: route.duration ?? 0, steps, bounds: { south, north, west, east }, via, tolls };
}

/** Rough distance between two points in metres, flat-earth: plenty for spacing callouts. */
function metresBetween(a: LatLon, b: LatLon): number {
  const k = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  return Math.hypot((a.lat - b.lat) * 111_320, (a.lon - b.lon) * 111_320 * k);
}

/** At most this many points of a route are compared; a long route is sampled. */
const CALLOUT_SAMPLES = 200;

function sampled(points: readonly LatLon[]): LatLon[] {
  const step = Math.max(1, Math.floor(points.length / CALLOUT_SAMPLES));
  return points.filter((_, i) => i % step === 0);
}

/**
 * Where each route's time bubble goes: the first halfway along its length,
 * every other on the point of it farthest from the routes before, so the
 * bubble sits on the stretch only that route takes.
 */
export function calloutPoints(routes: readonly Route[]): LatLon[] {
  const points: LatLon[] = [];
  const others: LatLon[][] = [];
  for (const route of routes) {
    const own = sampled(route.points);
    let at: LatLon;
    if (others.length === 0) {
      let walked = 0;
      at = own[Math.floor(own.length / 2)]!;
      for (let i = 1; i < route.points.length; i++) {
        walked += metresBetween(route.points[i - 1]!, route.points[i]!);
        if (walked >= route.distance / 2) {
          at = route.points[i]!;
          break;
        }
      }
    } else {
      let best = -1;
      at = own[Math.floor(own.length / 2)]!;
      for (const p of own) {
        let nearest = Infinity;
        for (const other of others) for (const q of other) nearest = Math.min(nearest, metresBetween(p, q));
        if (nearest > best) {
          best = nearest;
          at = p;
        }
      }
    }
    points.push(at);
    others.push(own);
  }
  return points;
}

/** The ways from `from` to `to`, fastest first. Throws `DirectionsError` with a message to show. */
export async function findRoutes(fetch: FetchFunction, from: LatLon, to: LatLon & { name: string }, mode: TravelMode): Promise<Route[]> {
  const coords = `${from.lon.toFixed(6)},${from.lat.toFixed(6)};${to.lon.toFixed(6)},${to.lat.toFixed(6)}`;
  // The FOSSGIS servers keep one OSRM per mode; each answers to the `driving` profile.
  const url = `${OSRM_URL}/routed-${mode}/route/v1/driving/${coords}?overview=full&geometries=polyline&steps=true&alternatives=2`;
  let response: Awaited<ReturnType<FetchFunction>>;
  try {
    response = await fetch(url, { headers: { Accept: "application/json" } });
  } catch {
    throw new DirectionsError("Maps can't reach the directions server.");
  }
  if (response.status === 429) throw new DirectionsError("The directions server is busy. Try again in a moment.");
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new DirectionsError(`The directions server answered ${response.status}.`);
  }
  const routes = parseRoutes(json, to.name);
  if (routes.length > 0) return routes;
  const code = (json as OsrmResponse)?.code;
  if (code === "NoRoute" || code === "NoSegment") throw new DirectionsError("Maps can't find a way between these places.");
  throw new DirectionsError(response.ok ? "Maps couldn't find directions." : `The directions server answered ${response.status}.`);
}

/** "350 m", "4.2 km", "120 km". */
export function formatRouteDistance(metres: number): string {
  if (metres < 1000) return `${Math.max(10, Math.round(metres / 10) * 10)} m`;
  const km = metres / 1000;
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

/** "09:15": the time on the clock `seconds` from `now`. */
export function formatArrival(now: Date, seconds: number): string {
  const at = new Date(now.getTime() + seconds * 1000);
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

/** "8 min", "1 h 5 min", "3 h". */
export function formatDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
