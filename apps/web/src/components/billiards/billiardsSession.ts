import { observeResize } from "~/lib/observeResize";

import { BilliardsAudio } from "./billiardsAudio.ts";
import { MAX_SHOT_SPEED, type PhysicsEvent } from "./billiardsPhysics.ts";
import {
  drawScene,
  drawStaticLayer,
  FRAME_WIDTH,
  SINK_SECONDS,
  TABLE_ORIGIN,
  type Sinking,
} from "./billiardsRender.ts";
import { BilliardsGame, type Foul, type Phase } from "./billiardsRules.ts";
import { POCKETS, type Point } from "./billiardsTable.ts";

/** What the overlay shows around the canvas. */
export interface BilliardsHud {
  readonly phase: Phase;
  readonly isBreak: boolean;
  readonly shots: number;
  readonly penaltySeconds: number;
  /** Clock plus penalties: the race time. */
  readonly totalMs: number;
  readonly needsCall: boolean;
  readonly calledPocket: number | null;
  readonly foul: Foul | null;
  /** The foul was the game's free first miss. */
  readonly forgiven: boolean;
  /** The player tried to shoot the 8 without calling a pocket. */
  readonly blocked: boolean;
}

const CHARGE_MS = 1100;
const MIN_SHOT_SPEED = 0.3;
const FINE_AIM = 0.12;
const POCKET_PICK_RADIUS = 0.1;
const HUD_INTERVAL_MS = 250;

function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/** Runs one game on a canvas: input, simulation, sound and drawing. */
export class BilliardsSession {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly staticLayer = document.createElement("canvas");
  private readonly onHud: (hud: BilliardsHud) => void;
  private readonly audio = new BilliardsAudio();
  private readonly stopObservingResize: () => void;
  private game = new BilliardsGame();
  private scale = 1;
  private frame = 0;
  private lastFrame = 0;
  private aimAngle = -Math.PI / 2;
  private lastPointerAngle: number | null = null;
  private pointer: Point | null = null;
  private chargeStart: number | null = null;
  private sinking: Sinking[] = [];
  private clockStart: number | null = null;
  private clockEnd: number | null = null;
  private blockedUntil = 0;
  private lastHud: BilliardsHud | null = null;
  private lastHudAt = 0;

  constructor(canvas: HTMLCanvasElement, onHud: (hud: BilliardsHud) => void) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D is not available");
    this.canvas = canvas;
    this.context = context;
    this.onHud = onHud;
    this.stopObservingResize = observeResize(canvas, () => this.resize());
    canvas.addEventListener("pointerdown", this.handlePointerDown);
    canvas.addEventListener("pointermove", this.handlePointerMove);
    canvas.addEventListener("pointerup", this.handlePointerUp);
    canvas.addEventListener("pointercancel", this.handlePointerCancel);
    canvas.addEventListener("contextmenu", this.handleContextMenu);
    this.resize();
    this.frame = requestAnimationFrame(this.tick);
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.stopObservingResize();
    this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
    this.canvas.removeEventListener("pointermove", this.handlePointerMove);
    this.canvas.removeEventListener("pointerup", this.handlePointerUp);
    this.canvas.removeEventListener("pointercancel", this.handlePointerCancel);
    this.canvas.removeEventListener("contextmenu", this.handleContextMenu);
    this.audio.dispose();
  }

  restart(): void {
    this.game = new BilliardsGame();
    this.aimAngle = -Math.PI / 2;
    this.chargeStart = null;
    this.sinking = [];
    this.clockStart = null;
    this.clockEnd = null;
    this.blockedUntil = 0;
    this.emitHud(performance.now(), true);
  }

  /** Drops a shot being charged. False when there was none. */
  cancelCharge(): boolean {
    if (this.chargeStart === null) return false;
    this.chargeStart = null;
    return true;
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const ratio = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(rect.width * ratio);
    this.canvas.height = Math.round(rect.height * ratio);
    this.staticLayer.width = this.canvas.width;
    this.staticLayer.height = this.canvas.height;
    this.scale = this.canvas.width / FRAME_WIDTH;
    drawStaticLayer(this.staticLayer, this.scale);
  }

  private toTable(event: PointerEvent): Point {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * FRAME_WIDTH - TABLE_ORIGIN.x,
      y: ((event.clientY - rect.top) / rect.width) * FRAME_WIDTH - TABLE_ORIGIN.y,
    };
  }

  private pocketAt(point: Point | null): number | null {
    if (!point || !this.game.needsCall()) return null;
    for (const pocket of POCKETS) {
      if (Math.hypot(pocket.x - point.x, pocket.y - point.y) < POCKET_PICK_RADIUS) return pocket.id;
    }
    return null;
  }

  private power(now: number): number {
    return this.chargeStart === null ? 0 : Math.min(1, (now - this.chargeStart) / CHARGE_MS);
  }

  private readonly handlePointerMove = (event: PointerEvent) => {
    this.pointer = this.toTable(event);
    this.canvas.style.cursor = this.pocketAt(this.pointer) === null ? "crosshair" : "pointer";
    const cue = this.game.ball(0);
    if (!cue?.onTable) return;
    const target = Math.atan2(this.pointer.y - cue.y, this.pointer.x - cue.x);
    // The aim holds still while a shot charges, so pressing a trackpad can't nudge it.
    if (this.chargeStart === null) {
      this.aimAngle =
        event.shiftKey && this.lastPointerAngle !== null
          ? this.aimAngle + wrapAngle(target - this.lastPointerAngle) * FINE_AIM
          : target;
    }
    this.lastPointerAngle = target;
  };

  private readonly handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    this.audio.unlock();
    const now = performance.now();
    if (this.game.phase !== "aiming") return;
    const pocket = this.pocketAt(this.toTable(event));
    if (pocket !== null) {
      this.game.callPocket(pocket);
      this.emitHud(now, true);
      return;
    }
    if (this.game.needsCall() && this.game.calledPocket === null) {
      this.blockedUntil = now + 2500;
      this.emitHud(now, true);
      return;
    }
    this.chargeStart = now;
    this.canvas.setPointerCapture(event.pointerId);
  };

  private readonly handlePointerUp = (event: PointerEvent) => {
    if (this.chargeStart === null) return;
    const now = performance.now();
    const power = this.power(now);
    this.chargeStart = null;
    if (this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }
    const speed = MIN_SHOT_SPEED + (MAX_SHOT_SPEED - MIN_SHOT_SPEED) * power * power;
    if (!this.game.shoot(this.aimAngle, speed)) return;
    this.audio.cue(power);
    this.emitHud(now, true);
  };

  private readonly handlePointerCancel = () => {
    this.chargeStart = null;
  };

  private readonly handleContextMenu = (event: Event) => {
    event.preventDefault();
  };

  private readonly tick = (time: number) => {
    this.frame = requestAnimationFrame(this.tick);
    const seconds = this.lastFrame === 0 ? 0 : Math.min(0.05, (time - this.lastFrame) / 1000);
    this.lastFrame = time;

    const phase = this.game.phase;
    const events: PhysicsEvent[] = [];
    this.game.advance(seconds, events);
    this.playEvents(events, time / 1000);
    if (this.game.phase !== phase) {
      if (this.game.phase === "cleared") this.clockEnd = time;
      // The clock starts once the break settles.
      if (!this.game.isBreak && this.clockStart === null) this.clockStart = time;
      this.emitHud(time, true);
    }
    this.sinking = this.sinking.filter((sinking) => time / 1000 - sinking.start < SINK_SECONDS);

    drawScene(this.context, this.staticLayer, this.scale, {
      game: this.game,
      aimAngle: this.aimAngle,
      power: this.chargeStart === null ? null : this.power(time),
      hoverPocket: this.pocketAt(this.pointer),
      sinking: this.sinking,
      now: time / 1000,
    });
    if (time - this.lastHudAt > HUD_INTERVAL_MS) this.emitHud(time, false);
  };

  private playEvents(events: ReadonlyArray<PhysicsEvent>, now: number): void {
    const clicks: number[] = [];
    const thuds: number[] = [];
    for (const event of events) {
      if (event.kind === "ball") clicks.push(event.speed);
      else if (event.kind === "cushion") thuds.push(event.speed);
      else {
        this.audio.pocket();
        const pocket = POCKETS[event.pocket];
        if (pocket) {
          this.sinking.push({ ball: event.ball, x: event.x, y: event.y, pocket, start: now });
        }
      }
    }
    // A break makes dozens of contacts in one frame; the loudest few carry it.
    for (const speed of clicks.sort((a, b) => b - a).slice(0, 3)) this.audio.click(speed);
    for (const speed of thuds.sort((a, b) => b - a).slice(0, 2)) this.audio.cushion(speed);
  }

  private emitHud(now: number, force: boolean): void {
    const game = this.game;
    const hud: BilliardsHud = {
      phase: game.phase,
      isBreak: game.isBreak,
      shots: game.shots,
      penaltySeconds: game.penaltySeconds,
      totalMs:
        (this.clockStart === null ? 0 : (this.clockEnd ?? now) - this.clockStart) +
        game.penaltySeconds * 1000,
      needsCall: game.needsCall(),
      calledPocket: game.calledPocket,
      foul: game.phase === "rolling" ? null : (game.lastShot?.foul ?? null),
      forgiven: game.lastShot?.forgiven ?? false,
      blocked: now < this.blockedUntil,
    };
    this.lastHudAt = now;
    const last = this.lastHud;
    const changed =
      !last ||
      (Object.keys(hud) as Array<keyof BilliardsHud>).some((key) =>
        key === "totalMs"
          ? Math.floor(hud.totalMs / 1000) !== Math.floor(last.totalMs / 1000)
          : hud[key] !== last[key],
      );
    if (!force && !changed) return;
    this.lastHud = hud;
    this.onHud(hud);
  }
}
