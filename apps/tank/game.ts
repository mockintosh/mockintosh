/**
 * Tank's rules, with no drawing in them: a plain the world wraps around,
 * obstacles, enemy tanks that close in and fire, and one shell of your own in
 * flight at a time. Headings follow the camera: yaw 0 faces −z, positive yaw
 * turns right, so forward is (sin yaw, −cos yaw) on x, z.
 */
import type { ObstacleKind } from "./models";

/** The plain repeats every WORLD units each way: drive far enough and you come back. */
export const WORLD = 180;
export const PLAYER_RADIUS = 1.4;
export const TANK_RADIUS = 1.7;
const PLAYER_SPEED = 7;
const PLAYER_TURN = 1.5;
const ENEMY_SPEED = 4.2;
const ENEMY_TURN = 0.9;
const PLAYER_SHELL_SPEED = 48;
const ENEMY_SHELL_SPEED = 20;
const SHELL_LIFE = 2.4;
const GRAVITY = 14;
const LIVES = 3;

export interface Controls {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  fire: boolean;
}

export interface Obstacle {
  kind: ObstacleKind;
  x: number;
  z: number;
  yaw: number;
  radius: number;
}

export interface Enemy {
  x: number;
  z: number;
  yaw: number;
  cooldown: number;
  /** Heading offset it approaches on, so it doesn't drive straight down your barrel. */
  swerve: number;
  swerveTimer: number;
  /** While going round an obstacle: the heading to hold, and for how long. */
  detour?: number;
  detourTimer?: number;
}

export interface Shell {
  x: number;
  z: number;
  yaw: number;
  life: number;
  fromPlayer: boolean;
}

export interface Debris {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  spin: number;
  life: number;
  scale: number;
}

export interface Game {
  random: () => number;
  time: number;
  player: { x: number; z: number; yaw: number; lives: number; score: number };
  /** Seconds left of the cracked-glass picture after a hit, and of the grace after it. */
  hit: number;
  grace: number;
  enemies: Enemy[];
  /** Seconds until the next enemy rolls in, per missing enemy. */
  reinforcements: number[];
  shells: Shell[];
  debris: Debris[];
  obstacles: Obstacle[];
  rocks: { x: number; z: number; yaw: number }[];
  over: boolean;
  /** Where the last hit struck the glass, -1…1 across the view. */
  crack: { x: number; y: number; seed: number };
}

/** mulberry32: seeded, so a game replays exactly in tests. */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The shortest way from a to b across the wrapping plain. */
export function wrap(d: number): number {
  return d - WORLD * Math.round(d / WORLD);
}

/** An angle folded into −π…π. */
export function angleDelta(a: number): number {
  return a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
}

/** The heading that faces from (x, z) toward (tx, tz). */
export function headingTo(x: number, z: number, tx: number, tz: number): number {
  return Math.atan2(wrap(tx - x), -wrap(tz - z));
}

const RADII: Record<ObstacleKind, number> = { cube: 2.1, pyramid: 1.9, tower: 1.15, wall: 2.6 };

export function createGame(seed = Date.now()): Game {
  const random = createRandom(seed);
  const obstacles: Obstacle[] = [];
  const kinds: ObstacleKind[] = ["cube", "pyramid", "pyramid", "tower", "wall", "cube"];
  while (obstacles.length < 70) {
    const x = (random() - 0.5) * WORLD;
    const z = (random() - 0.5) * WORLD;
    // Keep a clearing around the start.
    if (Math.hypot(x, z) < 14) continue;
    const kind = kinds[Math.floor(random() * kinds.length)]!;
    obstacles.push({ kind, x, z, yaw: random() * Math.PI, radius: RADII[kind] });
  }
  const rocks = Array.from({ length: 140 }, () => ({ x: (random() - 0.5) * WORLD, z: (random() - 0.5) * WORLD, yaw: random() * Math.PI }));
  const game: Game = {
    random,
    time: 0,
    player: { x: 0, z: 0, yaw: 0, lives: LIVES, score: 0 },
    hit: 0,
    grace: 2,
    enemies: [],
    reinforcements: [1.5],
    shells: [],
    debris: [],
    obstacles,
    rocks,
    over: false,
    crack: { x: 0, y: 0, seed: 0 },
  };
  return game;
}

/** How many enemies the field holds at this score. */
export function enemyQuota(score: number): number {
  return score >= 8000 ? 3 : score >= 3000 ? 2 : 1;
}

function obstacleAt(game: Game, x: number, z: number, radius: number): Obstacle | undefined {
  return game.obstacles.find((o) => Math.hypot(wrap(o.x - x), wrap(o.z - z)) < o.radius + radius);
}

function blocked(game: Game, x: number, z: number, radius: number): boolean {
  return obstacleAt(game, x, z, radius) !== undefined;
}

function spawnEnemy(game: Game): void {
  const { player, random } = game;
  for (let attempt = 0; attempt < 20; attempt++) {
    const bearing = random() * Math.PI * 2;
    const distance = 45 + random() * 25;
    const x = player.x + Math.sin(bearing) * distance;
    const z = player.z - Math.cos(bearing) * distance;
    if (blocked(game, x, z, TANK_RADIUS + 1)) continue;
    game.enemies.push({ x, z, yaw: headingTo(x, z, player.x, player.z) + (random() - 0.5), cooldown: 3 + random() * 2, swerve: 0, swerveTimer: 0 });
    return;
  }
}

function explode(game: Game, x: number, z: number, pieces: number, power: number): void {
  const { random } = game;
  for (let i = 0; i < pieces; i++) {
    const angle = random() * Math.PI * 2;
    const speed = power * (0.4 + random() * 0.8);
    game.debris.push({
      x,
      y: 0.6 + random(),
      z,
      vx: Math.sin(angle) * speed,
      vy: power * (0.6 + random()),
      vz: Math.cos(angle) * speed,
      yaw: random() * Math.PI * 2,
      pitch: random() * Math.PI * 2,
      spin: (random() - 0.5) * 12,
      life: 2.5 + random(),
      scale: 0.5 + random() * (power > 5 ? 1.2 : 0.3),
    });
  }
}

/** Advance the game by `dt` seconds. */
export function step(game: Game, controls: Controls, dt: number): void {
  if (game.over) {
    updateDebris(game, dt);
    return;
  }
  game.time += dt;
  game.hit = Math.max(0, game.hit - dt);
  game.grace = Math.max(0, game.grace - dt);
  const player = game.player;

  // Drive. Treads stop dead at an obstacle rather than sliding round it.
  const turn = (controls.right ? 1 : 0) - (controls.left ? 1 : 0);
  const drive = (controls.forward ? 1 : 0) - (controls.back ? 0.6 : 0);
  player.yaw = angleDelta(player.yaw + turn * PLAYER_TURN * dt);
  const nx = player.x + Math.sin(player.yaw) * drive * PLAYER_SPEED * dt;
  const nz = player.z - Math.cos(player.yaw) * drive * PLAYER_SPEED * dt;
  if (!blocked(game, nx, nz, PLAYER_RADIUS) && !game.enemies.some((e) => Math.hypot(wrap(e.x - nx), wrap(e.z - nz)) < TANK_RADIUS + PLAYER_RADIUS)) {
    player.x = nx;
    player.z = nz;
  }

  // One shell of your own in the air at a time.
  if (controls.fire && !game.shells.some((s) => s.fromPlayer)) {
    game.shells.push({ x: player.x + Math.sin(player.yaw) * 2, z: player.z - Math.cos(player.yaw) * 2, yaw: player.yaw, life: SHELL_LIFE, fromPlayer: true });
  }

  updateEnemies(game, dt);
  updateShells(game, dt);
  updateDebris(game, dt);

  // Reinforcements arrive a while after each loss, more of them as the score grows.
  while (game.enemies.length + game.reinforcements.length < enemyQuota(player.score)) game.reinforcements.push(4 + game.random() * 3);
  game.reinforcements = game.reinforcements.map((t) => t - dt);
  const due = game.reinforcements.filter((t) => t <= 0).length;
  game.reinforcements = game.reinforcements.filter((t) => t > 0);
  for (let i = 0; i < due; i++) spawnEnemy(game);
}

function updateEnemies(game: Game, dt: number): void {
  const { player, random } = game;
  for (const enemy of game.enemies) {
    const distance = Math.hypot(wrap(player.x - enemy.x), wrap(player.z - enemy.z));
    enemy.swerveTimer -= dt;
    if (enemy.swerveTimer <= 0) {
      // Far off it weaves; close in it lines up the shot.
      enemy.swerve = distance > 30 ? (random() - 0.5) * 1.4 : 0;
      enemy.swerveTimer = 2 + random() * 3;
    }
    const aim = angleDelta(headingTo(enemy.x, enemy.z, player.x, player.z) - enemy.yaw);
    enemy.detourTimer = Math.max(0, (enemy.detourTimer ?? 0) - dt);
    const detouring = enemy.detourTimer > 0 && enemy.detour !== undefined;
    const want = detouring ? angleDelta(enemy.detour! - enemy.yaw) : angleDelta(aim + enemy.swerve);
    enemy.yaw = angleDelta(enemy.yaw + Math.max(-ENEMY_TURN * dt, Math.min(ENEMY_TURN * dt, want)));
    if (Math.abs(want) < 0.6 && (distance > 16 || detouring)) {
      const nx = enemy.x + Math.sin(enemy.yaw) * ENEMY_SPEED * dt;
      const nz = enemy.z - Math.cos(enemy.yaw) * ENEMY_SPEED * dt;
      const obstacle = obstacleAt(game, nx, nz, TANK_RADIUS);
      if (obstacle) {
        // Go round it: along its edge, on whichever side the tank already leans toward.
        const toward = headingTo(enemy.x, enemy.z, obstacle.x, obstacle.z);
        const side = angleDelta(enemy.yaw - toward) >= 0 ? 1 : -1;
        enemy.detour = angleDelta(toward + side * Math.PI * 0.55);
        enemy.detourTimer = 1.6;
      } else {
        enemy.x = nx;
        enemy.z = nz;
      }
    }
    enemy.cooldown -= dt;
    if (enemy.cooldown <= 0 && Math.abs(aim) < 0.08 && distance < 70) {
      // Not a perfect shot: keep moving and some go wide.
      const yaw = enemy.yaw + (random() - 0.5) * 0.12;
      game.shells.push({ x: enemy.x + Math.sin(yaw) * 2.2, z: enemy.z - Math.cos(yaw) * 2.2, yaw, life: SHELL_LIFE * 2, fromPlayer: false });
      enemy.cooldown = 4.5 + random() * 3;
    }
  }
}

function updateShells(game: Game, dt: number): void {
  const { player } = game;
  const live: Shell[] = [];
  for (const shell of game.shells) {
    const speed = shell.fromPlayer ? PLAYER_SHELL_SPEED : ENEMY_SHELL_SPEED;
    // Sub-steps so a fast shell can't hop over a tank between frames.
    const steps = Math.max(1, Math.ceil((speed * dt) / 0.8));
    let spent = false;
    for (let i = 0; i < steps && !spent; i++) {
      shell.x += (Math.sin(shell.yaw) * speed * dt) / steps;
      shell.z -= (Math.cos(shell.yaw) * speed * dt) / steps;
      if (blocked(game, shell.x, shell.z, 0.1)) {
        explode(game, shell.x, shell.z, 3, 3);
        spent = true;
      } else if (shell.fromPlayer) {
        const target = game.enemies.findIndex((e) => Math.hypot(wrap(e.x - shell.x), wrap(e.z - shell.z)) < TANK_RADIUS);
        if (target >= 0) {
          const enemy = game.enemies[target]!;
          explode(game, enemy.x, enemy.z, 10, 7);
          game.enemies.splice(target, 1);
          player.score += 1000;
          spent = true;
        }
      } else if (Math.hypot(wrap(player.x - shell.x), wrap(player.z - shell.z)) < PLAYER_RADIUS + 0.2) {
        spent = true;
        if (game.grace <= 0) hitPlayer(game, shell);
      }
    }
    shell.life -= dt;
    if (!spent && shell.life > 0) live.push(shell);
  }
  game.shells = live;
}

function hitPlayer(game: Game, shell: Shell): void {
  const { player, random } = game;
  player.lives -= 1;
  game.hit = 2.2;
  game.grace = 4;
  // The glass cracks on the side the shell came from.
  const from = angleDelta(shell.yaw + Math.PI - player.yaw);
  game.crack = { x: Math.max(-0.8, Math.min(0.8, from)), y: (random() - 0.5) * 0.6, seed: Math.floor(random() * 1e9) };
  // Everyone backs off and reloads: a moment to recover.
  for (const enemy of game.enemies) enemy.cooldown = Math.max(enemy.cooldown, 4);
  game.shells = game.shells.filter((s) => s.fromPlayer);
  if (player.lives <= 0) game.over = true;
}

function updateDebris(game: Game, dt: number): void {
  const live: Debris[] = [];
  for (const d of game.debris) {
    d.vy -= GRAVITY * dt;
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    d.z += d.vz * dt;
    d.yaw += d.spin * dt;
    d.pitch += d.spin * 0.7 * dt;
    if (d.y < 0) {
      // Land and lie still.
      d.y = 0;
      d.vx = d.vy = d.vz = 0;
      d.spin = 0;
    }
    d.life -= dt;
    if (d.life > 0) live.push(d);
  }
  game.debris = live;
}

export interface Radar {
  /** Enemies within radar range, relative to the player's heading: x right, y ahead, in units. */
  blips: { x: number; y: number }[];
  /** "ENEMY IN RANGE", "ENEMY TO LEFT", … or "" when the field is empty. */
  message: string;
}

export const RADAR_RANGE = 90;

export function radar(game: Game, fov: number): Radar {
  const { player } = game;
  const blips: { x: number; y: number }[] = [];
  let nearest: { distance: number; bearing: number } | null = null;
  for (const enemy of game.enemies) {
    const dx = wrap(enemy.x - player.x);
    const dz = wrap(enemy.z - player.z);
    const distance = Math.hypot(dx, dz);
    const bearing = angleDelta(Math.atan2(dx, -dz) - player.yaw);
    if (distance < RADAR_RANGE) blips.push({ x: Math.sin(bearing) * distance, y: Math.cos(bearing) * distance });
    if (!nearest || distance < nearest.distance) nearest = { distance, bearing };
  }
  let message = "";
  if (nearest) {
    if (Math.abs(nearest.bearing) < fov / 2) message = "ENEMY IN RANGE";
    else if (Math.abs(nearest.bearing) > 2.4) message = "ENEMY TO REAR";
    else message = nearest.bearing < 0 ? "ENEMY TO LEFT" : "ENEMY TO RIGHT";
  }
  return { blips, message };
}
