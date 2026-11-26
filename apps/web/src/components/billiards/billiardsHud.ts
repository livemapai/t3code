import { RAIL_WIDTH, TABLE_LENGTH, TABLE_WIDTH } from "./billiardsTable.ts";

// The scoreboard lives in the scene: a brass plate on the top rail for the clock, chalk tallies
// for shots, and callouts that pop up where something happened. Words come in translated.

export interface BilliardsLabels {
  readonly scratch: string;
  readonly miss: string;
  readonly freeMiss: string;
  readonly early8: string;
  readonly wrong8: string;
  readonly scratch8: string;
  readonly wand: string;
  readonly golden: string;
  readonly glow: string;
  readonly wandHint: string;
  readonly goldenHint: string;
  readonly glowHint: string;
  readonly callPocket: string;
  readonly callFirst: string;
  readonly breakHint: string;
  readonly controlsHint: string;
  readonly penalty: (seconds: number) => string;
}

export interface ScoreView {
  readonly totalMs: number;
  readonly penaltySeconds: number;
  readonly shots: number;
  readonly bestMs: number | null;
  readonly goldenShots: number;
  readonly isBreak: boolean;
  /** Only the 8 is left and no pocket is called yet. */
  readonly callNeeded: boolean;
}

const BRASS = "#c9a24a";
const PLATE_WIDTH = 0.44;
const PLATE_HEIGHT = 0.14;
const PLATE_Y = -RAIL_WIDTH - 0.02 - PLATE_HEIGHT;
const CHALK = "236, 233, 222";
const ROUNDED = `ui-rounded, "SF Pro Rounded", ui-sans-serif, system-ui, sans-serif`;
const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

export function formatClock(ms: number, tenths = false): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return tenths ? `${clock}.${Math.floor((Math.max(0, ms) % 1000) / 100)}` : clock;
}

interface TextStyle {
  readonly weight?: number;
  readonly family?: string;
  readonly fill: string;
  readonly stroke?: string;
  /** Outline width, in table units. */
  readonly strokeWidth?: number;
  readonly align?: CanvasTextAlign;
  /** In table units. */
  readonly maxWidth?: number;
}

/**
 * Text at (x, y) in table units, `size` tall, drawn at real pixel size: canvas fonts smaller than a
 * pixel, scaled up by the table transform, come out soft and blocky.
 */
function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  style: TextStyle,
): void {
  const matrix = ctx.getTransform();
  const at = matrix.transformPoint({ x, y });
  const scale = matrix.a;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = `${style.weight ?? 700} ${size * scale}px ${style.family ?? ROUNDED}`;
  ctx.textAlign = style.align ?? "center";
  ctx.textBaseline = "middle";
  const maxWidth = style.maxWidth === undefined ? undefined : style.maxWidth * scale;
  if (style.stroke) {
    ctx.lineJoin = "round";
    ctx.lineWidth = (style.strokeWidth ?? 0.008) * scale;
    ctx.strokeStyle = style.stroke;
    ctx.strokeText(text, at.x, at.y, maxWidth);
  }
  ctx.fillStyle = style.fill;
  ctx.fillText(text, at.x, at.y, maxWidth);
  ctx.restore();
}

function brassPlate(ctx: CanvasRenderingContext2D, x: number, width: number): void {
  const plate = ctx.createLinearGradient(0, PLATE_Y, 0, PLATE_Y + PLATE_HEIGHT);
  plate.addColorStop(0, "#f4dc95");
  plate.addColorStop(0.45, BRASS);
  plate.addColorStop(1, "#76561a");
  const scale = ctx.getTransform().a;
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
  ctx.shadowBlur = 0.03 * scale;
  ctx.shadowOffsetY = 0.01 * scale;
  ctx.fillStyle = plate;
  ctx.beginPath();
  ctx.roundRect(x, PLATE_Y, width, PLATE_HEIGHT, 0.018);
  ctx.fill();
  ctx.restore();
  // Bevel and two screws.
  ctx.strokeStyle = "rgba(255, 244, 205, 0.6)";
  ctx.lineWidth = 0.003;
  ctx.beginPath();
  ctx.roundRect(x + 0.006, PLATE_Y + 0.006, width - 0.012, PLATE_HEIGHT - 0.012, 0.013);
  ctx.stroke();
  for (const sx of [x + 0.024, x + width - 0.024]) {
    const sy = PLATE_Y + PLATE_HEIGHT / 2;
    ctx.fillStyle = "#6b4d17";
    ctx.beginPath();
    ctx.arc(sx, sy, 0.008, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 240, 200, 0.65)";
    ctx.lineWidth = 0.002;
    ctx.beginPath();
    ctx.moveTo(sx - 0.0055, sy - 0.002);
    ctx.lineTo(sx + 0.0055, sy + 0.002);
    ctx.stroke();
  }
}

/** Text cut into brass: dark letters over a light edge. */
function engrave(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  color = "#3a2808",
): void {
  drawText(ctx, text, x, y + size * 0.05, size, { family: MONO, fill: "rgba(255, 246, 214, 0.6)" });
  drawText(ctx, text, x, y, size, { family: MONO, fill: color });
}

/** A chalk stroke: soft, a little rough. */
function chalkLine(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  ctx.strokeStyle = `rgba(${CHALK}, 0.3)`;
  ctx.lineWidth = 0.011;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.strokeStyle = `rgba(${CHALK}, 0.9)`;
  ctx.lineWidth = 0.0055;
  ctx.stroke();
}

const MAX_TALLIES = 20;

/** Shots as chalk tallies, in fives, in the dark left of the scoreboard. */
function drawTallies(ctx: CanvasRenderingContext2D, shots: number): void {
  ctx.save();
  ctx.lineCap = "round";
  const height = 0.075;
  const top = PLATE_Y + (PLATE_HEIGHT - height) / 2;
  const left = -0.15;
  const groupWidth = 0.1;
  for (let i = 0; i < Math.min(shots, MAX_TALLIES); i++) {
    const group = Math.floor(i / 5);
    const within = i % 5;
    const gx = left + group * groupWidth;
    // A fixed wobble per mark, so the tally doesn't jitter.
    const wobble = Math.sin(i * 12.9898) * 0.005;
    if (within < 4) {
      const x = gx + within * 0.018;
      chalkLine(ctx, x + wobble, top, x - wobble, top + height);
    } else {
      chalkLine(ctx, gx - 0.008, top + height * 0.82, gx + 0.064, top + height * 0.18);
    }
  }
  ctx.restore();
  if (shots > MAX_TALLIES) {
    drawText(ctx, `+${shots - MAX_TALLIES}`, left, top + height + 0.03, 0.032, {
      fill: `rgba(${CHALK}, 0.85)`,
      align: "left",
    });
  }
}

function drawTrophy(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  ctx.beginPath();
  ctx.moveTo(x - size, y - size);
  ctx.lineTo(x + size, y - size);
  ctx.quadraticCurveTo(x + size, y + size * 0.3, x, y + size * 0.4);
  ctx.quadraticCurveTo(x - size, y + size * 0.3, x - size, y - size);
  ctx.fill();
  ctx.fillRect(x - size * 0.15, y + size * 0.35, size * 0.3, size * 0.5);
  ctx.fillRect(x - size * 0.55, y + size * 0.8, size * 1.1, size * 0.25);
}

/** The brass scoreboard (clock, penalties, today's best) and the shot tallies. Table transform. */
export function drawScoreboard(ctx: CanvasRenderingContext2D, view: ScoreView): void {
  const x = (TABLE_WIDTH - PLATE_WIDTH) / 2;
  brassPlate(ctx, x, PLATE_WIDTH);
  const penalty = view.penaltySeconds > 0;
  const clockY = PLATE_Y + PLATE_HEIGHT * (view.bestMs === null ? 0.52 : 0.4);
  engrave(ctx, formatClock(view.totalMs), penalty ? 0.47 : 0.5, clockY, 0.085);
  if (penalty) engrave(ctx, `+${view.penaltySeconds}`, 0.655, clockY + 0.004, 0.036, "#8a1c10");
  if (view.bestMs !== null) {
    const bestY = PLATE_Y + PLATE_HEIGHT * 0.79;
    ctx.fillStyle = "#4a340c";
    drawTrophy(ctx, 0.425, bestY - 0.003, 0.0105);
    engrave(ctx, formatClock(view.bestMs, true), 0.52, bestY, 0.032, "#4a340c");
  }
  drawTallies(ctx, view.shots);

  // The golden cue's shots left, as gold pips under the plate.
  for (let i = 0; i < view.goldenShots; i++) {
    ctx.fillStyle = "#ffd36a";
    ctx.beginPath();
    ctx.arc(
      0.5 + (i - (view.goldenShots - 1) / 2) * 0.035,
      PLATE_Y + PLATE_HEIGHT + 0.012,
      0.008,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
}

/** Instructions written in chalk on the cloth: how to shoot, or that the 8 needs a pocket. */
export function drawChalkHints(
  ctx: CanvasRenderingContext2D,
  view: ScoreView,
  labels: BilliardsLabels,
  now: number,
): void {
  const lines = view.isBreak
    ? [labels.breakHint, labels.controlsHint]
    : view.callNeeded
      ? [labels.callPocket]
      : [];
  const pulse = view.callNeeded ? 0.65 + 0.35 * Math.sin(now * 3) : 0.8;
  for (const [i, line] of lines.entries()) {
    const size = i === 0 ? 0.046 : 0.032;
    const y = (view.isBreak ? 1.7 : TABLE_LENGTH / 2) + i * 0.065;
    drawText(ctx, line, 0.5, y, size, {
      weight: 600,
      fill: `rgba(${CHALK}, ${(i === 0 ? 0.8 : 0.55) * pulse})`,
      stroke: "rgba(0, 0, 0, 0.25)",
      strokeWidth: 0.006,
      maxWidth: 0.92,
    });
  }
}

interface Callout {
  readonly text: string;
  readonly detail: string | null;
  readonly x: number;
  readonly y: number;
  readonly color: string;
  age: number;
  readonly life: number;
}

/** Words that pop up where something happened, rise a little and fade. */
export class Callouts {
  private items: Callout[] = [];

  add(text: string, x: number, y: number, color: string, detail: string | null = null): void {
    // Keep it on the table, clear of the rails.
    const cx = Math.max(0.22, Math.min(TABLE_WIDTH - 0.22, x));
    const cy = Math.max(0.1, Math.min(TABLE_LENGTH - 0.16, y));
    this.items.push({ text, detail, x: cx, y: cy, color, age: 0, life: detail ? 2.6 : 1.8 });
  }

  reset(): void {
    this.items = [];
  }

  update(seconds: number): void {
    for (const item of this.items) item.age += seconds;
    this.items = this.items.filter((item) => item.age < item.life);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const item of this.items) {
      const t = item.age / item.life;
      const pop =
        item.age < 0.18
          ? 0.6 + (item.age / 0.18) * 0.55
          : Math.max(1, 1.15 - (item.age - 0.18) * 1.5);
      const alpha = t > 0.75 ? (1 - t) / 0.25 : 1;
      const y = item.y - 0.07 * Math.min(1, item.age / 0.6);
      ctx.save();
      ctx.globalAlpha = alpha;
      drawText(ctx, item.text, item.x, y, 0.062 * pop, {
        weight: 800,
        fill: item.color,
        stroke: "rgba(8, 10, 14, 0.88)",
        strokeWidth: 0.012 * pop,
        maxWidth: 0.95,
      });
      if (item.detail) {
        drawText(ctx, item.detail, item.x, y + 0.06, 0.034, {
          weight: 650,
          fill: "rgba(255, 255, 255, 0.95)",
          stroke: "rgba(8, 10, 14, 0.85)",
          strokeWidth: 0.008,
          maxWidth: 0.95,
        });
      }
      ctx.restore();
    }
  }
}
