import { createSignal, For } from "@mockintosh/sdk";
import type { JSX } from "@mockintosh/ui";
import { Knob } from "./Knob";
import type { ParamDef } from "./params";

export const TITLE_H = 12;

/** A framed group of controls under a black title band, like a hardware faceplate. */
export function Section(props: { title: string; children: JSX.Element; flexGrow?: number }): JSX.Element {
  return (
    <box flexDirection="column" borderWidth={1} borderColor={1} flexGrow={props.flexGrow}>
      <box height={TITLE_H} background={1}>
        <text font="body" color={0} align="center" verticalAlign="middle" height={TITLE_H} nowrap>
          {props.title}
        </text>
      </box>
      <box flexDirection="row" alignItems="flex-start" justifyContent="space-around" paddingLeft={1} paddingRight={1} paddingTop={2} gap={0}>
        {props.children}
      </box>
    </box>
  );
}

/** One knob per definition, reading and writing a record of numbers. */
export function KnobRow<K extends string>(props: {
  defs: readonly ParamDef<K>[];
  values: Readonly<Record<K, number>>;
  onChange(key: K, value: number): void;
  onInspect(def: ParamDef | null): void;
}): JSX.Element {
  return (
    <For each={props.defs}>
      {(def) => (
        <Knob
          def={def}
          value={props.values[def.key]}
          onChange={(value) => props.onChange(def.key, value)}
          onInspect={props.onInspect}
        />
      )}
    </For>
  );
}

/**
 * A faceplate push button. Deliberately not focusable, so the instrument
 * keeps the keyboard while you press it.
 */
export function PanelButton(props: {
  name: string;
  label: string;
  width: number;
  /** Lit (inverted), for latching buttons such as Play. */
  lit?: boolean;
  onPress(): void;
}): JSX.Element {
  const [down, setDown] = createSignal(false);
  const inverted = () => (props.lit ?? false) !== down();
  return (
    <box
      width={props.width}
      height={14}
      borderWidth={1}
      borderColor={1}
      borderRadius={3}
      background={inverted() ? 1 : 0}
      semantic={{ name: props.name, role: "button", value: props.lit ? "on" : "off" }}
      onMouseDown={() => setDown(true)}
      onMouseUp={() => setDown(false)}
      onClick={props.onPress}
    >
      <text font="body" color={inverted() ? 0 : 1} align="center" verticalAlign="middle" height={12} nowrap>
        {props.label}
      </text>
    </box>
  );
}

/** The inverted display: patch name, what the hand is on, and the transport. */
export function Display(props: { width: number; height: number; title: string; detail: string; status: string }): JSX.Element {
  return (
    <box
      width={props.width}
      height={props.height}
      background={1}
      borderRadius={4}
      paddingLeft={5}
      paddingRight={4}
      paddingTop={3}
      flexDirection="column"
      semantic={{ name: "display", role: "status", value: `${props.title} | ${props.detail} | ${props.status}` }}
    >
      <text font="menu" spacing={1} color={0} nowrap>
        {props.title}
      </text>
      <text font="body" color={0} nowrap>
        {props.detail}
      </text>
      <text font="body" color={0} nowrap>
        {props.status}
      </text>
    </box>
  );
}
