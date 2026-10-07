import { createMemo, createSignal, onCleanup } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { DialogButton, TextInput, useApp } from "@mockintosh/sdk";
import { planBatch } from "./batch";

export const PRINT_SERIES_SIZE = { width: 260, height: 118 } as const;

export interface PrintSeriesProps extends Record<string, unknown> {
  /** `t` of the first print — the frame on screen when the dialog opened. */
  start: number;
  /** Called with every print's `t` after the dialog has closed itself. */
  onPrint: (times: number[]) => void;
  /** Runs while the dialog is torn down, so it must not write signals. */
  onClosed: () => void;
}

const FIELD_W = 64;

function formatT(t: number): string {
  return String(Number(t.toFixed(2)));
}

/** Print Series… — asks how far apart and how far to go, and says how many prints that makes. */
export function PrintSeries(props: PrintSeriesProps): JSX.Element {
  const app = useApp();
  const [step, setStep] = createSignal("0.25");
  const [end, setEnd] = createSignal(formatT(props.start + 2));
  const plan = createMemo(() => planBatch(props.start, step(), end()));
  onCleanup(() => props.onClosed());

  const close = () => app.os.closeWindow(app.window.id);
  function print(): void {
    const current = plan();
    if ("reason" in current) return;
    close();
    props.onPrint(current.times);
  }

  const summary = () => {
    const current = plan();
    if ("reason" in current) return current.reason;
    const n = current.times.length;
    const last = current.times[n - 1]!;
    return n === 1 ? "1 print" : `${n} prints, t = ${formatT(props.start)} to ${formatT(last)}`;
  };

  return (
    <box width="100%" height="100%" padding={10} flexDirection="column" gap={8} background={0}>
      <text font="body" nowrap>{`Print from t = ${formatT(props.start)}`}</text>
      <box flexDirection="row" alignItems="center" gap={6}>
        <text font="body" nowrap>Step:</text>
        <TextInput
          name="step"
          value={step()}
          onChange={setStep}
          onSubmit={print}
          onCancel={close}
          width={FIELD_W}
          autoFocus
          selectAllOnFocus
        />
        <text font="body" nowrap>End t:</text>
        <TextInput
          name="end"
          value={end()}
          onChange={setEnd}
          onSubmit={print}
          onCancel={close}
          width={FIELD_W}
          selectAllOnFocus
        />
      </box>
      <text font="body" nowrap>{summary()}</text>
      <box flexGrow={1} />
      <box flexDirection="row" alignItems="center" justifyContent="flex-end" gap={10}>
        <DialogButton name="cancel" label="Cancel" onClick={close} />
        <DialogButton name="print" label="Print" default disabled={!plan().ok} onClick={print} />
      </box>
    </box>
  );
}
