/**
 * Events, how they are kept, and how a day's events share its column. Pure:
 * the views draw what these functions return.
 */
import {
  MINUTES_PER_DAY,
  addDays,
  atMinute,
  dayDifference,
  formatFloating,
  parseFloating,
  startOfDay,
} from "./dates";

export interface CalendarEvent {
  id: string;
  title: string;
  /** Floating local time, `YYYY-MM-DDTHH:MM`. An all-day event starts at its first day's midnight. */
  start: string;
  /** Exclusive: an all-day event on the 12th alone ends at the 13th's midnight. */
  end: string;
  allDay?: boolean;
}

/** The file the events are kept in, in the app's storage folder. */
export const EVENTS_FILE = "events.json";

export function newEventId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** The events in `text`, an events file; events it can't read are left out. */
export function parseEvents(text: string): CalendarEvent[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  const list = raw && typeof raw === "object" && Array.isArray((raw as { events?: unknown }).events)
    ? (raw as { events: unknown[] }).events
    : [];
  return list.filter(isEvent);
}

export function serializeEvents(events: readonly CalendarEvent[]): string {
  return JSON.stringify({ version: 1, events }, null, 1);
}

function isEvent(value: unknown): value is CalendarEvent {
  if (!value || typeof value !== "object") return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.id === "string" &&
    typeof e.title === "string" &&
    typeof e.start === "string" &&
    typeof e.end === "string" &&
    parseFloating(e.start) !== null &&
    parseFloating(e.end) !== null &&
    (e.allDay === undefined || typeof e.allDay === "boolean")
  );
}

export function eventStart(event: CalendarEvent): Date {
  return parseFloating(event.start)!;
}

export function eventEnd(event: CalendarEvent): Date {
  return parseFloating(event.end)!;
}

/** `event` moved so it starts at `start`, keeping its length. */
export function moveEvent(event: CalendarEvent, start: Date): CalendarEvent {
  const length = eventEnd(event).getTime() - eventStart(event).getTime();
  return { ...event, start: formatFloating(start), end: formatFloating(new Date(start.getTime() + length)) };
}

// --- Timed events in a day's column -----------------------------------------

/** One timed event's part in one day, and where it sits across the column. */
export interface DaySegment {
  event: CalendarEvent;
  /** Minutes from the day's midnight, clipped to the day. */
  top: number;
  bottom: number;
  /** It began on an earlier day / goes on into a later one. */
  continuesBefore: boolean;
  continuesAfter: boolean;
  /** Which of `columns` side-by-side columns it takes, from the left. */
  column: number;
  columns: number;
}

/**
 * The timed events that fall on `day`, packed into side-by-side columns: an
 * event takes the leftmost column free at its start, and every event in a
 * run of overlapping events shares that run's column count.
 */
export function layoutDay(events: readonly CalendarEvent[], day: Date): DaySegment[] {
  const dayStart = startOfDay(day).getTime();
  const dayEnd = addDays(startOfDay(day), 1).getTime();
  const segments: DaySegment[] = [];
  for (const event of events) {
    if (event.allDay) continue;
    const start = eventStart(event).getTime();
    const end = Math.max(eventEnd(event).getTime(), start);
    // A zero-length event still shows, at its start.
    if (end === start ? start < dayStart || start >= dayEnd : end <= dayStart || start >= dayEnd) continue;
    const top = Math.max(0, minutesBetween(dayStart, start));
    const bottom = Math.min(MINUTES_PER_DAY, minutesBetween(dayStart, end));
    segments.push({
      event,
      top,
      bottom: Math.max(bottom, top),
      continuesBefore: start < dayStart,
      continuesAfter: end > dayEnd,
      column: 0,
      columns: 1,
    });
  }
  segments.sort((a, b) => a.top - b.top || b.bottom - a.bottom || a.event.id.localeCompare(b.event.id));

  // Too short to draw apart from what follows: treat every segment as at least this long.
  const MIN_MINUTES = 15;
  const span = (s: DaySegment) => Math.max(s.bottom, s.top + MIN_MINUTES);
  let run: DaySegment[] = [];
  let runEnd = -1;
  let columnEnds: number[] = [];
  const closeRun = () => {
    for (const s of run) s.columns = columnEnds.length;
    run = [];
    columnEnds = [];
  };
  for (const s of segments) {
    if (s.top >= runEnd) closeRun();
    let column = columnEnds.findIndex((end) => end <= s.top);
    if (column < 0) column = columnEnds.push(0) - 1;
    columnEnds[column] = span(s);
    s.column = column;
    run.push(s);
    runEnd = Math.max(runEnd, span(s));
  }
  closeRun();
  return segments;
}

/** Wall-clock minutes from `from` to `to`, so a day is 1440 even when daylight saving makes it 23 or 25 hours. */
function minutesBetween(from: number, to: number): number {
  const a = new Date(from);
  const b = new Date(to);
  return dayDifference(a, b) * MINUTES_PER_DAY + (b.getHours() * 60 + b.getMinutes()) - (a.getHours() * 60 + a.getMinutes());
}

// --- All-day events across a row of days -------------------------------------

/** An all-day event's bar across the days shown, and the lane it sits in. */
export interface AllDayBar {
  event: CalendarEvent;
  /** Indices into the days shown, inclusive. */
  first: number;
  last: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
  lane: number;
}

/** The all-day events over `days` (consecutive), each in the topmost lane free across its days. */
export function layoutAllDay(events: readonly CalendarEvent[], days: readonly Date[]): AllDayBar[] {
  if (days.length === 0) return [];
  const first = days[0]!;
  const bars: AllDayBar[] = [];
  for (const event of events) {
    if (!event.allDay) continue;
    const from = dayDifference(first, eventStart(event));
    // The end is exclusive; an all-day event lasts at least its first day.
    const to = Math.max(from, dayDifference(first, eventEnd(event)) - 1);
    if (to < 0 || from >= days.length) continue;
    bars.push({
      event,
      first: Math.max(0, from),
      last: Math.min(days.length - 1, to),
      continuesBefore: from < 0,
      continuesAfter: to >= days.length,
      lane: 0,
    });
  }
  bars.sort((a, b) => a.first - b.first || b.last - a.last || a.event.id.localeCompare(b.event.id));
  const laneEnds: number[] = [];
  for (const bar of bars) {
    let lane = laneEnds.findIndex((end) => end < bar.first);
    if (lane < 0) lane = laneEnds.push(0) - 1;
    laneEnds[lane] = bar.last;
    bar.lane = lane;
  }
  return bars;
}

// --- A first launch's calendar ------------------------------------------------

/** A few events in the week of `weekStart`, so a new calendar shows what it does. */
export function sampleEvents(weekStart: Date): CalendarEvent[] {
  const at = (day: number, minutes: number) => formatFloating(atMinute(addDays(weekStart, day), minutes));
  const timed = (title: string, day: number, from: number, to: number): CalendarEvent => ({
    id: newEventId(),
    title,
    start: at(day, from),
    end: at(day, to),
  });
  return [
    timed("Team Meeting", 0, 9 * 60 + 30, 10 * 60 + 30),
    timed("Lunch with Sam", 1, 12 * 60, 13 * 60),
    timed("Design Review", 2, 14 * 60, 15 * 60 + 30),
    timed("1:1", 2, 15 * 60, 15 * 60 + 30),
    timed("Gym", 3, 7 * 60, 8 * 60),
    timed("Dentist", 4, 16 * 60, 16 * 60 + 45),
    timed("Dinner", 5, 19 * 60, 21 * 60),
    {
      id: newEventId(),
      title: "Conference",
      start: formatFloating(addDays(weekStart, 3)),
      end: formatFloating(addDays(weekStart, 5)),
      allDay: true,
    },
  ];
}
