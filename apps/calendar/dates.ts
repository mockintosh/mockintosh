/**
 * Calendar date math on local wall-clock time. A day is a `Date` at local
 * midnight; times within it are minutes from that midnight. Events keep
 * floating times ("09:00 on the 12th", whatever the zone), as iCalendar's
 * floating times do, written `YYYY-MM-DDTHH:MM`.
 */

export const MINUTES_PER_DAY = 24 * 60;

/** 0 = Sunday … 6 = Saturday, as `Date.getDay()`. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Local midnight of `date`'s day. */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** `date` moved by whole days, keeping its time of day across daylight-saving changes. */
export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** The first day of the week holding `date`, for weeks that start on `weekStart`. */
export function startOfWeek(date: Date, weekStart: Weekday): Date {
  const day = startOfDay(date);
  return addDays(day, -((day.getDay() - weekStart + 7) % 7));
}

/** The `count` days from `first`. */
export function daysFrom(first: Date, count: number): Date[] {
  return Array.from({ length: count }, (_, i) => addDays(first, i));
}

export function isWeekend(date: Date): boolean {
  return date.getDay() === 0 || date.getDay() === 6;
}

/** Minutes since local midnight of `date`'s own day. */
export function minuteOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/** `day` (any time on it) at `minutes` past its midnight; 1440 is the next midnight. */
export function atMinute(day: Date, minutes: number): Date {
  const d = startOfDay(day);
  d.setMinutes(minutes);
  return d;
}

/** Whole days from `a`'s day to `b`'s, ignoring the time of day and daylight-saving hours. */
export function dayDifference(a: Date, b: Date): number {
  const utc = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((utc(b) - utc(a)) / 86_400_000);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** `YYYY-MM-DDTHH:MM` in local time. */
export function formatFloating(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The local time a `YYYY-MM-DDTHH:MM` (or `YYYY-MM-DD`) string names, or `null` if it names none. */
export function parseFloating(text: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(text);
  if (!m) return null;
  const date = new Date(+m[1]!, +m[2]! - 1, +m[3]!, m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Hours and minutes as the clock shows them: `9:30` / `21:30`, or `9:30 AM` / `9:30 PM`. */
export function formatTime(minutes: number, hour24: boolean): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  if (hour24) return `${pad(h)}:${pad(m)}`;
  return `${h % 12 || 12}:${pad(m)} ${h < 12 ? "AM" : "PM"}`;
}

/** An hour's label in the time column: `09:00`, or `9 AM` and `Noon`. */
export function formatHour(hour: number, hour24: boolean): string {
  if (hour24) return `${pad(hour % 24)}:00`;
  if (hour === 12) return "Noon";
  return `${hour % 12 || 12} ${hour < 12 ? "AM" : "PM"}`;
}

/** `October 2026`. */
export function formatMonthYear(date: Date): string {
  return `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}
