/** The Go menu: where the Macintosh comes from, and a few cities. */
import type { LatLon } from "./mercator";

export interface Landmark extends LatLon {
  name: string;
  zoom: number;
}

/** Where a new Maps opens: Apple's campus at 1 Infinite Loop, Cupertino. */
export const HOME: Landmark = { name: "Infinite Loop, Cupertino", lat: 37.33182, lon: -122.03118, zoom: 15 };

export const HISTORY: readonly Landmark[] = [
  HOME,
  { name: "Flint Center, Cupertino", lat: 37.3194, lon: -122.0449, zoom: 16 },
  { name: "Xerox PARC, Palo Alto", lat: 37.4027, lon: -122.1484, zoom: 16 },
  { name: "Apple Park, Cupertino", lat: 37.3349, lon: -122.009, zoom: 15 },
];

export const CITIES: readonly Landmark[] = [
  { name: "San Francisco", lat: 37.7793, lon: -122.4193, zoom: 13 },
  { name: "New York", lat: 40.7128, lon: -74.006, zoom: 13 },
  { name: "London", lat: 51.5074, lon: -0.1278, zoom: 13 },
  { name: "Paris", lat: 48.8566, lon: 2.3522, zoom: 13 },
  { name: "Stockholm", lat: 59.3293, lon: 18.0686, zoom: 13 },
  { name: "Tokyo", lat: 35.6812, lon: 139.7671, zoom: 13 },
  { name: "Sydney", lat: -33.8688, lon: 151.2093, zoom: 13 },
];

export const WORLD: Landmark = { name: "The World", lat: 30, lon: 10, zoom: 1 };
