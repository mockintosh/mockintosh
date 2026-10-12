/**
 * The twelve months as small calendars, as many to a row as the window has
 * room for. Days with events are bold; today is in its pill and the chosen
 * day is boxed. Click a day to choose it, double-click it to open it, and
 * click a month's name to open the month.
 */
import { For, createEffect, createMemo, onSettled } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { WindowHeader, useApp } from "@mockintosh/sdk";
import { MONTH_NAMES, WEEKDAY_SHORT, dayKey, daysFrom, monthWeeks, sameDay } from "./dates";
import { busyDays } from "./events";
import { BODY_H } from "./shared";
import type { ViewProps } from "./views";

const CELL_W = 18;
const CELL_H = BODY_H;
const MONTH_W = 7 * CELL_W;
const TITLE_H = 16;
/** A month: its name, the weekdays' initials, and six weeks, so the rows line up. */
const MONTH_H = TITLE_H + CELL_H + 6 * CELL_H;
const GAP_X = 12;
const GAP_Y = 10;
const PAD = 8;

export function YearView(props: ViewProps): JSX.Element {
  const app = useApp();
  const win = app.window;
  const width = () => win.width();
  const year = () => props.date.getFullYear();

  const columns = () => Math.max(1, Math.min(4, Math.floor((width() - 2 * PAD + GAP_X) / (MONTH_W + GAP_X))));
  const rows = () => Math.ceil(12 / columns());
  /** The months share the width left over between them. */
  const gapX = () => (columns() > 1 ? Math.floor((width() - 2 * PAD - columns() * MONTH_W) / (columns() - 1)) : 0);
  const left = () => (columns() > 1 ? PAD : Math.floor((width() - MONTH_W) / 2));
  const contentH = () => Math.max(win.height(), 2 * PAD + rows() * MONTH_H + (rows() - 1) * GAP_Y);
  const busy = createMemo(() => busyDays(props.events));

  createEffect(
    () => [width(), contentH()] as const,
    ([w, h]) => win.setContentSize(w, h),
  );
  onSettled(() => win.scrollTo(0));

  function Month(p: { month: number }): JSX.Element {
    const first = () => new Date(year(), p.month, 1);
    const weeks = createMemo(() => monthWeeks(first(), props.settings.weekStart));
    const days = createMemo(() => daysFrom(weeks().first, 42));
    const x = () => left() + (p.month % columns()) * (MONTH_W + gapX());
    const y = () => PAD + Math.floor(p.month / columns()) * (MONTH_H + GAP_Y);
    return (
      <box
        position="absolute"
        left={x()}
        top={y()}
        width={MONTH_W}
        height={MONTH_H}
        semantic={{ name: `month:${MONTH_NAMES[p.month]}`, role: "grid" }}
      >
        <text
          position="absolute"
          left={2}
          top={0}
          font="menu"
          spacing={1}
          nowrap
          onClick={() => props.actions.show("month", first())}
        >
          {MONTH_NAMES[p.month]!}
        </text>
        <For each={[0, 1, 2, 3, 4, 5, 6]}>
          {(i) => (
            <text position="absolute" left={i * CELL_W} top={TITLE_H} width={CELL_W} font="body" align="center" nowrap>
              {WEEKDAY_SHORT[(props.settings.weekStart + i) % 7]!.slice(0, 1)}
            </text>
          )}
        </For>
        <For each={days().map((_, i) => i)}>
          {(i) => {
            const day = () => days()[i]!;
            const shown = () => day().getMonth() === p.month;
            const today = () => sameDay(day(), props.now);
            const chosen = () => sameDay(day(), props.date) && !today();
            return (
              <box
                position="absolute"
                left={(i % 7) * CELL_W}
                top={TITLE_H + CELL_H + Math.floor(i / 7) * CELL_H}
                width={CELL_W}
                height={CELL_H}
                background={today() && shown() ? 1 : 0}
                borderColor={chosen() && shown() ? 1 : undefined}
                borderWidth={chosen() && shown() ? 1 : 0}
                borderRadius={today() && shown() ? 3 : 0}
                onClick={shown() ? () => props.actions.focus(day()) : undefined}
                onDoubleClick={shown() ? () => props.actions.show("day", day()) : undefined}
              >
                {shown() ? (
                  <text
                    font="body"
                    bold={busy().has(dayKey(day())) || today()}
                    color={today() ? 0 : 1}
                    background={today() ? 1 : 0}
                    align="center"
                    nowrap
                    alignSelf="center"
                  >
                    {String(day().getDate())}
                  </text>
                ) : null}
              </box>
            );
          }}
        </For>
      </box>
    );
  }

  return (
    <>
      <WindowHeader height={props.toolbarHeight}>
        <box width={width()} height={props.toolbarHeight} background={0}>
          {props.toolbar()}
        </box>
      </WindowHeader>
      <box width={width()} height={contentH()} background={0} semantic={{ name: "calendar-year", role: "grid" }}>
        <For each={Array.from({ length: 12 }, (_, m) => m)}>{(m) => <Month month={m} />}</For>
      </box>
    </>
  );
}
