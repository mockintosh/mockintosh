/**
 * Web Mercator, the projection every OpenStreetMap tile is cut in. At zoom
 * `z` the world is a square `256 · 2^z` pixels wide, the 180th meridian at
 * both edges and ±85.05° at the top and bottom, split into `2^z × 2^z` tiles.
 */

export const TILE_SIZE = 256;
export const MAX_LATITUDE = 85.0511287798066;
/** Equatorial circumference, in metres. */
const EARTH_CIRCUMFERENCE = 40_075_016.686;

export interface LatLon {
  lat: number;
  lon: number;
}

export interface WorldPoint {
  x: number;
  y: number;
}

export function worldSize(zoom: number): number {
  return TILE_SIZE * 2 ** zoom;
}

function clampLatitude(lat: number): number {
  return Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, lat));
}

/** Longitude in [-180, 180). */
export function wrapLongitude(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** Where a place is, in pixels from the world's top-left corner at `zoom`. */
export function project(point: LatLon, zoom: number): WorldPoint {
  const size = worldSize(zoom);
  const lat = (clampLatitude(point.lat) * Math.PI) / 180;
  return {
    x: ((point.lon + 180) / 360) * size,
    y: ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * size,
  };
}

/** The place at a world pixel; `x` may lie outside the world and wraps. */
export function unproject(point: WorldPoint, zoom: number): LatLon {
  const size = worldSize(zoom);
  const n = Math.PI * (1 - (2 * point.y) / size);
  return {
    lat: (Math.atan(Math.sinh(n)) * 180) / Math.PI,
    lon: wrapLongitude((point.x / size) * 360 - 180),
  };
}

/** Ground distance one pixel covers at `lat`. */
export function metresPerPixel(lat: number, zoom: number): number {
  return (EARTH_CIRCUMFERENCE * Math.cos((clampLatitude(lat) * Math.PI) / 180)) / worldSize(zoom);
}

/** The largest zoom at which the box fits in `width × height` pixels. */
export function zoomToFit(
  box: { south: number; north: number; west: number; east: number },
  width: number,
  height: number,
  minZoom: number,
  maxZoom: number,
): number {
  for (let zoom = maxZoom; zoom > minZoom; zoom--) {
    const nw = project({ lat: box.north, lon: box.west }, zoom);
    const se = project({ lat: box.south, lon: box.east }, zoom);
    let w = se.x - nw.x;
    if (w < 0) w += worldSize(zoom);
    if (w <= width && se.y - nw.y <= height) return zoom;
  }
  return minZoom;
}
