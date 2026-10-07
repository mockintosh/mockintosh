/**
 * A place's info, in a panel over the map: its name and what it is, a
 * Directions button, and what OpenStreetMap knows about it — the address,
 * opening hours, phone, website and what's good to know.
 */
import { Button, For, Show, createMemo, createSignal, fontLineHeight, spacedFontName } from "@mockintosh/sdk";
import type { JSX } from "@mockintosh/ui";
import type { PlaceDetails } from "./search";
import { CloseBox, Panel, ScrollArea, wrapped } from "./ui";

/** The place the info is about; `details` once looked up. */
export interface PlaceInfoState {
  name: string;
  /** "Golf course". */
  kind: string;
  lat: number;
  lon: number;
  details: PlaceDetails | null;
  /** Still looking the details up. */
  loading: boolean;
}

const PAD = 6;
const BUTTON_H = 18;
const BUTTON_ROW = BUTTON_H + 8;
/** Chicago at the app content's 1px glyph spacing. */
const TITLE_FONT = spacedFontName("menu", 1);
const TEXT_FONT = "body";
const VALUE_FONT = "geneva12";

/** "golf_course" → "Golf course". */
export function kindLabel(kind: string): string {
  const words = kind.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

interface Section {
  label: string;
  lines: string[];
}

export function PlaceInfo(props: {
  place: PlaceInfoState;
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  onClose: () => void;
  onDirections: () => void;
  onWebsite: (url: string) => void;
}): JSX.Element {
  const [scroll, setScroll] = createSignal(0);
  const inner = () => props.width - 2 - PAD * 2 - 4;
  const titleH = fontLineHeight(TITLE_FONT);
  const textH = fontLineHeight(TEXT_FONT);
  const valueH = fontLineHeight(VALUE_FONT);

  const layout = createMemo(() => {
    const place = props.place;
    const details = place.details;
    const title = wrapped(place.name, inner() - 14, TITLE_FONT);
    const subtitle = wrapped([place.kind, details?.locality].filter(Boolean).join(" · "), inner(), TEXT_FONT);
    const sections: Section[] = [];
    const add = (label: string, values: readonly string[] | undefined) => {
      const lines = (values ?? []).flatMap((value) => wrapped(value, inner(), VALUE_FONT));
      if (lines.length) sections.push({ label, lines });
    };
    if (place.loading) add("Details", ["Looking them up…"]);
    add("Address", details?.address ? [details.address] : undefined);
    add("Hours", details?.hours);
    add("Phone", details?.phone ? [details.phone] : undefined);
    add("Website", details?.website ? [details.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")] : undefined);
    add("Cuisine", details?.cuisine ? [details.cuisine] : undefined);
    add("Good to Know", details?.goodToKnow);
    add("Coordinates", [`${place.lat.toFixed(5)}, ${place.lon.toFixed(5)}`]);
    const sectionH = (s: Section) => 1 + 4 + textH + s.lines.length * valueH + 5;
    const height = PAD + title.length * titleH + subtitle.length * textH + BUTTON_ROW + sections.reduce((sum, s) => sum + sectionH(s), 0) + PAD;
    return { title, subtitle, sections, height };
  });
  const view = () => Math.min(layout().height, props.maxHeight - 2);

  return (
    <Panel name="maps-place" left={props.left} top={props.top} width={props.width} height={view() + 2}>
      <ScrollArea name="maps-place-info" width={props.width - 2} view={view()} height={layout().height} scroll={scroll()} onScroll={setScroll}>
        <box flexDirection="column" paddingLeft={PAD} paddingRight={PAD + 4} paddingTop={PAD}>
          <For each={layout().title}>{(line) => <text font={TITLE_FONT} nowrap>{line}</text>}</For>
          <For each={layout().subtitle}>{(line) => <text font={TEXT_FONT} nowrap>{line}</text>}</For>
          <box height={BUTTON_ROW} flexDirection="row" alignItems="center" gap={8}>
            <Button name="maps-place-directions" label="Directions" height={BUTTON_H} onClick={props.onDirections} />
            <Show when={props.place.details?.website}>
              {(url) => <Button name="maps-place-website" label="Website" height={BUTTON_H} onClick={() => props.onWebsite(url())} />}
            </Show>
          </box>
          <For each={layout().sections}>
            {(section) => (
              <box flexDirection="column" paddingBottom={5}>
                <box width={inner()} height={1} marginBottom={4} background={1} />
                <text font={TEXT_FONT} nowrap>{section.label}</text>
                <For each={section.lines}>{(line) => <text font={VALUE_FONT} nowrap>{line}</text>}</For>
              </box>
            )}
          </For>
        </box>
      </ScrollArea>
      <CloseBox name="maps-place-close" left={props.width - 2 - PAD - 11} top={PAD} onClick={props.onClose} />
    </Panel>
  );
}
