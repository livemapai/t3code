import type { Ball } from "./billiardsPhysics.ts";
import { EIGHT, type BilliardsGame } from "./billiardsRules.ts";
import {
  BALL_RADIUS,
  CUSHIONS,
  FOOT_SPOT,
  HEAD_SPOT,
  POCKETS,
  RAIL_WIDTH,
  TABLE_LENGTH,
  TABLE_WIDTH,
  type Pocket,
} from "./billiardsTable.ts";

// The canvas is a 9:16 frame around the table, in table units.
export const FRAME_WIDTH = 1.4;
const FRAME_HEIGHT = (FRAME_WIDTH * 16) / 9;
export const TABLE_ORIGIN = {
  x: (FRAME_WIDTH - TABLE_WIDTH) / 2,
  y: (FRAME_HEIGHT - TABLE_LENGTH) / 2,
};

const R = BALL_RADIUS;
const BALL_COLORS = [
  "#f4f1e8",
  "#f2c230",
  "#2160d4",
  "#d8322b",
  "#6c3fa3",
  "#f07a1f",
  "#1d8a4a",
  "#8c2233",
  "#151515",
];
const CLOTH_CENTER = "#1d6896";
const CLOTH_EDGE = "#0f3b5c";
const CUSHION = "#164f78";
const SINK_SECONDS = 0.22;
const CALL = "255, 200, 80";

export interface Sinking {
  readonly ball: number;
  readonly x: number;
  readonly y: number;
  readonly pocket: Pocket;
  readonly start: number;
}

export interface SceneView {
  readonly game: BilliardsGame;
  readonly aimAngle: number;
  /** 0 to 1 while charging a shot, null otherwise. */
  readonly power: number | null;
  readonly hoverPocket: number | null;
  readonly sinking: ReadonlyArray<Sinking>;
  /** Seconds, for pulses and animations. */
  readonly now: number;
}

export { SINK_SECONDS };

function frameTransform(ctx: CanvasRenderingContext2D, scale: number): void {
  ctx.setTransform(scale, 0, 0, scale, TABLE_ORIGIN.x * scale, TABLE_ORIGIN.y * scale);
}

/** Everything that never moves, drawn once per resize. */
export function drawStaticLayer(layer: HTMLCanvasElement, scale: number): void {
  const ctx = layer.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, layer.width, layer.height);
  frameTransform(ctx, scale);

  const backdrop = ctx.createRadialGradient(0.5, 1, 0.2, 0.5, 1, 1.6);
  backdrop.addColorStop(0, "#141b24");
  backdrop.addColorStop(1, "#06080c");
  ctx.fillStyle = backdrop;
  ctx.fillRect(-TABLE_ORIGIN.x, -TABLE_ORIGIN.y, FRAME_WIDTH, FRAME_HEIGHT);

  // Rail wood, with a soft drop shadow under the whole table.
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
  ctx.shadowBlur = 0.06 * scale;
  ctx.shadowOffsetY = 0.02 * scale;
  const wood = ctx.createLinearGradient(-RAIL_WIDTH, 0, 1 + RAIL_WIDTH, 0);
  wood.addColorStop(0, "#2a1810");
  wood.addColorStop(0.5, "#3d2416");
  wood.addColorStop(1, "#2a1810");
  ctx.fillStyle = wood;
  ctx.beginPath();
  ctx.roundRect(-RAIL_WIDTH, -RAIL_WIDTH, 1 + RAIL_WIDTH * 2, 2 + RAIL_WIDTH * 2, 0.045);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.07)";
  ctx.lineWidth = 0.003;
  ctx.stroke();

  // Cloth, under the cushions too.
  const cloth = ctx.createRadialGradient(0.5, 1, 0.1, 0.5, 1, 1.2);
  cloth.addColorStop(0, CLOTH_CENTER);
  cloth.addColorStop(1, CLOTH_EDGE);
  ctx.fillStyle = cloth;
  ctx.fillRect(-0.045, -0.045, 1.09, 2.09);
  ctx.save();
  ctx.globalAlpha = 0.07;
  ctx.fillStyle = noisePattern(ctx, scale);
  ctx.fillRect(-0.045, -0.045, 1.09, 2.09);
  ctx.restore();

  for (const cushion of CUSHIONS) {
    ctx.beginPath();
    for (const [i, point] of cushion.entries()) {
      if (i === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    }
    ctx.closePath();
    ctx.fillStyle = CUSHION;
    ctx.fill();
    const [, noseStart, noseEnd] = cushion;
    if (noseStart && noseEnd) {
      ctx.beginPath();
      ctx.moveTo(noseStart.x, noseStart.y);
      ctx.lineTo(noseEnd.x, noseEnd.y);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
      ctx.lineWidth = 0.003;
      ctx.stroke();
    }
  }

  for (const pocket of POCKETS) {
    const hole = ctx.createRadialGradient(pocket.x, pocket.y, 0, pocket.x, pocket.y, pocket.radius);
    hole.addColorStop(0, "#000");
    hole.addColorStop(0.75, "#050505");
    hole.addColorStop(1, "#1b1b1b");
    ctx.fillStyle = hole;
    ctx.beginPath();
    ctx.arc(pocket.x, pocket.y, pocket.radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Diamonds on the rails, spots and the head string on the cloth.
  ctx.fillStyle = "rgba(236, 224, 196, 0.75)";
  const railMid = RAIL_WIDTH * 0.6;
  for (const t of [0.25, 0.5, 0.75]) {
    for (const [x, y] of [
      [t, -railMid],
      [t, TABLE_LENGTH + railMid],
      [-railMid, t],
      [-railMid, 1 + t],
      [1 + railMid, t],
      [1 + railMid, 1 + t],
    ] as const) {
      ctx.beginPath();
      ctx.arc(x, y, 0.006, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
  ctx.lineWidth = 0.003;
  ctx.beginPath();
  ctx.moveTo(0, HEAD_SPOT.y);
  ctx.lineTo(1, HEAD_SPOT.y);
  ctx.stroke();
  ctx.fillStyle = "rgba(255, 255, 255, 0.18)";
  for (const spot of [HEAD_SPOT, FOOT_SPOT]) {
    ctx.beginPath();
    ctx.arc(spot.x, spot.y, 0.005, 0, Math.PI * 2);
    ctx.fill();
  }

  // The tray the potted balls line up in.
  ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
  ctx.beginPath();
  ctx.roundRect(-0.01, TRAY_Y - 0.032, 1.02, 0.064, 0.032);
  ctx.fill();
}

const TRAY_Y = TABLE_LENGTH + RAIL_WIDTH + 0.07;

function noisePattern(ctx: CanvasRenderingContext2D, scale: number): CanvasPattern | string {
  const size = 128;
  const tile = document.createElement("canvas");
  tile.width = size;
  tile.height = size;
  const tileContext = tile.getContext("2d");
  if (!tileContext) return "transparent";
  const image = tileContext.createImageData(size, size);
  for (let i = 0; i < image.data.length; i += 4) {
    const value = Math.random() * 255;
    image.data[i] = value;
    image.data[i + 1] = value;
    image.data[i + 2] = value;
    image.data[i + 3] = 255;
  }
  tileContext.putImageData(image, 0, 0);
  const pattern = ctx.createPattern(tile, "repeat");
  if (!pattern) return "transparent";
  pattern.setTransform(new DOMMatrix().scale(1 / scale));
  return pattern;
}

export function drawScene(
  ctx: CanvasRenderingContext2D,
  staticLayer: HTMLCanvasElement,
  scale: number,
  view: SceneView,
): void {
  const { game } = view;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(staticLayer, 0, 0);
  frameTransform(ctx, scale);

  const cue = game.ball(0);
  const aiming = game.phase === "aiming" && cue?.onTable;
  if (game.needsCall()) drawPocketCalls(ctx, view);
  if (aiming && cue) drawAimGuide(ctx, game, cue, view.aimAngle);

  for (const ball of game.balls) if (ball.onTable) drawShadow(ctx, ball.x, ball.y, 1);
  for (const ball of game.balls) if (ball.onTable) drawBall(ctx, ball.id, ball.x, ball.y, 1);
  for (const sinking of view.sinking) drawSinking(ctx, sinking, view.now);

  if (aiming && cue) drawCue(ctx, cue, view.aimAngle, view.power ?? 0);
  if (view.power !== null) drawPowerMeter(ctx, view.power);

  for (const [i, id] of game.pottedOrder.entries()) {
    drawBall(ctx, id, 0.035 + i * 0.066, TRAY_Y, 1);
  }
}

function drawShadow(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const shadow = ctx.createRadialGradient(
    x + R * 0.3,
    y + R * 0.45,
    0,
    x + R * 0.3,
    y + R * 0.45,
    R * 1.25 * size,
  );
  shadow.addColorStop(0, "rgba(0, 0, 0, 0.45)");
  shadow.addColorStop(0.6, "rgba(0, 0, 0, 0.25)");
  shadow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.arc(x + R * 0.3, y + R * 0.45, R * 1.25 * size, 0, Math.PI * 2);
  ctx.fill();
}

function drawBall(
  ctx: CanvasRenderingContext2D,
  id: number,
  x: number,
  y: number,
  size: number,
): void {
  const r = R * size;
  const color = BALL_COLORS[id > EIGHT ? id - EIGHT : id] ?? "#fff";
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = id > EIGHT ? "#f4f1e8" : color;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  if (id > EIGHT) {
    ctx.fillStyle = color;
    ctx.fillRect(x - r, y - r * 0.55, r * 2, r * 1.1);
  }
  if (id !== 0) {
    ctx.fillStyle = "#f7f4ea";
    ctx.beginPath();
    ctx.arc(x, y, r * 0.47, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#151515";
    ctx.font = `700 ${r * 0.62}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(id), x, y + r * 0.04);
  }
  const shade = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.05, x, y, r);
  shade.addColorStop(0, "rgba(255, 255, 255, 0.6)");
  shade.addColorStop(0.22, "rgba(255, 255, 255, 0.12)");
  shade.addColorStop(0.65, "rgba(0, 0, 0, 0)");
  shade.addColorStop(1, "rgba(0, 0, 0, 0.42)");
  ctx.fillStyle = shade;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.restore();
}

function drawSinking(ctx: CanvasRenderingContext2D, sinking: Sinking, now: number): void {
  const t = Math.min(1, (now - sinking.start) / SINK_SECONDS);
  const ease = t * t;
  const x = sinking.x + (sinking.pocket.x - sinking.x) * ease;
  const y = sinking.y + (sinking.pocket.y - sinking.y) * ease;
  const size = 1 - 0.45 * ease;
  ctx.save();
  ctx.globalAlpha = 1 - ease * 0.85;
  drawBall(ctx, sinking.ball, x, y, size);
  ctx.restore();
}

interface AimHit {
  readonly x: number;
  readonly y: number;
  readonly ball: Ball | null;
}

/** Where the cue ball would first touch a ball, or the cushion line, along `angle`. */
function castAim(game: BilliardsGame, cue: Ball, angle: number): AimHit {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let best = Infinity;
  let hit: Ball | null = null;
  for (const ball of game.balls) {
    if (!ball.onTable || ball === cue) continue;
    const fx = cue.x - ball.x;
    const fy = cue.y - ball.y;
    const b = fx * dx + fy * dy;
    const c = fx * fx + fy * fy - 4 * R * R;
    const disc = b * b - c;
    if (disc < 0) continue;
    const t = -b - Math.sqrt(disc);
    if (t > 0 && t < best) {
      best = t;
      hit = ball;
    }
  }
  const wallX = dx > 0 ? (1 - R - cue.x) / dx : dx < 0 ? (R - cue.x) / dx : Infinity;
  const wallY = dy > 0 ? (2 - R - cue.y) / dy : dy < 0 ? (R - cue.y) / dy : Infinity;
  const wall = Math.max(0, Math.min(wallX, wallY));
  if (wall < best) {
    best = wall;
    hit = null;
  }
  return { x: cue.x + dx * best, y: cue.y + dy * best, ball: hit };
}

function drawAimGuide(
  ctx: CanvasRenderingContext2D,
  game: BilliardsGame,
  cue: Ball,
  angle: number,
): void {
  const hit = castAim(game, cue, angle);
  ctx.save();
  ctx.lineCap = "round";
  ctx.setLineDash([0.01, 0.012]);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
  ctx.lineWidth = 0.0035;
  ctx.beginPath();
  ctx.moveTo(cue.x, cue.y);
  ctx.lineTo(hit.x, hit.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
  ctx.lineWidth = 0.003;
  ctx.beginPath();
  ctx.arc(hit.x, hit.y, R, 0, Math.PI * 2);
  ctx.stroke();
  if (hit.ball) {
    const nx = (hit.ball.x - hit.x) / (2 * R);
    const ny = (hit.ball.y - hit.y) / (2 * R);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
    ctx.lineWidth = 0.004;
    ctx.beginPath();
    ctx.moveTo(hit.ball.x + nx * R, hit.ball.y + ny * R);
    ctx.lineTo(hit.ball.x + nx * 0.3, hit.ball.y + ny * 0.3);
    ctx.stroke();
    // The cue ball leaves at right angles to the object ball.
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const along = dx * nx + dy * ny;
    const tx = dx - along * nx;
    const ty = dy - along * ny;
    const length = Math.hypot(tx, ty);
    if (length > 0.05) {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
      ctx.beginPath();
      ctx.moveTo(hit.x, hit.y);
      ctx.lineTo(hit.x + (tx / length) * 0.12, hit.y + (ty / length) * 0.12);
      ctx.stroke();
    }
  }
  ctx.restore();
}

const CUE_LENGTH = 1.15;

function drawCue(ctx: CanvasRenderingContext2D, cue: Ball, angle: number, power: number): void {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const back = R + 0.012 + power * 0.14;
  const tipX = cue.x - dx * back;
  const tipY = cue.y - dy * back;
  const buttX = tipX - dx * CUE_LENGTH;
  const buttY = tipY - dy * CUE_LENGTH;
  const px = -dy;
  const py = dx;
  const outline = (offset: number) => {
    ctx.beginPath();
    ctx.moveTo(tipX + px * 0.0065 + offset, tipY + py * 0.0065 + offset * 1.4);
    ctx.lineTo(buttX + px * 0.013 + offset, buttY + py * 0.013 + offset * 1.4);
    ctx.lineTo(buttX - px * 0.013 + offset, buttY - py * 0.013 + offset * 1.4);
    ctx.lineTo(tipX - px * 0.0065 + offset, tipY - py * 0.0065 + offset * 1.4);
    ctx.closePath();
  };
  outline(0.012);
  ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
  ctx.fill();
  const body = ctx.createLinearGradient(tipX, tipY, buttX, buttY);
  for (const [stop, color] of [
    [0, "#7fb2e0"],
    [0.01, "#7fb2e0"],
    [0.0101, "#f3efe4"],
    [0.025, "#f3efe4"],
    [0.026, "#e0c69c"],
    [0.62, "#b8875a"],
    [0.621, "#d4af37"],
    [0.63, "#d4af37"],
    [0.631, "#2a1810"],
    [1, "#120a06"],
  ] as const) {
    body.addColorStop(stop, color);
  }
  outline(0);
  ctx.fillStyle = body;
  ctx.fill();
}

function drawPowerMeter(ctx: CanvasRenderingContext2D, power: number): void {
  const x = 1 + RAIL_WIDTH + 0.04;
  const top = 0.6;
  const height = 0.8;
  ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
  ctx.beginPath();
  ctx.roundRect(x, top, 0.018, height, 0.009);
  ctx.fill();
  const fill = ctx.createLinearGradient(0, top + height, 0, top);
  fill.addColorStop(0, "#5ad19a");
  fill.addColorStop(0.6, "#ffc850");
  fill.addColorStop(1, "#ff5a4f");
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x, top + height * (1 - power), 0.018, height * power, 0.009);
  ctx.fill();
}

function drawPocketCalls(ctx: CanvasRenderingContext2D, view: SceneView): void {
  const pulse = 0.35 + 0.25 * Math.sin(view.now * 4);
  for (const pocket of POCKETS) {
    const called = view.game.calledPocket === pocket.id;
    const hovered = view.hoverPocket === pocket.id;
    ctx.strokeStyle = `rgba(${CALL}, ${called || hovered ? 0.95 : pulse})`;
    ctx.lineWidth = called ? 0.008 : 0.005;
    ctx.beginPath();
    ctx.arc(pocket.x, pocket.y, pocket.radius * 1.3, 0, Math.PI * 2);
    ctx.stroke();
    if (called) drawBall(ctx, EIGHT, pocket.x, pocket.y, 0.6);
  }
}
