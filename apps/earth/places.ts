/**
 * Cities labelled on the globe, and the places the Go menu flies to.
 * Degrees, as an atlas gives them.
 */

export interface City {
  name: string;
  lat: number;
  lon: number;
  /** 1 shows first, from a little way out; 3 only close in. */
  rank: 1 | 2 | 3;
}

export const CITIES: readonly City[] = [
  { name: "Tokyo", lat: 35.68, lon: 139.69, rank: 1 },
  { name: "New York", lat: 40.71, lon: -74.01, rank: 1 },
  { name: "London", lat: 51.51, lon: -0.13, rank: 1 },
  { name: "Paris", lat: 48.86, lon: 2.35, rank: 1 },
  { name: "Moscow", lat: 55.76, lon: 37.62, rank: 1 },
  { name: "Beijing", lat: 39.9, lon: 116.41, rank: 1 },
  { name: "Sydney", lat: -33.87, lon: 151.21, rank: 1 },
  { name: "Cairo", lat: 30.04, lon: 31.24, rank: 1 },
  { name: "Mumbai", lat: 19.08, lon: 72.88, rank: 1 },
  { name: "Sao Paulo", lat: -23.55, lon: -46.63, rank: 1 },
  { name: "Mexico City", lat: 19.43, lon: -99.13, rank: 1 },
  { name: "Los Angeles", lat: 34.05, lon: -118.24, rank: 1 },
  { name: "Lagos", lat: 6.52, lon: 3.38, rank: 1 },
  { name: "Buenos Aires", lat: -34.6, lon: -58.38, rank: 1 },
  { name: "Jakarta", lat: -6.21, lon: 106.85, rank: 1 },
  { name: "Johannesburg", lat: -26.2, lon: 28.05, rank: 1 },
  { name: "Delhi", lat: 28.61, lon: 77.21, rank: 1 },
  { name: "Singapore", lat: 1.35, lon: 103.82, rank: 2 },
  { name: "Hong Kong", lat: 22.32, lon: 114.17, rank: 2 },
  { name: "Shanghai", lat: 31.23, lon: 121.47, rank: 2 },
  { name: "Seoul", lat: 37.57, lon: 126.98, rank: 2 },
  { name: "Bangkok", lat: 13.76, lon: 100.5, rank: 2 },
  { name: "Istanbul", lat: 41.01, lon: 28.98, rank: 2 },
  { name: "Berlin", lat: 52.52, lon: 13.4, rank: 2 },
  { name: "Madrid", lat: 40.42, lon: -3.7, rank: 2 },
  { name: "Rome", lat: 41.9, lon: 12.5, rank: 2 },
  { name: "Stockholm", lat: 59.33, lon: 18.07, rank: 2 },
  { name: "Reykjavik", lat: 64.15, lon: -21.94, rank: 2 },
  { name: "Chicago", lat: 41.88, lon: -87.63, rank: 2 },
  { name: "San Francisco", lat: 37.77, lon: -122.42, rank: 2 },
  { name: "Toronto", lat: 43.65, lon: -79.38, rank: 2 },
  { name: "Vancouver", lat: 49.28, lon: -123.12, rank: 2 },
  { name: "Lima", lat: -12.05, lon: -77.04, rank: 2 },
  { name: "Bogota", lat: 4.71, lon: -74.07, rank: 2 },
  { name: "Santiago", lat: -33.45, lon: -70.67, rank: 2 },
  { name: "Nairobi", lat: -1.29, lon: 36.82, rank: 2 },
  { name: "Cape Town", lat: -33.92, lon: 18.42, rank: 2 },
  { name: "Dubai", lat: 25.2, lon: 55.27, rank: 2 },
  { name: "Tehran", lat: 35.69, lon: 51.39, rank: 2 },
  { name: "Perth", lat: -31.95, lon: 115.86, rank: 2 },
  { name: "Auckland", lat: -36.85, lon: 174.76, rank: 2 },
  { name: "Honolulu", lat: 21.31, lon: -157.86, rank: 2 },
  { name: "Anchorage", lat: 61.22, lon: -149.9, rank: 2 },
  { name: "Melbourne", lat: -37.81, lon: 144.96, rank: 2 },
  { name: "Manila", lat: 14.6, lon: 120.98, rank: 2 },
  { name: "Kinshasa", lat: -4.44, lon: 15.27, rank: 2 },
  { name: "Brisbane", lat: -27.47, lon: 153.03, rank: 3 },
  { name: "Darwin", lat: -12.46, lon: 130.84, rank: 3 },
  { name: "Adelaide", lat: -34.93, lon: 138.6, rank: 3 },
  { name: "Wellington", lat: -41.29, lon: 174.78, rank: 3 },
  { name: "Oslo", lat: 59.91, lon: 10.75, rank: 3 },
  { name: "Helsinki", lat: 60.17, lon: 24.94, rank: 3 },
  { name: "Copenhagen", lat: 55.68, lon: 12.57, rank: 3 },
  { name: "Gothenburg", lat: 57.71, lon: 11.97, rank: 3 },
  { name: "Amsterdam", lat: 52.37, lon: 4.9, rank: 3 },
  { name: "Vienna", lat: 48.21, lon: 16.37, rank: 3 },
  { name: "Warsaw", lat: 52.23, lon: 21.01, rank: 3 },
  { name: "Athens", lat: 37.98, lon: 23.73, rank: 3 },
  { name: "Lisbon", lat: 38.72, lon: -9.14, rank: 3 },
  { name: "Dublin", lat: 53.35, lon: -6.26, rank: 3 },
  { name: "Edinburgh", lat: 55.95, lon: -3.19, rank: 3 },
  { name: "Barcelona", lat: 41.39, lon: 2.17, rank: 3 },
  { name: "Zurich", lat: 47.38, lon: 8.54, rank: 3 },
  { name: "Seattle", lat: 47.61, lon: -122.33, rank: 3 },
  { name: "Boston", lat: 42.36, lon: -71.06, rank: 3 },
  { name: "Miami", lat: 25.76, lon: -80.19, rank: 3 },
  { name: "Denver", lat: 39.74, lon: -104.99, rank: 3 },
  { name: "Havana", lat: 23.11, lon: -82.37, rank: 3 },
  { name: "Osaka", lat: 34.69, lon: 135.5, rank: 3 },
  { name: "Taipei", lat: 25.03, lon: 121.57, rank: 3 },
  { name: "Hanoi", lat: 21.03, lon: 105.85, rank: 3 },
  { name: "Karachi", lat: 24.86, lon: 67.01, rank: 3 },
  { name: "Riyadh", lat: 24.71, lon: 46.68, rank: 3 },
  { name: "Addis Ababa", lat: 9.03, lon: 38.74, rank: 3 },
  { name: "Casablanca", lat: 33.57, lon: -7.59, rank: 3 },
  { name: "Dakar", lat: 14.72, lon: -17.47, rank: 3 },
  { name: "Rio de Janeiro", lat: -22.91, lon: -43.17, rank: 3 },
  { name: "Ushuaia", lat: -54.8, lon: -68.3, rank: 3 },
  { name: "McMurdo", lat: -77.85, lon: 166.67, rank: 3 },
];

export interface Destination {
  name: string;
  lat: number;
  lon: number;
  /** Ground across the window, in kilometres. */
  across: number;
}

/** The Go menu: somewhere on each continent, and a few things worth the trip. */
export const DESTINATIONS: readonly Destination[] = [
  { name: "Australia", lat: -26, lon: 134, across: 5200 },
  { name: "Europe", lat: 51, lon: 12, across: 4500 },
  { name: "Africa", lat: 2, lon: 20, across: 9000 },
  { name: "North America", lat: 45, lon: -100, across: 7500 },
  { name: "South America", lat: -18, lon: -60, across: 7500 },
  { name: "Asia", lat: 35, lon: 95, across: 9500 },
  { name: "Antarctica", lat: -90, lon: 0, across: 6500 },
  { name: "The Arctic", lat: 90, lon: 0, across: 6500 },
  { name: "Scandinavia", lat: 63, lon: 16, across: 1800 },
  { name: "The Mediterranean", lat: 38, lon: 15, across: 3800 },
  { name: "Japan", lat: 37, lon: 138, across: 2000 },
  { name: "New Zealand", lat: -41, lon: 173, across: 1600 },
  { name: "Hawaii", lat: 20.6, lon: -157.4, across: 700 },
  { name: "Cape Horn", lat: -55.98, lon: -67.27, across: 600 },
  { name: "The Strait of Gibraltar", lat: 35.95, lon: -5.6, across: 150 },
  { name: "The Bosphorus", lat: 41.12, lon: 29.07, across: 160 },
];
