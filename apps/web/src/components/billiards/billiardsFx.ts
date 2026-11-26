import type { Ball, PhysicsEvent } from "./billiardsPhysics.ts";
import { EIGHT } from "./billiardsRules.ts";
import { BALL_RADIUS, POCKETS, TABLE_LENGTH, TABLE_WIDTH } from "./billiardsTable.ts";

// Everything here is looks only: it never feeds back into the simulation.

const R = BALL_RADIUS;
const MAX_PARTICLES = 240;
const GOLD = "255, 200, 80";
const WHITE = "255, 255, 255";
const DUST = "205, 225, 255";

/**
 * The cloth's memory: a rolling ball brushes the nap into a light trail that stays for the game.
 * A ball crossing an older trail brushes it back flat, so crossings return to plain cloth. Each
 * shot paints into its own layer, which is XORed onto the settled marks when the shot ends, so
 * a ball never erases the trail it is drawing right now.
 */
export class ClothNap {
  private readonly settled = document.createElement("canvas");
  private readonly shot = document.createElement("canvas");
  private readonly view = document.createElement("canvas");
  private scale = 1;
  private originX = 0;
  private originY = 0;
  private shotMarked = false;
  private viewStale = true;

  resize(width: number, height: number, scale: number, originX: number, originY: number): void {
    for (const canvas of [this.settled, this.shot, this.view]) {
      canvas.width = width;
      canvas.height = height;
    }
    this.scale = scale;
    this.originX = originX;
    this.originY = originY;
    this.shotMarked = false;
    this.viewStale = true;
  }

  clear(): void {
    for (const canvas of [this.settled, this.shot, this.view]) {
      canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    }
    this.shotMarked = false;
    this.viewStale = true;
  }

  /** Brushes the nap along a ball's path this frame. */
  stamp(x0: number, y0: number, x1: number, y1: number): void {
    const ctx = this.shot.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(this.scale, 0, 0, this.scale, this.originX, this.originY);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = R * 1.6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    this.shotMarked = true;
    this.viewStale = true;
  }

  /** The shot ended: its trail joins the cloth, flattening the older trails it crossed. */
  commit(): void {
    if (!this.shotMarked) return;
    const ctx = this.settled.getContext("2d");
    if (ctx) {
      ctx.globalCompositeOperation = "xor";
      ctx.drawImage(this.shot, 0, 0);
      ctx.globalCompositeOperation = "source-over";
    }
    this.shot.getContext("2d")?.clearRect(0, 0, this.shot.width, this.shot.height);
    this.shotMarked = false;
    this.viewStale = true;
  }

  /** Lays the nap over the cloth, never over the pockets or rails. Expects the table transform. */
  draw(ctx: CanvasRenderingContext2D, shiftX: number, shiftY: number): void {
    if (this.viewStale) {
      const view = this.view.getContext("2d");
      if (view) {
        view.clearRect(0, 0, this.view.width, this.view.height);
        view.drawImage(this.settled, 0, 0);
        if (this.shotMarked) {
          view.globalCompositeOperation = "xor";
          view.drawImage(this.shot, 0, 0);
          view.globalCompositeOperation = "source-over";
        }
      }
      this.viewStale = false;
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, TABLE_WIDTH, TABLE_LENGTH);
    for (const pocket of POCKETS) {
      ctx.moveTo(pocket.x + pocket.radius, pocket.y);
      ctx.arc(pocket.x, pocket.y, pocket.radius, 0, Math.PI * 2);
    }
    ctx.clip("evenodd");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 0.13;
    ctx.filter = `blur(${Math.max(1, R * 0.2 * this.scale)}px)`;
    ctx.drawImage(this.view, shiftX, shiftY);
    ctx.restore();
  }
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  readonly life: number;
  readonly size: number;
  readonly color: string;
  readonly drag: number;
}

interface Ring {
  readonly x: number;
  readonly y: number;
  age: number;
  readonly life: number;
  readonly from: number;
  readonly to: number;
  readonly width: number;
  readonly color: string;
  readonly alpha: number;
}

export class Effects {
  private particles: Particle[] = [];
  private rings: Ring[] = [];
  private shakeTime = 0;
  private shakePower = 0;
  /** A shot gets one hit-stop at most, on its first hard contact. */
  private impactShown = false;
  /** Seconds the whole scene stays frozen, for the weight of a hard hit. */
  hitStop = 0;

  reset(): void {
    this.particles = [];
    this.rings = [];
    this.shakeTime = 0;
    this.hitStop = 0;
  }

  cueStrike(cue: Ball, angle: number, power: number): void {
    this.impactShown = false;
    this.ring(cue.x, cue.y, R, R * (2 + power * 2), 0.18, 0.004, WHITE, 0.35 + power * 0.4);
    const count = Math.round(3 + power * 6);
    for (let i = 0; i < count; i++) {
      // Chalk puffs back off the tip.
      const spread = angle + Math.PI + (Math.random() - 0.5) * 1.2;
      const speed = 0.08 + Math.random() * 0.25 * (0.4 + power);
      this.particle(
        cue.x - Math.cos(angle) * R,
        cue.y - Math.sin(angle) * R,
        Math.cos(spread) * speed,
        Math.sin(spread) * speed,
        0.35 + Math.random() * 0.25,
        0.003 + Math.random() * 0.003,
        "127, 178, 224",
        5,
      );
    }
  }

  /** Turns this frame's contacts into effects. `breakShot` says whether the rack is breaking. */
  onEvents(
    events: ReadonlyArray<PhysicsEvent>,
    balls: ReadonlyArray<Ball>,
    breakShot: boolean,
  ): void {
    let hardest = 0;
    for (const event of events) {
      if (event.kind === "ball") {
        hardest = Math.max(hardest, event.speed);
        if (event.speed < 0.5) continue;
        const a = balls.find((ball) => ball.id === event.a);
        const b = balls.find((ball) => ball.id === event.b);
        if (!a || !b) continue;
        const x = (a.x + b.x) / 2;
        const y = (a.y + b.y) / 2;
        const v = Math.min(1, event.speed / 5);
        this.ring(x, y, R * 0.3, R * (1 + v * 1.6), 0.16, 0.003, WHITE, 0.25 + v * 0.45);
        if (event.speed > 2.5) this.burst(x, y, Math.round(2 + v * 6), 0.4 * v, WHITE, 0.25);
      } else if (event.kind === "cushion") {
        if (event.speed < 0.4) continue;
        const v = Math.min(1, event.speed / 4);
        this.burst(event.x, event.y, Math.round(3 + v * 7), 0.12 + 0.22 * v, DUST, 0.5);
        this.ring(
          event.x,
          event.y,
          R * 0.4,
          R * (1.2 + v * 1.5),
          0.25,
          0.0025,
          DUST,
          0.15 + v * 0.3,
        );
      } else if (event.kind === "pocket") {
        const pocket = POCKETS[event.pocket];
        if (!pocket) continue;
        const gold = event.ball === EIGHT;
        const color = gold ? GOLD : event.ball === 0 ? "255, 110, 90" : WHITE;
        this.ring(
          pocket.x,
          pocket.y,
          pocket.radius * 0.8,
          pocket.radius * 2.4,
          0.5,
          0.006,
          color,
          0.8,
        );
        this.ring(pocket.x, pocket.y, pocket.radius, pocket.radius * 1.6, 0.3, 0.003, color, 0.5);
        for (let i = 0; i < 14; i++) {
          // Sparks drawn into the pocket.
          const angle = (i / 14) * Math.PI * 2 + Math.random() * 0.3;
          const distance = pocket.radius * (1.6 + Math.random());
          const speed = distance / 0.35;
          this.particle(
            pocket.x + Math.cos(angle) * distance,
            pocket.y + Math.sin(angle) * distance,
            -Math.cos(angle) * speed,
            -Math.sin(angle) * speed,
            0.32,
            0.0035,
            color,
            0,
          );
        }
      }
    }
    if (this.impactShown) return;
    if (breakShot && hardest > 3) {
      this.impactShown = true;
      this.hitStop = 0.05;
      this.shake(0.006, 0.3);
    } else if (hardest > 5.5) {
      this.impactShown = true;
      this.hitStop = 0.03;
    }
  }

  /** A power-up collected, or a ball taken by one: a burst in its colour. */
  powerBurst(x: number, y: number, color: string): void {
    this.ring(x, y, R, R * 5, 0.55, 0.006, color, 0.9);
    this.ring(x, y, R * 0.5, R * 3, 0.35, 0.003, WHITE, 0.6);
    this.burst(x, y, 22, 0.55, color, 0.6);
  }

  /** One spark left behind something magic as it moves. */
  trail(x: number, y: number, color: string): void {
    const angle = Math.random() * Math.PI * 2;
    this.particle(
      x + Math.cos(angle) * R * 0.6,
      y + Math.sin(angle) * R * 0.6,
      Math.cos(angle) * 0.03,
      Math.sin(angle) * 0.03,
      0.45 + Math.random() * 0.3,
      0.0025 + Math.random() * 0.0025,
      color,
      2,
    );
  }

  /** The table cleared: a wide gold wave from the called pocket. */
  celebrate(pocketId: number | null): void {
    const pocket = POCKETS.find((candidate) => candidate.id === pocketId) ?? POCKETS[0];
    if (!pocket) return;
    for (const [delay, width] of [
      [0, 0.012],
      [0.12, 0.007],
      [0.24, 0.004],
    ] as const) {
      this.rings.push({
        x: pocket.x,
        y: pocket.y,
        age: -delay,
        life: 1.3,
        from: pocket.radius,
        to: 2.4,
        width,
        color: GOLD,
        alpha: 0.7,
      });
    }
    this.shake(0.004, 0.25);
  }

  private shake(power: number, time: number): void {
    this.shakePower = Math.max(this.shakePower * (this.shakeTime > 0 ? 1 : 0), power);
    this.shakeTime = Math.max(this.shakeTime, time);
  }

  /** How far the frame is thrown this instant, in table units. */
  shakeOffset(): { readonly x: number; readonly y: number } {
    if (this.shakeTime <= 0) return { x: 0, y: 0 };
    const power = this.shakePower * Math.min(1, this.shakeTime / 0.3);
    return { x: (Math.random() - 0.5) * 2 * power, y: (Math.random() - 0.5) * 2 * power };
  }

  update(seconds: number): void {
    this.shakeTime = Math.max(0, this.shakeTime - seconds);
    for (const particle of this.particles) {
      particle.age += seconds;
      const drag = Math.exp(-particle.drag * seconds);
      particle.vx *= drag;
      particle.vy *= drag;
      particle.x += particle.vx * seconds;
      particle.y += particle.vy * seconds;
    }
    this.particles = this.particles.filter((particle) => particle.age < particle.life);
    for (const ring of this.rings) ring.age += seconds;
    this.rings = this.rings.filter((ring) => ring.age < ring.life);
  }

  /** Draws rings and particles. Expects the table transform. */
  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const ring of this.rings) {
      if (ring.age < 0) continue;
      const t = ring.age / ring.life;
      const ease = 1 - (1 - t) * (1 - t);
      ctx.strokeStyle = `rgba(${ring.color}, ${ring.alpha * (1 - t)})`;
      ctx.lineWidth = ring.width * (1 - t * 0.6);
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, ring.from + (ring.to - ring.from) * ease, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const particle of this.particles) {
      const t = particle.age / particle.life;
      ctx.fillStyle = `rgba(${particle.color}, ${0.85 * (1 - t)})`;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size * (1 - t * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private burst(x: number, y: number, count: number, speed: number, color: string, life: number) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.6);
      this.particle(
        x,
        y,
        Math.cos(angle) * v,
        Math.sin(angle) * v,
        life * (0.6 + Math.random() * 0.4),
        0.0025 + Math.random() * 0.003,
        color,
        4,
      );
    }
  }

  private particle(
    x: number,
    y: number,
    vx: number,
    vy: number,
    life: number,
    size: number,
    color: string,
    drag: number,
  ): void {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.particles.push({ x, y, vx, vy, age: 0, life, size, color, drag });
  }

  private ring(
    x: number,
    y: number,
    from: number,
    to: number,
    life: number,
    width: number,
    color: string,
    alpha: number,
  ): void {
    this.rings.push({ x, y, age: 0, life, from, to, width, color, alpha });
  }
}
