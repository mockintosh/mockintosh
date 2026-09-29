/**
 * What Mockintosh lays over the ad, in the machine's own pixels: the runner
 * selected with marching ants, the feed's alerts and notifications piling up
 * over Big Brother, his screen cracking, his crash, and the card.
 */
import type { Sprite } from "@mockintosh/sdk";
import { button, dialogFrame } from "../desktop";
import { easeInOutCubic, easeOutCubic, hash, seg } from "../ease";
import type { KeyBox } from "../footage";
import { toneOver, type Painter, type PixelRect, type Vec } from "../painter";
import type { Screen } from "../screen";
import { ALERTS, BANNERS, BANNERS_UNTIL, CARD_LINES, CRASH, IMPACT, LOGO_AT, LOGO_UNTIL } from "./edit";

const SYSTEM = { font: "chicago" } as const;

/** A System 7 alert centred on (cx, cy): icon, message, buttons with the last one default. */
function alertBox(sc: Screen, cx: number, cy: number, lines: readonly string[], buttons: readonly string[], icon: Sprite | undefined): void {
  const z = sc.z;
  const m = 16 * z;
  const lh = sc.measure("Ag", SYSTEM).height + 2 * z;
  const iconW = icon ? icon.width * z + 14 * z : 0;
  const textW = Math.max(...lines.map((l) => sc.measure(l, SYSTEM).width));
  const widths = buttons.map((b) => Math.max(58 * z, sc.measure(b, SYSTEM).width + 20 * z));
  const gap = 12 * z;
  const row = widths.reduce((a, b) => a + b, 0) + gap * (buttons.length - 1);
  const buttonH = 20 * z;
  const w = Math.max(iconW + textW, row) + 2 * m;
  const body = Math.max(icon ? icon.height * z : 0, lines.length * lh);
  const h = m + body + 14 * z + buttonH + m;
  const r = { x0: Math.round(cx - w / 2), y0: Math.round(cy - h / 2), x1: 0, y1: 0 };
  r.x1 = r.x0 + w;
  r.y1 = r.y0 + h;
  dialogFrame(sc, r);
  if (icon) sc.sprite(icon, r.x0 + m, r.y0 + m, z);
  lines.forEach((line, i) => sc.text(line, r.x0 + m + iconW, r.y0 + m + i * lh, SYSTEM));
  let bx = r.x1 - m - row;
  const by = r.y1 - m - buttonH;
  widths.forEach((bw, i) => {
    button(sc, { x0: bx, y0: by, x1: bx + bw, y1: by + buttonH }, buttons[i]!, { isDefault: i === buttons.length - 1 });
    bx += bw + gap;
  });
}

/** The feed's alerts, cascading over Big Brother's face as he speaks. */
export function alerts(sc: Screen, t: number, icon: Sprite | undefined): void {
  for (const cue of ALERTS) {
    if (t < cue.at || t >= cue.until) continue;
    alertBox(sc, sc.x(146 + cue.step * 10), sc.y(66 + cue.step * 12), cue.lines, cue.buttons, icon);
  }
}

/** Notifications sliding in from the right and stacking down the screen. */
export function banners(sc: Screen, t: number): void {
  if (t >= BANNERS_UNTIL) return;
  const z = sc.z;
  const shown = BANNERS.filter((b) => t >= b.at);
  if (!shown.length) return;
  const h = 34 * z;
  const gap = 4 * z;
  const stack = shown.length * (h + gap);
  const room = sc.clip.y1 - sc.clip.y0 - 12 * z;
  const top = sc.clip.y0 + 6 * z - Math.max(0, stack - room);
  shown.forEach((b, i) => {
    const w = Math.max(150 * z, sc.measure(b.text, { font: "geneva", size: 9 }).width + 20 * z);
    const slide = 1 - easeOutCubic(seg(t, b.at, b.at + 0.18));
    const x1 = sc.clip.x1 - 6 * z + Math.round(slide * (w + 12 * z));
    const y = top + i * (h + gap);
    const r: PixelRect = { x0: x1 - w, y0: y, x1, y1: y + h };
    sc.fill(r.x0 + 2 * z, r.y0 + 2 * z, r.x1 + 2 * z, r.y1 + 2 * z, 1);
    sc.fillRect(r, 0);
    sc.box(r, z);
    sc.text("Big Brother", r.x0 + 8 * z, r.y0 + 4 * z, SYSTEM);
    sc.text(b.text, r.x0 + 8 * z, r.y0 + 20 * z, { font: "geneva", size: 9 });
  });
}

/**
 * The runner, selected: marching ants round her and a Finder label beneath.
 * `person` is in stage units.
 */
export function marquee(sc: Screen, person: KeyBox, phase: number): void {
  const z = sc.z;
  const r = sc.rect(person.x0, person.y0, person.x1, person.y1);
  const c = sc.clip;
  const box = { x0: Math.max(c.x0 + z, r.x0), y0: Math.max(c.y0 + z, r.y0), x1: Math.min(c.x1 - z, r.x1), y1: Math.min(c.y1 - z, r.y1) };
  if (box.x1 - box.x0 < 6 * z || box.y1 - box.y0 < 6 * z) return;
  sc.box(box, z, 0);
  sc.ants(box, phase);
  const style = { font: "geneva", size: 9 } as const;
  const label = "Mockintosh";
  const { width, height } = sc.measure(label, style);
  const cx = Math.round((box.x0 + box.x1) / 2);
  const below = box.y1 + 3 * z + height + z <= c.y1;
  const ly = below ? box.y1 + 3 * z : box.y1 - height - 3 * z;
  const lx = Math.max(c.x0 + 2 * z, Math.min(c.x1 - width - 2 * z, cx - Math.round(width / 2)));
  sc.fill(lx - 2 * z, ly - z, lx + width + 2 * z, ly + height, 1);
  sc.text(label, lx, ly - z, { ...style, ink: 0 });
}

/** Where on Big Brother's face the hammer lands. */
const STRIKE: Vec = { x: 160, y: 76 };

/** Cracks and shards in ink, racing out through the white of the flash. */
export function shatter(p: Painter, t: number): void {
  const k = seg(t, IMPACT, IMPACT + 1.2);
  if (k <= 0 || k >= 1) return;
  const R = 10 + 300 * k ** 1.5;
  const fade = 1 - easeInOutCubic(seg(k, 0.45, 1));
  p.with({ paint: toneOver(fade) }, () => {
    for (let i = 0; i < 22; i++) {
      const a0 = (i / 22) * Math.PI * 2 + hash(i, 3) * 0.3;
      const pts: Vec[] = [STRIKE];
      for (let j = 1; j <= 6; j++) {
        const a = a0 + (hash(i * 7 + j, 4) - 0.5) * 0.5;
        const r = R * (0.2 + j * 0.16) * (0.7 + 0.3 * hash(i, 5));
        pts.push({ x: STRIKE.x + Math.cos(a) * r, y: STRIKE.y + Math.sin(a) * r * 0.8 });
      }
      p.stroke(pts, 0.6 + hash(i, 6) * 0.9);
    }
    for (let i = 0; i < 40; i++) {
      const a = hash(i, 7) * Math.PI * 2;
      const dist = 16 + R * (0.4 + hash(i, 8) * 0.8);
      const c = { x: STRIKE.x + Math.cos(a) * dist, y: STRIKE.y + Math.sin(a) * dist * 0.8 + k * k * 30 };
      const size = (1 + hash(i, 9) * 4) * (0.4 + 1.6 * k);
      const spin = hash(i, 10) * 6 + t * (5 + hash(i, 11) * 9);
      p.polygon([0, 2.1, 4.0].map((o) => ({ x: c.x + Math.cos(spin + o) * size, y: c.y + Math.sin(spin + o) * size * 0.7 })));
    }
  });
}

/** Big Brother, crashed, with the classic apology. */
export function crash(sc: Screen, t: number, icon: Sprite | undefined): void {
  if (t < CRASH.at || t >= CRASH.until) return;
  alertBox(sc, sc.x(160), sc.y(88), ["Sorry, a system error occurred.", '"Big Brother"   ID = 1984'], ["Restart"], icon);
}

/** Let only `amount` of the white inside `r` survive, pixel by random pixel: a dissolve on black. */
function dissolve(p: Painter, r: PixelRect, amount: number): void {
  if (amount >= 1) return;
  const { clip, frame } = p;
  for (let y = Math.max(clip.y0, r.y0); y < Math.min(clip.y1, r.y1); y++) {
    const row = y * frame.width;
    for (let x = Math.max(clip.x0, r.x0); x < Math.min(clip.x1, r.x1); x++) if (hash(x, y * 7 + 5) >= amount) frame.pixels[row + x] = 1;
  }
}

/** The closing card on black: two lines each dissolving in and out, then the Happy Mac and the name. */
export function card(p: Painter, sc: Screen, t: number, happy: Sprite | undefined): void {
  const z = sc.z;
  for (const [at, until, lines] of CARD_LINES) {
    if (t < at || t >= until + 0.3) continue;
    const amount = Math.min(seg(t, at, at + 0.6), 1 - seg(t, until, until + 0.3));
    const style = { font: "newYork", size: 18, k: z, ink: 0 as const };
    const lh = sc.measure("Ag", style).height;
    const top = sc.y(90) - Math.round((lh * 1.35 * lines.length) / 2);
    lines.forEach((line, i) => sc.centered(line, sc.x(160), top + Math.round(i * lh * 1.35), style));
    dissolve(p, { x0: p.clip.x0, y0: top - lh, x1: p.clip.x1, y1: top + lh * 3 }, easeInOutCubic(amount));
  }
  if (t < LOGO_AT || t >= LOGO_UNTIL + 0.4) return;
  const amount = Math.min(seg(t, LOGO_AT, LOGO_AT + 0.5), 1 - seg(t, LOGO_UNTIL, LOGO_UNTIL + 0.4));
  const cx = sc.x(160);
  let y = sc.y(46);
  if (happy) {
    const k = Math.max(z, Math.round(sc.len(56) / happy.height));
    // White on black: the icon inverted, as if lit from inside.
    sc.sprite(happy, cx - Math.round((happy.width * k) / 2), y, k, true);
    y += happy.height * k + sc.len(8);
  }
  const markH = sc.measure("Mockintosh", { font: "chicago", k: 1 }).height;
  sc.centered("Mockintosh", cx, y, { font: "chicago", k: Math.max(z, Math.round(sc.len(20) / markH)), ink: 0 });
  dissolve(p, p.clip, easeInOutCubic(amount));
}

/** Shown in place of the footage until it has loaded, or where it can't. */
export function awaitingFootage(sc: Screen): void {
  sc.centered("1984.mp4", sc.x(160), sc.y(84), { ...SYSTEM, ink: 0 });
}
