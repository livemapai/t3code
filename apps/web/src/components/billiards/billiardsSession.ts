import { observeResize } from "~/lib/observeResize";

import { BilliardsAudio } from "./billiardsAudio.ts";
import { BallSprites } from "./billiardsBalls.ts";
import { ClothNap, Effects } from "./billiardsFx.ts";
import { shotSpeed, type PhysicsEvent } from "./billiardsPhysics.ts";
import {
  drawScene,
  drawStaticLayer,
  FRAME_WIDTH,
  SINK_SECONDS,
  TABLE_ORIGIN,
  type Sinking,
} from "./billiardsRender.ts";
import {
  loadRuns,
  medalFor,
  rackDay,
  rackSeed,
  runsOn,
  saveRun,
  type BilliardsRun,
  type Medal,
} from "./billiardsRecords.ts";
import { cueTip, POWER_COLORS, type CueStyle } from "./billiardsCues.ts";
import { loadSkin, saveSkin, unlockedSkins, type SkinId } from "./billiardsSkins.ts";
import {
  BilliardsGame,
  EIGHT,
  placeRings,
  seededRandom,
  type Foul,
  type Phase,
} from "./billiardsRules.ts";
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
  /** Today's rack, `YYYY-MM-DD`. */
  readonly day: string;
  /** This machine's runs on today's rack, best first. */
  readonly todayRuns: ReadonlyArray<BilliardsRun>;
  /** How the run that just cleared the table placed. */
  readonly result: RunResult | null;
  /** A power-up waiting for the next shot. */
  readonly armed: "wand" | "glow" | null;
  readonly goldenShots: number;
  readonly skin: SkinId;
  readonly unlockedSkins: ReadonlySet<SkinId>;
}

export interface RunResult {
  readonly run: BilliardsRun;
  /** 1 is the best run today. */
  readonly rankToday: number;
  readonly medal: Medal | null;
  /** Skins this run unlocked. */
  readonly newSkins: ReadonlyArray<SkinId>;
}

function dailyGame(day: string): BilliardsGame {
  const seed = rackSeed(day);
  return new BilliardsGame({
    random: seededRandom(seed),
    rings: placeRings(seededRandom(seed ^ 0x5bd1e995)),
  });
}

const CHARGE_MS = 1100;
const FINE_AIM = 0.12;
const POCKET_PICK_RADIUS = 0.1;
const HUD_INTERVAL_MS = 250;
/** How slow the final 8 rolls as it nears the called pocket. */
const SLOW_MOTION = 0.3;

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
  private readonly sprites = new BallSprites();
  private readonly nap = new ClothNap();
  private readonly fx = new Effects();
  private readonly stopObservingResize: () => void;
  private day = rackDay();
  private game = dailyGame(this.day);
  private runs = loadRuns();
  private todayRuns = runsOn(this.runs, this.day);
  private result: RunResult | null = null;
  private unlocked = unlockedSkins(this.runs);
  private skin: SkinId = this.unlocked.has(loadSkin()) ? loadSkin() : "classic";
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
  /** Hit-stops and slow motion don't count against the player's clock. */
  private frozenMs = 0;
  private timeScale = 1;
  private finalShot = false;
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
    this.day = rackDay();
    this.game = dailyGame(this.day);
    this.todayRuns = runsOn(this.runs, this.day);
    this.result = null;
    this.aimAngle = -Math.PI / 2;
    this.chargeStart = null;
    this.sinking = [];
    this.clockStart = null;
    this.clockEnd = null;
    this.blockedUntil = 0;
    this.frozenMs = 0;
    this.timeScale = 1;
    this.finalShot = false;
    this.sprites.reset();
    this.nap.clear();
    this.fx.reset();
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
    this.sprites.resize(this.scale);
    this.nap.resize(
      this.canvas.width,
      this.canvas.height,
      this.scale,
      TABLE_ORIGIN.x * this.scale,
      TABLE_ORIGIN.y * this.scale,
    );
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
    const speed = shotSpeed(power);
    const finalShot = this.game.objectBallsLeft() === 0;
    if (!this.game.shoot(this.aimAngle, speed)) return;
    this.finalShot = finalShot;
    this.audio.cue(power);
    const cue = this.game.ball(0);
    if (cue) this.fx.cueStrike(cue, this.aimAngle, power);
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

    // A hit-stop freezes everything for a beat; slow motion stretches the final 8.
    let simSeconds = seconds * this.timeScale;
    let frozenSeconds = seconds - simSeconds;
    if (this.fx.hitStop > 0) {
      const stop = Math.min(this.fx.hitStop, seconds);
      this.fx.hitStop -= stop;
      simSeconds = 0;
      frozenSeconds = seconds;
    }
    if (this.clockStart !== null && this.clockEnd === null) this.frozenMs += frozenSeconds * 1000;

    const phase = this.game.phase;
    const breakShot = this.game.isBreak;
    const before = new Map<number, Point>();
    for (const ball of this.game.balls)
      if (ball.onTable) before.set(ball.id, { x: ball.x, y: ball.y });
    const events: PhysicsEvent[] = [];
    this.game.advance(simSeconds, events);
    this.trackRolling(before, simSeconds);
    this.playEvents(events, time / 1000);
    this.fx.onEvents(events, this.game.balls, breakShot);
    if (this.game.phase !== phase) {
      this.nap.commit();
      if (this.game.phase === "cleared") {
        this.clockEnd = time;
        this.fx.celebrate(this.game.calledPocket);
        this.recordRun(time);
      }
      // The clock starts once the break settles.
      if (!this.game.isBreak && this.clockStart === null) this.clockStart = time;
      this.emitHud(time, true);
    }
    if (simSeconds > 0 || this.game.phase === "aiming") this.trailMagic(time);
    this.updateSlowMotion(seconds);
    this.fx.update(simSeconds === 0 ? 0 : Math.max(simSeconds, seconds * 0.5));
    this.sinking = this.sinking.filter((sinking) => time / 1000 - sinking.start < SINK_SECONDS);

    drawScene(this.context, this.staticLayer, this.scale, {
      game: this.game,
      aimAngle: this.aimAngle,
      power: this.chargeStart === null ? null : this.power(time),
      hoverPocket: this.pocketAt(this.pointer),
      sinking: this.sinking,
      now: time / 1000,
      sprites: this.sprites,
      nap: this.nap,
      fx: this.fx,
      shake: this.fx.shakeOffset(),
      vignette: Math.min(1, (1 - this.timeScale) / (1 - SLOW_MOTION)),
      cueStyle: this.cueStyle(),
    });
    if (time - this.lastHudAt > HUD_INTERVAL_MS) this.emitHud(time, false);
  };

  /** Rolls each moving ball's sprite and brushes the cloth along its path. */
  private trackRolling(before: ReadonlyMap<number, Point>, seconds: number): void {
    if (seconds === 0) return;
    for (const ball of this.game.balls) {
      const start = before.get(ball.id);
      if (!start || !ball.onTable) continue;
      const dx = ball.x - start.x;
      const dy = ball.y - start.y;
      const distance = Math.hypot(dx, dy);
      // A respot jumps the ball; it didn't roll there.
      if (distance < 1e-5 || distance > 0.2) continue;
      this.sprites.roll(ball.id, dx, dy);
      this.nap.stamp(start.x, start.y, ball.x, ball.y);
    }
  }

  private recordRun(now: number): void {
    const run: BilliardsRun = {
      day: this.day,
      totalMs: Math.round(this.totalMs(now)),
      penaltySeconds: this.game.penaltySeconds,
      shots: this.game.shots,
      finishedAt: new Date().toISOString(),
    };
    this.runs = saveRun(this.runs, run);
    const before = this.unlocked;
    this.unlocked = unlockedSkins(this.runs);
    const newSkins = [...this.unlocked].filter((id) => !before.has(id));
    this.todayRuns = runsOn(this.runs, this.day);
    this.result = {
      run,
      rankToday: this.todayRuns.indexOf(run) + 1,
      medal: medalFor(run.totalMs),
      newSkins,
    };
  }

  private totalMs(now: number): number {
    const clock =
      this.clockStart === null ? 0 : (this.clockEnd ?? now) - this.clockStart - this.frozenMs;
    return clock + this.game.penaltySeconds * 1000;
  }

  private updateSlowMotion(seconds: number): void {
    let target = 1;
    const eight = this.game.ball(EIGHT);
    const pocket = POCKETS.find((candidate) => candidate.id === this.game.calledPocket);
    if (this.finalShot && this.game.phase === "rolling" && eight?.onTable && pocket) {
      const dx = pocket.x - eight.x;
      const dy = pocket.y - eight.y;
      const distance = Math.hypot(dx, dy);
      const speed = Math.hypot(eight.vx, eight.vy);
      const heading = speed > 0 ? (dx * eight.vx + dy * eight.vy) / (distance * speed) : 0;
      if (speed > 0.05 && distance < 0.35 && heading > 0.85) target = SLOW_MOTION;
    }
    this.timeScale += (target - this.timeScale) * Math.min(1, seconds * 8);
    if (Math.abs(this.timeScale - target) < 0.01) this.timeScale = target;
  }

  private playEvents(events: ReadonlyArray<PhysicsEvent>, now: number): void {
    const clicks: number[] = [];
    const thuds: number[] = [];
    for (const event of events) {
      switch (event.kind) {
        case "ball":
          clicks.push(event.speed);
          break;
        case "cushion":
          thuds.push(event.speed);
          break;
        case "touch":
          break;
        case "pocket": {
          this.audio.pocket();
          const pocket = POCKETS[event.pocket];
          if (pocket) {
            this.sinking.push({ ball: event.ball, x: event.x, y: event.y, pocket, start: now });
          }
          break;
        }
        case "powerUp": {
          const ring = this.game.rings.find((candidate) => candidate.id === event.ring);
          if (!ring) break;
          this.audio.powerUp();
          this.fx.powerBurst(ring.x, ring.y, POWER_COLORS[ring.kind]);
          this.emitHud(now * 1000, true);
          break;
        }
        case "guide": {
          const ball = this.game.ball(event.ball);
          const power = this.game.activePower;
          if (!ball || !power) break;
          this.audio.guide();
          this.fx.powerBurst(ball.x, ball.y, POWER_COLORS[power]);
          break;
        }
      }
    }
    // A break makes dozens of contacts in one frame; the loudest few carry it.
    for (const speed of clicks.sort((a, b) => b - a).slice(0, 3)) this.audio.click(speed);
    for (const speed of thuds.sort((a, b) => b - a).slice(0, 2)) this.audio.cushion(speed);
  }

  /** Sparks behind balls a power-up is steering, and off a magic stick while aiming. */
  private trailMagic(now: number): void {
    const power = this.game.activePower;
    for (const ball of this.game.balls) {
      if (ball.onTable && ball.guidedTo !== null && power) {
        this.fx.trail(ball.x, ball.y, POWER_COLORS[power]);
      }
    }
    const cue = this.game.ball(0);
    if (power === "glow" && cue?.onTable && this.game.phase === "rolling") {
      this.fx.trail(cue.x, cue.y, POWER_COLORS.glow);
    }
    const style = this.cueStyle();
    const sparks =
      style === "wand" || style === "golden" || style === "glow" ? POWER_COLORS[style] : null;
    if (sparks && this.game.phase === "aiming" && cue?.onTable && Math.random() < 0.35) {
      const tip = cueTip(cue, this.aimAngle, this.power(now));
      this.fx.trail(tip.x, tip.y, sparks);
    }
  }

  private cueStyle(): CueStyle {
    if (this.game.armed) return this.game.armed;
    return this.game.goldenShots > 0 ? "golden" : this.skin;
  }

  /** Picks a stick skin; only unlocked ones take. */
  setSkin(id: SkinId): void {
    if (!this.unlocked.has(id)) return;
    this.skin = id;
    saveSkin(id);
    this.emitHud(performance.now(), true);
  }

  private emitHud(now: number, force: boolean): void {
    const game = this.game;
    const hud: BilliardsHud = {
      phase: game.phase,
      isBreak: game.isBreak,
      shots: game.shots,
      penaltySeconds: game.penaltySeconds,
      totalMs: this.totalMs(now),
      needsCall: game.needsCall(),
      calledPocket: game.calledPocket,
      foul: game.phase === "rolling" ? null : (game.lastShot?.foul ?? null),
      forgiven: game.lastShot?.forgiven ?? false,
      blocked: now < this.blockedUntil,
      day: this.day,
      todayRuns: this.todayRuns,
      result: this.result,
      armed: game.armed,
      goldenShots: game.goldenShots,
      skin: this.skin,
      unlockedSkins: this.unlocked,
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
