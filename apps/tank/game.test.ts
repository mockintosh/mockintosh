import { describe, expect, it } from "vitest";
import { WORLD, angleDelta, createGame, enemyQuota, headingTo, radar, step, wrap, type Controls, type Game } from "./game";
import { TankView } from "./view";

const idle: Controls = { forward: false, back: false, left: false, right: false, fire: false };

/** A field with nothing in it but what the test puts there. */
function emptyGame(): Game {
  const game = createGame(7);
  game.obstacles = [];
  game.reinforcements = [];
  game.grace = 0;
  return game;
}

function run(game: Game, controls: Controls, seconds: number, dt = 1 / 60): void {
  for (let t = 0; t < seconds; t += dt) step(game, controls, dt);
}

describe("geometry", () => {
  it("wraps distances across the plain and folds angles", () => {
    expect(wrap(WORLD - 1)).toBeCloseTo(-1);
    expect(wrap(-WORLD + 2)).toBeCloseTo(2);
    expect(angleDelta(Math.PI * 1.5)).toBeCloseTo(-Math.PI / 2);
    // Yaw 0 faces −z; a quarter turn right faces +x.
    expect(headingTo(0, 0, 0, -10)).toBeCloseTo(0);
    expect(headingTo(0, 0, 10, 0)).toBeCloseTo(Math.PI / 2);
  });
});

describe("Tank", () => {
  it("drives forward along its heading and stops at an obstacle", () => {
    const game = emptyGame();
    run(game, { ...idle, forward: true }, 1);
    expect(game.player.z).toBeLessThan(-6);
    expect(game.player.x).toBeCloseTo(0);

    const blocked = emptyGame();
    blocked.obstacles = [{ kind: "cube", x: 0, z: -5, yaw: 0, radius: 2.1 }];
    run(blocked, { ...idle, forward: true }, 2);
    expect(blocked.player.z).toBeGreaterThan(-5 + 2.1 + 1.4 - 0.2);
  });

  it("keeps one of your shells in the air at a time, and scores a hit", () => {
    const game = emptyGame();
    game.enemies = [{ x: 0, z: -30, yaw: Math.PI, cooldown: 99, swerve: 0, swerveTimer: 99 }];
    step(game, { ...idle, fire: true }, 1 / 60);
    step(game, { ...idle, fire: true }, 1 / 60);
    expect(game.shells.filter((s) => s.fromPlayer)).toHaveLength(1);
    run(game, idle, 1);
    expect(game.enemies).toHaveLength(0);
    expect(game.player.score).toBe(1000);
    expect(game.debris.length).toBeGreaterThan(0);
  });

  it("sends a new enemy after one is destroyed", () => {
    const game = emptyGame();
    game.enemies = [];
    run(game, idle, 10);
    expect(game.enemies.length).toBe(1);
    expect(enemyQuota(3000)).toBe(2);
  });

  it("loses a life when an enemy shell lands, and ends the game on the last one", () => {
    const game = emptyGame();
    game.player.lives = 1;
    game.enemies = [{ x: 0, z: -40, yaw: 0, cooldown: 99, swerve: 0, swerveTimer: 99 }];
    game.shells = [{ x: 0, z: -10, yaw: Math.PI, life: 5, fromPlayer: false }];
    run(game, idle, 1);
    expect(game.player.lives).toBe(0);
    expect(game.over).toBe(true);
    expect(game.hit).toBeGreaterThan(0);
  });

  it("turns enemies toward you, and they fire once lined up", () => {
    const game = emptyGame();
    game.enemies = [{ x: 30, z: 0, yaw: 0, cooldown: 0, swerve: 0, swerveTimer: 99 }];
    run(game, idle, 4);
    expect(Math.abs(angleDelta(game.enemies[0]!.yaw - -Math.PI / 2))).toBeLessThan(0.1);
    expect(game.shells.some((s) => !s.fromPlayer) || game.player.lives < 3).toBe(true);
  });

  it("tells you where the nearest enemy is", () => {
    const game = emptyGame();
    game.enemies = [{ x: 0, z: -20, yaw: 0, cooldown: 99, swerve: 0, swerveTimer: 99 }];
    expect(radar(game, 1).message).toBe("ENEMY IN RANGE");
    game.enemies[0]!.x = 20;
    game.enemies[0]!.z = 0;
    expect(radar(game, 1).message).toBe("ENEMY TO RIGHT");
    game.enemies[0]!.x = 0;
    game.enemies[0]!.z = 20;
    expect(radar(game, 1).message).toBe("ENEMY TO REAR");
    expect(radar(game, 1).blips[0]!.y).toBeCloseTo(-20);
  });
});

describe("TankView", () => {
  it("draws a full frame in both looks without leaving the target", () => {
    const game = createGame(3);
    game.enemies = [{ x: 3, z: -25, yaw: 0.4, cooldown: 99, swerve: 0, swerveTimer: 99 }];
    run(game, { ...idle, left: true, fire: true }, 2);
    for (const style of ["patterns", "vector"] as const) {
      const target = { width: 320, height: 200, pixels: new Uint8Array(320 * 200) };
      new TankView().draw(target, game, style);
      const ink = target.pixels.reduce((n, p) => n + p, 0);
      expect(ink).toBeGreaterThan(1000);
      expect(ink).toBeLessThan(320 * 200);
      expect(target.pixels.every((p) => p === 0 || p === 1)).toBe(true);
    }
  });
});

describe("enemy driving", () => {
  it("goes round an obstacle in its way instead of nosing into it", () => {
    const game = emptyGame();
    game.obstacles = [{ kind: "wall", x: 0, z: -30, yaw: 0, radius: 2.6 }];
    game.enemies = [{ x: 0, z: -45, yaw: Math.PI, cooldown: 99, swerve: 0, swerveTimer: 99 }];
    run(game, idle, 12);
    const enemy = game.enemies[0]!;
    // It got past the wall and closed in.
    expect(Math.hypot(enemy.x, enemy.z)).toBeLessThan(22);
  });
});
