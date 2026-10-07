import { describe, expect, it } from "vitest";
import type { FetchFunction } from "@mockintosh/sdk";
import { SearchError, kindOf, parseCoordinates, parseDetails, parseResults, searchPlaces, zoomForRank } from "./search";

function reply(status: number, body: unknown): Awaited<ReturnType<FetchFunction>> {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

const GOTHENBURG = {
  name: "Gothenburg",
  display_name: "Gothenburg, Göteborgs Stad, Västra Götaland County, 411 10, Sweden",
  lat: "57.7072326",
  lon: "11.9670171",
  boundingbox: ["57.5472326", "57.8672326", "11.8070171", "12.1270171"],
  place_rank: 16,
  addresstype: "city",
  type: "administrative",
};

describe("parseCoordinates", () => {
  it("reads latitude and longitude", () => {
    expect(parseCoordinates("57.7, 11.97")).toMatchObject({ lat: 57.7, lon: 11.97 });
    expect(parseCoordinates(" -33.86 151.21 ")).toMatchObject({ lat: -33.86, lon: 151.21 });
  });

  it("leaves words and impossible numbers to the geocoder", () => {
    expect(parseCoordinates("Gothenburg")).toBeNull();
    expect(parseCoordinates("95, 10")).toBeNull();
    expect(parseCoordinates("10, 200")).toBeNull();
  });
});

describe("parseDetails", () => {
  it("gathers the address, hours, contacts and what's good to know", () => {
    const details = parseDetails(
      { house_number: "12", road: "Main Street", city: "Newark", postcode: "07112", country: "United States" },
      { opening_hours: "Mo-Fr 08:00-18:00; Sa 10:00-14:00", phone: "+1 973 555 0100", website: "https://example.com", cuisine: "italian;pizza", wheelchair: "yes", internet_access: "wlan" },
      "Luigi's",
    );
    expect(details).toEqual({
      locality: "Newark",
      address: "12 Main Street, Newark 07112",
      phone: "+1 973 555 0100",
      website: "https://example.com",
      hours: ["Mo-Fr 08:00-18:00", "Sa 10:00-14:00"],
      cuisine: "Italian, Pizza",
      goodToKnow: ["Wheelchair accessible", "Wi-Fi"],
    });
  });

  it("names the place around a place, not the place itself", () => {
    expect(parseDetails({ city: "Newark", county: "Essex County" }, null, "Newark").locality).toBe("Essex County");
  });
});

describe("parseResults", () => {
  it("lists a street mapped in pieces once", () => {
    const piece = (lat: string) => ({ name: "Main Street", display_name: "Main Street, Financial District, San Francisco, United States", lat, lon: "-122.39", addresstype: "road" });
    expect(parseResults([piece("37.79"), piece("37.791")])).toHaveLength(1);
  });

  it("splits the name from what and where it is, keeping the most local parts and the country", () => {
    const [place] = parseResults([GOTHENBURG]);
    expect(place).toEqual({
      name: "Gothenburg",
      detail: "City, Göteborgs Stad, Västra Götaland County, Sweden",
      lat: 57.7072326,
      lon: 11.9670171,
      bounds: { south: 57.5472326, north: 57.8672326, west: 11.8070171, east: 12.1270171 },
      zoom: { min: 10, max: 13 },
      kind: "City",
      details: { goodToKnow: [] },
    });
  });

  it("tells apart places that share a name and a country by their kind", () => {
    const newYork = { name: "New York", display_name: "New York, United States", lat: "40.71", lon: "-74.01", type: "administrative" };
    const [city, state] = parseResults([
      { ...newYork, addresstype: "city", place_rank: 10 },
      { ...newYork, addresstype: "state", place_rank: 8 },
    ]);
    expect(city).toMatchObject({ detail: "City, United States", zoom: { min: 10, max: 13 } });
    expect(state).toMatchObject({ detail: "State, United States", zoom: { min: 5, max: 8 } });
  });

  it("skips results without a position and names the nameless from their address", () => {
    const places = parseResults([{ name: "Nowhere" }, { name: "", display_name: "1 Infinite Loop, Cupertino, USA", lat: "37.3", lon: "-122", place_rank: 30, addresstype: "building", type: "office" }]);
    expect(places).toHaveLength(1);
    expect(places[0]).toMatchObject({ name: "1 Infinite Loop", detail: "Office, Cupertino, USA", zoom: { min: 3, max: 17 } });
    expect(parseResults({ error: "nope" })).toEqual([]);
  });
});

describe("kindOf", () => {
  it("names the kind of place, or what a general one is", () => {
    expect(kindOf("city", "administrative")).toBe("City");
    expect(kindOf("road", "residential")).toBe("Street");
    expect(kindOf("amenity", "fast_food")).toBe("Fast food");
    expect(kindOf("building", "yes")).toBe("Building");
    expect(kindOf(undefined, undefined)).toBe("");
  });
});

describe("zoomForRank", () => {
  it("lets the box decide, going no closer than the kind of place allows", () => {
    expect(zoomForRank(4)).toEqual({ min: 3, max: 6 });
    expect(zoomForRank(30)).toEqual({ min: 3, max: 17 });
  });

  it("opens a bay to fit the whole of it", () => {
    const [bay] = parseResults([{ name: "Chesapeake Bay", display_name: "Chesapeake Bay, Maryland, United States", lat: "38.5", lon: "-76.2", place_rank: 22, addresstype: "bay", type: "bay", boundingbox: ["36.9", "39.55", "-76.54", "-75.81"] }]);
    expect(bay).toMatchObject({ detail: "Bay, Maryland, United States", zoom: { min: 3, max: 16 } });
  });
});

describe("searchPlaces", () => {
  it("asks Nominatim once, in English, and needs no server for coordinates", async () => {
    const asked: string[] = [];
    const fetch: FetchFunction = async (url) => {
      asked.push(url);
      return reply(200, [GOTHENBURG]);
    };
    expect(await searchPlaces(fetch, "  göteborg ")).toHaveLength(1);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("q=g%C3%B6teborg&");
    expect(asked[0]).toContain("accept-language=en");
    await searchPlaces(fetch, "57.7, 11.9");
    expect(asked).toHaveLength(1);
  });

  describe("near another place", () => {
    const at = (name: string, display: string, lat: number, lon: number, importance: number, addresstype = "city") => ({
      name,
      display_name: display,
      lat: String(lat),
      lon: String(lon),
      addresstype,
      importance,
    });
    /** A geocoder with `nearby` in the box and `everywhere` outside it; the asks are kept. */
    const geocoder = (nearby: unknown[], everywhere: unknown[]) => {
      const asked: string[] = [];
      const fetch: FetchFunction = async (url) => {
        asked.push(url);
        return reply(200, url.includes("bounded=1") ? nearby : [...nearby, ...everywhere]);
      };
      return { asked, fetch };
    };
    const newYork = { lat: 40.71, lon: -74.01, radius: 0.5 };

    it("asks both in the box around it and everywhere", async () => {
      const { asked, fetch } = geocoder([], []);
      await searchPlaces(fetch, "Springfield", { lat: 42.36, lon: -71.06, radius: 2 });
      expect(asked).toHaveLength(2);
      expect(asked.find((u) => u.includes("bounded=1"))).toContain("viewbox=-73.06000%2C44.36000%2C-69.06000%2C40.36000");
      expect(asked.find((u) => !u.includes("bounded=1"))).toContain("viewbox=");
    });

    it("puts a famous place far away ahead of shops named after it nearby", async () => {
      // Importances as Nominatim gives them.
      const laundromat = at("San Francisco Laundromat", "San Francisco Laundromat, Broadway, Queens, New York, United States", 40.76, -73.92, 0, "shop");
      const deli = at("San Francisco Deli", "San Francisco Deli, Linden Boulevard, Brooklyn, New York, United States", 40.65, -73.95, 0, "shop");
      const city = at("San Francisco", "San Francisco, California, United States", 37.78, -122.42, 0.78);
      const colombia = at("San Francisco", "San Francisco, Antioquia, Colombia", 5.96, -75.1, 0.46, "county");
      const { fetch } = geocoder([laundromat, deli], [colombia, city]);
      const found = await searchPlaces(fetch, "San Francisco", newYork);
      // The city, then what's nearby, then the town of the name far away.
      expect(found.map((p) => p.detail.split(", ").at(-1))).toEqual(["United States", "United States", "United States", "Colombia"]);
      expect(found[0]!.detail).toBe("City, California, United States");
      // How far each is, to show in the list.
      expect(found[0]!.distance).toBeGreaterThan(4000);
      expect(found[1]!.distance).toBeLessThan(15);
    });

    it("puts a common name nearby ahead of the same name far away", async () => {
      const here = at("Main Street", "Main Street, Flushing, Queens, New York, United States", 40.76, -73.83, 0.1, "road");
      const there = at("Main Street", "Main Street, Springfield, Illinois, United States", 39.8, -89.65, 0.2, "road");
      const { fetch } = geocoder([here], [there]);
      const found = await searchPlaces(fetch, "Main Street", newYork);
      expect(found.map((p) => p.detail)).toEqual(["Street, Flushing, Queens, United States", "Street, Springfield, Illinois, United States"]);
    });

    it("lists a place found both ways once", async () => {
      const city = at("Newark", "Newark, Essex County, New Jersey, United States", 40.73, -74.17, 0.6);
      const { fetch } = geocoder([city], [city]);
      expect(await searchPlaces(fetch, "Newark", newYork)).toHaveLength(1);
    });
  });

  it("explains failures", async () => {
    await expect(searchPlaces(async () => reply(429, {}), "x")).rejects.toThrow(/busy/);
    await expect(searchPlaces(async () => reply(500, {}), "x")).rejects.toThrow(SearchError);
    await expect(
      searchPlaces(async () => {
        throw new TypeError("Failed to fetch");
      }, "x"),
    ).rejects.toThrow(/can't reach/);
  });
});
