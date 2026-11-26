import { useNavigate } from "@tanstack/react-router";
import { useGT } from "gt-react";
import {
  CircleCheckIcon,
  LockIcon,
  MedalIcon,
  MessageCircleQuestionIcon,
  PaletteIcon,
  GiftIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "../../lib/utils";
import { useThreadShells } from "../../state/entities";
import { medalFor, nextMedal, type Medal } from "./billiardsRecords";
import { POWER_COLORS } from "./billiardsCues";
import { FOUL_PENALTY_SECONDS, GLOW_BALLS } from "./billiardsRules";
import { BilliardsSession, type BilliardsHud } from "./billiardsSession";
import { SKINS, type Skin, type SkinId } from "./billiardsSkins";
import { snapshotThreads, threadAlerts, type ThreadAlert } from "./billiardsThreadAlerts";

const MAX_ALERTS = 3;
const MEDAL_COLORS: Readonly<Record<Medal, string>> = {
  gold: "#e8b931",
  silver: "#c4cbd4",
  bronze: "#c8834f",
};

function formatClock(ms: number, tenths = false): string {
  const seconds = Math.floor(ms / 1000);
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return tenths ? `${clock}.${Math.floor((ms % 1000) / 100)}` : clock;
}

function alertId(alert: ThreadAlert): string {
  return `${alert.key}:${alert.kind}:${alert.thread.latestRun?.completedAt ?? ""}`;
}

/** The billiards easter egg: a full-window table, opened by triple-clicking the Ari Code logo. */
export default function BilliardsOverlay({ onClose }: { onClose: () => void }) {
  const gt = useGT();
  const navigate = useNavigate();
  const dialogRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef<BilliardsSession | null>(null);
  const [hud, setHud] = useState<BilliardsHud | null>(null);
  const threads = useThreadShells();
  const [baseline] = useState(() => snapshotThreads(threads));
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  const alerts = threadAlerts(baseline, threads)
    .filter((alert) => !dismissed.has(alertId(alert)))
    .slice(0, MAX_ALERTS);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- runs the canvas game session while mounted and reports its HUD
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const session = new BilliardsSession(canvas, setHud);
    sessionRef.current = session;
    dialogRef.current?.focus();
    return () => {
      session.dispose();
      sessionRef.current = null;
    };
  }, []);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a window Escape listener that closes the game while it is open
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (!sessionRef.current?.cancelCharge()) onClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const openThread = (alert: ThreadAlert) => {
    onClose();
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId: alert.thread.environmentId, threadId: alert.thread.id },
    });
  };

  const skinName = (id: SkinId) => {
    switch (id) {
      case "classic":
        return gt("Classic", { $context: "billiards cue skin" });
      case "ari":
        // oxlint-disable-next-line t3code/no-untranslated-copy -- product name
        return "Ari";
      case "copper":
        return gt("Copper", { $context: "billiards cue skin" });
      case "chrome":
        return gt("Chrome", { $context: "billiards cue skin" });
      case "ember":
        return gt("Ember", { $context: "billiards cue skin" });
    }
  };
  const unlockHint = (skin: Skin) => {
    switch (skin.unlock) {
      case null:
        return "";
      case "clear":
        return gt("Clear a table");
      case "bronze":
        return gt("Win a bronze medal");
      case "silver":
        return gt("Win a silver medal");
      case "gold":
        return gt("Win a gold medal");
    }
  };

  const medalLabel = (medal: Medal) =>
    medal === "gold"
      ? gt("Gold medal")
      : medal === "silver"
        ? gt("Silver medal")
        : gt("Bronze medal");
  const nextMedalText = (totalMs: number) => {
    const next = nextMedal(totalMs);
    if (!next) return null;
    const time = formatClock(next[1]);
    return next[0] === "gold"
      ? gt("Next: gold under {time}", { time })
      : next[0] === "silver"
        ? gt("Next: silver under {time}", { time })
        : gt("Next: bronze under {time}", { time });
  };

  const status = ((): { text: string; tone: string; color?: string } => {
    if (!hud) return { text: "", tone: "quiet" };
    if (hud.blocked) return { text: gt("Call a pocket for the 8 first: click it."), tone: "warn" };
    switch (hud.foul) {
      case "scratch":
        return {
          text: gt("Scratch. +{seconds} s", { seconds: FOUL_PENALTY_SECONDS.scratch }),
          tone: "warn",
        };
      case "noContact":
        return hud.forgiven
          ? {
              text: gt("No ball hit. Free this once, after that it costs {seconds} s.", {
                seconds: FOUL_PENALTY_SECONDS.noContact,
              }),
              tone: "call",
            }
          : {
              text: gt("No ball hit. +{seconds} s", { seconds: FOUL_PENALTY_SECONDS.noContact }),
              tone: "warn",
            };
      case "early8":
        return {
          text: gt("The 8 went in too early and is back on its spot. +{seconds} s", {
            seconds: FOUL_PENALTY_SECONDS.early8,
          }),
          tone: "warn",
        };
      case "wrong8":
        return {
          text: gt("Wrong pocket. The 8 is back on its spot. +{seconds} s", {
            seconds: FOUL_PENALTY_SECONDS.wrong8,
          }),
          tone: "warn",
        };
      case "scratch8":
        return {
          text: gt("Scratch on the 8. It is back on its spot. +{seconds} s", {
            seconds: FOUL_PENALTY_SECONDS.scratch8,
          }),
          tone: "warn",
        };
      case null:
        break;
    }
    if (hud.armed === "wand") {
      return {
        text: gt("Wand ready: the first ball you hit drops into the nearest pocket."),
        tone: "power",
        color: `rgb(${POWER_COLORS.wand})`,
      };
    }
    if (hud.armed === "glow") {
      return {
        text: gt(
          "Glow cue ready: the cue ball bursts through up to {count} balls and drops them.",
          {
            count: GLOW_BALLS,
          },
        ),
        tone: "power",
        color: `rgb(${POWER_COLORS.glow})`,
      };
    }
    if (hud.needsCall) {
      return hud.calledPocket === null
        ? { text: gt("Only the 8 is left. Click the pocket you call."), tone: "call" }
        : { text: gt("8 called. Click another pocket to change it."), tone: "call" };
    }
    if (hud.goldenShots > 0) {
      return {
        text: gt(
          "{count, plural, =1 {Golden cue: full sight for this shot.} other {Golden cue: full sight for {count} shots.}}",
          { count: hud.goldenShots },
        ),
        tone: "power",
        color: `rgb(${POWER_COLORS.golden})`,
      };
    }
    if (hud.isBreak) {
      return {
        text: gt("Today's rack is the same for everyone. The clock starts after the break."),
        tone: "quiet",
      };
    }
    return {
      text: gt("Move to aim, hold to charge, release to shoot. Shift aims finer, Esc closes."),
      tone: "quiet",
    };
  })();

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={gt("Billiards")}
      tabIndex={-1}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 outline-none backdrop-blur-sm [-webkit-app-region:no-drag]"
    >
      <div className="relative aspect-[9/16] h-[min(94dvh,calc(94vw*16/9))] select-none overflow-hidden rounded-2xl shadow-2xl ring-1 ring-white/10">
        <canvas ref={canvasRef} className="absolute inset-0 size-full touch-none" />
        <div className="pointer-events-none absolute inset-x-0 top-0 px-5 pt-3 text-white">
          <div className="flex items-center gap-3 text-xs font-medium tabular-nums">
            <span className="text-white/70">{gt("Shots {shots}", { shots: hud?.shots ?? 0 })}</span>
            {hud && hud.penaltySeconds > 0 ? (
              <span className="text-warning">
                {gt("Penalties +{seconds} s", { seconds: hud.penaltySeconds })}
              </span>
            ) : null}
            {hud?.todayRuns[0] ? (
              <span className="text-white/45">
                {gt("Best {time}", { time: formatClock(hud.todayRuns[0].totalMs, true) })}
              </span>
            ) : null}
            <span className="ml-auto text-sm font-semibold">{formatClock(hud?.totalMs ?? 0)}</span>
            <button
              type="button"
              aria-label={gt("Choose a stick")}
              aria-expanded={pickerOpen}
              onClick={() => setPickerOpen(!pickerOpen)}
              className={cn(
                "pointer-events-auto flex size-6 items-center justify-center rounded-md hover:bg-white/10 hover:text-white",
                pickerOpen ? "bg-white/10 text-white" : "text-white/60",
              )}
            >
              <PaletteIcon className="size-3.5" />
            </button>
            <button
              type="button"
              aria-label={gt("Close")}
              onClick={onClose}
              className="pointer-events-auto -mr-1 flex size-6 items-center justify-center rounded-md text-white/60 hover:bg-white/10 hover:text-white"
            >
              <XIcon className="size-4" />
            </button>
          </div>
          <p
            className={cn(
              "mt-0.5 truncate text-xs",
              status.tone === "warn" && "text-warning",
              status.tone === "call" && "text-warning",
              status.tone === "quiet" && "text-white/55",
            )}
            style={status.color ? { color: status.color } : undefined}
          >
            {status.text}
          </p>
        </div>
        {pickerOpen && hud ? (
          <div className="absolute top-12 right-3 w-48 rounded-xl bg-black/90 p-1.5 text-xs text-white shadow-2xl ring-1 ring-white/15">
            <p className="px-2 pt-1 pb-1.5 font-medium text-white/55">{gt("Stick")}</p>
            {SKINS.map((skin) => {
              const unlocked = hud.unlockedSkins.has(skin.id);
              return (
                <button
                  key={skin.id}
                  type="button"
                  disabled={!unlocked}
                  onClick={() => sessionRef.current?.setSkin(skin.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left",
                    unlocked ? "hover:bg-white/10" : "cursor-default opacity-45",
                    hud.skin === skin.id && "bg-white/15",
                  )}
                >
                  <span
                    aria-hidden
                    className="h-1.5 w-10 shrink-0 rounded-full"
                    style={{ background: skin.swatch }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{skinName(skin.id)}</span>
                    {unlocked ? null : (
                      <span className="block truncate text-white/55">{unlockHint(skin)}</span>
                    )}
                  </span>
                  {unlocked ? null : <LockIcon aria-hidden className="size-3 shrink-0" />}
                </button>
              );
            })}
          </div>
        ) : null}
        {alerts.length > 0 ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-2 flex flex-col-reverse items-center gap-1.5 px-4">
            {alerts.map((alert) => (
              <div
                key={alertId(alert)}
                className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full bg-black/85 py-1 pr-1 pl-3 text-xs text-white shadow-xl ring-1 ring-white/15"
              >
                {alert.kind === "done" ? (
                  <CircleCheckIcon aria-hidden className="size-3.5 shrink-0 text-success" />
                ) : (
                  <MessageCircleQuestionIcon
                    aria-hidden
                    className="size-3.5 shrink-0 text-warning"
                  />
                )}
                <span className="min-w-0 truncate">
                  {alert.kind === "done"
                    ? gt("{title} is done", { title: alert.thread.title })
                    : gt("{title} needs you", { title: alert.thread.title })}
                </span>
                <button
                  type="button"
                  onClick={() => openThread(alert)}
                  className="shrink-0 rounded-full bg-white px-2.5 py-0.5 font-medium text-black hover:bg-white/90"
                >
                  {gt("Open")}
                </button>
                <button
                  type="button"
                  aria-label={gt("Dismiss")}
                  onClick={() => setDismissed(new Set([...dismissed, alertId(alert)]))}
                  className="flex size-5 shrink-0 items-center justify-center rounded-full text-white/60 hover:bg-white/10 hover:text-white"
                >
                  <XIcon className="size-3" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        {hud?.phase === "cleared" ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/45 backdrop-blur-xs">
            <div className="rounded-2xl bg-black/85 px-10 py-7 text-center text-white shadow-2xl ring-1 ring-white/10">
              <p className="text-sm font-medium text-white/70">{gt("Table cleared")}</p>
              <p className="mt-1 text-6xl font-semibold tabular-nums">
                {formatClock(hud.result?.run.totalMs ?? hud.totalMs, true)}
              </p>
              {hud.result?.medal ? (
                <p
                  className="mt-2 flex items-center justify-center gap-1.5 text-sm font-semibold"
                  style={{ color: MEDAL_COLORS[hud.result.medal] }}
                >
                  <MedalIcon aria-hidden className="size-4" />
                  {medalLabel(hud.result.medal)}
                </p>
              ) : null}
              {hud.result?.rankToday === 1 ? (
                <p className="mt-1 text-sm text-warning">{gt("New best today!")}</p>
              ) : null}
              {hud.result?.newSkins.map((id) => (
                <p
                  key={id}
                  className="mt-1 flex items-center justify-center gap-1.5 text-xs text-white"
                >
                  <GiftIcon aria-hidden className="size-3.5 text-warning" />
                  {gt("New stick unlocked: {name}", { name: skinName(id) })}
                </p>
              ))}
              {hud.result && hud.result.medal !== "gold" ? (
                <p className="mt-1 text-xs text-white/55">
                  {nextMedalText(hud.result.run.totalMs)}
                </p>
              ) : null}
              <p className="mt-3 text-xs text-white/55 tabular-nums">
                {gt("{clock} played, +{seconds} s penalties, {shots} shots", {
                  clock: formatClock(hud.totalMs - hud.penaltySeconds * 1000, true),
                  seconds: hud.penaltySeconds,
                  shots: hud.shots,
                })}
              </p>
              {hud.todayRuns.length > 1 ? (
                <div className="mt-4 border-t border-white/10 pt-3 text-left">
                  <p className="text-xs font-medium text-white/55">
                    {gt("Today on this computer")}
                  </p>
                  <ol className="mt-1.5 space-y-0.5 text-xs tabular-nums">
                    {hud.todayRuns.slice(0, 5).map((run, index) => (
                      <li
                        key={run.finishedAt}
                        className={cn(
                          "flex items-center gap-2 rounded-md px-2 py-0.5",
                          run === hud.result?.run ? "bg-white/10 text-white" : "text-white/65",
                        )}
                      >
                        <span className="w-5 text-white/40">{index + 1}</span>
                        <span className="flex-1">{formatClock(run.totalMs, true)}</span>
                        {run.penaltySeconds > 0 ? (
                          <span className="text-warning">
                            {gt("+{seconds} s", { seconds: run.penaltySeconds })}
                          </span>
                        ) : null}
                        {(() => {
                          const medal = medalFor(run.totalMs);
                          return medal ? (
                            <MedalIcon
                              aria-label={medalLabel(medal)}
                              className="size-3.5"
                              style={{ color: MEDAL_COLORS[medal] }}
                            />
                          ) : (
                            <span className="size-3.5" />
                          );
                        })()}
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}
              <div className="mt-5 flex justify-center gap-2">
                <button
                  type="button"
                  onClick={() => sessionRef.current?.restart()}
                  className="rounded-lg bg-white px-4 py-1.5 text-sm font-medium text-black hover:bg-white/90"
                >
                  {gt("Play again")}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg px-4 py-1.5 text-sm font-medium text-white/80 ring-1 ring-white/15 hover:bg-white/10"
                >
                  {gt("Close")}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
