import { describe, expect, it } from "vite-plus/test";

import { castTrajectory } from "./billiardsAim.ts";
import { makeBall, shotSpeed, type PhysicsEvent } from "./billiardsPhysics.ts";
import { BilliardsGame } from "./billiardsRules.ts";
import { BALL_RADIUS } from "./billiardsTable.ts";

const R = BALL_RADIUS;

describe("castTrajectory", () => {
  it("stops where the cue ball touches the first ball", () => {
    const cue = makeBall(0, 0.5, 1.5);
    const path = castTrajectory([cue, makeBall(3, 0.5, 1)], cue, -Math.PI / 2);
    expect(path.ball?.id).toBe(3);
    expect(path.points.at(-1)?.y).toBeCloseTo(1 + 2 * R);
  });

  it("follows the cue ball off a cushion to a ball behind it", () => {
    const cue = makeBall(0, 0.5, 1.8);
    // 45 degrees up and right: off the right rail, then on to a ball up on the left.
    const bounceY = 1.8 - (1 - R - 0.5);
    // The rail keeps 72% of the speed into it and 94% along it, like the physics.
    const out = Math.hypot(0.72, 0.94);
    const target = makeBall(5, 1 - R - (0.4 * 0.72) / out, bounceY - (0.4 * 0.94) / out);
    const path = castTrajectory([cue, target], cue, -Math.PI / 4);
    expect(path.points).toHaveLength(3);
    expect(path.points[1]?.x).toBeCloseTo(1 - R);
    expect(path.ball?.id).toBe(5);
  });

  it("ends in the pocket when the cue ball heads straight into one", () => {
    const cue = makeBall(0, 0.3, 0.3);
    const path = castTrajectory([cue], cue, (-3 * Math.PI) / 4);
    expect(path.pocket).toBe(0);
    expect(path.ball).toBeNull();
  });

  it("predicts where a real shot comes off two cushions and stops", () => {
    const cue = makeBall(0, 0.3, 1.6);
    const angle = -1.1;
    const speed = shotSpeed(0.45);
    const path = castTrajectory([cue], cue, angle, speed, 6);
    const game = new BilliardsGame({ skipBreak: true, balls: [makeBall(0, 0.3, 1.6)] });
    game.shoot(angle, speed);
    const events: PhysicsEvent[] = [];
    while (game.phase === "rolling") game.advance(1 / 60, events);
    const end = path.points.at(-1)!;
    const ball = game.ball(0)!;
    expect(path.points.length).toBeGreaterThanOrEqual(3);
    expect(path.stops).toBe(true);
    expect(Math.hypot(end.x - ball.x, end.y - ball.y)).toBeLessThan(0.03);
  });
});
