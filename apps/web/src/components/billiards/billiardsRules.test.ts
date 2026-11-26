import { describe, expect, it } from "vite-plus/test";

import { makeBall, MAX_SHOT_SPEED, type Ball, type PhysicsEvent } from "./billiardsPhysics.ts";
import { BilliardsGame, EIGHT, rackBalls, seededRandom } from "./billiardsRules.ts";
import { BALL_RADIUS, FOOT_SPOT, HEAD_SPOT, POCKETS } from "./billiardsTable.ts";

function settle(game: BilliardsGame): PhysicsEvent[] {
  const events: PhysicsEvent[] = [];
  for (let frame = 0; frame < 60 * 60 && game.phase === "rolling"; frame++) {
    game.advance(1 / 60, events);
  }
  return events;
}

function angleTo(from: Ball, x: number, y: number): number {
  return Math.atan2(y - from.y, x - from.x);
}

function overlaps(balls: ReadonlyArray<Ball>): number {
  let count = 0;
  const onTable = balls.filter((ball) => ball.onTable);
  for (let i = 0; i < onTable.length; i++) {
    for (let j = i + 1; j < onTable.length; j++) {
      const a = onTable[i] as Ball;
      const b = onTable[j] as Ball;
      if (Math.hypot(a.x - b.x, a.y - b.y) < BALL_RADIUS * 2 - 1e-6) count++;
    }
  }
  return count;
}

const topLeft = POCKETS[0]!;
const topRight = POCKETS[1]!;

describe("rackBalls", () => {
  it("racks 15 balls without overlap and the 8 in the middle", () => {
    const balls = rackBalls(seededRandom(7));
    expect(balls).toHaveLength(16);
    expect(new Set(balls.map((ball) => ball.id)).size).toBe(16);
    expect(overlaps(balls)).toBe(0);
    const eight = balls.find((ball) => ball.id === EIGHT)!;
    expect(eight.x).toBeCloseTo(FOOT_SPOT.x);
  });

  it("racks the same way for the same seed", () => {
    expect(rackBalls(seededRandom(42))).toEqual(rackBalls(seededRandom(42)));
  });
});

describe("the break", () => {
  it("spreads the rack at full power and comes to rest on the table", () => {
    const game = new BilliardsGame({ random: seededRandom(3) });
    const cue = game.ball(0)!;
    expect(game.shoot(angleTo(cue, FOOT_SPOT.x, FOOT_SPOT.y) + 0.004, MAX_SHOT_SPEED)).toBe(true);
    settle(game);
    expect(game.phase).toBe("aiming");
    expect(game.shots).toBe(0);
    expect(game.penaltySeconds).toBe(0);
    expect(overlaps(game.balls)).toBe(0);
    for (const ball of game.balls.filter((b) => b.onTable)) {
      expect(ball.x).toBeGreaterThan(0);
      expect(ball.x).toBeLessThan(1);
      expect(ball.y).toBeGreaterThan(0);
      expect(ball.y).toBeLessThan(2);
    }
    const moved = game.balls.filter((b) => b.id !== 0 && Math.abs(b.y - FOOT_SPOT.y) > 0.2);
    expect(moved.length).toBeGreaterThan(5);
  });

  it("is the same every time for the same rack and shot", () => {
    const run = () => {
      const game = new BilliardsGame({ random: seededRandom(11) });
      game.shoot(-Math.PI / 2 + 0.01, MAX_SHOT_SPEED);
      settle(game);
      return game.balls.map((ball) => [ball.id, ball.x, ball.y, ball.onTable]);
    };
    expect(run()).toEqual(run());
  });
});

describe("rules", () => {
  // Cue and 8 on the diagonal to the top-left corner, so a straight shot pots the 8 there.
  const eightShot = (extra: Ball[] = []) => {
    const game = new BilliardsGame({
      skipBreak: true,
      balls: [makeBall(0, 0.4, 0.4), makeBall(EIGHT, 0.2, 0.2), ...extra],
    });
    return { game, angle: angleTo(game.ball(0)!, topLeft.x, topLeft.y) };
  };

  it("needs a called pocket before shooting the 8", () => {
    const { game, angle } = eightShot();
    expect(game.needsCall()).toBe(true);
    expect(game.shoot(angle, 2)).toBe(false);
  });

  it("clears the table when the 8 drops in the called pocket", () => {
    const { game, angle } = eightShot();
    game.callPocket(topLeft.id);
    expect(game.shoot(angle, 2)).toBe(true);
    settle(game);
    expect(game.phase).toBe("cleared");
    expect(game.shots).toBe(1);
    expect(game.penaltySeconds).toBe(0);
  });

  it("respots the 8 with a penalty when it drops in another pocket", () => {
    const { game, angle } = eightShot();
    game.callPocket(topRight.id);
    game.shoot(angle, 2);
    settle(game);
    expect(game.phase).toBe("aiming");
    expect(game.lastShot?.foul).toBe("wrong8");
    expect(game.penaltySeconds).toBe(15);
    expect(game.ball(EIGHT)).toMatchObject({ onTable: true, x: FOOT_SPOT.x });
  });

  it("respots the 8 with a penalty when it drops before the other balls", () => {
    const { game, angle } = eightShot([makeBall(3, 0.8, 1.6)]);
    expect(game.needsCall()).toBe(false);
    game.shoot(angle, 2);
    settle(game);
    expect(game.lastShot?.foul).toBe("early8");
    expect(game.penaltySeconds).toBe(15);
    expect(game.ball(EIGHT)?.onTable).toBe(true);
  });

  it("puts a scratched cue ball back on the head spot with a penalty", () => {
    const game = new BilliardsGame({
      skipBreak: true,
      balls: [makeBall(0, 0.3, 0.3), makeBall(3, 0.8, 1.6)],
    });
    game.shoot(angleTo(game.ball(0)!, topLeft.x, topLeft.y), 2);
    settle(game);
    expect(game.lastShot?.foul).toBe("scratch");
    expect(game.penaltySeconds).toBe(10);
    expect(game.ball(0)).toMatchObject({ onTable: true, x: HEAD_SPOT.x, y: HEAD_SPOT.y });
  });

  it("forgives the first miss of a game, then adds seconds for each miss", () => {
    const game = new BilliardsGame({
      skipBreak: true,
      balls: [makeBall(0, 0.5, 1.5), makeBall(3, 0.8, 0.3)],
    });
    game.shoot(Math.PI / 2, 0.6);
    settle(game);
    expect(game.lastShot).toMatchObject({ foul: "noContact", forgiven: true });
    expect(game.penaltySeconds).toBe(0);
    game.shoot(-Math.PI / 2, 0.6);
    settle(game);
    expect(game.lastShot).toMatchObject({ foul: "noContact", forgiven: false });
    expect(game.penaltySeconds).toBe(5);
  });

  it("counts a clean pot as one shot", () => {
    const game = new BilliardsGame({
      skipBreak: true,
      balls: [makeBall(0, 0.4, 0.4), makeBall(3, 0.2, 0.2), makeBall(EIGHT, 0.5, 1.2)],
    });
    game.shoot(angleTo(game.ball(0)!, topLeft.x, topLeft.y), 2);
    settle(game);
    expect(game.lastShot).toEqual({ foul: null, forgiven: false, potted: [3] });
    expect(game.penaltySeconds).toBe(0);
    expect(game.needsCall()).toBe(true);
  });
});
