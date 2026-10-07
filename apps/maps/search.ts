/**
 * Finding places: OpenStreetMap's Nominatim geocoder
 * (https://nominatim.org/release-docs/latest/api/Search/), asked once per
 * search as its usage policy requires, never as the user types. Names come
 * back in English where OpenStreetMap has them, since the system fonts only
 * have Latin letters. Coordinates typed as "lat, lon" need no server.
 */
import { encodeQuery, type FetchFunction } from "@mockintosh/sdk";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

export interface Place {
  /** The place's own name: "New York". */
  name: string;
  /**
   * What and where it is: "City, United States" or "State, United States".
   * The kind tells apart places that share a name and a country.
   */
  detail: string;
  lat: number;
  lon: number;
  /** What it spans, when the geocoder knows; the map fits it on screen. */
  bounds?: { south: number; north: number; west: number; east: number };
  /**
   * The zooms a place of its kind is shown between. A box alone can mislead:
   * a city's runs to its outermost boundary, a road's can be a whole county.
   */
  zoom: ZoomRange;
  /** "Golf course", "City": what the place is, as its info shows it. */
  kind: string;
  /** What OpenStreetMap knows about it, for its info. */
  details: PlaceDetails;
  /** How significant a place it is, by the geocoder, 0 to 1: a world city near 1, a corner shop near 0. */
  importance?: number;
  /** How far it is from the place it was looked for near, in kilometres. */
  distance?: number;
}

/** A place's info: where it is and what's useful to know, as far as OpenStreetMap says. */
export interface PlaceDetails {
  /** "Newark": the town or city it's in, for under its name. */
  locality?: string;
  /** "12 Main Street, Newark 07112". */
  address?: string;
  phone?: string;
  website?: string;
  /** Opening hours as tagged, a line per rule: "Mo-Fr 08:00-18:00". */
  hours?: string[];
  /** "Italian, Pizza". */
  cuisine?: string;
  /** "Wheelchair accessible", "Wi-Fi", "Outdoor seating". */
  goodToKnow: string[];
}

export interface ZoomRange {
  min: number;
  max: number;
}

export class SearchError extends Error {}

interface NominatimResult {
  name?: unknown;
  display_name?: unknown;
  lat?: unknown;
  lon?: unknown;
  boundingbox?: unknown;
  place_rank?: unknown;
  importance?: unknown;
  addresstype?: unknown;
  type?: unknown;
  address?: unknown;
  extratags?: unknown;
}

/** Zooms by Nominatim's `addresstype`, the kind of place a result is. */
const KIND_ZOOM: Readonly<Record<string, ZoomRange>> = {
  country: { min: 3, max: 6 },
  state: { min: 5, max: 8 },
  region: { min: 5, max: 8 },
  province: { min: 5, max: 8 },
  state_district: { min: 7, max: 10 },
  county: { min: 8, max: 11 },
  municipality: { min: 9, max: 12 },
  city: { min: 10, max: 13 },
  town: { min: 11, max: 14 },
  borough: { min: 11, max: 14 },
  city_district: { min: 11, max: 14 },
  village: { min: 12, max: 15 },
  suburb: { min: 12, max: 15 },
  quarter: { min: 13, max: 15 },
  island: { min: 9, max: 15 },
  neighbourhood: { min: 14, max: 16 },
  hamlet: { min: 14, max: 16 },
  road: { min: 15, max: 17 },
};

/**
 * Zooms for kinds the table doesn't name: a bay, a lake, a peninsula, a
 * shop. Their `place_rank` (4 a country, 16 a city, 22 a bay, 30 a house)
 * says how close to go at most, not how big they are, so the box decides.
 */
export function zoomForRank(rank: number): ZoomRange {
  const max = rank <= 4 ? 6 : rank <= 8 ? 8 : rank <= 12 ? 11 : rank <= 16 ? 13 : rank <= 20 ? 15 : rank <= 25 ? 16 : 17;
  return { min: 3, max };
}

/**
 * Kinds too general to describe a place ("amenity", "building"): the
 * result's `type` ("restaurant", "station") says more.
 */
const GENERAL_KINDS = new Set(["amenity", "shop", "tourism", "leisure", "building", "office", "craft", "historic", "man_made", "railway", "highway", "aeroway", "natural", "landuse", "place"]);
/** Kinds whose own word reads oddly in a list. */
const KIND_NAMES: Readonly<Record<string, string>> = {
  road: "Street", house_number: "Address", city_district: "District", state_district: "District", isolated_dwelling: "Farm",
};

/** "City", "State", "Restaurant": what a result is, as the list shows it. */
export function kindOf(addresstype: unknown, type: unknown): string {
  const general = typeof addresstype !== "string" || GENERAL_KINDS.has(addresstype);
  const kind = general ? (typeof type === "string" && type !== "yes" ? type : addresstype) : addresstype;
  if (typeof kind !== "string" || !kind) return "";
  const word = KIND_NAMES[kind] ?? kind.replace(/_/g, " ");
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** "57.7, 11.97", "57.7 11.97" or "-33.86,151.21". */
export function parseCoordinates(query: string): Place | null {
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(query);
  if (!match) return null;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { name: `${lat}, ${lon}`, detail: "Coordinates", lat, lon, zoom: { min: 15, max: 15 }, kind: "Coordinates", details: { goodToKnow: [] } };
}

const LOCALITY_KEYS = ["city", "town", "village", "hamlet", "suburb", "municipality", "county", "state", "country"] as const;

/** Yes-or-no tags worth a line under Good to Know, and what to say for yes. */
const GOOD_TO_KNOW: ReadonlyArray<readonly [string, string, string]> = [
  ["wheelchair", "yes", "Wheelchair accessible"],
  ["wheelchair", "limited", "Partly wheelchair accessible"],
  ["internet_access", "wlan", "Wi-Fi"],
  ["internet_access", "yes", "Internet access"],
  ["outdoor_seating", "yes", "Outdoor seating"],
  ["takeaway", "yes", "Takeaway"],
  ["delivery", "yes", "Delivery"],
  ["diet:vegetarian", "yes", "Vegetarian options"],
  ["diet:vegan", "yes", "Vegan options"],
  ["payment:cards", "yes", "Accepts cards"],
  ["payment:credit_cards", "yes", "Accepts credit cards"],
  ["payment:contactless", "yes", "Accepts contactless payments"],
  ["payment:cash", "no", "No cash"],
  ["fee", "no", "Free entry"],
  ["drive_through", "yes", "Drive-through"],
  ["toilets", "yes", "Toilets"],
];

const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value.trim() : undefined);

/** The info in a Nominatim result asked for with `addressdetails` and `extratags`. */
export function parseDetails(rawAddress: unknown, rawTags: unknown, name: string): PlaceDetails {
  const address = (rawAddress && typeof rawAddress === "object" ? rawAddress : {}) as Record<string, unknown>;
  const tags = (rawTags && typeof rawTags === "object" ? rawTags : {}) as Record<string, unknown>;
  // The place itself can be the first locality ("Newark" for Newark): name the one around it.
  const locality = LOCALITY_KEYS.map((key) => text(address[key])).find((value) => value && value !== name);
  const street = [text(address.house_number), text(address.road) ?? text(address.pedestrian) ?? text(address.footway)].filter(Boolean).join(" ");
  const town = [text(address.city) ?? text(address.town) ?? text(address.village), text(address.postcode)].filter(Boolean).join(" ");
  const addressLine = street && street !== name ? [street, town].filter(Boolean).join(", ") : undefined;
  const hours = text(tags.opening_hours)
    ?.split(";")
    .map((rule) => rule.trim())
    .filter(Boolean);
  const cuisine = text(tags.cuisine)
    ?.split(";")
    .map((c) => c.trim().replace(/_/g, " "))
    .map((c) => c.charAt(0).toUpperCase() + c.slice(1))
    .join(", ");
  const goodToKnow: string[] = [];
  for (const [key, value, words] of GOOD_TO_KNOW) if (tags[key] === value && !goodToKnow.includes(words)) goodToKnow.push(words);
  return {
    locality,
    address: addressLine,
    phone: text(tags.phone) ?? text(tags["contact:phone"]),
    website: text(tags.website) ?? text(tags["contact:website"]) ?? text(tags.url),
    hours: hours?.length ? hours : undefined,
    cuisine,
    goodToKnow,
  };
}

export function parseResults(json: unknown): Place[] {
  if (!Array.isArray(json)) return [];
  const places: Place[] = [];
  for (const raw of json as NominatimResult[]) {
    const lat = Number(raw.lat);
    const lon = Number(raw.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const full = typeof raw.display_name === "string" ? raw.display_name : "";
    const parts = full.split(",").map((part) => part.trim()).filter(Boolean);
    const name = (typeof raw.name === "string" && raw.name.trim()) || parts[0] || `${lat}, ${lon}`;
    const rest = parts[0] === name ? parts.slice(1) : parts;
    // The first parts after the name are the most local: a road, a district.
    const where = rest.length > 3 ? [...rest.slice(0, 2), rest.at(-1)!] : rest;
    const kind = kindOf(raw.addresstype, raw.type);
    const detail = [kind, ...where].filter(Boolean).join(", ");
    const rank = Number(raw.place_rank);
    const zoom = (typeof raw.addresstype === "string" ? KIND_ZOOM[raw.addresstype] : undefined) ?? zoomForRank(Number.isFinite(rank) ? rank : 30);
    const place: Place = { name, detail, lat, lon, zoom, kind, details: parseDetails(raw.address, raw.extratags, name) };
    const importance = Number(raw.importance);
    if (Number.isFinite(importance)) place.importance = importance;
    if (Array.isArray(raw.boundingbox) && raw.boundingbox.length === 4) {
      const [south, north, west, east] = raw.boundingbox.map(Number) as [number, number, number, number];
      if ([south, north, west, east].every(Number.isFinite)) place.bounds = { south, north, west, east };
    }
    // A street comes back once for each of the pieces it's mapped in; the
    // list can't tell them apart, so it keeps the first.
    if (places.some((other) => other.name === place.name && other.detail === place.detail)) continue;
    places.push(place);
  }
  return places;
}

/** A box around a point, `radius` degrees each way, to search in or near. */
export interface Nearby {
  lat: number;
  lon: number;
  radius: number;
  /** Only places in the box, as for the place a label on the map names; otherwise anywhere when none are in it. */
  bounded?: boolean;
}

/** Within this many kilometres of another place, a match counts as near it, more the nearer it is. */
const NEARBY_KM = 150;
/**
 * How much being right next to the other place counts for, against the
 * geocoder's importance (0 to 1): enough to put the Main Street nearby ahead
 * of one far away, not a laundromat called San Francisco ahead of the city.
 */
const NEARBY_WEIGHT = 0.4;
/**
 * Far away counts against a match a little, up to this much at `FAR_KM`
 * and beyond: from New York, San Francisco the city still comes first
 * (importance about 0.8), then the shops named after it nearby, and only
 * then the towns of that name in Colombia or the Philippines (about 0.4).
 */
const FAR_WEIGHT = 0.15;
const FAR_KM = 5000;

/** Kilometres from `point` to place `p`, near enough for ranking. */
function kmFrom(p: { lat: number; lon: number }, point: { lat: number; lon: number }): number {
  const k = Math.cos((((p.lat + point.lat) / 2) * Math.PI) / 180);
  return Math.hypot(p.lat - point.lat, (p.lon - point.lon) * k) * 111.32;
}

/**
 * `places` ranked for a search near `point`: by how important each is,
 * how near, and how far; each with its distance. Ties keep the order they
 * came in.
 */
export function rankNear(places: readonly Place[], point: { lat: number; lon: number }): Place[] {
  const scored = places.map((place, order) => {
    const distance = kmFrom(place, point);
    const near = Math.max(0, 1 - distance / NEARBY_KM);
    const far = Math.min(1, distance / FAR_KM);
    return { place: { ...place, distance }, order, score: (place.importance ?? 0) + NEARBY_WEIGHT * near - FAR_WEIGHT * far };
  });
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  return scored.map(({ place }) => place);
}

/**
 * Places matching `query`, best first; with `near`, those around a point
 * as well as everywhere, ranked by how important and how near each is
 * (only those around it, when it's `bounded`). Throws `SearchError` with a
 * message to show.
 */
export async function searchPlaces(fetch: FetchFunction, query: string, near?: Nearby): Promise<Place[]> {
  const coordinates = parseCoordinates(query);
  if (coordinates) return [coordinates];
  if (!near) return ask(fetch, query);
  if (near.bounded) return rankNear(await ask(fetch, query, near), near);
  // Unbounded, the box is only a small boost to a match's ranking, so a
  // common name ("Main Street") comes back from everywhere but nearby; in
  // the box alone, a famous place ("San Francisco", from New York) is
  // missed for the shops named after it. So both, ranked together.
  const [inside, everywhere] = await Promise.all([ask(fetch, query, { ...near, bounded: true }), ask(fetch, query, near)]);
  const all = [...inside];
  for (const place of everywhere) {
    if (!all.some((other) => other.name === place.name && other.detail === place.detail)) all.push(place);
  }
  return rankNear(all, near);
}

async function ask(fetch: FetchFunction, query: string, near?: Nearby): Promise<Place[]> {
  const box = near
    ? [
        { name: "viewbox", value: [near.lon - near.radius, near.lat + near.radius, near.lon + near.radius, near.lat - near.radius].map((v) => v.toFixed(5)).join(",") },
        ...(near.bounded ? [{ name: "bounded", value: "1" }] : []),
      ]
    : [];
  const url = `${NOMINATIM_URL}?${encodeQuery([
    ...box,
    { name: "q", value: query.trim() },
    { name: "format", value: "jsonv2" },
    { name: "limit", value: "8" },
    { name: "accept-language", value: "en" },
    { name: "addressdetails", value: "1" },
    { name: "extratags", value: "1" },
  ])}`;
  let response: Awaited<ReturnType<FetchFunction>>;
  try {
    response = await fetch(url, { headers: { Accept: "application/json" } });
  } catch {
    throw new SearchError("Maps can't reach the search server.");
  }
  if (response.status === 429) throw new SearchError("The search server is busy. Try again in a moment.");
  if (!response.ok) throw new SearchError(`The search server answered ${response.status}.`);
  return parseResults(await response.json());
}
