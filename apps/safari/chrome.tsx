import { For, Show, createSignal, measureText, type Sprite } from "@mockintosh/sdk";
import { TextInput, createPress, type JSX } from "@mockintosh/ui";
import { closeIcon, dimmed, lockIcon } from "./icons";

export const TOOLBAR_H = 24;
export const TAB_BAR_H = 17;
/** Toolbar and the header band's own bottom rule (no tab bar). */
export const TOOLBAR_HEADER_H = TOOLBAR_H + 1;
/** Toolbar, rule, tab bar, and the header band's own bottom rule. */
export const HEADER_H = TOOLBAR_H + 1 + TAB_BAR_H + 1;
const FACE_H = 18;
const TAB_FONT = "body";
const ARROW_W = 23;
const LOCK_GAP = 3;
const CLOSE_W = 13;
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
  /** How far the page in front has loaded, 0 to 1; null when it isn't loading. */
  progress: number | null;
}

/** Height of the loading bar along the field's bottom edge. */
const PROGRESS_H = 2;

/** The address field: a lock for `https` pages, then the address, and a bar along its foot while the page loads, as Safari's fills. */
export function AddressField(props: AddressFieldProps): JSX.Element {
  const lockW = () => (props.secure ? lockIcon.width + LOCK_GAP : 0);
  const fill = () => (props.progress === null ? 0 : Math.round(props.progress * (props.width - 2)));
  return (
    <box width={props.width} height={FACE_H} borderWidth={1} borderColor={1} shadow flexDirection="row" alignItems="center" paddingLeft={3} gap={LOCK_GAP} position="relative">
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
      <Show when={props.progress !== null}>
        <box
          semantic={{ name: "safari-progress", role: "progressbar", value: String(props.progress ?? 0) }}
          position="absolute"
          left={0}
          bottom={0}
          width={fill()}
          height={PROGRESS_H}
          background={1}
        />
      </Show>
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
  tabs: readonly TabLabel[];
  activeId: number;
  onSelect: (id: number) => void;
  onClose: (id: number) => void;
}

/** `text` cut to fit `width`, ending in an ellipsis when it had to be cut. */
function fitted(text: string, width: number): string {
  if (measureText(text, TAB_FONT) <= width) return text;
  let cut = text;
  while (cut.length > 0 && measureText(`${cut}…`, TAB_FONT) > width) cut = cut.slice(0, -1);
  return cut ? `${cut.trimEnd()}…` : "";
}

function TabCell(props: {
  tab: TabLabel;
  active: boolean;
  width: number;
  onSelect: (id: number) => void;
  onClose: (id: number) => void;
}): JSX.Element {
  const [hovered, setHovered] = createSignal(false);
  const select = createPress({ name: `safari-tab:${props.tab.id}`, onClick: () => props.onSelect(props.tab.id) });
  const close = createPress({ name: `safari-tab-close:${props.tab.id}`, onClick: () => props.onClose(props.tab.id) });
  const dark = () => props.active || select.pressed();
  const closeDark = () => (close.pressed() ? !dark() : dark());
  return (
    <box
      width={props.width}
      height={TAB_BAR_H}
      background={dark() ? 1 : 0}
      overflow="hidden"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <box
        {...select.rootProps()}
        width={props.width}
        height={TAB_BAR_H}
        justifyContent="center"
        alignItems="center"
        overflow="hidden"
      >
        <text font={TAB_FONT} color={dark() ? 0 : 1} nowrap>{fitted(props.tab.label, props.width - 8)}</text>
      </box>
      <Show when={hovered()}>
        <box
          {...close.rootProps()}
          position="absolute"
          left={0}
          top={0}
          width={CLOSE_W}
          height={TAB_BAR_H}
          background={closeDark() ? 1 : 0}
          justifyContent="center"
          alignItems="center"
        >
          <image
            src={closeIcon}
            width={closeIcon.width}
            height={closeIcon.height}
            mode={closeDark() ? "inverted" : "normal"}
          />
        </box>
      </Show>
    </box>
  );
}

/** Tabs sharing the bar width evenly. */
export function TabBar(props: TabBarProps): JSX.Element {
  /** Tabs split the width evenly; the rounding goes to the first ones. */
  const tabWidth = (index: number) => {
    const count = props.tabs.length;
    const room = props.width - (count - 1);
    return Math.floor(room / count) + (index < room % count ? 1 : 0);
  };
  return (
    <box width={props.width} height={TAB_BAR_H} flexDirection="row">
      <For each={props.tabs}>
        {(tab, index) => (
          <>
            <Show when={index() > 0}>
              <box width={1} background={1} />
            </Show>
            <TabCell
              tab={tab}
              active={tab.id === props.activeId}
              width={tabWidth(index())}
              onSelect={props.onSelect}
              onClose={props.onClose}
            />
          </>
        )}
      </For>
    </box>
  );
}
