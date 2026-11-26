import type { Ball } from "./billiardsPhysics.ts";
import { BALL_RADIUS, TABLE_LENGTH, TABLE_WIDTH, type Point } from "./billiardsTable.ts";

const R = BALL_RADIUS;
/** How many cushions the guide follows the cue ball off. */
const AIM_BOUNCES = 2;
const MAX_LENGTH = 3;

export interface Trajectory {
  /** The cue ball's path: its centre at the start, at each cushion, and where it ends. */
  readonly points: ReadonlyArray<Point>;
  /** The ball it hits first, with the cue ball touching it at the path's last point. */
  readonly ball: Ball | null;
  /** The path ends in this pocket: a scratch, unless a ball comes first. */
  readonly pocket: number | null;
  /** Direction of the last segment, for the cue ball's deflection off `ball`. */
  readonly dx: number;
  readonly dy: number;
}

// Where the rails open into a pocket, measured along the rail the path reaches.
const CORNER_OPENING = 0.07;
const SIDE_OPENING = 0.045;

/** The pocket whose mouth the path reaches at a rail, if any. */
function pocketAt(x: number, y: number, onSideRail: boolean): number | null {
  const right = x > TABLE_WIDTH / 2;
  const top = y < TABLE_LENGTH / 2;
  if (onSideRail && Math.abs(y - TABLE_LENGTH / 2) < SIDE_OPENING) return right ? 3 : 2;
  const along = onSideRail ? Math.min(y, TABLE_LENGTH - y) : Math.min(x, TABLE_WIDTH - x);
  if (along < CORNER_OPENING) return top ? (right ? 1 : 0) : right ? 5 : 4;
  return null;
}

/**
 * Where the cue ball goes along `angle` if nothing slows it: off up to `bounces` cushions,
 * until it touches a ball or runs into a pocket. Cushions are treated as straight rails.
 */
export function castTrajectory(
  balls: ReadonlyArray<Ball>,
  cue: Ball,
  angle: number,
  bounces = AIM_BOUNCES,
): Trajectory {
  let x = cue.x;
  let y = cue.y;
  let dx = Math.cos(angle);
  let dy = Math.sin(angle);
  let travelled = 0;
  const points: Point[] = [{ x, y }];
  for (let bounce = 0; ; bounce++) {
    let best = Infinity;
    let hit: Ball | null = null;
    for (const ball of balls) {
      if (!ball.onTable || ball === cue) continue;
      const fx = x - ball.x;
      const fy = y - ball.y;
      const b = fx * dx + fy * dy;
      const c = fx * fx + fy * fy - 4 * R * R;
      const disc = b * b - c;
      if (disc < 0) continue;
      const t = -b - Math.sqrt(disc);
      if (t > 1e-6 && t < best) {
        best = t;
        hit = ball;
      }
    }
    const wallX = dx > 0 ? (TABLE_WIDTH - R - x) / dx : dx < 0 ? (R - x) / dx : Infinity;
    const wallY = dy > 0 ? (TABLE_LENGTH - R - y) / dy : dy < 0 ? (R - y) / dy : Infinity;
    const wall = Math.max(0, Math.min(wallX, wallY));
    const remaining = MAX_LENGTH - travelled;
    if (hit && best <= wall && best <= remaining) {
      points.push({ x: x + dx * best, y: y + dy * best });
      return { points, ball: hit, pocket: null, dx, dy };
    }
    const step = Math.min(wall, remaining);
    x += dx * step;
    y += dy * step;
    travelled += step;
    points.push({ x, y });
    if (step === remaining) return { points, ball: null, pocket: null, dx, dy };
    const pocket = pocketAt(x, y, wall === wallX);
    if (pocket !== null || bounce >= bounces) return { points, ball: null, pocket, dx, dy };
    if (wall === wallX) dx = -dx;
    if (wall === wallY) dy = -dy;
  }
}
