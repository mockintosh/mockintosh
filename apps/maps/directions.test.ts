import { describe, expect, it } from "vitest";
import { calloutPoints, decodePolyline, findRoutes, formatArrival, formatDuration, formatRouteDistance, instruction, parseRoutes } from "./directions";

describe("decodePolyline", () => {
  it("decodes Google's example", () => {
    expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")).toEqual([
      { lat: 38.5, lon: -120.2 },
      { lat: 40.7, lon: -120.95 },
      { lat: 43.252, lon: -126.453 },
    ]);
  });
});

describe("instruction", () => {
  it("words OSRM's maneuvers", () => {
    expect(instruction({ name: "Infinite Loop", maneuver: { type: "depart", bearing_after: 181 } }, "")).toBe("Head south on Infinite Loop");
    expect(instruction({ name: "Main Street", maneuver: { type: "turn", modifier: "slight left" } }, "")).toBe("Turn slight left onto Main Street");
    expect(instruction({ name: "", ref: "I 280", maneuver: { type: "end of road", modifier: "right" } }, "")).toBe("Turn right onto I 280");
    expect(instruction({ name: "", destinations: "I 280 North: San Francisco", maneuver: { type: "on ramp", modifier: "left" } }, "")).toBe(
      "Take the ramp toward I 280 North: San Francisco",
    );
    expect(instruction({ name: "", exits: "12A", destinations: "Market Street", maneuver: { type: "off ramp" } }, "")).toBe(
      "Take exit 12A toward Market Street",
    );
    expect(instruction({ name: "Ring Road", maneuver: { type: "roundabout", exit: 2 } }, "")).toBe("At the roundabout, take the second exit onto Ring Road");
    expect(instruction({ name: "Elm Street", maneuver: { type: "continue", modifier: "right" } }, "")).toBe("Turn right to stay on Elm Street");
    expect(instruction({ name: "", maneuver: { type: "fork", modifier: "slight right" } }, "")).toBe("Keep right at the fork");
    expect(instruction({ maneuver: { type: "arrive", modifier: "left" } }, "San Francisco")).toBe("Arrive at San Francisco on the left");
  });
});

/** An OSRM answer for a straight route east, in two steps. */
const ANSWER = {
  code: "Ok",
  routes: [
    {
      distance: 1234,
      duration: 185,
      geometry: "_p~iF~ps|U_ulLnnqC_mqNvxq`@",
      legs: [
        {
          steps: [
            {
              name: "Main Street",
              distance: 1234,
              intersections: [{ classes: ["toll"] }],
              maneuver: { type: "depart", bearing_after: 90, location: [-120.2, 38.5] },
            },
            { name: "Main Street", distance: 0.2, maneuver: { type: "continue", modifier: "straight", location: [-120.95, 40.7] } },
            { name: "Main Street", distance: 0, maneuver: { type: "arrive", location: [-126.453, 43.252] } },
          ],
          summary: "Main Street",
        },
      ],
    },
  ],
};

describe("parseRoutes", () => {
  it("reads the line, the totals and the steps that go somewhere", () => {
    const [route] = parseRoutes(ANSWER, "Home");
    if (!route) throw new Error("no route");
    expect(route.points).toHaveLength(3);
    expect(route.distance).toBe(1234);
    expect(route.steps.map((s) => s.text)).toEqual(["Head east on Main Street", "Arrive at Home"]);
    expect(route.steps[1]!.at).toEqual({ lat: 43.252, lon: -126.453 });
    expect(route.bounds).toEqual({ south: 38.5, north: 43.252, west: -126.453, east: -120.2 });
    expect(route.via).toBe("Main Street");
    expect(route.tolls).toBe(true);
  });

  it("finds nothing in an answer without a route", () => {
    expect(parseRoutes({ code: "NoRoute", routes: [] }, "Home")).toEqual([]);
  });

  it("puts the fastest of several first", () => {
    const slow = { ...ANSWER.routes[0]!, duration: 999 };
    const routes = parseRoutes({ code: "Ok", routes: [slow, ANSWER.routes[0]] }, "Home");
    expect(routes.map((r) => r.duration)).toEqual([185, 999]);
  });
});

describe("findRoutes", () => {
  it("asks the server for the mode's route, longitude first", async () => {
    let asked = "";
    const fetch = async (url: string) => {
      asked = url;
      return new Response(JSON.stringify(ANSWER), { status: 200 });
    };
    const routes = await findRoutes(fetch as never, { lat: 38.5, lon: -120.2 }, { lat: 43.252, lon: -126.453, name: "Home" }, "bike");
    expect(asked).toContain("/routed-bike/route/v1/driving/-120.200000,38.500000;-126.453000,43.252000?");
    expect(asked).toContain("alternatives=2");
    expect(routes[0]!.steps).toHaveLength(2);
  });

  it("says so when there's no way between the places", async () => {
    const fetch = async () => new Response(JSON.stringify({ code: "NoRoute", message: "Impossible route" }), { status: 400 });
    await expect(findRoutes(fetch as never, { lat: 0, lon: 0 }, { lat: 1, lon: 1, name: "There" }, "car")).rejects.toThrow("can't find a way");
  });
});

describe("calloutPoints", () => {
  it("puts the first halfway along and another where it parts from the first", () => {
    const line = (points: [number, number][]) => ({ points: points.map(([lat, lon]) => ({ lat, lon })) });
    const straight = { ...line([[0, 0], [0, 0.01], [0, 0.02], [0, 0.03], [0, 0.04]]), distance: 4452 };
    const detour = { ...line([[0, 0], [0, 0.01], [0.01, 0.02], [0, 0.03], [0, 0.04]]), distance: 5000 };
    const [first, second] = calloutPoints([straight, detour] as never);
    expect(first).toEqual({ lat: 0, lon: 0.02 });
    expect(second).toEqual({ lat: 0.01, lon: 0.02 });
  });
});

describe("formatting", () => {
  it("gives the time of arrival on a 24-hour clock", () => {
    expect(formatArrival(new Date(2026, 9, 6, 8, 57), 18 * 60)).toBe("09:15");
  });

  it("rounds distances and times as a list of steps wants them", () => {
    expect(formatRouteDistance(4)).toBe("10 m");
    expect(formatRouteDistance(347)).toBe("350 m");
    expect(formatRouteDistance(4249)).toBe("4.2 km");
    expect(formatRouteDistance(69896)).toBe("70 km");
    expect(formatDuration(20)).toBe("1 min");
    expect(formatDuration(3304)).toBe("55 min");
    expect(formatDuration(3900)).toBe("1 h 5 min");
    expect(formatDuration(7200)).toBe("2 h");
  });
});
