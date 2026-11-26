import {
  BALL_RADIUS,
  CUSHION_SEGMENTS,
  POCKETS,
  TABLE_LENGTH,
  TABLE_WIDTH,
  type Pocket,
} from "./billiardsTable.ts";

export interface Ball {
  /** 0 is the cue ball, 1 to 15 the object balls. */
  readonly id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  onTable: boolean;
}

export type PhysicsEvent =
  | { readonly kind: "ball"; readonly a: number; readonly b: number; readonly speed: number }
  | {
      readonly kind: "cushion";
      readonly ball: number;
      readonly speed: number;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly kind: "pocket";
      readonly ball: number;
      readonly pocket: number;
      readonly x: number;
      readonly y: number;
    };

/** One fixed simulation step. Small enough that a break-speed ball can't pass through another. */
export const STEP_SECONDS = 1 / 480;
/** The fastest shot, in table widths per second. */
const MAX_SHOT_SPEED = 8;
const MIN_SHOT_SPEED = 0.3;

/** Cue ball speed for a shot charged to `power` (0 to 1); low power gets the finer control. */
export function shotSpeed(power: number): number {
  return MIN_SHOT_SPEED + (MAX_SHOT_SPEED - MIN_SHOT_SPEED) * power * power;
}

export const ROLL_DECEL = 0.5;
export const DRAG = 0.12;
const SLEEP_SPEED = 0.012;
const BALL_RESTITUTION = 0.94;
export const CUSHION_RESTITUTION = 0.72;
export const CUSHION_GRIP = 0.94;
const DIAMETER = BALL_RADIUS * 2;
const OUT_MARGIN = BALL_RADIUS * 1.2;

export function makeBall(id: number, x: number, y: number): Ball {
  return { id, x, y, vx: 0, vy: 0, onTable: true };
}

export function anyMoving(balls: ReadonlyArray<Ball>): boolean {
  return balls.some((ball) => ball.onTable && (ball.vx !== 0 || ball.vy !== 0));
}

function nearestPocket(x: number, y: number): Pocket {
  let best = POCKETS[0] as Pocket;
  let bestDistance = Infinity;
  for (const pocket of POCKETS) {
    const distance = Math.hypot(pocket.x - x, pocket.y - y);
    if (distance < bestDistance) {
      best = pocket;
      bestDistance = distance;
    }
  }
  return best;
}

/** Advances every ball by one fixed step, appending what happened to `events`. Deterministic. */
export function stepPhysics(balls: Ball[], events: PhysicsEvent[]): void {
  const dt = STEP_SECONDS;

  for (const ball of balls) {
    if (!ball.onTable || (ball.vx === 0 && ball.vy === 0)) continue;
    const speed = Math.hypot(ball.vx, ball.vy);
    const loss = (ROLL_DECEL + DRAG * speed) * dt;
    if (speed - loss < SLEEP_SPEED) {
      ball.vx = 0;
      ball.vy = 0;
      continue;
    }
    const scale = (speed - loss) / speed;
    ball.vx *= scale;
    ball.vy *= scale;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
  }

  for (let i = 0; i < balls.length; i++) {
    const a = balls[i];
    if (!a?.onTable) continue;
    for (let j = i + 1; j < balls.length; j++) {
      const b = balls[j];
      if (!b?.onTable) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared >= DIAMETER * DIAMETER || distanceSquared === 0) continue;
      const distance = Math.sqrt(distanceSquared);
      const nx = dx / distance;
      const ny = dy / distance;
      const push = (DIAMETER - distance) / 2;
      a.x -= nx * push;
      a.y -= ny * push;
      b.x += nx * push;
      b.y += ny * push;
      const approach = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      if (approach <= 0) continue;
      const impulse = ((1 + BALL_RESTITUTION) / 2) * approach;
      a.vx -= impulse * nx;
      a.vy -= impulse * ny;
      b.vx += impulse * nx;
      b.vy += impulse * ny;
      events.push({ kind: "ball", a: a.id, b: b.id, speed: approach });
    }
  }

  for (const ball of balls) {
    if (!ball.onTable) continue;
    for (const { a, b } of CUSHION_SEGMENTS) {
      const sx = b.x - a.x;
      const sy = b.y - a.y;
      const t = Math.max(
        0,
        Math.min(1, ((ball.x - a.x) * sx + (ball.y - a.y) * sy) / (sx * sx + sy * sy)),
      );
      const cx = a.x + sx * t;
      const cy = a.y + sy * t;
      const dx = ball.x - cx;
      const dy = ball.y - cy;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared >= BALL_RADIUS * BALL_RADIUS || distanceSquared === 0) continue;
      const distance = Math.sqrt(distanceSquared);
      const nx = dx / distance;
      const ny = dy / distance;
      ball.x += nx * (BALL_RADIUS - distance);
      ball.y += ny * (BALL_RADIUS - distance);
      const normalSpeed = ball.vx * nx + ball.vy * ny;
      if (normalSpeed >= 0) continue;
      const tx = ball.vx - normalSpeed * nx;
      const ty = ball.vy - normalSpeed * ny;
      ball.vx = tx * CUSHION_GRIP - normalSpeed * CUSHION_RESTITUTION * nx;
      ball.vy = ty * CUSHION_GRIP - normalSpeed * CUSHION_RESTITUTION * ny;
      events.push({ kind: "cushion", ball: ball.id, speed: -normalSpeed, x: cx, y: cy });
    }
  }

  for (const ball of balls) {
    if (!ball.onTable) continue;
    const pocket = nearestPocket(ball.x, ball.y);
    const inPocket = Math.hypot(pocket.x - ball.x, pocket.y - ball.y) < pocket.radius;
    // Cushions close every gap but the pocket mouths, so a ball off the cloth went into one.
    const offCloth =
      ball.x < -OUT_MARGIN ||
      ball.x > TABLE_WIDTH + OUT_MARGIN ||
      ball.y < -OUT_MARGIN ||
      ball.y > TABLE_LENGTH + OUT_MARGIN;
    if (!inPocket && !offCloth) continue;
    events.push({ kind: "pocket", ball: ball.id, pocket: pocket.id, x: ball.x, y: ball.y });
    ball.onTable = false;
    ball.vx = 0;
    ball.vy = 0;
  }
}
