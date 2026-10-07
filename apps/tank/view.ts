/**
 * One frame of Tank: sky, ground and mountains, the field through the
 * gunsight, then the instruments over it. Two looks share everything but the
 * paint: Patterns (flat faces stamped from the shade ramp, black outlines)
 * and Vector (black faces hide what's behind them; white edges, as on the
 * arcade's vector tube).
 */
import { CREASES, LIGHTING, Renderer, SILHOUETTE, SOLID, drawLine, fillRows, focalLength, horizonY, instance, type Camera, type Instance, type Target } from "../qd3d";
import { SHADE_LEVELS, shadeInk } from "@mockintosh/ui";
import { drawMicro, microWidth, MICRO_HEIGHT } from "../showreel/microtype";
import { INK, PAPER, Painter } from "../showreel/painter";
import { MODELS } from "./models";
import { RADAR_RANGE, createRandom, radar, wrap, type Game } from "./game";

export type Style = "patterns" | "vector";

export const EYE_HEIGHT = 1.45;
export const FOV = (52 * Math.PI) / 180;

const SKY = SHADE_LEVELS - 1;
const GROUND = 25;
const MOUNTAIN = 9;
const LIGHT: [number, number, number] = [0.45, 1, 0.35];

/** A ring of peaks around the horizon, heights 0…1, the same every game. */
const RIDGE = (() => {
  const random = createRandom(1984);
  const samples = 96;
  const heights = new Float32Array(samples);
  const phase = [random(), random(), random()].map((p) => p * Math.PI * 2);
  for (let i = 0; i < samples; i++) {
    const a = (i / samples) * Math.PI * 2;
    const h = 0.45 + 0.3 * Math.sin(a * 3 + phase[0]!) + 0.2 * Math.sin(a * 7 + phase[1]!) + 0.12 * Math.sin(a * 13 + phase[2]!);
    // Pointed: sharpen the tops.
    heights[i] = Math.max(0, h) ** 1.6;
  }
  return heights;
})();

function ridgeAt(angle: number): number {
  const t = (((angle / (Math.PI * 2)) % 1) + 1) % 1 * RIDGE.length;
  const i = Math.floor(t);
  const f = t - i;
  return RIDGE[i % RIDGE.length]! * (1 - f) + RIDGE[(i + 1) % RIDGE.length]! * f;
}

export class TankView {
  private renderer = new Renderer();

  draw(target: Target, game: Game, style: Style): void {
    const vector = style === "vector";
    const camera: Camera = {
      position: [0, EYE_HEIGHT, 0],
      yaw: game.player.yaw,
      // A little jolt when hit.
      pitch: game.hit > 1.8 ? Math.sin(game.time * 60) * 0.02 : 0,
      fov: FOV,
      near: 0.3,
      far: 140,
    };
    const horizon = horizonY(camera, target.height);
    if (vector) target.pixels.fill(1);
    else {
      fillRows(target, 0, horizon, SKY);
      fillRows(target, horizon, target.height, GROUND);
    }
    this.mountains(target, camera, horizon, vector);
    if (vector) drawLine(target, 0, Math.round(horizon), target.width, Math.round(horizon), 0);

    this.renderer.render(target, camera, this.instances(game, vector), { light: LIGHT, edgeInk: vector ? 0 : 1 });
    this.instruments(target, game, vector);
  }

  /** Everything in the field, placed around the player at the origin (the world wraps). */
  private instances(game: Game, vector: boolean): Instance[] {
    const { player } = game;
    const flags = vector ? SOLID | SILHOUETTE | CREASES : SOLID | LIGHTING | SILHOUETTE | CREASES;
    const shade = vector ? 0 : 1;
    const at = (x: number, y: number, z: number): [number, number, number] => [wrap(x - player.x), y, wrap(z - player.z)];
    const list: Instance[] = [];
    for (const rock of game.rocks) list.push(instance(MODELS.rock, { position: at(rock.x, 0, rock.z), yaw: rock.yaw, flags, shade: vector ? 0 : 0.9 }));
    for (const o of game.obstacles) list.push(instance(MODELS[o.kind], { position: at(o.x, 0, o.z), yaw: o.yaw, flags, shade }));
    for (const e of game.enemies) list.push(instance(MODELS.tank, { position: at(e.x, 0, e.z), yaw: e.yaw, flags, shade }));
    for (const s of game.shells) {
      list.push(instance(MODELS.shell, { position: at(s.x, s.fromPlayer ? 1.0 : 1.1, s.z), yaw: s.yaw, roll: game.time * 9, flags, shade }));
    }
    for (const d of game.debris) {
      list.push(instance(MODELS.debris, { position: at(d.x, d.y, d.z), yaw: d.yaw, pitch: d.pitch, scale: d.scale, flags, shade }));
    }
    return list;
  }

  private mountains(target: Target, camera: Camera, horizon: number, vector: boolean): void {
    const f = focalLength(camera, target.height);
    const peak = target.height * 0.11;
    const base = Math.round(horizon);
    let lastTop = -1;
    for (let x = 0; x < target.width; x++) {
      const angle = camera.yaw + Math.atan((x + 0.5 - target.width / 2) / f);
      const top = Math.round(base - ridgeAt(angle) * peak);
      if (!vector) {
        for (let y = Math.max(0, top); y < base; y++) target.pixels[y * target.width + x] = shadeInk(MOUNTAIN, x, y);
      }
      // The ridge line, joined up column to column.
      const ink = vector ? 0 : 1;
      const from = lastTop < 0 ? top : lastTop;
      for (let y = Math.min(from, top); y <= Math.max(from, top); y++) {
        if (y >= 0 && y < target.height) target.pixels[y * target.width + x] = ink;
      }
      lastTop = top;
    }
  }

  private instruments(target: Target, game: Game, vector: boolean): void {
    const k = target.height >= 300 ? 2 : 1;
    const ink: 0 | 1 = vector ? 0 : 1;
    const painter = new Painter(target, { scale: 1, x: 0, y: 0 });
    const cx = Math.round(target.width / 2);
    const cy = Math.round(target.height / 2);

    // Gunsight: brackets either side, ticks above and below, haloed so they read on the horizon.
    const gap = 6 * k;
    const arm = 10 * k;
    const sight: [number, number, number, number][] = [
      [cx - gap - arm, cy, cx - gap, cy],
      [cx + gap, cy, cx + gap + arm, cy],
      [cx - gap - arm, cy - 4 * k, cx - gap - arm, cy + 4 * k],
      [cx + gap + arm, cy - 4 * k, cx + gap + arm, cy + 4 * k],
      [cx, cy - gap - arm, cx, cy - gap],
      [cx, cy + gap, cx, cy + gap + arm / 2],
    ];
    const halo: 0 | 1 = ink ? 0 : 1;
    for (const [x0, y0, x1, y1] of sight) {
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) drawLine(target, x0 + dx, y0 + dy, x1 + dx, y1 + dy, halo);
    }
    for (const [x0, y0, x1, y1] of sight) drawLine(target, x0, y0, x1, y1, ink);

    // Radar, top centre: you at the middle facing up, a sweep, and a blip per enemy.
    const r = 17 * k;
    const ry = r + 4 * k;
    const scan = radar(game, FOV * (target.width / target.height));
    disc(target, cx, ry, r + 1, vector ? 1 : 0);
    circle(target, cx, ry, r, ink);
    const sweep = game.time * 2.5;
    drawLine(target, cx, ry, cx + Math.sin(sweep) * r, ry - Math.cos(sweep) * r, ink);
    const half = (FOV * (target.width / target.height)) / 2;
    drawLine(target, cx, ry, cx - Math.sin(half) * r * 0.5, ry - Math.cos(half) * r * 0.5, ink);
    drawLine(target, cx, ry, cx + Math.sin(half) * r * 0.5, ry - Math.cos(half) * r * 0.5, ink);
    for (const blip of scan.blips) {
      const bx = Math.round(cx + (blip.x / RADAR_RANGE) * r);
      const by = Math.round(ry - (blip.y / RADAR_RANGE) * r);
      for (let dy = -k; dy <= k; dy++) for (let dx = -k; dx <= k; dx++) plot(target, bx + dx, by + dy, ink);
    }

    // Words, on a label so they read over any pattern.
    const label = (text: string, x: number, y: number, scale: number) => {
      const w = microWidth(text, scale);
      const pad = 2 * scale;
      painter.with({ paint: vector ? INK : PAPER }, () => {
        for (let row = y - pad; row < y + MICRO_HEIGHT * scale + pad; row++) painter.span(row, x - pad, x + w + pad);
      });
      painter.with({ paint: vector ? PAPER : INK }, () => drawMicro(painter, text, x, y, scale));
    };
    const margin = 6 * k;
    if (scan.message && !game.over && (scan.message !== "ENEMY IN RANGE" || Math.floor(game.time * 2) % 2 === 0)) {
      label(scan.message, margin, margin, k);
    }
    const score = `SCORE ${game.player.score}`;
    label(score, target.width - margin - microWidth(score, k), margin, k);
    const lives = `TANKS ${Math.max(0, game.player.lives)}`;
    label(lives, target.width - margin - microWidth(lives, k), margin + (MICRO_HEIGHT + 6) * k, k);

    if (game.hit > 0 || game.over) this.crack(target, game, ink);
    if (game.over) {
      const big = 2 * k;
      label("GAME OVER", cx - microWidth("GAME OVER", big) / 2, cy - 20 * k, big);
      label("PRESS RETURN TO PLAY AGAIN", cx - microWidth("PRESS RETURN TO PLAY AGAIN", k) / 2, cy + 18 * k, k);
    } else if (game.time < 3) {
      label("SPACE FIRES  ARROWS DRIVE", cx - microWidth("SPACE FIRES  ARROWS DRIVE", k) / 2, target.height - margin - MICRO_HEIGHT * k, k);
    }
  }

  /** Cracked glass where the shell struck: jagged lines out from the hit, and a ring round it. */
  private crack(target: Target, game: Game, ink: 0 | 1): void {
    const random = createRandom(game.crack.seed);
    const ox = target.width / 2 + (game.crack.x * target.width) / 2;
    const oy = target.height / 2 + (game.crack.y * target.height) / 2;
    const reach = Math.hypot(target.width, target.height);
    for (let i = 0; i < 11; i++) {
      let angle = (i / 11) * Math.PI * 2 + random() * 0.4;
      let x = ox;
      let y = oy;
      let length = reach * (0.15 + random() * 0.5);
      while (length > 0) {
        const stepLength = 8 + random() * 22;
        angle += (random() - 0.5) * 0.7;
        const nx = x + Math.cos(angle) * stepLength;
        const ny = y + Math.sin(angle) * stepLength;
        drawLine(target, x, y, nx, ny, ink);
        x = nx;
        y = ny;
        length -= stepLength;
      }
    }
    circle(target, Math.round(ox), Math.round(oy), 7 + Math.round(random() * 5), ink);
  }
}

function plot(target: Target, x: number, y: number, ink: 0 | 1): void {
  if (x >= 0 && y >= 0 && x < target.width && y < target.height) target.pixels[y * target.width + x] = ink;
}

function circle(target: Target, cx: number, cy: number, r: number, ink: 0 | 1): void {
  // Midpoint circle.
  let x = r;
  let y = 0;
  let err = 1 - r;
  while (x >= y) {
    for (const [dx, dy] of [[x, y], [y, x], [-y, x], [-x, y], [-x, -y], [-y, -x], [y, -x], [x, -y]] as const) plot(target, cx + dx, cy + dy, ink);
    y++;
    if (err < 0) err += 2 * y + 1;
    else {
      x--;
      err += 2 * (y - x) + 1;
    }
  }
}

function disc(target: Target, cx: number, cy: number, r: number, ink: 0 | 1): void {
  for (let y = -r; y <= r; y++) {
    const w = Math.floor(Math.sqrt(r * r - y * y));
    for (let x = -w; x <= w; x++) plot(target, cx + x, cy + y, ink);
  }
}
