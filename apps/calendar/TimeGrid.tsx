/**
 * Days side by side down a 24-hour column, as the Week view shows seven and
 * the Day view one: day headers and all-day events in the window header, the
 * hours below them, scrolled by the window.
 *
 * Dragging an event leaves it where it is and draws where it would land over
 * the grid, so the node that took the press keeps it until release.
 */
import { For, Show, createEffect, createMemo, createSignal, onSettled } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { TextInput, fontLineHeight, measureText } from "@mockintosh/ui";
import { WindowHeader, useApp } from "@mockintosh/sdk";
import {
  MINUTES_PER_DAY,
  WEEKDAY_SHORT,
  addDays,
  atMinute,
  formatFloating,
  formatHour,
  formatTime,
  isWeekend,
  minuteOfDay,
  sameDay,
  startOfDay,
} from "./dates";
import {
  type CalendarEvent,
  eventEnd,
  eventStart,
  layoutAllDay,
  layoutDay,
  moveEvent,
  newEventId,
} from "./events";
import type { ViewProps } from "./views";

const HOUR_H = 26;
/** The time column, left of the days. */
const GUTTER_W = 38;
const DAY_HEAD_H = 18;
const LANE_H = 13;
/** Minutes that a drag moves or sizes an event by. */
const SNAP = 15;
/** How far up from an event's bottom edge a press sizes it instead of moving it. */
const RESIZE_EDGE = 4;
/** The hour the grid opens scrolled to. */
const FIRST_HOUR = 7;
const NEW_TITLE = "New Event";
/** Narrower than this, a title stays on one line rather than breaking inside its words. */
const WRAP_W = 48;

const BODY_H = fontLineHeight("body");
const GRID_H = 24 * HOUR_H + 1;

/** Weekends are shaded with this pattern, a dot in every 4×4. */
const WEEKEND = new Uint8Array([0x88, 0, 0x22, 0, 0x88, 0, 0x22, 0]);

const minuteY = (minutes: number) => Math.round((minutes * HOUR_H) / 60);

/** `text` cut with an ellipsis to fit `width` pixels, measured as drawn (`bold` is wider). */
function fit(text: string, width: number, bold = false): string {
  const style = { bold };
  if (measureText(text, "body", style) <= width) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measureText(`${text.slice(0, mid)}…`, "body", style) <= width) lo = mid;
    else hi = mid - 1;
  }
  return lo === 0 ? "" : `${text.slice(0, lo).trimEnd()}…`;
}

/** An event being dragged, as it would be if the mouse were let go now. */
interface Drag {
  event: CalendarEvent;
  /** The event isn't in the calendar yet: the drag is drawing it. */
  creating: boolean;
}

export function TimeGrid(props: ViewProps & { days: readonly Date[] }): JSX.Element {
  const app = useApp();
  const win = app.window;
  const count = () => props.days.length;
  const width = () => win.width();
  /** Left edge of day `i`'s column; `count()` gives the right edge of the last. */
  const columnX = (i: number) => GUTTER_W + Math.round((i * (width() - GUTTER_W)) / count());
  const columnW = (i: number) => columnX(i + 1) - columnX(i);
  const averageW = () => (width() - GUTTER_W) / count();

  const [drag, setDrag] = createSignal<Drag | null>(null);

  const segments = createMemo(() => props.days.map((day) => layoutDay(props.events, day)));
  const bars = createMemo(() => layoutAllDay(props.events, props.days));
  const lanes = () => bars().reduce((n, bar) => Math.max(n, bar.lane + 1), 0);
  const allDayH = () => Math.max(1, lanes()) * LANE_H + 3;
  const todayIndex = () => props.days.findIndex((day) => sameDay(day, props.now));

  // The grid is as wide as the window, whatever it's resized to: nothing to scroll across.
  createEffect(width, (w) => win.setContentSize(w, GRID_H));

  onSettled(() => {
    // Half an hour above, so the hour's own label shows.
    win.scrollTo(FIRST_HOUR * HOUR_H - HOUR_H / 2);
  });

  // --- Dragging ---------------------------------------------------------------

  function moveBy(event: CalendarEvent, days: number, minutes: number): CalendarEvent {
    const start = eventStart(event);
    const moved = addDays(start, days);
    moved.setMinutes(moved.getMinutes() + minutes);
    return moveEvent(event, moved);
  }

  /** Where a drag that started at (x0, y0) on screen is now, in whole days and snapped minutes. */
  const travel = (x0: number, y0: number, x: number, y: number) => ({
    days: Math.round((x - x0) / averageW()),
    minutes: Math.round(((y - y0) * 60) / HOUR_H / SNAP) * SNAP,
  });

  function finishDrag(): void {
    const done = drag();
    setDrag(null);
    if (!done) return;
    if (done.creating) props.actions.create(done.event);
    else props.actions.update(done.event);
  }

  // --- Pieces -----------------------------------------------------------------

  function DayHeader(p: { index: number }): JSX.Element {
    const day = () => props.days[p.index]!;
    const today = () => p.index === todayIndex();
    return (
      <box
        position="absolute"
        left={columnX(p.index)}
        top={0}
        width={columnW(p.index)}
        height={DAY_HEAD_H}
        flexDirection="row"
        justifyContent="center"
        alignItems="center"
        gap={3}
      >
        <text font="body" nowrap>{WEEKDAY_SHORT[day().getDay()]!}</text>
        <box
          paddingLeft={2}
          paddingRight={2}
          borderRadius={3}
          background={today() ? 1 : 0}
        >
          <text font="body" bold={today()} color={today() ? 0 : 1} nowrap>
            {String(day().getDate())}
          </text>
        </box>
      </box>
    );
  }

  function AllDayRow(): JSX.Element {
    const dayAt = (x: number) => Math.max(0, Math.min(count() - 1, Math.floor((x - GUTTER_W) / averageW())));
    const ghost = () => {
      const d = drag();
      return d?.event.allDay ? layoutAllDay([d.event], props.days) : [];
    };
    return (
      <box position="absolute" left={0} top={DAY_HEAD_H} width={width()} height={allDayH()}>
        <text position="absolute" left={0} top={1} width={GUTTER_W - 4} font="body" align="right" nowrap>
          all-day
        </text>
        <box
          position="absolute"
          left={GUTTER_W}
          top={0}
          width={width() - GUTTER_W}
          height={allDayH()}
          onClick={() => props.actions.select(null)}
          onDoubleClick={(x) => {
            const day = props.days[dayAt(x + GUTTER_W)]!;
            props.actions.create({
              id: newEventId(),
              title: NEW_TITLE,
              start: formatFloating(startOfDay(day)),
              end: formatFloating(addDays(startOfDay(day), 1)),
              allDay: true,
            });
          }}
        />
        <ColumnRules top={0} height={allDayH()} />
        <For each={bars().map((bar) => bar.event.id)}>
          {(id) => {
            const bar = () => bars().find((b) => b.event.id === id);
            let x0 = 0;
            return (
              <Show when={bar()}>
                {(b) => (
                  <EventBox
                    event={b().event}
                    left={columnX(b().first) + 2}
                    top={b().lane * LANE_H + 1}
                    width={columnX(b().last + 1) - columnX(b().first) - 3}
                    height={LANE_H - 1}
                    lines={1}
                    dimmed={drag()?.event.id === id}
                    onDragStart={(_x, _y, gx) => (x0 = gx)}
                    onDrag={(_x, _y, gx) => {
                      const days = travel(x0, 0, gx, 0).days;
                      setDrag({ event: moveBy(b().event, days, 0), creating: false });
                    }}
                    onDragEnd={finishDrag}
                  />
                )}
              </Show>
            );
          }}
        </For>
        <For each={ghost()}>
          {(b) => (
            <GhostBox
              left={columnX(b.first) + 2}
              top={b.lane * LANE_H + 1}
              width={columnX(b.last + 1) - columnX(b.first) - 3}
              height={LANE_H - 1}
              title={b.event.title}
            />
          )}
        </For>
      </box>
    );
  }

  /** The 1px rules down the left of every day, from `top` for `height`. */
  function ColumnRules(p: { top: number; height: number }): JSX.Element {
    return (
      <For each={props.days.map((_, i) => i)}>
        {(i) => <box position="absolute" left={columnX(i)} top={p.top} width={1} height={p.height} background={1} />}
      </For>
    );
  }

  /** An event drawn as a block: its title, and its times when it has the room. */
  function EventBox(p: {
    event: CalendarEvent;
    left: number;
    top: number;
    width: number;
    height: number;
    /** Lines of text the block has room for. */
    lines: number;
    time?: string;
    dimmed: boolean;
    /** Its bottom edge can be dragged: the event ends in this block. */
    resizable?: boolean;
    onDragStart: (x: number, y: number, gx: number, gy: number) => void;
    onDrag: (x: number, y: number, gx: number, gy: number) => void;
    onDragEnd: () => void;
    onResizeStart?: (gy: number) => void;
    onResize?: (gy: number) => void;
  }): JSX.Element {
    const selected = () => props.selected === p.event.id;
    const editing = () => props.editing === p.event.id;
    const ink = () => (selected() ? 0 : 1);
    /** A title wraps when the block has the lines for it and the width to break between words. */
    const wraps = () => p.lines > 1 && p.width >= WRAP_W;
    /** Inside the border, the colour bar and the padding either side of the text. */
    const textW = () => p.width - 2 - 2 - 3;
    /** The time goes under a title that fits on its line, or one that leaves it a line. */
    const showsTime = () =>
      !!p.time && p.lines > 1 && (p.lines > 2 || measureText(p.event.title, "body", { bold: true }) <= textW());
    const titleLines = () => Math.max(1, p.lines - (showsTime() ? 1 : 0));
    return (
      <box
        position="absolute"
        left={p.left}
        top={p.top}
        width={Math.max(4, p.width)}
        height={Math.max(4, p.height)}
        background={selected() ? 1 : p.dimmed ? "gray25" : 0}
        borderColor={1}
        borderWidth={1}
        borderRadius={2}
        overflow="hidden"
        flexDirection="row"
        semantic={{ name: `event:${p.event.title}`, role: "button", value: p.time ?? "all-day" }}
        onMouseDown={() => props.actions.select(p.event.id)}
        onDoubleClick={() => props.actions.edit(p.event.id)}
        onDragStart={p.onDragStart}
        onDrag={p.onDrag}
        onDragEnd={p.onDragEnd}
      >
        {/* Calendar's colour bar down the event's left edge. */}
        <box width={2} background={1} />
        <box flexGrow={1} paddingLeft={2} paddingRight={1} flexDirection="column" overflow="hidden">
          <Show
            when={editing()}
            fallback={
              // Cut at a whole line, so a long title never shows half a line of itself.
              <box maxHeight={titleLines() * BODY_H} overflow="hidden">
                <text font="body" bold color={ink()} wrap={wraps()} nowrap={!wraps()}>
                  {wraps() ? p.event.title : fit(p.event.title, textW(), true)}
                </text>
              </box>
            }
          >
            <TitleEditor event={p.event} width={Math.max(8, p.width - 6)} />
          </Show>
          <Show when={showsTime() && !editing()}>
            <text font="body" color={ink()} nowrap>{fit(p.time!, textW())}</text>
          </Show>
        </box>
        <Show when={p.resizable && p.height > RESIZE_EDGE * 2}>
          <box
            position="absolute"
            left={0}
            top={p.height - 2 - RESIZE_EDGE}
            width={p.width - 2}
            height={RESIZE_EDGE}
            onMouseDown={() => props.actions.select(p.event.id)}
            onDragStart={(_x, _y, _gx, gy) => p.onResizeStart?.(gy)}
            onDrag={(_x, _y, _gx, gy) => p.onResize?.(gy)}
            onDragEnd={p.onDragEnd}
          />
        </Show>
      </box>
    );
  }

  /** Where a dragged event would land: an outline, with its title. */
  function GhostBox(p: { left: number; top: number; width: number; height: number; title: string; time?: string }): JSX.Element {
    return (
      <box
        position="absolute"
        left={p.left}
        top={p.top}
        width={Math.max(4, p.width)}
        height={Math.max(4, p.height)}
        background={1}
        borderRadius={2}
        paddingLeft={4}
        overflow="hidden"
        flexDirection="column"
      >
        <text font="body" bold color={0} nowrap>{fit(p.title, p.width - 6, true)}</text>
        <Show when={p.time && p.height >= BODY_H * 2 + 2}>
          <text font="body" color={0} nowrap>{fit(p.time!, p.width - 6)}</text>
        </Show>
      </box>
    );
  }

  function TitleEditor(p: { event: CalendarEvent; width: number }): JSX.Element {
    const [draft, setDraft] = createSignal(p.event.title);
    let done = false;
    const commit = () => {
      if (done) return;
      done = true;
      const title = draft().trim() || NEW_TITLE;
      if (title !== p.event.title) props.actions.update({ ...p.event, title });
      props.actions.edit(null);
    };
    return (
      <TextInput
        name="event-title"
        value={draft()}
        onChange={setDraft}
        onSubmit={commit}
        onBlur={commit}
        onCancel={() => {
          done = true;
          props.actions.edit(null);
        }}
        borderless
        padding={0}
        verticalAlign="top"
        font="body"
        width={p.width}
        height={BODY_H}
        autoFocus
        selectAllOnFocus
      />
    );
  }

  /** When `event` starts, as an event block shows it; with `range`, when it ends too. */
  function eventTime(event: CalendarEvent, range = false): string {
    const start = formatTime(minuteOfDay(eventStart(event)), props.settings.hour24);
    return range ? `${start} – ${formatTime(minuteOfDay(eventEnd(event)), props.settings.hour24)}` : start;
  }

  /** Day `index`'s column: its shading, and what pressing in it makes. */
  function DayColumn(p: { index: number }): JSX.Element {
    const day = () => props.days[p.index]!;
    /** The snapped minute of `y` in the column, rounded down. */
    const snapped = (y: number) => Math.max(0, Math.min(MINUTES_PER_DAY - SNAP, Math.floor((y * 60) / HOUR_H / SNAP) * SNAP));
    let anchor = 0;
    const draw = (y: number) => {
      const at = snapped(y);
      const from = Math.min(anchor, at);
      const to = Math.max(anchor, at) + SNAP;
      setDrag({
        creating: true,
        event: { id: newEventId(), title: NEW_TITLE, start: formatFloating(atMinute(day(), from)), end: formatFloating(atMinute(day(), to)) },
      });
    };
    return (
      <box
        position="absolute"
        left={columnX(p.index)}
        top={0}
        width={columnW(p.index)}
        height={GRID_H}
        background={isWeekend(day()) ? WEEKEND : 0}
        semantic={{ name: `day:${formatFloating(day()).slice(0, 10)}`, role: "grid" }}
        onClick={() => props.actions.select(null)}
        onDoubleClick={(_x, y) => {
          const from = Math.min(MINUTES_PER_DAY - 60, Math.floor((y * 60) / HOUR_H / 30) * 30);
          props.actions.create({
            id: newEventId(),
            title: NEW_TITLE,
            start: formatFloating(atMinute(day(), from)),
            end: formatFloating(atMinute(day(), from + 60)),
          });
        }}
        onDragStart={(_x, y) => {
          anchor = snapped(y);
          props.actions.select(null);
          draw(y);
        }}
        onDrag={(_x, y) => draw(y)}
        onDragEnd={finishDrag}
      />
    );
  }

  /** Day `index`'s timed events. */
  function DayEvents(p: { index: number }): JSX.Element {
    const daySegments = () => segments()[p.index] ?? [];
    return (
      <For each={daySegments().map((s) => s.event.id)}>
        {(id) => {
          const segment = () => daySegments().find((s) => s.event.id === id);
          let x0 = 0;
          let y0 = 0;
          return (
            <Show when={segment()}>
              {(s) => {
                const slot = () => (columnW(p.index) - 3) / s().columns;
                const height = () => minuteY(s().bottom) - minuteY(s().top);
                return (
                  <EventBox
                    event={s().event}
                    left={columnX(p.index) + 2 + Math.round(s().column * slot())}
                    top={minuteY(s().top)}
                    width={Math.round((s().column + 1) * slot()) - Math.round(s().column * slot())}
                    height={Math.max(BODY_H + 2, height())}
                    lines={Math.floor((height() - 2) / BODY_H)}
                    time={eventTime(s().event)}
                    dimmed={drag()?.event.id === id}
                    resizable={!s().continuesAfter}
                    onDragStart={(_x, _y, gx, gy) => {
                      x0 = gx;
                      y0 = gy;
                    }}
                    onDrag={(_x, _y, gx, gy) => {
                      const t = travel(x0, y0, gx, gy);
                      setDrag({ event: moveBy(s().event, t.days, t.minutes), creating: false });
                    }}
                    onDragEnd={finishDrag}
                    onResizeStart={(gy) => (y0 = gy)}
                    onResize={(gy) => {
                      const event = s().event;
                      const start = eventStart(event);
                      const end = eventEnd(event);
                      end.setMinutes(end.getMinutes() + travel(0, y0, 0, gy).minutes);
                      // An event lasts at least one snap.
                      const least = new Date(start.getTime() + SNAP * 60_000);
                      setDrag({ event: { ...event, end: formatFloating(end < least ? least : end) }, creating: false });
                    }}
                  />
                );
              }}
            </Show>
          );
        }}
      </For>
    );
  }

  /** Where the dragged event would land, in each day it would touch. */
  function DragGhosts(): JSX.Element {
    const ghosts = () => {
      const d = drag();
      if (!d || d.event.allDay) return [];
      return props.days.flatMap((day, index) => layoutDay([d.event], day).map((s) => ({ s, index })));
    };
    return (
      <For each={ghosts()}>
        {(g) => (
          <GhostBox
            left={columnX(g.index) + 2}
            top={minuteY(g.s.top)}
            width={columnW(g.index) - 3}
            height={Math.max(BODY_H + 2, minuteY(g.s.bottom) - minuteY(g.s.top))}
            title={g.s.event.title}
            time={eventTime(g.s.event, true)}
          />
        )}
      </For>
    );
  }

  /** Now: a line across today, its time in the time column. */
  function NowLine(): JSX.Element {
    const minute = () => minuteOfDay(props.now);
    const y = () => minuteY(minute());
    return (
      <Show when={todayIndex() >= 0}>
        <box position="absolute" left={GUTTER_W} top={y()} width={width() - GUTTER_W} height={1} background="gray50" />
        <box position="absolute" left={columnX(todayIndex())} top={y() - 1} width={columnW(todayIndex())} height={2} background={1} />
        <box position="absolute" left={columnX(todayIndex()) - 2} top={y() - 3} width={6} height={6} borderRadius={3} background={1} />
        <box
          position="absolute"
          left={1}
          top={y() - Math.ceil(BODY_H / 2)}
          width={GUTTER_W - 5}
          height={BODY_H}
          background={1}
          borderRadius={2}
        >
          <text font="body" bold color={0} align="center" nowrap>
            {formatTime(minute(), props.settings.hour24).replace(/ ?[AP]M$/, "")}
          </text>
        </box>
      </Show>
    );
  }

  const hours = Array.from({ length: 23 }, (_, i) => i + 1);
  /** An hour's label gives way to the time of now when they would overlap. */
  const hourHidden = (hour: number) =>
    todayIndex() >= 0 && Math.abs(minuteY(minuteOfDay(props.now)) - hour * HOUR_H) < BODY_H;

  return (
    <>
      <WindowHeader height={props.toolbarHeight + DAY_HEAD_H + allDayH()}>
        <box width={width()} height={props.toolbarHeight + DAY_HEAD_H + allDayH()} background={0} flexDirection="column">
          {props.toolbar()}
          <box width={width()} height={DAY_HEAD_H + allDayH()}>
            <For each={props.days.map((_, i) => i)}>{(i) => <DayHeader index={i} />}</For>
            <box position="absolute" left={GUTTER_W} top={DAY_HEAD_H - 1} width={width() - GUTTER_W} height={1} background="gray50" />
            <AllDayRow />
          </box>
        </box>
      </WindowHeader>
      <box width={width()} height={GRID_H} background={0} semantic={{ name: "calendar-grid", role: "grid" }}>
        <For each={props.days.map((_, i) => i)}>{(i) => <DayColumn index={i} />}</For>
        <For each={hours}>
          {(hour) => (
            <>
              <box position="absolute" left={GUTTER_W - 3} top={hour * HOUR_H} width={width() - GUTTER_W + 3} height={1} background="gray50" />
              <Show when={!hourHidden(hour)}>
                <text
                  position="absolute"
                  left={0}
                  top={hour * HOUR_H - Math.ceil(BODY_H / 2)}
                  width={GUTTER_W - 5}
                  font="body"
                  align="right"
                  nowrap
                >
                  {formatHour(hour, props.settings.hour24)}
                </text>
              </Show>
            </>
          )}
        </For>
        <ColumnRules top={0} height={GRID_H} />
        <For each={props.days.map((_, i) => i)}>{(i) => <DayEvents index={i} />}</For>
        <DragGhosts />
        <NowLine />
      </box>
    </>
  );
}
