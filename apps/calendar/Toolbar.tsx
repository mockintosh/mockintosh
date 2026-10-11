/**
 * The bar across the top of the calendar: the period's title, the view
 * switcher, and Previous / Today / Next.
 */
import { For, createSignal } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import type { Sprite } from "@mockintosh/sdk";
import type { CalendarView, ViewKind } from "./views";

export const TOOLBAR_H = 22;
const SEGMENT_H = 15;

interface Segment {
  /** Its name; drawn unless there's a sprite. */
  label: string;
  sprite?: Sprite;
  selected?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

/** One rounded control split into segments, as a Mac segmented control: the selected one inverted. */
function Segmented(props: { name: string; segments: readonly Segment[] }): JSX.Element {
  const [pressed, setPressed] = createSignal(-1);
  return (
    <box
      semantic={{ name: props.name, role: "group" }}
      flexDirection="row"
      height={SEGMENT_H}
      borderColor={1}
      borderWidth={1}
      borderRadius={4}
      overflow="hidden"
    >
      <For each={props.segments.map((_, i) => i)}>
        {(i) => {
          const segment = () => props.segments[i]!;
          const inverted = () => !segment().disabled && (!!segment().selected !== (pressed() === i));
          const sprite = () => segment().sprite;
          return (
            <>
              {i > 0 ? <box width={1} background={1} /> : null}
              <box
                semantic={{ name: `${props.name}:${segment().label}`, role: "button", value: String(!!segment().selected), enabled: !segment().disabled }}
                paddingLeft={6}
                paddingRight={6}
                flexDirection="row"
                alignItems="center"
                background={inverted() ? 1 : 0}
                onMouseDown={() => !segment().disabled && setPressed(i)}
                onMouseUp={() => setPressed(-1)}
                onClick={() => !segment().disabled && segment().onClick()}
              >
                {sprite() ? (
                  <image src={sprite()!} mode={inverted() ? "inverted" : "normal"} />
                ) : (
                  <text font="body" color={inverted() ? 0 : 1} stipple={segment().disabled} nowrap>
                    {segment().label}
                  </text>
                )}
              </box>
            </>
          );
        }}
      </For>
    </box>
  );
}

/**
 * Drawn in the window's header band, outside the app's own context, so it
 * takes its sprites rather than looking them up.
 */
export function Toolbar(props: {
  width: number;
  sprites: { previous: Sprite; next: Sprite };
  title: string;
  views: readonly CalendarView[];
  view: ViewKind;
  onView: (kind: ViewKind) => void;
  onStep: (direction: -1 | 1) => void;
  onToday: () => void;
}): JSX.Element {
  return (
    <box
      width={props.width}
      height={TOOLBAR_H}
      paddingLeft={6}
      paddingRight={6}
      flexDirection="row"
      alignItems="center"
      gap={8}
      // Clicking a button leaves the keys with the calendar, for the arrows and Delete.
      keepsFocus
      semantic={{ name: "calendar-toolbar", role: "toolbar" }}
    >
      <box flexGrow={1} flexShrink={1} overflow="hidden">
        <text font="menu" spacing={1} nowrap semantic={{ name: "calendar-title", role: "heading" }}>
          {props.title}
        </text>
      </box>
      <Segmented
        name="calendar-view"
        segments={props.views.map((view) => ({
          label: view.label,
          selected: view.kind === props.view,
          onClick: () => props.onView(view.kind),
        }))}
      />
      <Segmented
        name="calendar-go"
        segments={[
          { label: "Previous", sprite: props.sprites.previous, onClick: () => props.onStep(-1) },
          { label: "Today", onClick: props.onToday },
          { label: "Next", sprite: props.sprites.next, onClick: () => props.onStep(1) },
        ]}
      />
    </box>
  );
}
