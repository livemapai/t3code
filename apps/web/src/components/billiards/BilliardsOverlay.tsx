import { useNavigate } from "@tanstack/react-router";
import { useGT } from "gt-react";
import { CircleCheckIcon, MessageCircleQuestionIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "../../lib/utils";
import { useThreadShells } from "../../state/entities";
import { FOUL_PENALTY_SECONDS } from "./billiardsRules";
import { BilliardsSession, type BilliardsHud } from "./billiardsSession";
import { snapshotThreads, threadAlerts, type ThreadAlert } from "./billiardsThreadAlerts";

const MAX_ALERTS = 3;

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

  const status = (() => {
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
    if (hud.needsCall) {
      return hud.calledPocket === null
        ? { text: gt("Only the 8 is left. Click the pocket you call."), tone: "call" }
        : { text: gt("8 called. Click another pocket to change it."), tone: "call" };
    }
    if (hud.isBreak) {
      return {
        text: gt("The clock starts after the break. Hold to charge, release to shoot."),
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
            <span className="ml-auto text-sm font-semibold">{formatClock(hud?.totalMs ?? 0)}</span>
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
          >
            {status.text}
          </p>
        </div>
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
                {formatClock(hud.totalMs, true)}
              </p>
              <p className="mt-3 text-xs text-white/55 tabular-nums">
                {gt("{clock} played, +{seconds} s penalties, {shots} shots", {
                  clock: formatClock(hud.totalMs - hud.penaltySeconds * 1000, true),
                  seconds: hud.penaltySeconds,
                  shots: hud.shots,
                })}
              </p>
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
