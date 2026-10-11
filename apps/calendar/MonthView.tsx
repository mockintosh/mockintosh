/**
 * A month as whole weeks, a row each, filling the window: every day's number
 * in its corner, all-day events as bars across their days, and the day's
 * other events listed under them until the cell is full.
 *
 * As in the week, dragging an event leaves it in place and outlines the day
 * it would land on, so the node that took the press keeps it.
 */
import { For, Show, createEffect, createMemo, createSignal, onSettled } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { WindowHeader, useApp } from "@mockintosh/sdk";
import {
  MONTH_NAMES,
  WEEKDAY_SHORT,
  addDays,
  daysFrom,
  formatFloating,
  formatTime,
  isWeekend,
  minuteOfDay,
  monthWeeks,
  sameDay,
  startOfDay,
} from "./dates";
import { type CalendarEvent, eventStart, layoutAllDay, layoutDay, newEventId } from "./events";
import { BODY_H, DayNumber, NEW_TITLE, TitleEditor, WEEKEND, fit, moveBy } from "./shared";
import type { ViewProps } from "./views";

/** The weekdays' names over the columns. */
const NAMES_H = 14;
/** A day's number, along the top of its cell. */
const NUMBER_H = BODY_H + 2;
/** One event in a cell. */
const LINE_H = BODY_H;
/** A week's row is never shorter than its number and two events; the window scrolls instead. */
const MIN_ROW = NUMBER_H + 2 * LINE_H + 2;
/** Wide enough for an event's time beside its title. */
const TIME_W = 90;

/** An event being dragged: where it would be, and the day it would land on. */
interface Drag {
  event: CalendarEvent;
  target: number;
}

export function MonthView(props: ViewProps): JSX.Element {
  const app = useApp();
  const win = app.window;
  const width = () => win.width();

  const weeks = createMemo(() => monthWeeks(props.date, props.settings.weekStart));
  const days = createMemo(() => daysFrom(weeks().first, weeks().count * 7));
  const rowH = () => Math.max(MIN_ROW, Math.floor((win.height() - 1) / weeks().count));
  const colX = (i: number) => Math.round((i * width()) / 7);
  const colW = (i: number) => colX(i + 1) - colX(i);
  const cellX = (index: number) => colX(index % 7);
  const cellY = (index: number) => Math.floor(index / 7) * rowH();
  /** Lines of events a cell has room for, under its number. */
  const lines = () => Math.floor((rowH() - NUMBER_H - 2) / LINE_H);
  const contentH = () => weeks().count * rowH() + 1;
  const inMonth = (day: Date) => day.getMonth() === props.date.getMonth();

  createEffect(
    () => [width(), contentH()] as const,
    ([w, h]) => win.setContentSize(w, h),
  );
  onSettled(() => win.scrollTo(0));

  /** Each week's all-day bars, and how many lanes they take. */
  const weekBars = createMemo(() =>
    Array.from({ length: weeks().count }, (_, row) => {
      const bars = layoutAllDay(props.events, days().slice(row * 7, row * 7 + 7));
      return { bars, lanes: bars.reduce((n, bar) => Math.max(n, bar.lane + 1), 0) };
    }),
  );
  /** Each day's timed events, in the order they start. */
  const dayEvents = createMemo(() => days().map((day) => layoutDay(props.events, day).map((s) => s.event)));

  const [drag, setDrag] = createSignal<Drag | null>(null);
  let x0 = 0;
  let y0 = 0;
  const startDrag = (gx: number, gy: number) => {
    x0 = gx;
    y0 = gy;
  };
  /** Follow the pointer with `event`, which sits on day `index`. */
  const dragTo = (event: CalendarEvent, index: number, gx: number, gy: number) => {
    const moved = Math.round((gx - x0) / (width() / 7)) + 7 * Math.round((gy - y0) / rowH());
    setDrag({ event: moveBy(event, moved), target: Math.max(0, Math.min(days().length - 1, index + moved)) });
  };
  const finishDrag = () => {
    const done = drag();
    setDrag(null);
    if (done) props.actions.update(done.event);
  };

  const indices = () => days().map((_, i) => i);

  function Cell(p: { index: number }): JSX.Element {
    const day = () => days()[p.index]!;
    return (
      <box
        position="absolute"
        left={cellX(p.index)}
        top={cellY(p.index)}
        width={colW(p.index % 7)}
        height={rowH()}
        background={isWeekend(day()) ? WEEKEND : 0}
        semantic={{ name: `day:${formatFloating(day()).slice(0, 10)}`, role: "grid" }}
        onClick={() => props.actions.select(null)}
        onDoubleClick={() =>
          props.actions.create({
            id: newEventId(),
            title: NEW_TITLE,
            start: formatFloating(startOfDay(day())),
            end: formatFloating(addDays(startOfDay(day()), 1)),
            allDay: true,
          })
        }
      />
    );
  }

  /** A day's number in its cell's top right corner: the month's first day says which month. */
  function DayCorner(p: { index: number }): JSX.Element {
    const day = () => days()[p.index]!;
    const label = () => (day().getDate() === 1 ? `${MONTH_NAMES[day().getMonth()]!.slice(0, 3)} 1` : String(day().getDate()));
    return (
      <box
        position="absolute"
        left={cellX(p.index) + colW(p.index % 7) - 4 - 40}
        top={cellY(p.index) + 1}
        width={40}
        height={NUMBER_H}
        flexDirection="row"
        justifyContent="flex-end"
        alignItems="center"
      >
        <box onClick={() => props.actions.show("day", day())}>
          <DayNumber label={label()} today={sameDay(day(), props.now)} dimmed={!inMonth(day())} />
        </box>
      </box>
    );
  }

  /** An event on one line: all-day ones boxed, the rest after a dot, with the time when there's room. */
  function EventLine(p: {
    event: CalendarEvent;
    index: number;
    left: number;
    top: number;
    width: number;
    boxed: boolean;
  }): JSX.Element {
    const selected = () => props.selected === p.event.id;
    const editing = () => props.editing === p.event.id;
    const ink = () => (selected() ? 0 : 1);
    const time = () => (p.boxed || p.width < TIME_W ? "" : formatTime(minuteOfDay(eventStart(p.event)), props.settings.hour24));
    const titleW = () => p.width - 8 - (time() ? 34 : 0);
    return (
      <box
        position="absolute"
        left={p.left}
        top={p.top}
        width={Math.max(4, p.width)}
        height={LINE_H - 1}
        flexDirection="row"
        alignItems="center"
        gap={2}
        paddingLeft={2}
        paddingRight={2}
        background={selected() ? 1 : drag()?.event.id === p.event.id ? "gray25" : 0}
        borderColor={p.boxed ? 1 : undefined}
        borderWidth={p.boxed ? 1 : 0}
        borderRadius={2}
        overflow="hidden"
        semantic={{ name: `event:${p.event.title}`, role: "button", value: time() || "all-day" }}
        onMouseDown={() => props.actions.select(p.event.id)}
        onDoubleClick={() => props.actions.edit(p.event.id)}
        onDragStart={(_x, _y, gx, gy) => startDrag(gx, gy)}
        onDrag={(_x, _y, gx, gy) => dragTo(p.event, p.index, gx, gy)}
        onDragEnd={finishDrag}
      >
        <Show when={!p.boxed}>
          <box width={3} height={3} borderRadius={1} background={ink()} />
        </Show>
        <Show
          when={editing()}
          fallback={
            <text font="body" bold={p.boxed} color={ink()} nowrap flexGrow={1}>
              {fit(p.event.title, titleW(), p.boxed)}
            </text>
          }
        >
          <TitleEditor event={p.event} width={Math.max(8, titleW())} actions={props.actions} />
        </Show>
        <Show when={time() && !editing()}>
          <text font="body" color={ink()} nowrap>{time()}</text>
        </Show>
      </box>
    );
  }

  /** Week `row`'s all-day bars, each across its days, in the lanes under the numbers. */
  function WeekBars(p: { row: number }): JSX.Element {
    const info = () => weekBars()[p.row]!;
    return (
      <For each={info().bars.filter((bar) => bar.lane < lines()).map((bar) => bar.event.id)}>
        {(id) => {
          const bar = () => info().bars.find((b) => b.event.id === id);
          return (
            <Show when={bar()}>
              {(b) => (
                <EventLine
                  event={b().event}
                  index={p.row * 7 + b().first}
                  left={colX(b().first) + 2}
                  top={p.row * rowH() + NUMBER_H + b().lane * LINE_H}
                  width={colX(b().last + 1) - colX(b().first) - 3}
                  boxed
                />
              )}
            </Show>
          );
        }}
      </For>
    );
  }

  /** Day `index`'s timed events under its row's bars, with how many more there are when they don't fit. */
  function DayList(p: { index: number }): JSX.Element {
    const lanes = () => weekBars()[Math.floor(p.index / 7)]!.lanes;
    const room = () => Math.max(0, lines() - lanes());
    const all = () => dayEvents()[p.index] ?? [];
    const shown = () => (all().length <= room() ? all() : all().slice(0, Math.max(0, room() - 1)));
    const more = () => all().length - shown().length;
    const top = (n: number) => cellY(p.index) + NUMBER_H + (lanes() + n) * LINE_H;
    return (
      <>
        <For each={shown().map((event) => event.id)}>
          {(id) => {
            const at = () => shown().findIndex((e) => e.id === id);
            return (
              <Show when={shown()[at()]}>
                {(event) => (
                  <EventLine
                    event={event()}
                    index={p.index}
                    left={cellX(p.index) + 2}
                    top={top(at())}
                    width={colW(p.index % 7) - 3}
                    boxed={false}
                  />
                )}
              </Show>
            );
          }}
        </For>
        <Show when={more() > 0 && room() > 0}>
          <text
            position="absolute"
            left={cellX(p.index) + 4}
            top={top(shown().length)}
            font="body"
            nowrap
            onClick={() => props.actions.show("day", days()[p.index]!)}
          >
            {`${more()} more…`}
          </text>
        </Show>
      </>
    );
  }

  return (
    <>
      <WindowHeader height={props.toolbarHeight + NAMES_H}>
        <box width={width()} height={props.toolbarHeight + NAMES_H} background={0} flexDirection="column">
          {props.toolbar()}
          <box width={width()} height={NAMES_H}>
            <For each={[0, 1, 2, 3, 4, 5, 6]}>
              {(i) => (
                <text
                  position="absolute"
                  left={colX(i)}
                  top={1}
                  width={colW(i) - 5}
                  font="body"
                  align="right"
                  nowrap
                >
                  {WEEKDAY_SHORT[(props.settings.weekStart + i) % 7]!}
                </text>
              )}
            </For>
          </box>
        </box>
      </WindowHeader>
      <box width={width()} height={contentH()} background={0} semantic={{ name: "calendar-month", role: "grid" }}>
        <For each={indices()}>{(i) => <Cell index={i} />}</For>
        <For each={[1, 2, 3, 4, 5, 6]}>
          {(i) => <box position="absolute" left={colX(i)} top={0} width={1} height={contentH()} background={1} />}
        </For>
        <For each={Array.from({ length: weeks().count }, (_, r) => r + 1)}>
          {(r) => <box position="absolute" left={0} top={r * rowH()} width={width()} height={1} background={1} />}
        </For>
        <For each={indices()}>{(i) => <DayCorner index={i} />}</For>
        <For each={Array.from({ length: weeks().count }, (_, r) => r)}>{(r) => <WeekBars row={r} />}</For>
        <For each={indices()}>{(i) => <DayList index={i} />}</For>
        <Show when={drag()}>
          {(d) => (
            <box
              position="absolute"
              left={cellX(d().target) + 1}
              top={cellY(d().target) + 1}
              width={colW(d().target % 7) - 1}
              height={rowH() - 1}
              borderColor={1}
              borderWidth={2}
            />
          )}
        </Show>
      </box>
    </>
  );
}
