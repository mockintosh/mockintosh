import { For, Show, measureText, type Sprite } from "@mockintosh/sdk";
import { TextInput, createPress, type JSX } from "@mockintosh/ui";
import { dimmed, lockIcon, plusIcon } from "./icons";
import type { SiteBookmark } from "./page";

export const TOOLBAR_H = 24;
export const TAB_BAR_H = 17;
/** Toolbar, rule, tab bar, and the header band's own bottom rule. */
export const HEADER_H = TOOLBAR_H + 1 + TAB_BAR_H + 1;
const FACE_H = 18;
const TAB_FONT = "body";
const CELL_W = 20;
const ARROW_W = 23;
const LOCK_GAP = 3;
/** Outer widths, frames included and shadows not. */
export const BACK_FORWARD_W = ARROW_W * 2 + 3;
export const TOOLBAR_BUTTON_W = FACE_H + 2;

interface FaceProps {
  name: string;
  icon: Sprite;
  onClick: () => void;
  disabled?: boolean;
  width: number;
  height: number;
}

/** An icon on a white face that goes black while pressed. The caller draws the frame. */
function IconFace(props: FaceProps): JSX.Element {
  const press = createPress(props);
  const icon = () => (props.disabled ? dimmed(props.icon) : props.icon);
  return (
    <box
      {...press.rootProps()}
      width={props.width}
      height={props.height}
      background={press.pressed() ? 1 : 0}
      justifyContent="center"
      alignItems="center"
    >
      <image src={icon()} width={props.icon.width} height={props.icon.height} mode={press.pressed() ? "inverted" : "normal"} />
    </box>
  );
}

export interface ToolbarButtonProps {
  name: string;
  icon: Sprite;
  onClick: () => void;
  disabled?: boolean;
}

/** A framed toolbar button with a drop shadow. */
export function ToolbarButton(props: ToolbarButtonProps): JSX.Element {
  return (
    <box borderWidth={1} borderColor={1} shadow>
      <IconFace {...props} width={FACE_H} height={FACE_H - 2} />
    </box>
  );
}

export interface BackForwardProps {
  back: ToolbarButtonProps;
  forward: ToolbarButtonProps;
}

/** Back and Forward share one frame, split down the middle. */
export function BackForward(props: BackForwardProps): JSX.Element {
  return (
    <box borderWidth={1} borderColor={1} shadow flexDirection="row">
      <IconFace {...props.back} width={ARROW_W} height={FACE_H - 2} />
      <box width={1} background={1} />
      <IconFace {...props.forward} width={ARROW_W} height={FACE_H - 2} />
    </box>
  );
}

export interface AddressFieldProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  secure: boolean;
  width: number;
}

/** The address field: a lock for `https` pages, then the address. */
export function AddressField(props: AddressFieldProps): JSX.Element {
  const lockW = () => (props.secure ? lockIcon.width + LOCK_GAP : 0);
  return (
    <box width={props.width} height={FACE_H} borderWidth={1} borderColor={1} shadow flexDirection="row" alignItems="center" paddingLeft={3} gap={LOCK_GAP}>
      <Show when={props.secure}>
        <image src={lockIcon} width={lockIcon.width} height={lockIcon.height} />
      </Show>
      <TextInput
        name="safari-address"
        value={props.value}
        onChange={props.onChange}
        onSubmit={() => props.onSubmit()}
        placeholder="Search or enter website name"
        font={TAB_FONT}
        width={Math.max(20, props.width - 5 - lockW())}
        padding={1}
        borderless
        selectAllOnFocus
      />
    </box>
  );
}

/** One tab in the bar, as the bar draws it. */
export interface TabLabel {
  id: number;
  label: string;
}

export interface TabBarProps {
  width: number;
  bookmarks: readonly SiteBookmark[];
  tabs: readonly TabLabel[];
  activeId: number;
  onBookmark: (bookmark: SiteBookmark) => void;
  onSelect: (id: number) => void;
  onNewTab: () => void;
}

/** `text` cut to fit `width`, ending in an ellipsis when it had to be cut. */
function fitted(text: string, width: number): string {
  if (measureText(text, TAB_FONT) <= width) return text;
  let cut = text;
  while (cut.length > 0 && measureText(`${cut}…`, TAB_FONT) > width) cut = cut.slice(0, -1);
  return cut ? `${cut.trimEnd()}…` : "";
}

function TabCell(props: { tab: TabLabel; active: boolean; width: number; onSelect: (id: number) => void }): JSX.Element {
  const press = createPress({ name: `safari-tab:${props.tab.id}`, onClick: () => props.onSelect(props.tab.id) });
  const dark = () => props.active || press.pressed();
  return (
    <box
      {...press.rootProps()}
      width={props.width}
      height={TAB_BAR_H}
      background={dark() ? 1 : 0}
      justifyContent="center"
      alignItems="center"
      overflow="hidden"
    >
      <text font={TAB_FONT} color={dark() ? 0 : 1} nowrap>{fitted(props.tab.label, props.width - 8)}</text>
    </box>
  );
}

/** Bookmark buttons on the left, the tabs sharing what's left, and a new-tab button. */
export function TabBar(props: TabBarProps): JSX.Element {
  const tabsWidth = () => props.width - props.bookmarks.length * (CELL_W + 1) - (CELL_W + 1);
  /** Tabs split the width evenly; the rounding goes to the first ones. */
  const tabWidth = (index: number) => {
    const count = props.tabs.length;
    const room = tabsWidth() - (count - 1);
    return Math.floor(room / count) + (index < room % count ? 1 : 0);
  };
  return (
    <box width={props.width} height={TAB_BAR_H} flexDirection="row">
      <For each={props.bookmarks}>
        {(bookmark) => (
          <>
            <IconFace name={`safari-bookmark:${bookmark.title}`} icon={bookmark.icon} onClick={() => props.onBookmark(bookmark)} width={CELL_W} height={TAB_BAR_H} />
            <box width={1} background={1} />
          </>
        )}
      </For>
      <For each={props.tabs}>
        {(tab, index) => (
          <>
            <Show when={index() > 0}>
              <box width={1} background={1} />
            </Show>
            <TabCell tab={tab} active={tab.id === props.activeId} width={tabWidth(index())} onSelect={props.onSelect} />
          </>
        )}
      </For>
      <box width={1} background={1} />
      <IconFace name="safari-new-tab" icon={plusIcon} onClick={props.onNewTab} width={CELL_W} height={TAB_BAR_H} />
    </box>
  );
}
