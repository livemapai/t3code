import { castTrajectory, GOLDEN_SIGHT } from "./billiardsAim.ts";
import { drawCue, drawRings, POWER_COLORS, type CueStyle } from "./billiardsCues.ts";
import type { BallSprites } from "./billiardsBalls.ts";
import type { ClothNap, Effects } from "./billiardsFx.ts";
import { shotSpeed, type Ball } from "./billiardsPhysics.ts";
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
  readonly sprites: BallSprites;
  readonly nap: ClothNap;
  readonly fx: Effects;
  /** Screen shake, in table units. */
  readonly shake: { readonly x: number; readonly y: number };
  /** 0 to 1: darkens the edges while the final 8 rolls in slow motion. */
  readonly vignette: number;
  readonly cueStyle: CueStyle;
}

export { SINK_SECONDS };

function frameTransform(
  ctx: CanvasRenderingContext2D,
  scale: number,
  shiftX = 0,
  shiftY = 0,
): void {
  ctx.setTransform(
    scale,
    0,
    0,
    scale,
    (TABLE_ORIGIN.x + shiftX) * scale,
    (TABLE_ORIGIN.y + shiftY) * scale,
  );
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
  const { game, sprites } = view;
  const shiftX = view.shake.x * scale;
  const shiftY = view.shake.y * scale;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (shiftX !== 0 || shiftY !== 0) {
    ctx.fillStyle = "#06080c";
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }
  ctx.drawImage(staticLayer, shiftX, shiftY);
  frameTransform(ctx, scale, view.shake.x, view.shake.y);
  view.nap.draw(ctx, shiftX, shiftY);
  if (!game.isBreak) drawRings(ctx, game.rings, view.now);

  const cue = game.ball(0);
  const aiming = game.phase === "aiming" && cue?.onTable;
  if (game.needsCall()) drawPocketCalls(ctx, view);
  if (aiming && cue) {
    drawAimGuide(ctx, game, cue, view.aimAngle, view.power, game.goldenShots > 0);
  }

  for (const ball of game.balls) if (ball.onTable) drawShadow(ctx, ball.x, ball.y, 1);
  for (const ball of game.balls) if (ball.onTable) sprites.draw(ctx, ball.id, ball.x, ball.y);
  for (const sinking of view.sinking) drawSinking(ctx, sprites, sinking, view.now);
  view.fx.draw(ctx);

  if (aiming && cue) {
    drawCue(ctx, cue, view.aimAngle, view.power ?? 0, view.cueStyle, view.now);
  }
  if (view.power !== null) drawPowerMeter(ctx, view.power);

  for (const [i, id] of game.pottedOrder.entries()) {
    sprites.draw(ctx, id, 0.035 + i * 0.066, TRAY_Y);
  }
  if (view.vignette > 0) drawVignette(ctx, view.vignette);
}

function drawVignette(ctx: CanvasRenderingContext2D, amount: number): void {
  const shade = ctx.createRadialGradient(0.5, 1, 0.45, 0.5, 1, 1.45);
  shade.addColorStop(0, "rgba(0, 0, 0, 0)");
  shade.addColorStop(1, `rgba(0, 0, 0, ${0.6 * amount})`);
  ctx.fillStyle = shade;
  ctx.fillRect(
    -TABLE_ORIGIN.x - 0.05,
    -TABLE_ORIGIN.y - 0.05,
    FRAME_WIDTH + 0.1,
    FRAME_HEIGHT + 0.1,
  );
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

function drawSinking(
  ctx: CanvasRenderingContext2D,
  sprites: BallSprites,
  sinking: Sinking,
  now: number,
): void {
  const t = Math.min(1, (now - sinking.start) / SINK_SECONDS);
  const ease = t * t;
  const x = sinking.x + (sinking.pocket.x - sinking.x) * ease;
  const y = sinking.y + (sinking.pocket.y - sinking.y) * ease;
  const size = 1 - 0.45 * ease;
  ctx.save();
  ctx.globalAlpha = 1 - ease * 0.85;
  sprites.draw(ctx, sinking.ball, x, y, size);
  ctx.restore();
}

function drawAimGuide(
  ctx: CanvasRenderingContext2D,
  game: BilliardsGame,
  cue: Ball,
  angle: number,
  power: number | null,
  golden: boolean,
): void {
  // While charging, the line only reaches as far as this power rolls the cue ball.
  const speed = power === null ? null : shotSpeed(power);
  const path = golden
    ? castTrajectory(game.balls, cue, angle, speed, GOLDEN_SIGHT.bounces, GOLDEN_SIGHT.length)
    : castTrajectory(game.balls, cue, angle, speed);
  const dots = golden ? POWER_COLORS.golden : "255, 255, 255";
  ctx.save();
  ctx.lineCap = "round";
  // Zero-length dashes with round caps draw dots; each cushion leg fades a little more.
  ctx.setLineDash([0, 0.017]);
  ctx.lineWidth = 0.0065;
  for (let i = 1; i < path.points.length; i++) {
    const from = path.points[i - 1];
    const to = path.points[i];
    if (!from || !to) continue;
    ctx.strokeStyle = `rgba(${dots}, ${Math.max(0.2, 0.8 - (i - 1) * (golden ? 0.1 : 0.25))})`;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  const end = path.points[path.points.length - 1] ?? cue;
  if (path.ball) {
    const { ball } = path;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.75)";
    ctx.lineWidth = 0.004;
    ctx.beginPath();
    ctx.arc(end.x, end.y, R, 0, Math.PI * 2);
    ctx.stroke();
    const nx = (ball.x - end.x) / (2 * R);
    const ny = (ball.y - end.y) / (2 * R);
    if (golden) {
      // Full sight: where the object ball goes, off its cushions too.
      const others = game.balls.filter((other) => other !== cue);
      const objectPath = castTrajectory(others, ball, Math.atan2(ny, nx), null, 3, 2.5);
      ctx.setLineDash([0, 0.017]);
      ctx.lineWidth = 0.0065;
      ctx.strokeStyle = `rgba(${POWER_COLORS.golden}, 0.85)`;
      ctx.beginPath();
      for (const [i, point] of objectPath.points.entries()) {
        if (i === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
      ctx.lineWidth = 0.0045;
      ctx.beginPath();
      ctx.moveTo(ball.x + nx * R, ball.y + ny * R);
      ctx.lineTo(ball.x + nx * 0.3, ball.y + ny * 0.3);
      ctx.stroke();
    }
    // The cue ball leaves at right angles to the object ball.
    const along = path.dx * nx + path.dy * ny;
    const tx = path.dx - along * nx;
    const ty = path.dy - along * ny;
    const length = Math.hypot(tx, ty);
    if (length > 0.05) {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
      ctx.lineWidth = 0.003;
      ctx.beginPath();
      ctx.moveTo(end.x, end.y);
      ctx.lineTo(end.x + (tx / length) * 0.12, end.y + (ty / length) * 0.12);
      ctx.stroke();
    }
  } else if (path.stops) {
    ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
    ctx.lineWidth = 0.003;
    ctx.beginPath();
    ctx.arc(end.x, end.y, R, 0, Math.PI * 2);
    ctx.stroke();
  } else if (path.pocket !== null) {
    // Straight into a pocket: a scratch.
    ctx.strokeStyle = "rgba(255, 110, 90, 0.85)";
    ctx.lineWidth = 0.004;
    ctx.beginPath();
    ctx.arc(end.x, end.y, R, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
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
    if (called) view.sprites.draw(ctx, EIGHT, pocket.x, pocket.y, 0.6);
  }
}
