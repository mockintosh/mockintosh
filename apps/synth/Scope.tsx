import type { JSX } from "@mockintosh/ui";
import { SCOPE_SIZE } from "./engine";
import { fft } from "./fft";
import { ensureFrame, line, plot, rect, vline, type Frame } from "./pixels";

export const SCOPE_MODES = ["WAVE", "SPECTRUM", "STEREO"] as const;
export type ScopeMode = (typeof SCOPE_MODES)[number];

/** What the scope reads: the engine's output rings and the frame being heard. */
export interface ScopeSource {
  left: Float32Array;
  right: Float32Array;
  /** Stream frame reaching the speaker now. */
  now(): number;
  sampleRate(): number;
  /** Hz of the lowest note sounding, to scale the timebase to about two cycles. */
  fundamental(): number | null;
}

const MASK = SCOPE_SIZE - 1;
const FFT_SIZE = 1024;

function dottedAxes(frame: Frame): void {
  const mid = frame.height >> 1;
  for (let x = 0; x < frame.width; x += 3) plot(frame, x, mid, 1);
  for (let y = 0; y < frame.height; y += 3) plot(frame, frame.width >> 1, y, 1);
}

/** A triggered trace: find the last rising zero crossing, then draw about two cycles. */
export function drawWave(frame: Frame, source: ScopeSource): void {
  const { left, right } = source;
  const now = Math.floor(source.now());
  const rate = source.sampleRate();
  const hz = source.fundamental();
  const span = Math.max(frame.width, Math.min(4096, Math.round(hz ? (2 * rate) / hz : rate / 100)));
  const at = (i: number) => (left[i & MASK]! + right[i & MASK]!) * 0.5;
  let start = now - span;
  for (let i = now - span; i > now - span - Math.min(4096, span * 2); i--) {
    if (at(i - 1) < 0 && at(i) >= 0) {
      start = i;
      break;
    }
  }
  dottedAxes(frame);
  const mid = (frame.height - 1) / 2;
  const scale = (frame.height - 3) / 2;
  let prevY: number | null = null;
  for (let x = 0; x < frame.width; x++) {
    const a = start + Math.floor((x * span) / frame.width);
    const b = Math.max(a + 1, start + Math.floor(((x + 1) * span) / frame.width));
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = a; i < b; i++) {
      const v = at(i);
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const yTop = mid - hi * scale;
    const yBottom = mid - lo * scale;
    vline(frame, x, prevY === null ? yTop : Math.min(yTop, prevY), prevY === null ? yBottom : Math.max(yBottom, prevY), 1);
    prevY = (yTop + yBottom) / 2;
  }
}

/** Log-frequency bars with falling peak dots. */
function createSpectrum() {
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  const hann = Float64Array.from({ length: FFT_SIZE }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
  let peaks = new Float64Array(0);
  return (frame: Frame, source: ScopeSource) => {
    const now = Math.floor(source.now());
    for (let i = 0; i < FFT_SIZE; i++) {
      const k = (now - FFT_SIZE + i) & MASK;
      re[i] = ((source.left[k]! + source.right[k]!) * 0.5) * hann[i]!;
      im[i] = 0;
    }
    fft(re, im);
    const rate = source.sampleRate();
    const bars = Math.floor(frame.width / 2);
    if (peaks.length !== bars) peaks = new Float64Array(bars);
    const lowHz = 40;
    const highHz = Math.min(16000, rate / 2);
    for (let b = 0; b < bars; b++) {
      const f0 = lowHz * Math.pow(highHz / lowHz, b / bars);
      const f1 = lowHz * Math.pow(highHz / lowHz, (b + 1) / bars);
      const k0 = Math.max(1, Math.floor((f0 * FFT_SIZE) / rate));
      const k1 = Math.max(k0 + 1, Math.ceil((f1 * FFT_SIZE) / rate));
      let power = 0;
      for (let k = k0; k < Math.min(k1, FFT_SIZE / 2); k++) power = Math.max(power, re[k]! * re[k]! + im[k]! * im[k]!);
      const db = 10 * Math.log10(power / (FFT_SIZE * FFT_SIZE * 0.0625) + 1e-12);
      const level = Math.max(0, Math.min(1, (db + 66) / 66));
      peaks[b] = Math.max(level, peaks[b]! - 0.012);
      const h = Math.round(level * (frame.height - 2));
      rect(frame, b * 2, frame.height - h, 1, h, 1);
      plot(frame, b * 2, frame.height - 1 - Math.round(peaks[b]! * (frame.height - 2)), 1);
    }
    for (let x = 0; x < frame.width; x += 3) plot(frame, x, frame.height - 1, 1);
  };
}

/** Goniometer: mid on the vertical, side on the horizontal, so mono is a line and width is a cloud. */
function drawStereo(frame: Frame, source: ScopeSource): void {
  dottedAxes(frame);
  const now = Math.floor(source.now());
  const cx = (frame.width - 1) / 2;
  const cy = (frame.height - 1) / 2;
  const scale = (frame.height - 2) * 0.55;
  let px: number | null = null;
  let py = 0;
  for (let i = now - 900; i < now; i++) {
    const l = source.left[i & MASK]!;
    const r = source.right[i & MASK]!;
    const x = cx + (l - r) * scale;
    const y = cy - (l + r) * 0.5 * scale;
    if (px !== null && Math.abs(x - px) + Math.abs(y - py) < 12) line(frame, px, py, x, y, 1);
    else plot(frame, x, y, 1);
    px = x;
    py = y;
  }
}

export interface ScopeProps {
  width: number;
  height: number;
  mode: ScopeMode;
  source: ScopeSource;
  revision: number;
  onClick(): void;
}

/** The synth's display: a triggered oscilloscope, a spectrum analyser, or a goniometer. */
export function Scope(props: ScopeProps): JSX.Element {
  let frame: Frame | null = null;
  const spectrum = createSpectrum();
  return (
    <raster
      width={props.width}
      height={props.height}
      revision={props.revision}
      semantic={{ name: "scope", role: "preview", value: props.mode }}
      onClick={props.onClick}
      onPaint={(surface) => {
        frame = ensureFrame(frame, props.width, props.height);
        frame.pixels.fill(0);
        if (props.mode === "SPECTRUM") spectrum(frame, props.source);
        else if (props.mode === "STEREO") drawStereo(frame, props.source);
        else drawWave(frame, props.source);
        surface.blitPixels(frame.pixels, frame.width, frame.height);
      }}
    />
  );
}
