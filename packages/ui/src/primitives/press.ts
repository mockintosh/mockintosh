import { createSignal, type Accessor } from "solid-js";
import type { SemanticMetadata } from "../inspection";

export interface PressProps {
  name?: string;
  disabled?: boolean;
  onClick: () => void;
}

export interface PressRootProps {
  semantic: SemanticMetadata;
  tabIndex: number | undefined;
  onMouseDown: () => void;
  onMouseUp: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onKeyDown: (key: string) => void;
}

export interface Press {
  pressed: Accessor<boolean>;
  rootProps: () => PressRootProps;
}

/**
 * Press tracking, Enter/Space, and button semantics. The skin owns the tree.
 * Fires `onClick` on mouseup (not click) so a double-click still counts twice,
 * and only when the pointer is still over it, as the Mac's buttons do:
 * dragging off one lets it go up, and back over it presses it again.
 */
export function createPress(props: PressProps): Press {
  const [pressed, setPressed] = createSignal(false, { ownedWrite: true });
  /** The button was pressed and the mouse hasn't come up yet. */
  let held = false;
  /** The pointer is over the button while it's held. */
  let over = false;

  function activate(): void {
    if (!props.disabled) props.onClick();
  }

  function onMouseDown(): void {
    if (props.disabled) return;
    held = true;
    over = true;
    setPressed(true);
  }

  function onMouseUp(): void {
    const release = held && over;
    held = false;
    setPressed(false);
    if (release) activate();
  }

  function onMouseEnter(): void {
    over = true;
    if (held) setPressed(true);
  }

  function onMouseLeave(): void {
    over = false;
    setPressed(false);
  }

  function onKeyDown(key: string): void {
    if ((key === "Enter" || key === " ") && !props.disabled) props.onClick();
  }

  return {
    pressed,
    rootProps: (): PressRootProps => ({
      semantic: { name: props.name, role: "button", enabled: !props.disabled },
      tabIndex: props.disabled ? undefined : 0,
      onMouseDown,
      onMouseUp,
      onMouseEnter,
      onMouseLeave,
      onKeyDown,
    }),
  };
}
