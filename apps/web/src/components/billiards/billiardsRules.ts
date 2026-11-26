import {
  anyMoving,
  makeBall,
  stepPhysics,
  STEP_SECONDS,
  type Ball,
  type PhysicsEvent,
} from "./billiardsPhysics.ts";
import {
  BALL_RADIUS,
  FOOT_SPOT,
  HEAD_SPOT,
  POCKETS,
  TABLE_LENGTH,
  type Point,
} from "./billiardsTable.ts";

// Solo 8-ball: pot the other 14 in any order, then the 8 into a pocket you call.
// It's a race: the clock starts once the break settles, and fouls add seconds to it.

export type Foul = "scratch" | "noContact" | "early8" | "wrong8" | "scratch8";

/** Seconds each foul adds to the clock. */
export const FOUL_PENALTY_SECONDS: Readonly<Record<Foul, number>> = {
  scratch: 10,
  noContact: 5,
  early8: 15,
  wrong8: 15,
  scratch8: 15,
};
export const EIGHT = 8;

export type Phase = "aiming" | "rolling" | "cleared";

// Power-ups: rings on the cloth, placed by the daily seed so everyone gets the same ones.
// Rolling the cue ball over a ring arms it for the next shot.
export type PowerKind = "wand" | "golden" | "glow";

export interface PowerRing {
  readonly id: number;
  readonly kind: PowerKind;
  readonly x: number;
  readonly y: number;
  collected: boolean;
}

/** The cue ball's centre has to pass this close to a ring's centre. */
export const RING_RADIUS = 0.04;
/** How many shots the golden cue's full sight lasts. */
export const GOLDEN_SHOTS = 3;
/** How many balls one glow shot can burst into pockets. */
export const GLOW_BALLS = 3;

/** Two rings a rack: one in each half, the glow cue rarer than the other two. */
export function placeRings(random: () => number): PowerRing[] {
  const first: PowerKind = random() < 0.5 ? "wand" : "golden";
  const second: PowerKind = random() < 0.35 ? "glow" : first === "wand" ? "golden" : "wand";
  const spot = (top: number, bottom: number) => ({
    x: 0.14 + random() * 0.72,
    y: top + random() * (bottom - top),
  });
  return [
    { id: 0, kind: first, ...spot(1.05, 1.38), collected: false },
    { id: 1, kind: second, ...spot(0.18, 0.85), collected: false },
  ];
}

/** A shot that runs longer than this is stopped where it is. */
const MAX_ROLL_SECONDS = 40;

/** Same seed, same sequence: the daily rack depends on it. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The cue ball on the head spot and 15 balls racked on the foot spot, the 8 in the middle. */
export function rackBalls(random: () => number): Ball[] {
  const others = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15];
  for (let i = others.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [others[i], others[j]] = [others[j] as number, others[i] as number];
  }
  const spacing = BALL_RADIUS * 2 + 0.0004;
  const rowStep = spacing * (Math.sqrt(3) / 2);
  const balls: Ball[] = [makeBall(0, HEAD_SPOT.x, HEAD_SPOT.y)];
  let next = 0;
  for (let row = 0; row < 5; row++) {
    for (let i = 0; i <= row; i++) {
      const id = row === 2 && i === 1 ? EIGHT : (others[next++] as number);
      balls.push(makeBall(id, FOOT_SPOT.x + (i - row / 2) * spacing, FOOT_SPOT.y - row * rowStep));
    }
  }
  return balls;
}

function nearestPocketId(x: number, y: number): number {
  let best = 0;
  let bestDistance = Infinity;
  for (const pocket of POCKETS) {
    const distance = Math.hypot(pocket.x - x, pocket.y - y);
    if (distance < bestDistance) {
      best = pocket.id;
      bestDistance = distance;
    }
  }
  return best;
}

export interface ShotResult {
  readonly foul: Foul | null;
  /** The game's first miss is free: likely a slip, so it only warns. */
  readonly forgiven: boolean;
  readonly potted: ReadonlyArray<number>;
}

export interface BilliardsGameOptions {
  readonly random?: () => number;
  /** A custom layout, for tests. */
  readonly balls?: Ball[];
  /** Power-up rings; none without them. */
  readonly rings?: PowerRing[];
  readonly skipBreak?: boolean;
}

export class BilliardsGame {
  readonly balls: Ball[];
  phase: Phase = "aiming";
  isBreak: boolean;
  shots = 0;
  penaltySeconds = 0;
  calledPocket: number | null = null;
  lastShot: ShotResult | null = null;
  /** Ball ids in the order they dropped. */
  readonly pottedOrder: number[] = [];
  readonly rings: PowerRing[];
  /** Waiting for the next shot. */
  armed: "wand" | "glow" | null = null;
  /** Shots left with the golden cue's full sight. */
  goldenShots = 0;

  private accumulator = 0;
  private rollSeconds = 0;
  private firstContact: number | null = null;
  private pottedThisShot: Array<{ ball: number; pocket: number }> = [];
  private objectBallsAtShotStart = 0;
  private missForgiven = false;
  /** The power-up working on the shot that's rolling. */
  private active: "wand" | "glow" | null = null;
  private guidedThisShot = 0;

  constructor(options: BilliardsGameOptions = {}) {
    this.balls = options.balls ?? rackBalls(options.random ?? Math.random);
    this.isBreak = !options.skipBreak;
    this.rings = options.rings ?? [];
  }

  /** The power-up working on the shot that's rolling. */
  get activePower(): "wand" | "glow" | null {
    return this.active;
  }

  ball(id: number): Ball | undefined {
    return this.balls.find((ball) => ball.id === id);
  }

  /** Object balls still on the table, not counting the 8. */
  objectBallsLeft(): number {
    return this.balls.filter((ball) => ball.onTable && ball.id !== 0 && ball.id !== EIGHT).length;
  }

  /** Only the 8 is left, so a pocket has to be called before shooting. */
  needsCall(): boolean {
    return this.phase === "aiming" && this.objectBallsLeft() === 0 && !!this.ball(EIGHT)?.onTable;
  }

  callPocket(pocket: number): void {
    if (this.needsCall()) this.calledPocket = pocket;
  }

  /** Strikes the cue ball. False when it isn't time to shoot, or the 8 needs a called pocket. */
  shoot(angle: number, speed: number): boolean {
    const cue = this.ball(0);
    if (this.phase !== "aiming" || !cue?.onTable) return false;
    if (this.needsCall() && this.calledPocket === null) return false;
    cue.vx = Math.cos(angle) * speed;
    cue.vy = Math.sin(angle) * speed;
    this.firstContact = null;
    this.pottedThisShot = [];
    this.objectBallsAtShotStart = this.objectBallsLeft();
    this.active = this.armed;
    this.armed = null;
    this.guidedThisShot = 0;
    if (this.goldenShots > 0) this.goldenShots -= 1;
    this.rollSeconds = 0;
    this.accumulator = 0;
    this.phase = "rolling";
    return true;
  }

  /** Runs the simulation for `seconds` in fixed steps; settles the shot once every ball stops. */
  advance(seconds: number, events: PhysicsEvent[]): void {
    if (this.phase !== "rolling") return;
    this.accumulator += seconds;
    while (this.accumulator >= STEP_SECONDS) {
      this.accumulator -= STEP_SECONDS;
      this.rollSeconds += STEP_SECONDS;
      const from = events.length;
      stepPhysics(this.balls, events, { cueGhost: this.active === "glow" });
      const stepEnd = events.length;
      for (let i = from; i < stepEnd; i++) {
        const event = events[i];
        if (event?.kind === "ball" && (event.a === 0 || event.b === 0)) {
          const other = event.a === 0 ? event.b : event.a;
          if (this.firstContact === null) {
            this.firstContact = other;
            if (this.active === "wand") this.guide(other, events);
          }
        } else if (event?.kind === "touch") {
          this.firstContact ??= event.ball;
          if (this.active === "glow" && this.guidedThisShot < GLOW_BALLS) {
            this.guide(event.ball, events);
          }
        } else if (event?.kind === "pocket") {
          this.pottedThisShot.push({ ball: event.ball, pocket: event.pocket });
          if (event.ball !== 0) this.pottedOrder.push(event.ball);
        }
      }
      this.collectRings(events);
      if (this.rollSeconds > MAX_ROLL_SECONDS) {
        for (const ball of this.balls) {
          ball.vx = 0;
          ball.vy = 0;
          ball.guidedTo = null;
        }
      }
      if (!anyMoving(this.balls)) {
        this.settle();
        return;
      }
    }
  }

  /** Steers a ball into a pocket: the nearest, or for the last 8 the called one. */
  private guide(id: number, events: PhysicsEvent[]): void {
    const ball = this.ball(id);
    if (!ball?.onTable || ball.guidedTo !== null || id === 0) return;
    let pocket: number | null;
    if (id === EIGHT) {
      // The 8 only drops by power-up when it's the last ball and its pocket is called.
      if (this.objectBallsLeft() > 0) return;
      pocket = this.calledPocket;
    } else {
      pocket = nearestPocketId(ball.x, ball.y);
    }
    if (pocket === null) return;
    ball.guidedTo = pocket;
    this.guidedThisShot += 1;
    events.push({ kind: "guide", ball: id });
  }

  private collectRings(events: PhysicsEvent[]): void {
    const cue = this.ball(0);
    if (this.isBreak || !cue?.onTable) return;
    for (const ring of this.rings) {
      if (ring.collected || Math.hypot(ring.x - cue.x, ring.y - cue.y) > RING_RADIUS) continue;
      ring.collected = true;
      if (ring.kind === "golden") this.goldenShots = GOLDEN_SHOTS;
      else this.armed = ring.kind;
      events.push({ kind: "powerUp", ring: ring.id });
    }
  }

  private settle(): void {
    this.active = null;
    const scratched = this.pottedThisShot.some((pot) => pot.ball === 0);
    const eight = this.pottedThisShot.find((pot) => pot.ball === EIGHT);
    let foul: Foul | null = null;
    let forgiven = false;
    let cleared = false;

    if (this.isBreak) {
      this.isBreak = false;
    } else {
      this.shots += 1;
      if (eight) {
        if (this.objectBallsAtShotStart > 0) foul = "early8";
        else if (scratched) foul = "scratch8";
        else if (eight.pocket !== this.calledPocket) foul = "wrong8";
        else cleared = true;
      } else if (scratched) {
        foul = "scratch";
      } else if (this.firstContact === null) {
        foul = "noContact";
      }
      if (foul === "noContact" && !this.missForgiven) {
        this.missForgiven = true;
        forgiven = true;
      } else if (foul) {
        this.penaltySeconds += FOUL_PENALTY_SECONDS[foul];
      }
    }

    if (eight && !cleared) this.respot(EIGHT, FOOT_SPOT, -1);
    if (scratched) this.respot(0, HEAD_SPOT, 1);
    this.lastShot = {
      foul,
      forgiven,
      potted: this.pottedThisShot.map((pot) => pot.ball).filter((id) => id !== 0),
    };
    this.phase = cleared ? "cleared" : "aiming";
  }

  /** Puts a ball back on `spot`, sliding along the table (`direction` first) until it's clear. */
  private respot(id: number, spot: Point, direction: 1 | -1): void {
    const ball = this.ball(id);
    if (!ball) return;
    const potted = this.pottedOrder.lastIndexOf(id);
    if (potted !== -1) this.pottedOrder.splice(potted, 1);
    const step = BALL_RADIUS * 0.5;
    for (let i = 0; i < 400; i++) {
      const offset = (i % 2 === 1 ? 1 : -1) * Math.ceil(i / 2) * step * direction;
      const y = spot.y + offset;
      if (y < BALL_RADIUS || y > TABLE_LENGTH - BALL_RADIUS) continue;
      const free = this.balls.every(
        (other) =>
          other === ball ||
          !other.onTable ||
          Math.hypot(other.x - spot.x, other.y - y) >= BALL_RADIUS * 2 + 0.001,
      );
      if (free) {
        Object.assign(ball, { x: spot.x, y, vx: 0, vy: 0, onTable: true, guidedTo: null });
        return;
      }
    }
  }
}
