import { Button, Checkbox, TextInput, createSignal } from "@mockintosh/ui";
import type { JSX } from "@mockintosh/ui";

export function ExamplesPage(): JSX.Element {
  const [name, setName] = createSignal("");
  const [on, setOn] = createSignal(true);
  return (
    <box flexDirection="column" gap={16} padding={8}>
      <box flexDirection="column" gap={8}>
        <text font="geist">Examples</text>
        <text font="body" wrap selectable>
          Composed widgets. More examples later — start with this form.
        </text>
      </box>
      <box flexDirection="column" gap={8} width={240}>
        <TextInput width={240} value={name()} onChange={setName} placeholder="name" />
        <Checkbox checked={on()} onChange={setOn} label="remember me" />
        <Button
          label="Submit"
          disabled={!name()}
          onClick={() => setName("")}
        />
        <text font="body" wrap>
          {`${on() ? "will remember" : "will not remember"}${name() ? ` ${name()}` : ""}`}
        </text>
      </box>
    </box>
  );
}
