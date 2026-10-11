import type { JSX } from "@mockintosh/ui";
import { daysFrom } from "./dates";
import { TimeGrid } from "./TimeGrid";
import { weekOf, type ViewProps } from "./views";

/** Seven days from the start of the week holding `date`. */
export function WeekView(props: ViewProps): JSX.Element {
  const days = () => daysFrom(weekOf(props.date, props.settings), 7);
  return <TimeGrid {...props} days={days()} />;
}
