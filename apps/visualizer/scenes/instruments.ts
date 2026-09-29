/**
 * Instruments: the displays a studio rack would have — a scope, a phase
 * portrait, bar and radial spectra, a waterfall, needle meters and a strobe
 * tuner — drawn in phosphor and dither.
 */
import { drawMicro, microWidth, MICRO_HEIGHT } from "../../showreel/microtype";
import { INK, PAPER, XOR, tone, toneOver, type Painter } from "../../showreel/painter";
import { drawStrokes, layoutText, type PlacedGlyph } from "../../showreel/type";
import { BANDS, WINDOW, frequencyBand, resample } from "../listen";
import { Phosphor } from "../phosphor";
import {
  approach,
  devicePainter,
  microScaleOf,
  noteLabel,
  noteText,
  unitOf,
  type Frame,
  type Scene,
  type SceneDefinition,
} from "../scene";

/** Micro type with its top-left at (x, y), clamped inside the frame. */
function caption(p: Painter, text: string, x: number, y: number, k: number): void {
  const w = microWidth(text, k);
  drawMicro(p, text, Math.max(2, Math.min(p.frame.width - w - 2, x)), y, k);
}

function setPixel(frame: Frame, x: number, y: number, ink: 0 | 1): void {
  if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) return;
  frame.pixels[y * frame.width + x] = ink;
}

// ── Oscilloscope ──────────────────────────────────────────────────────────

/** Rising zero crossing to start from, so a steady tone stands still. */
function triggerStart(mono: Float32Array, span: number, search: number): number {
  const latest = WINDOW - span;
  for (let i = latest; i > Math.max(1, latest - search); i--) {
    if (mono[i - 1]! < 0 && mono[i]! >= 0) return i;
  }
  return latest;
}

function graticule(frame: Frame): void {
  const { width: w, height: h } = frame;
  const cols = 10;
  const rows = 8;
  for (let c = 0; c <= cols; c++) {
    const x = Math.min(w - 1, Math.round((c * (w - 1)) / cols));
    for (let y = 0; y < h; y += 3) setPixel(frame, x, y, 0);
  }
  for (let r = 0; r <= rows; r++) {
    const y = Math.min(h - 1, Math.round((r * (h - 1)) / rows));
    for (let x = 0; x < w; x += 3) setPixel(frame, x, y, 0);
  }
  // Minor ticks along the centre axes, five to a division.
  const cx = Math.round((w - 1) / 2);
  const cy = Math.round((h - 1) / 2);
  for (let k = 0; k <= cols * 5; k++) {
    const x = Math.round((k * (w - 1)) / (cols * 5));
    setPixel(frame, x, cy - 1, 0);
    setPixel(frame, x, cy + 1, 0);
  }
  for (let k = 0; k <= rows * 5; k++) {
    const y = Math.round((k * (h - 1)) / (rows * 5));
    setPixel(frame, cx - 1, y, 0);
    setPixel(frame, cx + 1, y, 0);
  }
}

function oscilloscope(): Scene {
  const glow = new Phosphor();
  return {
    render(frame, s) {
      glow.fit(frame);
      glow.decay(0.45);
      const { width: w, height: h } = frame;
      const period = s.pitch ? s.sampleRate / s.pitch : 0;
      const span = Math.round(Math.max(96, Math.min(WINDOW / 2, period ? period * 2.5 : WINDOW / 2)));
      const start = triggerStart(s.mono, span, period ? Math.ceil(period * 2) : 600);
      const mid = h / 2;
      const amp = h * 0.42 * Math.min(s.gain, 6);
      let px = 0;
      let py = mid;
      for (let x = 0; x <= w; x++) {
        const at = start + (x * span) / w;
        const k = Math.floor(at);
        const f = at - k;
        const v = (s.mono[Math.min(WINDOW - 1, k)]! * (1 - f) + s.mono[Math.min(WINDOW - 1, k + 1)]! * f) * amp;
        const y = mid - v;
        // A fast beam paints less phosphor per pixel: vertical edges come out faint.
        const len = Math.hypot(x - px, y - py);
        if (x > 0) glow.line(px, py, x, y, 1.1 / Math.max(1, len * 0.35));
        px = x;
        py = y;
      }
      glow.develop(frame);
      graticule(frame);

      const p = devicePainter(frame);
      const k = microScaleOf(frame);
      const msPerDiv = ((span / s.sampleRate) * 1000) / 10;
      p.with({ paint: PAPER }, () => {
        caption(p, `CH1  ${msPerDiv.toFixed(msPerDiv < 1 ? 2 : 1)}MS/DIV`, 4 * k, h - 4 * k - MICRO_HEIGHT * k, k);
        if (s.note !== null) {
          const label = `${noteText(noteLabel(s.note))}  ${s.pitch!.toFixed(1)}HZ`;
          caption(p, label, w - microWidth(label, k) - 4 * k, 4 * k, k);
        }
        caption(p, s.gain > 1.5 ? `AUTO X${s.gain.toFixed(1)}` : "AUTO", 4 * k, 4 * k, k);
      });
    },
  };
}

// ── Phase portrait ────────────────────────────────────────────────────────

/**
 * x = the signal now, y = the signal a quarter-period ago: a sine draws a
 * circle, a rich tone draws its harmonics as loops, noise a ball of wool.
 */
function phasePortrait(): Scene {
  const glow = new Phosphor();
  let delay = 24;
  /** Recent peak of the drawn stretch: the figure fills the screen whatever the volume, and shrinks slowly as a note dies. */
  let reach = 0.05;
  return {
    render(frame, s) {
      glow.fit(frame);
      glow.decay(0.72);
      const { width: w, height: h } = frame;
      const target = s.pitch ? s.sampleRate / s.pitch / 4 : 24;
      delay = approach(delay, Math.max(2, Math.min(400, target)), s.dt, 0.08);
      const lag = Math.round(delay);
      const cx = w / 2;
      const cy = h / 2;
      const from = Math.max(lag, WINDOW - 1400);
      let peak = 0;
      for (let i = from - lag; i < WINDOW; i++) peak = Math.max(peak, Math.abs(s.mono[i]!));
      reach = peak > reach ? approach(reach, peak, s.dt, 0.03) : approach(reach, Math.max(0.02, peak), s.dt, 1.2);
      const scale = (Math.min(w, h) * 0.3) / reach;
      const spin = s.travel * 0.15;
      const cos = Math.cos(spin);
      const sin = Math.sin(spin);
      let px = 0;
      let py = 0;
      for (let i = from; i < WINDOW; i++) {
        const a = s.mono[i]! * scale;
        const b = s.mono[i - lag]! * scale;
        const x = cx + a * cos - b * sin;
        const y = cy + a * sin + b * cos;
        if (i > from) glow.line(px, py, x, y, 0.35);
        px = x;
        py = y;
      }
      glow.spot(cx, cy, 1.5, 0.6);
      glow.develop(frame);
      const p = devicePainter(frame);
      const k = microScaleOf(frame);
      p.with({ paint: PAPER }, () => {
        caption(p, `X = S(T)   Y = S(T - ${lag})`, 4 * k, h - 4 * k - MICRO_HEIGHT * k, k);
      });
    },
  };
}

// ── Spectrum bars ─────────────────────────────────────────────────────────

const RULER_HZ = [50, 100, 200, 500, 1000, 2000, 5000, 10000] as const;

function hzLabel(hz: number): string {
  return hz >= 1000 ? `${hz / 1000}K` : String(hz);
}

function spectrumBars(): Scene {
  let bars = new Float32Array(0);
  let caps = new Float32Array(0);
  return {
    render(frame, s) {
      const { width: w, height: h } = frame;
      const p = devicePainter(frame);
      const k = microScaleOf(frame);
      frame.pixels.fill(1);
      const count = Math.max(12, Math.min(BANDS, Math.floor(w / 6)));
      if (bars.length !== count) {
        bars = new Float32Array(count);
        caps = new Float32Array(count);
      }
      resample(s.spectrum, bars);
      resample(s.peaks, caps);
      const pitch = w / count;
      const barW = Math.max(1, Math.floor(pitch) - 1);
      const base = Math.round(h * 0.74);
      const top = Math.round(h * 0.06);
      const segment = Math.max(2, Math.round(unitOf(frame) * 2));
      const segments = Math.max(4, Math.floor((base - top) / (segment + 1)));
      for (let b = 0; b < count; b++) {
        const x = Math.round(b * pitch + (pitch - barW) / 2);
        const lit = Math.round(bars[b]! * segments);
        for (let g = 0; g < lit; g++) {
          const y = base - (g + 1) * (segment + 1);
          // The top fifth is the "red" zone: checkered instead of solid.
          const paint = g >= segments * 0.8 ? tone(0.5) : PAPER;
          p.with({ paint }, () => p.rect(x, y, barW, segment));
          // A reflection in the floor, fainter as it goes down.
          const ry = base + 2 + g * (segment + 1);
          if (ry < h) p.with({ paint: tone(1 - 0.34 * Math.max(0, 1 - g / (segments * 0.35))) }, () => p.rect(x, ry, barW, segment));
        }
        const cap = Math.round(caps[b]! * segments);
        if (cap > 0) p.with({ paint: PAPER }, () => p.rect(x, base - cap * (segment + 1) - 2, barW, 1));
      }
      p.with({ paint: PAPER }, () => p.rect(0, base, w, 1));
      p.with({ paint: XOR }, () => {
        for (const hz of RULER_HZ) {
          const x = ((frequencyBand(hz) + 0.5) / BANDS) * w;
          const label = hzLabel(hz);
          const lx = Math.round(x - microWidth(label, k) / 2);
          if (lx < 2 || lx + microWidth(label, k) > w - 2) continue;
          drawMicro(p, label, lx, h - MICRO_HEIGHT * k - 3 * k, k);
        }
      });
    },
  };
}

// ── Sunburst ──────────────────────────────────────────────────────────────

interface Shockwave {
  age: number;
  strength: number;
}

function sunburst(): Scene {
  const rays = new Float32Array(40);
  const waves: Shockwave[] = [];
  return {
    render(frame, s) {
      const { width: w, height: h } = frame;
      const p = devicePainter(frame);
      frame.pixels.fill(1);
      const cx = w / 2;
      const cy = h / 2;
      const m = Math.min(w, h);
      const inner = m * (0.15 + 0.07 * s.bass + 0.04 * s.pulse);
      const reach = m * 0.34;
      if (s.beat) waves.push({ age: 0, strength: 0.4 + 0.6 * s.bass });
      for (const wave of waves) wave.age += s.dt;
      while (waves.length > 0 && waves[0]!.age > 1.4) waves.shift();

      // Shockwaves behind everything, thinning as they spread.
      p.with({ paint: toneOver(0.5) }, () => {
        for (const wave of waves) {
          const r = inner + wave.age * m * 0.55;
          const width = Math.max(1, (1 - wave.age / 1.4) * 6 * wave.strength * unitOf(frame));
          p.ring(cx, cy, r, width);
        }
      });

      resample(s.spectrum, rays);
      const spin = s.travel * 0.12;
      const n = rays.length;
      const step = Math.PI / n;
      const barWidth = Math.max(1, ((inner * Math.PI) / n) * 0.55);
      p.with({ paint: PAPER }, () => {
        for (let i = 0; i < n; i++) {
          const len = 2 + rays[i]! * reach;
          for (const side of [1, -1]) {
            const a = spin - Math.PI / 2 + side * (i + 0.5) * step;
            const ca = Math.cos(a);
            const sa = Math.sin(a);
            p.capsule(
              { x: cx + ca * (inner + 3), y: cy + sa * (inner + 3) },
              { x: cx + ca * (inner + 3 + len), y: cy + sa * (inner + 3 + len) },
              barWidth / 2,
            );
          }
        }
      });
      // A dark disc with a bright rim, and the note at its heart.
      p.with({ paint: INK }, () => p.circle(cx, cy, inner));
      p.with({ paint: PAPER }, () => p.ring(cx, cy, inner, Math.max(1, unitOf(frame) * (1 + 2 * s.pulse))));
      p.with({ paint: tone(0.5 * s.level) }, () => p.circle(cx, cy, inner * 0.8));
      if (s.note !== null) {
        const k = Math.max(1, Math.round(inner / 18));
        const label = noteText(noteLabel(s.note));
        p.with({ paint: XOR }, () => drawMicro(p, label, cx - microWidth(label, k) / 2, cy - (MICRO_HEIGHT * k) / 2, k));
      }
    },
  };
}

// ── Spectrogram ───────────────────────────────────────────────────────────

function spectrogram(): Scene {
  const glow = new Phosphor();
  let owed = 0;
  return {
    render(frame, s) {
      if (glow.fit(frame)) owed = 0;
      const { width: w, height: h } = frame;
      const k = microScaleOf(frame);
      const labelW = microWidth("10K", k) + 6 * k;
      // Scroll about 50 px a second, whatever the frame rate.
      owed += s.dt * 50 * Math.max(1, unitOf(frame) * 0.8);
      const shift = Math.floor(owed);
      owed -= shift;
      const light = glow.light;
      if (shift > 0) {
        for (let y = 0; y < h; y++) {
          const row = y * w;
          light.copyWithin(row + labelW, row + labelW + shift, row + w);
          for (let x = 0; x < shift; x++) {
            const at = row + w - shift + x;
            const band = (1 - y / (h - 1)) * (BANDS - 1);
            const b = Math.floor(band);
            const f = band - b;
            const v = s.spectrum[b]! * (1 - f) + (s.spectrum[Math.min(BANDS - 1, b + 1)] ?? 0) * f;
            light[at] = v * v * 1.1;
          }
        }
        // The melody, traced as a bright line over the picture.
        if (s.note !== null && s.clarity > 0.6) {
          const y = Math.round((1 - frequencyBand(s.pitch!) / (BANDS - 1)) * (h - 1));
          for (let x = w - shift; x < w; x++) {
            glow.lift(x, y, 1.6);
            glow.lift(x, y - 1, 1.6);
          }
        }
      }
      for (let y = 0; y < h; y++) light.fill(0, y * w, y * w + labelW);
      glow.develop(frame);
      const p = devicePainter(frame);
      p.with({ paint: PAPER }, () => {
        for (const hz of [100, 1000, 10000]) {
          const y = Math.round((1 - frequencyBand(hz) / (BANDS - 1)) * (h - 1));
          drawMicro(p, hzLabel(hz), 2 * k, Math.max(2, Math.min(h - MICRO_HEIGHT * k - 2, y - (MICRO_HEIGHT * k) / 2)), k);
          for (let x = labelW - 3 * k; x < labelW - k; x++) setPixel(frame, x, y, 0);
        }
        p.rect(labelW - 1, 0, 1, h);
      });
    },
  };
}

// ── VU meters ─────────────────────────────────────────────────────────────

const VU_MARKS = [-20, -10, -7, -5, -3, -2, -1, 0, 1, 2, 3] as const;
const VU_SWEEP = (100 * Math.PI) / 180;
/** 0 VU: a loud, healthy mix. */
const VU_REFERENCE_DB = -14;

/** Needle position 0…1 for a VU reading: the scale is linear in voltage. */
function vuPosition(vu: number): number {
  return Math.pow(10, vu / 20) / Math.pow(10, 3 / 20);
}

interface Needle {
  position: number;
  velocity: number;
  peakHold: number;
}

function rmsDb(samples: Float32Array, from: number): number {
  let sum = 0;
  for (let i = from; i < samples.length; i++) sum += samples[i]! * samples[i]!;
  return 10 * Math.log10(sum / (samples.length - from) + 1e-20);
}

function peakOf(samples: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]!));
  return peak;
}

function drawMeter(p: Painter, x: number, y: number, w: number, h: number, needle: Needle, label: string, k: number): void {
  const u = Math.max(1, Math.round(h / 60));
  // The face: a white card in a black bezel with a soft shadow at the top.
  p.with({ paint: PAPER }, () => p.rect(x, y, w, h));
  p.with({ paint: toneOver(0.25) }, () => p.rect(x, y, w, Math.max(2, h * 0.08)));
  p.with({ paint: INK }, () => {
    p.rect(x, y, w, u);
    p.rect(x, y + h - u, w, u);
    p.rect(x, y, u, h);
    p.rect(x + w - u, y, u, h);
  });
  const pivotX = x + w / 2;
  const pivotY = y + h * 1.05;
  const radius = h * 0.78;
  const angleAt = (vu: number) => -Math.PI / 2 - VU_SWEEP / 2 + VU_SWEEP * vuPosition(vu);
  const at = (a: number, r: number) => ({ x: pivotX + Math.cos(a) * r, y: pivotY + Math.sin(a) * r });

  p.with({ paint: INK }, () => {
    // The scale arc, heavy through the red.
    for (let v = -20; v < 3; v += 0.25) {
      p.capsule(at(angleAt(v), radius), at(angleAt(v + 0.25), radius), v >= 0 ? u * 1.6 : u * 0.5);
    }
    for (const mark of VU_MARKS) {
      const a = angleAt(mark);
      p.capsule(at(a, radius), at(a, radius + h * 0.07), u * 0.5);
      const text = mark > 0 ? `+${mark}` : String(mark);
      const t = at(a, radius + h * 0.07 + 4 * k);
      drawMicro(p, text, t.x - microWidth(text, k) / 2, t.y - MICRO_HEIGHT * k, k);
    }
    drawMicro(p, "VU", pivotX - microWidth("VU", k * 2) / 2, y + h * 0.52, k * 2);
    drawMicro(p, label, x + 4 * k, y + h - MICRO_HEIGHT * k - 4 * k, k);
    // The needle, then the black housing that hides its pivot.
    const a = -Math.PI / 2 - VU_SWEEP / 2 + VU_SWEEP * Math.max(-0.04, Math.min(1.06, needle.position));
    p.capsule(at(a, h * 0.2), at(a, radius + h * 0.1), Math.max(0.5, u * 0.5));
    p.rect(x + w * 0.3, y + h * 0.84, w * 0.4, h * 0.16);
  });
  // Peak lamp: lit while the signal is near full scale.
  const lampX = x + w - 8 * k;
  const lampY = y + h - 8 * k;
  p.with({ paint: INK }, () => p.circle(lampX, lampY, 2.5 * k));
  if (needle.peakHold <= 0) p.with({ paint: PAPER }, () => p.circle(lampX, lampY, 1.6 * k));
  p.with({ paint: INK }, () => drawMicro(p, "PEAK", lampX - 4 * k - microWidth("PEAK", k), lampY - (MICRO_HEIGHT * k) / 2, k));
}

function vuMeters(): Scene {
  const needles: [Needle, Needle] = [
    { position: 0, velocity: 0, peakHold: 0 },
    { position: 0, velocity: 0, peakHold: 0 },
  ];
  return {
    render(frame, s) {
      const { width: w, height: h } = frame;
      const p = devicePainter(frame);
      const k = microScaleOf(frame);
      p.with({ paint: INK }, () => p.fill());
      // Brushed-metal rack: fine horizontal hairlines.
      for (let y = 1; y < h; y += 3) p.with({ paint: tone(0.12) }, () => p.rect(0, y, w, 1));
      const side = w / h > 1.25;
      const gap = Math.round(Math.min(w, h) * 0.06);
      const mw = side ? (w - gap * 3) / 2 : Math.min(w - gap * 2, (h - gap * 3) / 2 / 0.62);
      const mh = side ? Math.min(mw * 0.62, h - gap * 2) : mw * 0.62;
      const channels = [s.left, s.right];
      needles.forEach((needle, c) => {
        const samples = channels[c]!;
        // A VU integrates about 300 ms; the needle is a damped spring toward it.
        const vu = rmsDb(samples, WINDOW - 1024) - VU_REFERENCE_DB;
        const target = s.silent ? 0 : vuPosition(Math.max(-24, vu));
        const dt = Math.min(0.05, s.dt);
        needle.velocity += (target - needle.position) * 90 * dt - needle.velocity * 13 * dt;
        needle.position += needle.velocity * dt;
        needle.peakHold = peakOf(samples) > 0.9 ? 0.5 : Math.max(0, needle.peakHold - s.dt);
        const mx = side ? gap + c * (mw + gap) : (w - mw) / 2;
        const my = side ? (h - mh) / 2 : gap + c * (mh + gap);
        drawMeter(p, Math.round(mx), Math.round(my), Math.round(mw), Math.round(mh), needle, c === 0 ? "LEFT" : "RIGHT", k);
      });
    },
  };
}

// ── Strobe tuner ──────────────────────────────────────────────────────────

/** A sharp sign for the stroke face, which has none: two uprights, two slanted bars. */
function drawSharp(p: Painter, x: number, top: number, size: number, width: number): void {
  const s = size;
  p.stroke([{ x: x + s * 0.35, y: top }, { x: x + s * 0.25, y: top + s }], width);
  p.stroke([{ x: x + s * 0.75, y: top }, { x: x + s * 0.65, y: top + s }], width);
  p.stroke([{ x, y: top + s * 0.38 }, { x: x + s, y: top + s * 0.3 }], width);
  p.stroke([{ x, y: top + s * 0.72 }, { x: x + s, y: top + s * 0.64 }], width);
}

function strobeTuner(): Scene {
  /** Phase of each strobe band, in pixels. */
  const phases = [0, 0, 0, 0];
  let shown: number | null = null;
  let cents = 0;
  return {
    render(frame, s) {
      const { width: w, height: h } = frame;
      const u = unitOf(frame);
      const k = microScaleOf(frame);
      const p = devicePainter(frame);
      p.with({ paint: INK }, () => p.fill());
      if (s.note !== null) shown = s.note;
      const holding = s.note !== null;
      const label = shown === null ? null : noteLabel(shown);
      cents = approach(cents, label ? (shown! - Math.round(shown!)) * 100 : 0, s.dt, 0.12);

      // The note, big, in the reel's stroke face.
      const size = 58;
      const top = 16;
      p.with({ stage: { scale: u, x: w / 2 - 160 * u, y: 0 } }, () => {
        p.with({ paint: holding ? PAPER : tone(0.35) }, () => {
          const write = (glyphs: readonly PlacedGlyph[], width: number) =>
            drawStrokes(p, glyphs.flatMap((glyph) => glyph.strokes), width);
          if (!label) {
            write(layoutText("- -", { size: size * 0.5, tracking: 4 }, { cx: 160, top: top + size * 0.25 }), 5);
            return;
          }
          const glyphs = layoutText(label.letter, { size }, { cx: 160 - (label.sharp ? 10 : 0), top });
          write(glyphs, 8);
          const right = glyphs[glyphs.length - 1]!.x + glyphs[glyphs.length - 1]!.width;
          if (label.sharp) drawSharp(p, right + 5, top, size * 0.34, 3.5);
          write(layoutText(String(label.octave), { size: size * 0.34 }, { x: right + 6, top: top + size * 0.66 }), 3.5);
        });
      });

      // Four strobe bands, each an octave finer: still when in tune, drifting
      // right when sharp and left when flat, faster the further off.
      const bandTop = Math.round(h * 0.6);
      const bandH = Math.max(3, Math.round(h * 0.05));
      const drift = holding ? cents * 2.2 * u : 0;
      for (let b = 0; b < 4; b++) {
        const period = Math.max(4, Math.round(32 * u) >> b);
        phases[b] = (phases[b]! + drift * s.dt * (1 << b)) % (period * 64);
        const y0 = bandTop + b * (bandH + 2);
        const paint = holding ? PAPER : tone(0.25);
        p.with({ paint }, () => {
          for (let x = -period; x < w + period; x += period) {
            const x0 = Math.round(x + (phases[b]! % period));
            p.rect(x0, y0, period / 2, bandH);
          }
        });
      }

      // A cents scale with a pointer.
      const scaleY = bandTop + 4 * (bandH + 2) + Math.round(8 * u);
      const x0 = w * 0.12;
      const x1 = w * 0.88;
      p.with({ paint: PAPER }, () => {
        p.rect(x0, scaleY, x1 - x0, 1);
        for (let c = -50; c <= 50; c += 10) {
          const x = x0 + ((c + 50) / 100) * (x1 - x0);
          const tall = c === 0 ? 6 : c % 50 === 0 ? 4 : 2;
          p.rect(Math.round(x), scaleY - tall * k, 1, tall * k);
        }
        const x = x0 + ((Math.max(-50, Math.min(50, cents)) + 50) / 100) * (x1 - x0);
        if (holding) p.polygon([{ x, y: scaleY + 2 }, { x: x - 4 * k, y: scaleY + 2 + 6 * k }, { x: x + 4 * k, y: scaleY + 2 + 6 * k }]);
        const readout = label && s.pitch
          ? `${s.pitch.toFixed(1)} HZ   ${cents >= 0 ? "+" : ""}${Math.round(cents)} CENTS`
          : "PLAY A NOTE";
        caption(p, readout, w / 2 - microWidth(readout, k) / 2, scaleY + 10 * k, k);
        caption(p, "-50", x0 - microWidth("-50", k) / 2, scaleY - 12 * k, k);
        caption(p, "+50", x1 - microWidth("+50", k) / 2, scaleY - 12 * k, k);
      });
      if (holding && Math.abs(cents) < 4) {
        // In tune: the pointer's lamp comes on.
        p.with({ paint: PAPER }, () => p.circle(w / 2, bandTop - 8 * u, 3 * u));
      }
    },
  };
}

export const INSTRUMENT_SCENES: readonly SceneDefinition[] = [
  { id: "scope", title: "Oscilloscope", create: oscilloscope },
  { id: "phase", title: "Phase Portrait", create: phasePortrait },
  { id: "bars", title: "Spectrum", create: spectrumBars },
  { id: "sunburst", title: "Sunburst", create: sunburst },
  { id: "spectrogram", title: "Spectrogram", create: spectrogram },
  { id: "vu", title: "VU Meters", create: vuMeters },
  { id: "tuner", title: "Strobe Tuner", create: strobeTuner },
];
