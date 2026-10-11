/**
 * The calendar's views — Day, Week, Month and Year — and what each needs to
 * be shown: its title, the days it covers, and how far Previous and Next go.
 * `Calendar.tsx` attaches the component that draws each.
 */
import type { JSX } from "@mockintosh/ui";
import type { CalendarEvent } from "./events";
import { addDays, formatLongDate, formatMonthYear, monthWeeks, startOfDay, startOfWeek, type Weekday } from "./dates";

export type ViewKind = "day" | "week" | "month" | "year";

export interface CalendarSettings {
  /** The day weeks start on. */
  weekStart: Weekday;
  /** `13:00` rather than `1 PM`. */
  hour24: boolean;
}

/** What a view can ask of the calendar. */
export interface CalendarActions {
  select(id: string | null): void;
  /** Add `event`, select it, and start editing its title. */
  create(event: CalendarEvent): void;
  update(event: CalendarEvent): void;
  remove(id: string): void;
  /** Edit an event's title in place, or stop editing. */
  edit(id: string | null): void;
  /** Make `date` the day the calendar is about, in the view it's in. */
  focus(date: Date): void;
  /** Go to `kind`'s view of the period holding `date`. */
  show(kind: ViewKind, date: Date): void;
}

export interface ViewProps {
  /** The day the view is about: the week holding it, the month holding it, … */
  date: Date;
  /** Now, to the minute. */
  now: Date;
  events: readonly CalendarEvent[];
  settings: CalendarSettings;
  selected: string | null;
  editing: string | null;
  actions: CalendarActions;
  /** The calendar's toolbar, for the view to put at the top of its window header. */
  toolbar: () => JSX.Element;
  /** The toolbar's height, which the view adds to its header's. */
  toolbarHeight: number;
}

export interface CalendarView {
  kind: ViewKind;
  label: string;
  /** ⌘-key in the View menu. */
  shortcut: string;
  /** The title over the view for the period holding `date`. */
  title(date: Date, settings: CalendarSettings): string;
  /** The days the view shows for `date`: from the first, up to but not including the second. */
  range(date: Date, settings: CalendarSettings): [Date, Date];
  /** `date` moved one period earlier (-1) or later (1). */
  step(date: Date, direction: -1 | 1): Date;
  Component: (props: ViewProps) => JSX.Element;
}

/** The first day of the week holding `date`. */
export function weekOf(date: Date, settings: CalendarSettings): Date {
  return startOfWeek(date, settings.weekStart);
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date.getFullYear(), date.getMonth() + months, 1);
  // Keep the day of the month where the new month has it: 31 January + 1 month is 28 February.
  const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(date.getDate(), lastDay));
  return next;
}

/** The views in the order the toolbar shows them, before their components are attached. */
export const VIEW_DEFINITIONS: readonly Omit<CalendarView, "Component">[] = [
  {
    kind: "day",
    label: "Day",
    shortcut: "1",
    title: (date) => formatLongDate(date),
    range: (date) => [startOfDay(date), addDays(startOfDay(date), 1)],
    step: (date, direction) => addDays(date, direction),
  },
  {
    kind: "week",
    label: "Week",
    shortcut: "2",
    // The month the week mostly falls in, as Calendar titles it.
    title: (date, settings) => formatMonthYear(addDays(weekOf(date, settings), 3)),
    range: (date, settings) => [weekOf(date, settings), addDays(weekOf(date, settings), 7)],
    step: (date, direction) => addDays(date, 7 * direction),
  },
  {
    kind: "month",
    label: "Month",
    shortcut: "3",
    title: (date) => formatMonthYear(date),
    range: (date, settings) => {
      const { first, count } = monthWeeks(date, settings.weekStart);
      return [first, addDays(first, count * 7)];
    },
    step: (date, direction) => addMonths(date, direction),
  },
  {
    kind: "year",
    label: "Year",
    shortcut: "4",
    title: (date) => String(date.getFullYear()),
    range: (date) => [new Date(date.getFullYear(), 0, 1), new Date(date.getFullYear() + 1, 0, 1)],
    step: (date, direction) => addMonths(date, 12 * direction),
  },
];
