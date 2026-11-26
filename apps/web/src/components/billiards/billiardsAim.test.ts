import { describe, expect, it } from "vite-plus/test";

import { castTrajectory } from "./billiardsAim.ts";
import { makeBall } from "./billiardsPhysics.ts";
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
    const target = makeBall(5, 1 - R - 0.3, bounceY - 0.3);
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
});
