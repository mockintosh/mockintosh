/**
 * What the views draw alike: the weekend shading, titles cut to fit, the
 * in-place title editor, and today's date in its pill.
 */
import { createSignal } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { TextInput, fontLineHeight, measureText } from "@mockintosh/ui";
import { addDays } from "./dates";
import { type CalendarEvent, eventStart, moveEvent } from "./events";
import type { CalendarActions } from "./views";

export const NEW_TITLE = "New Event";

export const BODY_H = fontLineHeight("body");

/** Weekends are shaded with this pattern, a dot in every 4×4. */
export const WEEKEND = new Uint8Array([0x88, 0, 0x22, 0, 0x88, 0, 0x22, 0]);

/** `text` cut with an ellipsis to fit `width` pixels, measured as drawn (`bold` is wider). */
export function fit(text: string, width: number, bold = false): string {
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

/** `event` moved by whole days and then minutes. */
export function moveBy(event: CalendarEvent, days: number, minutes = 0): CalendarEvent {
  const moved = addDays(eventStart(event), days);
  moved.setMinutes(moved.getMinutes() + minutes);
  return moveEvent(event, moved);
}

/** An event's title, typed over in place. Return or a click elsewhere keeps it; Escape doesn't. */
export function TitleEditor(props: { event: CalendarEvent; width: number; actions: CalendarActions }): JSX.Element {
  const [draft, setDraft] = createSignal(props.event.title);
  let done = false;
  const commit = () => {
    if (done) return;
    done = true;
    const title = draft().trim() || NEW_TITLE;
    if (title !== props.event.title) props.actions.update({ ...props.event, title });
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
      width={props.width}
      height={BODY_H}
      autoFocus
      selectAllOnFocus
    />
  );
}

/** A day's number, inverted in a rounded pill when it is today. */
export function DayNumber(props: { label: string; today: boolean; dimmed?: boolean }): JSX.Element {
  return (
    <box paddingLeft={2} paddingRight={2} borderRadius={3} background={props.today ? 1 : 0}>
      <text font="body" bold={props.today} color={props.today ? 0 : 1} stipple={props.dimmed && !props.today} nowrap>
        {props.label}
      </text>
    </box>
  );
}
