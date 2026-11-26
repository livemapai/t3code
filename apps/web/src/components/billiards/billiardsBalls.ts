import { EIGHT } from "./billiardsRules.ts";
import { BALL_RADIUS } from "./billiardsTable.ts";

// Balls are shaded per pixel from a 3D orientation, so stripes and numbers visibly roll.
// Each ball keeps a small sprite that is redrawn only when the ball turned.

const COLORS: ReadonlyArray<readonly [number, number, number]> = [
  [244, 241, 232],
  [242, 194, 48],
  [33, 96, 212],
  [216, 50, 43],
  [108, 63, 163],
  [240, 122, 31],
  [29, 138, 74],
  [140, 34, 51],
  [21, 21, 21],
];
const WHITE: readonly [number, number, number] = [246, 243, 234];
const CUE_DOT: readonly [number, number, number] = [200, 40, 40];
// Light from the top left, a little above.
const LIGHT = normalize([-0.38, -0.48, 0.79]);
const HALF = normalize([LIGHT[0], LIGHT[1], LIGHT[2] + 1]);
/** Cosine of the number disc's angular radius. */
const NUMBER_DISC = Math.cos(0.5);
/** Stripe balls are white where the pole axis is steeper than this. */
const STRIPE_CAP = 0.58;

type Vec3 = [number, number, number];

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / length, v[1] / length, v[2] / length];
}

/** Body axes in world space: e1, e2 (stripe pole) and e3 (number). z points at the viewer. */
interface Orientation {
  e1: Vec3;
  e2: Vec3;
  e3: Vec3;
}

interface Sprite {
  readonly canvas: HTMLCanvasElement;
  readonly image: ImageData;
  dirty: boolean;
}

function rollVector(v: Vec3, ux: number, uy: number, cos: number, sin: number): void {
  // Turns v in the plane of the travel direction u and z, carrying z towards u.
  const a = v[0] * ux + v[1] * uy;
  const c = v[2];
  const a2 = a * cos + c * sin;
  const c2 = c * cos - a * sin;
  v[0] += (a2 - a) * ux;
  v[1] += (a2 - a) * uy;
  v[2] = c2;
}

export class BallSprites {
  private readonly orientations = new Map<number, Orientation>();
  private readonly sprites = new Map<number, Sprite>();
  private size = 0;

  /** Sets the sprite size from the pixels per table unit; redraws everything when it changes. */
  resize(scale: number): void {
    const size = Math.max(8, Math.min(72, Math.ceil(BALL_RADIUS * 2 * scale)));
    if (size === this.size) return;
    this.size = size;
    this.sprites.clear();
  }

  reset(): void {
    this.orientations.clear();
    for (const sprite of this.sprites.values()) sprite.dirty = true;
  }

  /** Rolls a ball by the distance it travelled. */
  roll(id: number, dx: number, dy: number): void {
    const distance = Math.hypot(dx, dy);
    if (distance < 1e-6) return;
    const orientation = this.orientation(id);
    const angle = distance / BALL_RADIUS;
    const ux = dx / distance;
    const uy = dy / distance;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    rollVector(orientation.e1, ux, uy, cos, sin);
    rollVector(orientation.e2, ux, uy, cos, sin);
    orientation.e1 = normalize(orientation.e1);
    orientation.e2 = normalize(orientation.e2);
    // Rebuild e3 from the other two, so rounding never skews the frame.
    const [a, b] = [orientation.e1, orientation.e2];
    orientation.e3 = cross(a, b);
    const c = orientation.e3;
    orientation.e3 = normalize(c);
    orientation.e2 = cross(orientation.e3, a);
    const sprite = this.sprites.get(id);
    if (sprite) sprite.dirty = true;
  }

  /** Draws ball `id` centred on (x, y) in table units; `size` scales it, as when it sinks. */
  draw(ctx: CanvasRenderingContext2D, id: number, x: number, y: number, size = 1): void {
    const sprite = this.sprite(id);
    const r = BALL_RADIUS * size;
    ctx.drawImage(sprite.canvas, x - r, y - r, r * 2, r * 2);
    if (id === 0) return;
    const { e3 } = this.orientation(id);
    this.drawNumber(ctx, id, x, y, r, e3);
    if (id > EIGHT) this.drawNumber(ctx, id, x, y, r, [-e3[0], -e3[1], -e3[2]]);
  }

  private drawNumber(
    ctx: CanvasRenderingContext2D,
    id: number,
    x: number,
    y: number,
    r: number,
    axis: Vec3,
  ): void {
    if (axis[2] < 0.35) return;
    const angle = Math.atan2(axis[1], axis[0]);
    // Drawn at real pixel size: tiny fonts scaled up by the table transform render soft.
    const matrix = ctx.getTransform();
    const at = matrix.transformPoint({ x: x + axis[0] * r * 0.98, y: y + axis[1] * r * 0.98 });
    const pixels = r * matrix.a;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, at.x, at.y);
    ctx.rotate(angle);
    ctx.scale(axis[2], 1);
    ctx.rotate(-angle);
    ctx.globalAlpha *= Math.min(1, (axis[2] - 0.35) * 4);
    ctx.fillStyle = "#151515";
    ctx.font = `700 ${pixels * 0.62}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(id), 0, pixels * 0.04);
    ctx.restore();
  }

  private orientation(id: number): Orientation {
    let orientation = this.orientations.get(id);
    if (!orientation) {
      orientation = { e1: [1, 0, 0], e2: [0, 1, 0], e3: [0, 0, 1] };
      this.orientations.set(id, orientation);
    }
    return orientation;
  }

  private sprite(id: number): Sprite {
    let sprite = this.sprites.get(id);
    if (!sprite) {
      const canvas = document.createElement("canvas");
      canvas.width = this.size;
      canvas.height = this.size;
      const context = canvas.getContext("2d");
      const image = context
        ? context.createImageData(this.size, this.size)
        : new ImageData(this.size, this.size);
      sprite = { canvas, image, dirty: true };
      this.sprites.set(id, sprite);
    }
    if (sprite.dirty) {
      this.paint(id, sprite);
      sprite.dirty = false;
    }
    return sprite;
  }

  private paint(id: number, sprite: Sprite): void {
    const { e2, e3 } = this.orientation(id);
    const base = COLORS[id > EIGHT ? id - EIGHT : id] ?? WHITE;
    const stripe = id > EIGHT;
    const size = this.size;
    const half = size / 2;
    const data = sprite.image.data;
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const i = (py * size + px) * 4;
        const x = (px + 0.5 - half) / half;
        const y = (py + 0.5 - half) / half;
        const rr = x * x + y * y;
        if (rr >= 1) {
          data[i + 3] = 0;
          continue;
        }
        const z = Math.sqrt(1 - rr);
        const b2 = x * e2[0] + y * e2[1] + z * e2[2];
        const b3 = x * e3[0] + y * e3[1] + z * e3[2];
        let color = base;
        if (id === 0) {
          color = Math.abs(b3) > 0.965 ? CUE_DOT : WHITE;
        } else if (Math.abs(b3) > NUMBER_DISC && (b3 > 0 || stripe)) {
          color = WHITE;
        } else if (stripe && Math.abs(b2) > STRIPE_CAP) {
          color = WHITE;
        }
        const diffuse = Math.max(0, x * LIGHT[0] + y * LIGHT[1] + z * LIGHT[2]);
        const specular = Math.max(0, x * HALF[0] + y * HALF[1] + z * HALF[2]) ** 48;
        const light = 0.42 + 0.68 * diffuse;
        // A soft rim darkens the edge, like the cloth under it bouncing less light back.
        const rim = 0.78 + 0.22 * z;
        const edge = Math.min(1, (1 - Math.sqrt(rr)) * half * 1.5);
        data[i] = Math.min(255, color[0] * light * rim + specular * 235);
        data[i + 1] = Math.min(255, color[1] * light * rim + specular * 235);
        data[i + 2] = Math.min(255, color[2] * light * rim + specular * 235);
        data[i + 3] = edge * 255;
      }
    }
    sprite.canvas.getContext("2d")?.putImageData(sprite.image, 0, 0);
  }
}
