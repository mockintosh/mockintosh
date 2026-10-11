import { describe, expect, it } from "vitest";
import { addDays, dayDifference, daysFrom, formatFloating, formatHour, formatTime, parseFloating, startOfWeek } from "./dates";
import { type CalendarEvent, layoutAllDay, layoutDay, moveEvent, parseEvents, serializeEvents } from "./events";
import { VIEW_DEFINITIONS } from "./views";

const timed = (id: string, start: string, end: string): CalendarEvent => ({ id, title: id, start, end });
const view = (kind: string) => VIEW_DEFINITIONS.find((v) => v.kind === kind)!;

describe("dates", () => {
  it("finds the start of the week for either first weekday", () => {
    const sunday = new Date(2026, 9, 11); // Sunday 11 October 2026
    expect(formatFloating(startOfWeek(sunday, 1))).toBe("2026-10-05T00:00");
    expect(formatFloating(startOfWeek(sunday, 0))).toBe("2026-10-11T00:00");
    expect(formatFloating(startOfWeek(new Date(2026, 9, 14, 15), 1))).toBe("2026-10-12T00:00");
  });

  it("round-trips floating times and rejects nonsense", () => {
    expect(formatFloating(parseFloating("2026-03-29T02:30")!)).toMatch(/^2026-03-29T0[23]:30$/);
    expect(parseFloating("2026-10-11")!.getHours()).toBe(0);
    expect(parseFloating("tomorrow")).toBeNull();
  });

  it("counts days across a daylight-saving change", () => {
    const before = new Date(2026, 2, 28);
    expect(dayDifference(before, addDays(before, 3))).toBe(3);
    expect(daysFrom(before, 7).map((d) => d.getDate())).toEqual([28, 29, 30, 31, 1, 2, 3]);
  });

  it("formats times in 24 and 12 hours", () => {
    expect(formatTime(9 * 60 + 5, true)).toBe("09:05");
    expect(formatTime(21 * 60 + 30, false)).toBe("9:30 PM");
    expect(formatTime(0, false)).toBe("12:00 AM");
    expect(formatHour(12, false)).toBe("Noon");
    expect(formatHour(13, true)).toBe("13:00");
  });
});

describe("events", () => {
  it("keeps only well-formed events from a file", () => {
    const good = timed("a", "2026-10-12T09:00", "2026-10-12T10:00");
    const text = JSON.stringify({ events: [good, { id: "b", title: "x", start: "soon", end: "later" }, 4] });
    expect(parseEvents(text)).toEqual([good]);
    expect(parseEvents(serializeEvents([good]))).toEqual([good]);
    expect(parseEvents("not json")).toEqual([]);
  });

  it("moves an event keeping its length", () => {
    const moved = moveEvent(timed("a", "2026-10-12T09:00", "2026-10-12T10:30"), new Date(2026, 9, 13, 23, 0));
    expect(moved).toMatchObject({ start: "2026-10-13T23:00", end: "2026-10-14T00:30" });
  });

  it("puts overlapping events side by side and lone ones full width", () => {
    const day = new Date(2026, 9, 12);
    const segments = layoutDay(
      [
        timed("a", "2026-10-12T09:00", "2026-10-12T11:00"),
        timed("b", "2026-10-12T10:00", "2026-10-12T12:00"),
        timed("c", "2026-10-12T11:00", "2026-10-12T11:30"),
        timed("d", "2026-10-12T14:00", "2026-10-12T15:00"),
        timed("other day", "2026-10-13T09:00", "2026-10-13T10:00"),
      ],
      day,
    );
    const at = (id: string) => segments.find((s) => s.event.id === id)!;
    expect(segments.map((s) => s.event.id)).toEqual(["a", "b", "c", "d"]);
    expect([at("a").column, at("b").column, at("c").column]).toEqual([0, 1, 0]);
    expect([at("a").columns, at("b").columns, at("c").columns]).toEqual([2, 2, 2]);
    expect(at("d")).toMatchObject({ column: 0, columns: 1, top: 14 * 60, bottom: 15 * 60 });
  });

  it("clips an event that runs past midnight to each day", () => {
    const late = timed("late", "2026-10-12T23:00", "2026-10-13T01:00");
    expect(layoutDay([late], new Date(2026, 9, 12))[0]).toMatchObject({ top: 23 * 60, bottom: 24 * 60, continuesAfter: true });
    expect(layoutDay([late], new Date(2026, 9, 13))[0]).toMatchObject({ top: 0, bottom: 60, continuesBefore: true });
  });

  it("lays all-day events in lanes across the days shown", () => {
    const days = daysFrom(new Date(2026, 9, 12), 7);
    const allDay = (id: string, start: string, end: string): CalendarEvent => ({ ...timed(id, start, end), allDay: true });
    const bars = layoutAllDay(
      [
        allDay("trip", "2026-10-10", "2026-10-14"),
        allDay("party", "2026-10-13", "2026-10-14"),
        allDay("course", "2026-10-15", "2026-10-21"),
      ],
      days,
    );
    const at = (id: string) => bars.find((b) => b.event.id === id)!;
    expect(at("trip")).toMatchObject({ first: 0, last: 1, lane: 0, continuesBefore: true });
    expect(at("party")).toMatchObject({ first: 1, last: 1, lane: 1 });
    expect(at("course")).toMatchObject({ first: 3, last: 6, lane: 0, continuesAfter: true });
  });
});

describe("views", () => {
  const settings = { weekStart: 1 as const, hour24: true };

  it("titles a week by the month most of it is in", () => {
    // Monday 28 September – Sunday 4 October 2026: four of its days, from Thursday, are in October.
    expect(view("week").title(new Date(2026, 8, 30), settings)).toBe("October 2026");
    expect(view("week").title(new Date(2026, 9, 14), settings)).toBe("October 2026");
  });

  it("steps by the view's own period", () => {
    expect(formatFloating(view("week").step(new Date(2026, 9, 11), 1))).toBe("2026-10-18T00:00");
    expect(formatFloating(view("month").step(new Date(2026, 0, 31), 1))).toBe("2026-02-28T00:00");
    expect(formatFloating(view("day").step(new Date(2026, 9, 1), -1))).toBe("2026-09-30T00:00");
  });
});
