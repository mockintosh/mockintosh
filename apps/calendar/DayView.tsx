import type { JSX } from "@mockintosh/ui";
import { startOfDay } from "./dates";
import { TimeGrid } from "./TimeGrid";
import type { ViewProps } from "./views";

/** One day down the hours: the Week view's grid with a single column. */
export function DayView(props: ViewProps): JSX.Element {
  return <TimeGrid {...props} days={[startOfDay(props.date)]} />;
}
