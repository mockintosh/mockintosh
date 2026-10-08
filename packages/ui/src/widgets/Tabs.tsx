import type { JSX } from "@mockintosh/ui";
import { For } from "solid-js";

export interface TabItem {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface TabsProps {
  name?: string;
  value: string;
  onChange: (value: string) => void;
  items: readonly TabItem[];
  children?: JSX.Element;
}

/** Folder-tab bar. The parent still decides which panel to show in `children`. */
export function Tabs(props: TabsProps): JSX.Element {
  return (
    <box
      semantic={{ name: props.name, role: "tablist", value: props.value }}
      flexDirection="column"
      gap={0}
      alignSelf="stretch"
    >
      <box flexDirection="row" gap={1} alignItems="flex-end">
        <For each={props.items}>
          {(item) => {
            const active = () => props.value === item.value;
            const select = () => {
              if (!item.disabled) props.onChange(item.value);
            };
            return (
              <box
                semantic={{
                  name: props.name ? `${props.name}:${item.value}` : item.value,
                  role: "tab",
                  value: String(active()),
                  enabled: !item.disabled,
                }}
                paddingLeft={8}
                paddingRight={8}
                paddingTop={3}
                paddingBottom={3}
                background={active() ? 1 : 0}
                borderColor={1}
                borderWidth={1}
                tabIndex={item.disabled ? undefined : 0}
                cursor={item.disabled ? "default" : "pointer"}
                onClick={select}
                onKeyDown={(key: string) => {
                  if (key === "Enter" || key === " ") select();
                }}
              >
                <text
                  font="body"
                  color={active() ? 0 : 1}
                  stipple={item.disabled}
                  nowrap
                >
                  {item.label}
                </text>
              </box>
            );
          }}
        </For>
      </box>
      <box height={1} background={1} />
      {props.children}
    </box>
  );
}
