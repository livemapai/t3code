import { describe, expect, it } from "vite-plus/test";

import { makeBall, type Ball, type PhysicsEvent } from "./billiardsPhysics.ts";
import {
  BilliardsGame,
  EIGHT,
  GOLDEN_SHOTS,
  placeRings,
  seededRandom,
  type PowerKind,
  type PowerRing,
} from "./billiardsRules.ts";

function settle(game: BilliardsGame): PhysicsEvent[] {
  const events: PhysicsEvent[] = [];
  for (let frame = 0; frame < 60 * 60 && game.phase === "rolling"; frame++) {
    game.advance(1 / 60, events);
  }
  return events;
}

const ring = (kind: PowerKind, x: number, y: number): PowerRing => ({
  id: 0,
  kind,
  x,
  y,
  collected: false,
});

function gameWith(balls: Ball[], rings: PowerRing[] = []): BilliardsGame {
  return new BilliardsGame({ skipBreak: true, balls, rings });
}

const UP = -Math.PI / 2;

describe("power-up rings", () => {
  it("places the same rings for the same seed", () => {
    expect(placeRings(seededRandom(9))).toEqual(placeRings(seededRandom(9)));
  });

  it("arms the next shot when the cue ball rolls over a ring", () => {
    const game = gameWith([makeBall(0, 0.5, 1.6), makeBall(3, 0.9, 0.2)], [ring("wand", 0.5, 1.3)]);
    game.shoot(UP, 1.2);
    const events = settle(game);
    expect(events.some((event) => event.kind === "powerUp")).toBe(true);
    expect(game.armed).toBe("wand");
    expect(game.rings[0]?.collected).toBe(true);
  });

  it("gives the golden cue a few shots of full sight", () => {
    const game = gameWith(
      [makeBall(0, 0.5, 1.6), makeBall(3, 0.9, 0.2)],
      [ring("golden", 0.5, 1.3)],
    );
    game.shoot(UP, 1.2);
    settle(game);
    expect(game.goldenShots).toBe(GOLDEN_SHOTS);
    game.shoot(Math.PI / 2, 0.3);
    expect(game.goldenShots).toBe(GOLDEN_SHOTS - 1);
  });
});

describe("power-up shots", () => {
  it("wand: the first ball hit drops even on a thin, slow hit", () => {
    const game = gameWith([
      makeBall(0, 0.5, 1.4),
      makeBall(3, 0.52, 1.0),
      makeBall(EIGHT, 0.2, 1.8),
    ]);
    game.armed = "wand";
    game.shoot(UP, 0.9);
    settle(game);
    expect(game.lastShot?.potted).toEqual([3]);
    expect(game.ball(0)?.onTable).toBe(true);
  });

  it("wand: won't drop the 8 while other balls are left", () => {
    const game = gameWith([
      makeBall(0, 0.5, 1.4),
      makeBall(EIGHT, 0.5, 1.0),
      makeBall(3, 0.9, 0.2),
    ]);
    game.armed = "wand";
    game.shoot(UP, 0.9);
    settle(game);
    expect(game.ball(EIGHT)?.onTable).toBe(true);
  });

  it("glow: the cue ball bursts through up to three balls and drops them", () => {
    const game = gameWith([
      makeBall(0, 0.5, 1.7),
      makeBall(3, 0.5, 1.4),
      makeBall(4, 0.5, 1.2),
      makeBall(5, 0.5, 1.0),
      makeBall(6, 0.5, 0.8),
      makeBall(EIGHT, 0.1, 1.9),
    ]);
    game.armed = "glow";
    game.shoot(UP, 2.5);
    settle(game);
    expect([...(game.lastShot?.potted ?? [])].sort()).toEqual([3, 4, 5]);
    expect(game.ball(6)?.onTable).toBe(true);
    expect(game.lastShot?.foul).toBeNull();
  });
});
