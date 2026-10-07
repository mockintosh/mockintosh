/**
 * Directions, in a panel down the left of the map: how to travel, where
 * from and where to, then the ways there to choose between — or, for the
 * chosen way, its steps.
 */
import { For, Show, TextInput, createMemo, fontLineHeight, measureText, spacedFontName } from "@mockintosh/sdk";
import type { JSX } from "@mockintosh/ui";
import { TRAVEL_MODES, formatArrival, formatDuration, formatRouteDistance, type Route, type TravelMode } from "./directions";
import { CloseBox, Icon, Panel, ScrollArea, fitted, wrapped } from "./ui";

export type Endpoint = "from" | "to";

const PAD = 6;
/** Chicago at the app content's 1px glyph spacing. */
const TITLE_FONT = spacedFontName("menu", 1);
const TEXT_FONT = "body";
const MODE_H = 18;
const ROW_H = 18;
const MARKER_W = 16;
const SWAP_W = 14;
/** Between route cards. */
const CARD_GAP = 4;

/** How far below the panel's top the From and To box ends: where their matches are listed. */
export function directionsFieldsBottom(): number {
  return 1 + PAD + fontLineHeight(TITLE_FONT) + PAD + MODE_H + PAD + ROW_H * 2 + 1 + 2;
}

export function DirectionsPanel(props: {
  left: number;
  top: number;
  width: number;
  height: number;
  mode: TravelMode;
  onMode: (mode: TravelMode) => void;
  fromText: string;
  toText: string;
  onText: (field: Endpoint, text: string) => void;
  onSubmit: (field: Endpoint, text: string) => void;
  onHistory: (field: Endpoint, delta: number) => void;
  onCancel: () => void;
  onSwap: () => void;
  onClose: () => void;
  routes: readonly Route[];
  routing: boolean;
  error: string | null;
  selected: number;
  onSelect: (index: number) => void;
  showSteps: boolean;
  onShowSteps: (show: boolean) => void;
  step: number;
  onStep: (index: number) => void;
  scroll: number;
  onScroll: (scroll: number) => void;
  /** The moment the routes are timed from, for when they arrive. */
  now: Date;
}): JSX.Element {
  const inner = () => props.width - 2 - PAD * 2;
  const titleH = fontLineHeight(TITLE_FONT);
  const textH = fontLineHeight(TEXT_FONT);
  const headerH = PAD + titleH + PAD;
  const waypointsH = ROW_H * 2 + 1 + 2;
  const listTop = () => headerH + MODE_H + PAD + waypointsH + PAD;
  const listView = () => Math.max(0, props.height - 2 - listTop());
  const listWidth = () => props.width - 2;
  const cardH = PAD + titleH + textH * 2 + PAD;

  /** What a route card says under its time. */
  const cardLines = (route: Route, index: number): [string, string] => {
    const first = `ETA ${formatArrival(props.now, route.duration)} · ${formatRouteDistance(route.distance)}`;
    const second = [index === 0 ? "Fastest" : route.via ? `via ${route.via}` : "", route.tolls ? "Tolls" : ""].filter(Boolean).join(" · ");
    const width = inner() - 8 - 16;
    return [fitted(first, width, TEXT_FONT), fitted(second, width, TEXT_FONT)];
  };

  // The steps, laid out ahead so the list knows its height.
  const steps = createMemo(() => {
    const route = props.routes[props.selected];
    const width = inner() - 4;
    const rows: { lines: string[]; distance: string; ownLine: boolean; top: number; height: number }[] = [];
    let top = ROW_H + 1;
    for (const [index, item] of (route?.steps ?? []).entries()) {
      const lines = wrapped(item.text, width, TEXT_FONT);
      const distance = index === route!.steps.length - 1 ? "" : formatRouteDistance(item.distance);
      const room = width - measureText(lines.at(-1) ?? "", TEXT_FONT) - 6;
      const ownLine = distance !== "" && measureText(distance, TEXT_FONT) > room;
      const height = (lines.length + (ownLine ? 1 : 0)) * textH + PAD;
      rows.push({ lines, distance, ownLine, top, height });
      top += height;
    }
    return { rows, height: top };
  });
  const message = () => wrapped(props.error ?? (props.routing ? "Finding the way…" : "Choose where to start and where to go."), inner(), TEXT_FONT);
  const listHeight = () =>
    props.showSteps && props.routes[props.selected]
      ? steps().height
      : props.routes.length > 0
        ? props.routes.length * (cardH + CARD_GAP)
        : PAD + message().length * textH;

  const field = (endpoint: Endpoint) => (
    <box height={ROW_H} flexDirection="row" alignItems="center">
      <box width={MARKER_W} alignItems="center">
        <Icon name={endpoint === "from" ? "maps/start" : "maps/end"} />
      </box>
      <TextInput
        name={`maps-${endpoint}`}
        value={endpoint === "from" ? props.fromText : props.toText}
        onChange={(text) => props.onText(endpoint, text)}
        onSubmit={(text) => props.onSubmit(endpoint, text)}
        onHistory={(delta) => props.onHistory(endpoint, delta)}
        onCancel={props.onCancel}
        placeholder={endpoint === "from" ? "Start" : "End"}
        font={TEXT_FONT}
        width={inner() - 2 - MARKER_W - SWAP_W}
        padding={1}
        borderless
        selectAllOnFocus
        autoFocus={endpoint === "from" && !props.fromText}
      />
    </box>
  );

  return (
    <Panel name="maps-directions-panel" left={props.left} top={props.top} width={props.width} height={props.height}>
      <box height={headerH} paddingLeft={PAD} justifyContent="center">
        <text font={TITLE_FONT} nowrap>
          Directions
        </text>
      </box>
      <CloseBox name="maps-directions-close" left={props.width - 2 - PAD - 11} top={PAD + ((titleH - 11) >> 1)} onClick={props.onClose} />

      {/* How to travel: a segment each, the chosen one black. */}
      <box marginLeft={PAD} width={inner()} height={MODE_H} flexDirection="row" borderWidth={1} borderColor={1}>
        <For each={TRAVEL_MODES}>
          {(option, index) => (
            <box
              flexGrow={1}
              flexBasis={0}
              height={MODE_H - 2}
              alignItems="center"
              justifyContent="center"
              background={props.mode === option.mode ? 1 : 0}
              cursor="pointer"
              semantic={{ name: `maps-mode-${option.mode}`, role: "button", value: option.label }}
              onClick={() => props.onMode(option.mode)}
            >
              <Show when={index() > 0}>
                <box position="absolute" left={0} top={0} width={1} height={MODE_H - 2} background={1} />
              </Show>
              <Icon name={props.mode === option.mode ? `maps/${option.mode}-selected` : `maps/${option.mode}`} />
            </box>
          )}
        </For>
      </box>

      {/* Where from and where to, and a button to swap them. */}
      <box marginLeft={PAD} marginTop={PAD} width={inner()} height={waypointsH} borderWidth={1} borderColor={1} flexDirection="column">
        {field("from")}
        <box marginLeft={MARKER_W} width={inner() - 2 - MARKER_W - SWAP_W} height={1} background={1} />
        {field("to")}
        <box
          position="absolute"
          left={inner() - 2 - SWAP_W}
          top={0}
          width={SWAP_W}
          height={waypointsH - 2}
          alignItems="center"
          justifyContent="center"
          cursor="pointer"
          semantic={{ name: "maps-swap", role: "button" }}
          onClick={props.onSwap}
        >
          <Icon name="maps/swap" />
        </box>
      </box>

      <box marginTop={PAD} width={listWidth()} height={listView()}>
        <ScrollArea name="maps-route-list" width={listWidth()} view={listView()} height={listHeight()} scroll={props.scroll} onScroll={props.onScroll}>
          <Show
            when={props.showSteps && props.routes[props.selected]}
            fallback={
              <Show
                when={props.routes.length > 0}
                fallback={
                  <box flexDirection="column" paddingLeft={PAD} paddingTop={PAD}>
                    <For each={message()}>{(line) => <text font={TEXT_FONT} nowrap>{line}</text>}</For>
                  </box>
                }
              >
                <For each={props.routes}>
                  {(route, index) => {
                    const chosen = () => index() === props.selected;
                    const lines = () => cardLines(route, index());
                    return (
                      <box
                        position="absolute"
                        left={PAD}
                        top={index() * (cardH + CARD_GAP)}
                        width={inner() - 4}
                        height={cardH}
                        borderWidth={1}
                        borderColor={1}
                        background={chosen() ? 1 : 0}
                        paddingLeft={PAD}
                        paddingTop={PAD - 1}
                        flexDirection="column"
                        cursor="pointer"
                        semantic={{ name: `maps-route-${index()}`, role: "button", value: formatDuration(route.duration) }}
                        onClick={() => (chosen() ? props.onShowSteps(true) : props.onSelect(index()))}
                      >
                        <text font={TITLE_FONT} nowrap color={chosen() ? 0 : 1}>
                          {formatDuration(route.duration)}
                        </text>
                        <text font={TEXT_FONT} nowrap color={chosen() ? 0 : 1}>
                          {lines()[0]}
                        </text>
                        <text font={TEXT_FONT} nowrap color={chosen() ? 0 : 1}>
                          {lines()[1]}
                        </text>
                        <box
                          position="absolute"
                          left={inner() - 4 - 2 - PAD - 11}
                          top={((cardH - 2) >> 1) - 5}
                          cursor="pointer"
                          semantic={{ name: `maps-route-${index()}-steps`, role: "button" }}
                          onClick={() => {
                            props.onSelect(index());
                            props.onShowSteps(true);
                          }}
                        >
                          <Icon name={chosen() ? "maps/info-selected" : "maps/info"} />
                        </box>
                      </box>
                    );
                  }}
                </For>
              </Show>
            }
          >
            <box
              height={ROW_H}
              paddingLeft={PAD}
              flexDirection="row"
              alignItems="center"
              gap={4}
              cursor="pointer"
              semantic={{ name: "maps-routes-back", role: "button" }}
              onClick={() => props.onShowSteps(false)}
            >
              <Icon name="maps/back" />
              <text font={TEXT_FONT} nowrap>
                {`${formatDuration(props.routes[props.selected]!.duration)} · ${formatRouteDistance(props.routes[props.selected]!.distance)}`}
              </text>
            </box>
            <box width={listWidth()} height={1} background={1} />
            <For each={steps().rows}>
              {(row, index) => (
                <box
                  position="absolute"
                  left={0}
                  top={row.top}
                  width={listWidth() - 4}
                  height={row.height}
                  paddingLeft={PAD}
                  paddingTop={PAD >> 1}
                  flexDirection="column"
                  background={props.step === index() ? 1 : 0}
                  cursor="pointer"
                  semantic={{ name: `maps-step-${index()}`, role: "button", value: props.routes[props.selected]?.steps[index()]?.text }}
                  onClick={() => props.onStep(index())}
                >
                  <For each={row.lines}>{(line) => <text font={TEXT_FONT} nowrap color={props.step === index() ? 0 : 1}>{line}</text>}</For>
                  <Show when={row.distance}>
                    <text
                      position="absolute"
                      left={PAD}
                      top={(PAD >> 1) + (row.lines.length - (row.ownLine ? 0 : 1)) * textH}
                      width={inner() - 4}
                      font={TEXT_FONT}
                      align="right"
                      nowrap
                      color={props.step === index() ? 0 : 1}
                    >
                      {row.distance}
                    </text>
                  </Show>
                </box>
              )}
            </For>
          </Show>
        </ScrollArea>
      </box>
    </Panel>
  );
}
