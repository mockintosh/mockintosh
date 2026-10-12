/**
 * Calendar, after the Mac's own: a day or a week down the hours, a month of
 * weeks, or the whole year, with events you draw by dragging, move and
 * stretch by dragging, and name in place. The views are listed in
 * `calendar/views.ts`, with their components attached here.
 */
import { For, Show, createEffect, createSignal, onCleanup } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { defineApp, useApp } from "@mockintosh/sdk";
import { atMinute, formatFloating, minuteOfDay, startOfDay, type Weekday } from "./calendar/dates";
import { EVENTS_FILE, type CalendarEvent, newEventId, parseEvents, sampleEvents, serializeEvents } from "./calendar/events";
import { TOOLBAR_H, Toolbar } from "./calendar/Toolbar";
import { DayView } from "./calendar/DayView";
import { MonthView } from "./calendar/MonthView";
import { WeekView } from "./calendar/WeekView";
import { YearView } from "./calendar/YearView";
import {
  VIEW_DEFINITIONS,
  type CalendarActions,
  type CalendarSettings,
  type CalendarView,
  type ViewKind,
  type ViewProps,
  weekOf,
} from "./calendar/views";
import { sprites } from "./calendar/icons";

const SETTINGS_FILE = "settings.json";
const DEFAULT_SETTINGS: CalendarSettings = { weekStart: 1, hour24: true };

const COMPONENTS: Record<ViewKind, (props: ViewProps) => JSX.Element> = {
  day: DayView,
  week: WeekView,
  month: MonthView,
  year: YearView,
};

const VIEWS: readonly CalendarView[] = VIEW_DEFINITIONS.map((view) => ({ ...view, Component: COMPONENTS[view.kind] }));

const viewOf = (kind: ViewKind) => VIEWS.find((view) => view.kind === kind)!;

function parseSettings(text: string | null): CalendarSettings {
  try {
    const saved = JSON.parse(text ?? "{}") as Partial<CalendarSettings>;
    return {
      weekStart: Number.isInteger(saved.weekStart) && saved.weekStart! >= 0 && saved.weekStart! <= 6 ? saved.weekStart! : DEFAULT_SETTINGS.weekStart,
      hour24: typeof saved.hour24 === "boolean" ? saved.hour24 : DEFAULT_SETTINGS.hour24,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function Calendar(_props: Record<string, unknown>): JSX.Element {
  const app = useApp();
  const win = app.window;
  const { storage } = app;

  const [now, setNow] = createSignal(new Date());
  const [date, setDate] = createSignal(startOfDay(new Date()));
  const [view, setView] = createSignal<ViewKind>("week");
  const [settings, setSettings] = createSignal<CalendarSettings>(DEFAULT_SETTINGS);
  /** `null` until read from the preferences folder. */
  const [events, setEvents] = createSignal<readonly CalendarEvent[] | null>(null);
  const [selected, setSelected] = createSignal<string | null>(null);
  const [editing, setEditing] = createSignal<string | null>(null);

  void storage.read(SETTINGS_FILE).then(
    (text) => setSettings(parseSettings(text)),
    () => undefined,
  );
  void storage.read(EVENTS_FILE).then(
    // A first launch starts with a few events this week, so there's something to see.
    (text) => setEvents(text === null ? sampleEvents(weekOf(new Date(), settings())) : parseEvents(text)),
    () => setEvents([]),
  );

  // The clock moves on at each minute.
  let tick: ReturnType<typeof setTimeout> | undefined;
  const waitForMinute = () => {
    const at = new Date();
    tick = setTimeout(() => {
      setNow(new Date());
      waitForMinute();
    }, 60_000 - (at.getSeconds() * 1000 + at.getMilliseconds()) + 50);
  };
  waitForMinute();
  onCleanup(() => clearTimeout(tick));

  function saveEvents(next: readonly CalendarEvent[]): void {
    setEvents(next);
    void storage.write(EVENTS_FILE, serializeEvents(next));
  }

  function changeSettings(change: Partial<CalendarSettings>): void {
    const next = { ...settings(), ...change };
    setSettings(next);
    void storage.write(SETTINGS_FILE, JSON.stringify(next));
  }

  const actions: CalendarActions = {
    select: (id) => {
      setSelected(id);
      if (id !== editing()) setEditing(null);
    },
    create: (event) => {
      saveEvents([...(events() ?? []), event]);
      setSelected(event.id);
      setEditing(event.id);
    },
    update: (event) => saveEvents((events() ?? []).map((e) => (e.id === event.id ? event : e))),
    remove: (id) => {
      saveEvents((events() ?? []).filter((e) => e.id !== id));
      if (selected() === id) setSelected(null);
      if (editing() === id) setEditing(null);
    },
    edit: (id) => {
      if (id) setSelected(id);
      setEditing(id);
    },
    focus: (day) => setDate(startOfDay(day)),
    show: (kind, day) => {
      setDate(startOfDay(day));
      setView(kind);
    },
  };

  const step = (direction: -1 | 1) => setDate(viewOf(view()).step(date(), direction));
  const goToday = () => setDate(startOfDay(new Date()));

  /** A new hour-long event: at the next hour today when today is in view, else at nine. */
  function newEvent(): void {
    const today = new Date();
    const [from, to] = viewOf(view()).range(date(), settings());
    const inView = today >= from && today < to;
    const day = inView ? today : date();
    // The year has nowhere to name an event in place: open the day it goes on.
    if (view() === "year") actions.show("day", day);
    const start = inView ? Math.min(23, Math.floor(minuteOfDay(today) / 60) + 1) * 60 : 9 * 60;
    actions.create({
      id: newEventId(),
      title: "New Event",
      start: formatFloating(atMinute(day, start)),
      end: formatFloating(atMinute(day, start + 60)),
    });
  }

  createEffect(
    () => ({ view: view(), unit: viewOf(view()).label, selected: selected(), settings: settings() }),
    (state) => {
      app.setMenus([
        {
          label: "File",
          items: [
            { label: "New Event", shortcut: "N", onClick: newEvent },
            { type: "separator" },
            { label: "Quit", shortcut: "Q", onClick: () => app.quit() },
          ],
        },
        {
          label: "Edit",
          items: [
            {
              label: "Delete",
              disabled: !state.selected,
              onClick: () => state.selected && actions.remove(state.selected),
            },
          ],
        },
        {
          label: "View",
          items: [
            ...VIEWS.map((v) => ({
              label: v.label,
              shortcut: v.shortcut,
              checked: v.kind === state.view,
              onClick: () => setView(v.kind),
            })),
            { type: "separator" as const },
            { label: `Previous ${state.unit}`, shortcut: "[", onClick: () => step(-1) },
            { label: `Next ${state.unit}`, shortcut: "]", onClick: () => step(1) },
            { label: "Go to Today", shortcut: "T", onClick: goToday },
            { type: "separator" as const },
            {
              label: "Start Weeks on Monday",
              checked: state.settings.weekStart === 1,
              onClick: () => changeSettings({ weekStart: (state.settings.weekStart === 1 ? 0 : 1) as Weekday }),
            },
            {
              label: "24-Hour Time",
              checked: state.settings.hour24,
              onClick: () => changeSettings({ hour24: !state.settings.hour24 }),
            },
          ],
        },
      ]);
    },
  );

  const onKeyDown = (key: string, mods: { meta: boolean; ctrl: boolean }) => {
    if (mods.meta || mods.ctrl || editing()) return;
    if (key === "ArrowLeft") step(-1);
    else if (key === "ArrowRight") step(1);
    else if ((key === "Backspace" || key === "Delete") && selected()) actions.remove(selected()!);
    else if (key === "Enter" && selected()) actions.edit(selected());
    else if (key === "Escape") actions.select(null);
  };

  const arrows = { previous: app.getSprite("calendar/previous")!, next: app.getSprite("calendar/next")! };
  const toolbar = () => (
    <Toolbar
      width={win.width()}
      sprites={arrows}
      title={viewOf(view()).title(date(), settings())}
      views={VIEWS}
      view={view()}
      onView={setView}
      onStep={step}
      onToday={goToday}
    />
  );

  return (
    <box
      width={win.width()}
      background={0}
      tabIndex={0}
      autoFocus
      semantic={{ name: "calendar", role: "application" }}
      onKeyDown={onKeyDown}
    >
      <Show when={events()}>
        {(list) => (
          // One element per view, so switching mounts the new view fresh.
          <For each={[view()]}>
            {(kind) => {
              const View = viewOf(kind).Component;
              return (
                <View
                  date={date()}
                  now={now()}
                  events={list()}
                  settings={settings()}
                  selected={selected()}
                  editing={editing()}
                  actions={actions}
                  toolbar={toolbar}
                  toolbarHeight={TOOLBAR_H}
                />
              );
            }}
          </For>
        )}
      </Show>
    </box>
  );
}

export default defineApp({
  id: "calendar",
  title: "Calendar",
  icon: "calendar/icon",
  smallIcon: "calendar/icon-16x16",
  sprites,
  about: {
    version: "1.0",
    description:
      "Keeps your events by the day, week, month or year. Drag in a day to add an event, drag it to move it or its bottom edge to change its length, and double-click it to rename it.",
  },
  defaultSize: { width: 480, height: 300 },
  resizable: true,
  minSize: { width: 380, height: 220 },
  scrollable: true,
  Component: Calendar,
});
