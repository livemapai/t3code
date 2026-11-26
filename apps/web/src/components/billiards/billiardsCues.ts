import type { Ball } from "./billiardsPhysics.ts";
import { RING_RADIUS, type PowerKind, type PowerRing } from "./billiardsRules.ts";
import { BALL_RADIUS } from "./billiardsTable.ts";

// The stick's looks and the power-up rings. A power-up changes the stick while it's armed;
// the same looks become unlockable skins later.

export type CueStyle = "classic" | PowerKind;

const R = BALL_RADIUS;
const CUE_LENGTH = 1.15;
const WAND_LENGTH = 0.62;

/** Each power-up's colour, as "r, g, b". */
export const POWER_COLORS: Readonly<Record<PowerKind, string>> = {
  wand: "190, 140, 255",
  golden: "255, 200, 80",
  glow: "90, 235, 255",
};

/** Where the stick's tip sits, for effects that come off it. */
export function cueTip(cue: Ball, angle: number, power: number): { x: number; y: number } {
  const back = R + 0.012 + power * 0.14;
  return { x: cue.x - Math.cos(angle) * back, y: cue.y - Math.sin(angle) * back };
}

export function drawCue(
  ctx: CanvasRenderingContext2D,
  cue: Ball,
  angle: number,
  power: number,
  style: CueStyle,
  now: number,
): void {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const tip = cueTip(cue, angle, power);
  const length = style === "wand" ? WAND_LENGTH : CUE_LENGTH;
  // At full power the stick trembles a little.
  const tremble = power > 0.97 ? Math.sin(now * 90) * 0.0012 : 0;
  const tipX = tip.x - dy * tremble;
  const tipY = tip.y + dx * tremble;
  const buttX = tipX - dx * length;
  const buttY = tipY - dy * length;
  const px = -dy;
  const py = dx;
  const tipHalf = style === "wand" ? 0.004 : 0.0065;
  const buttHalf = style === "wand" ? 0.009 : 0.013;
  const outline = (offset: number) => {
    ctx.beginPath();
    ctx.moveTo(tipX + px * tipHalf + offset, tipY + py * tipHalf + offset * 1.4);
    ctx.lineTo(buttX + px * buttHalf + offset, buttY + py * buttHalf + offset * 1.4);
    ctx.lineTo(buttX - px * buttHalf + offset, buttY - py * buttHalf + offset * 1.4);
    ctx.lineTo(tipX - px * tipHalf + offset, tipY - py * tipHalf + offset * 1.4);
    ctx.closePath();
  };
  outline(0.012);
  ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
  ctx.fill();

  const body = ctx.createLinearGradient(tipX, tipY, buttX, buttY);
  for (const [stop, color] of cueStops(style, now)) body.addColorStop(stop, color);
  ctx.save();
  if (style === "glow" || style === "wand") {
    const scale = ctx.getTransform().a;
    ctx.shadowColor = `rgba(${POWER_COLORS[style]}, 0.9)`;
    ctx.shadowBlur = (0.018 + Math.sin(now * 6) * 0.006) * scale;
  }
  outline(0);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.restore();

  if (style === "wand") drawWandStar(ctx, tipX + dx * 0.006, tipY + dy * 0.006, now);
}

function cueStops(style: CueStyle, now: number): ReadonlyArray<readonly [number, string]> {
  switch (style) {
    case "classic":
      return [
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
      ];
    case "golden": {
      // A shine runs down the stick, over and over.
      const band = 0.08 + ((now * 0.45) % 1) * 0.84;
      return [
        [0, "#fff6d0"],
        [0.025, "#fff6d0"],
        [0.026, "#c99520"],
        [Math.max(0.03, band - 0.07), "#e3b23c"],
        [band, "#fffbe6"],
        [Math.min(0.97, band + 0.07), "#e3b23c"],
        [1, "#7a5208"],
      ];
    }
    case "wand":
      return [
        [0, "#f4ecff"],
        [0.03, "#f4ecff"],
        [0.031, "#3a2654"],
        [0.5, "#24173a"],
        [0.51, "#c9b6e8"],
        [0.53, "#c9b6e8"],
        [0.531, "#1a1029"],
        [1, "#0c0714"],
      ];
    case "glow": {
      // Colour flows along the stick.
      const stops: Array<readonly [number, string]> = [];
      for (let i = 0; i <= 6; i++) {
        const hue = (now * 140 + i * 50) % 360;
        stops.push([i / 6, `hsl(${hue}, 95%, ${i === 0 ? 88 : 62}%)`]);
      }
      return stops;
    }
  }
}

function drawWandStar(ctx: CanvasRenderingContext2D, x: number, y: number, now: number): void {
  const spin = now * 2.4;
  const size = 0.016 * (1 + Math.sin(now * 7) * 0.12);
  ctx.save();
  const glow = ctx.createRadialGradient(x, y, 0, x, y, size * 2.4);
  glow.addColorStop(0, `rgba(${POWER_COLORS.wand}, 0.75)`);
  glow.addColorStop(1, `rgba(${POWER_COLORS.wand}, 0)`);
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, size * 2.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fbf6ff";
  starPath(ctx, x, y, size, size * 0.38, spin);
  ctx.fill();
  ctx.restore();
}

function starPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  outer: number,
  inner: number,
  rotation: number,
): void {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = rotation + (i * Math.PI) / 4;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** The rings still waiting on the cloth, with a glyph for what each one gives. */
export function drawRings(
  ctx: CanvasRenderingContext2D,
  rings: ReadonlyArray<PowerRing>,
  now: number,
): void {
  for (const ring of rings) {
    if (ring.collected) continue;
    const color = POWER_COLORS[ring.kind];
    const pulse = 1 + Math.sin(now * 3 + ring.id) * 0.07;
    const radius = RING_RADIUS * 1.25 * pulse;
    ctx.save();
    const halo = ctx.createRadialGradient(ring.x, ring.y, 0, ring.x, ring.y, radius * 1.6);
    halo.addColorStop(0, `rgba(${color}, 0.28)`);
    halo.addColorStop(1, `rgba(${color}, 0)`);
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(ring.x, ring.y, radius * 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(${color}, 0.9)`;
    ctx.lineWidth = 0.004;
    ctx.setLineDash([0.014, 0.009]);
    ctx.lineDashOffset = -now * 0.04;
    ctx.beginPath();
    ctx.arc(ring.x, ring.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = `rgb(${color})`;
    ctx.strokeStyle = `rgb(${color})`;
    drawGlyph(ctx, ring.kind, ring.x, ring.y, now);
    ctx.restore();
  }
}

function drawGlyph(
  ctx: CanvasRenderingContext2D,
  kind: PowerKind,
  x: number,
  y: number,
  now: number,
): void {
  const s = RING_RADIUS * 0.5;
  switch (kind) {
    case "wand":
      starPath(ctx, x, y, s, s * 0.4, now);
      ctx.fill();
      break;
    case "golden":
      ctx.lineWidth = 0.004;
      ctx.beginPath();
      ctx.arc(x, y, s * 0.75, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, s * 0.3, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "glow":
      ctx.beginPath();
      ctx.moveTo(x + s * 0.25, y - s);
      ctx.lineTo(x - s * 0.55, y + s * 0.12);
      ctx.lineTo(x - s * 0.02, y + s * 0.12);
      ctx.lineTo(x - s * 0.3, y + s);
      ctx.lineTo(x + s * 0.55, y - s * 0.15);
      ctx.lineTo(x + s * 0.02, y - s * 0.15);
      ctx.closePath();
      ctx.fill();
      break;
  }
}
