import { useNavigate } from "@tanstack/react-router";
import { useGT } from "gt-react";
import { GiftIcon, LockIcon, MedalIcon, PaletteIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

import { cn } from "../../lib/utils";
import { useThreadShells } from "../../state/entities";
import { formatClock, type BilliardsLabels } from "./billiardsHud";
import { medalFor, nextMedal, type Medal } from "./billiardsRecords";
import { GLOW_BALLS, GOLDEN_SHOTS } from "./billiardsRules";
import { BilliardsSession, type BilliardsHud } from "./billiardsSession";
import { SKINS, type Skin, type SkinId } from "./billiardsSkins";
import { snapshotThreads, threadAlerts, type ThreadAlert } from "./billiardsThreadAlerts";

const MAX_ALERTS = 3;
const MEDAL_COLORS: Readonly<Record<Medal, string>> = {
  gold: "#f0c04a",
  silver: "#d3d9e0",
  bronze: "#d08a52",
};

// The pool hall's materials, kept here so the overlay matches what the canvas draws.
const CHALK = "rgba(236, 233, 222, 0.92)";
const CHALK_DIM = "rgba(236, 233, 222, 0.55)";
const CHALK_YELLOW = "#ffe08a";
const CHALKBOARD: CSSProperties = {
  background: "radial-gradient(120% 90% at 50% 40%, #2c3a33 0%, #1d2823 60%, #151c18 100%)",
  border: "10px solid #4a2f1b",
  boxShadow:
    "inset 0 0 0 2px #6b4527, inset 0 0 30px rgba(0,0,0,0.55), 0 24px 60px rgba(0,0,0,0.7)",
  color: CHALK,
  textShadow: "0 0 1px rgba(236,233,222,0.5)",
};
const BRASS_KNOB: CSSProperties = {
  background: "radial-gradient(circle at 35% 30%, #f6dc93, #c9a24a 55%, #6e5016)",
  boxShadow: "0 2px 6px rgba(0,0,0,0.6), inset 0 -1px 2px rgba(0,0,0,0.35)",
  color: "#3a2808",
};
const PAPER: CSSProperties = {
  background: "linear-gradient(180deg, #fbf3dc, #efe2bf)",
  boxShadow: "0 8px 18px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.6) inset",
  color: "#2b2114",
};
const WOOD_DRAWER: CSSProperties = {
  background: "linear-gradient(180deg, #3d2416, #2a1810)",
  boxShadow: "0 16px 40px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.08)",
  border: "1px solid #5a3a22",
};
const KEYFRAMES = `
@keyframes ari-billiards-note-in {
  0% { transform: translateY(-24px) rotate(-9deg); opacity: 0; }
  55% { transform: translateY(3px) rotate(2deg); opacity: 1; }
  78% { transform: translateY(-1px) rotate(-3deg); }
  100% { transform: translateY(0) rotate(-1.5deg); }
}
@keyframes ari-billiards-pin-glow {
  0%, 100% { box-shadow: 0 0 0 0 rgba(255, 90, 70, 0.7); }
  50% { box-shadow: 0 0 0 5px rgba(255, 90, 70, 0); }
}
@keyframes ari-billiards-board-in {
  0% { transform: translateY(14px) scale(0.96); opacity: 0; }
  100% { transform: translateY(0) scale(1); opacity: 1; }
}`;

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
  const chimedRef = useRef<ReadonlySet<string>>(new Set());
  const [hud, setHud] = useState<BilliardsHud | null>(null);
  const threads = useThreadShells();
  const [baseline] = useState(() => snapshotThreads(threads));
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  const alerts = threadAlerts(baseline, threads)
    .filter((alert) => !dismissed.has(alertId(alert)))
    .slice(0, MAX_ALERTS);
  const alertKey = alerts.map(alertId).join("|");

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

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- hands the canvas game its words in the reader's language
  useEffect(() => {
    const labels: BilliardsLabels = {
      scratch: gt("Scratch"),
      miss: gt("No ball hit"),
      freeMiss: gt("Free this once"),
      early8: gt("8 too early"),
      wrong8: gt("Wrong pocket"),
      scratch8: gt("Scratch on the 8"),
      wand: gt("Wand"),
      golden: gt("Golden cue"),
      glow: gt("Glow cue"),
      wandHint: gt("The first ball you hit drops"),
      goldenHint: gt("Full sight for {count} shots", { count: GOLDEN_SHOTS }),
      glowHint: gt("Bursts through {count} balls", { count: GLOW_BALLS }),
      callPocket: gt("Click a pocket to call the 8"),
      callFirst: gt("Call a pocket first"),
      breakHint: gt("Hold to charge, release to shoot"),
      controlsHint: gt("Shift for fine aim, Esc to close"),
      penalty: (seconds) => gt("+{seconds} s", { seconds }),
    };
    sessionRef.current?.setLabels(labels);
  }, [gt]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- rings a bell (Web Audio) when a new thread note is pinned
  useEffect(() => {
    const ids = alertKey === "" ? [] : alertKey.split("|");
    if (ids.some((id) => !chimedRef.current.has(id))) sessionRef.current?.chime();
    chimedRef.current = new Set([...chimedRef.current, ...ids]);
  }, [alertKey, sessionRef, chimedRef]);

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

  const result = hud?.phase === "cleared" ? hud.result : null;

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={gt("Billiards")}
      tabIndex={-1}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/85 outline-none backdrop-blur-sm [-webkit-app-region:no-drag]"
    >
      <style>{KEYFRAMES}</style>
      <div className="relative aspect-[9/16] h-[min(94dvh,calc(94vw*16/9))] select-none overflow-hidden rounded-2xl shadow-2xl ring-1 ring-white/10">
        <canvas ref={canvasRef} className="absolute inset-0 size-full touch-none" />

        <div className="absolute top-2.5 right-2.5 flex gap-1.5">
          <button
            type="button"
            aria-label={gt("Choose a stick")}
            aria-expanded={pickerOpen}
            onClick={() => setPickerOpen(!pickerOpen)}
            className="flex size-7 items-center justify-center rounded-full transition-transform hover:scale-110 active:scale-95"
            style={BRASS_KNOB}
          >
            <PaletteIcon className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label={gt("Close")}
            onClick={onClose}
            className="flex size-7 items-center justify-center rounded-full transition-transform hover:scale-110 active:scale-95"
            style={BRASS_KNOB}
          >
            <XIcon className="size-3.5" />
          </button>
        </div>

        {pickerOpen && hud ? (
          <div
            className="absolute top-12 right-2.5 w-52 rounded-xl p-1.5 text-xs"
            style={WOOD_DRAWER}
          >
            <p className="px-2 pt-1 pb-1.5 font-semibold" style={{ color: CHALK_DIM }}>
              {gt("Stick")}
            </p>
            {SKINS.map((skin) => {
              const unlocked = hud.unlockedSkins.has(skin.id);
              const selected = hud.skin === skin.id;
              return (
                <button
                  key={skin.id}
                  type="button"
                  disabled={!unlocked}
                  onClick={() => sessionRef.current?.setSkin(skin.id)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left",
                    unlocked ? "hover:bg-white/10" : "cursor-default opacity-45",
                    selected && "bg-white/15",
                  )}
                  style={{ color: CHALK }}
                >
                  <span
                    aria-hidden
                    className="h-2 w-12 shrink-0 rounded-full"
                    style={{ background: skin.swatch, boxShadow: "0 1px 2px rgba(0,0,0,0.6)" }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{skinName(skin.id)}</span>
                    {unlocked ? null : (
                      <span className="block truncate" style={{ color: CHALK_DIM }}>
                        {unlockHint(skin)}
                      </span>
                    )}
                  </span>
                  {unlocked ? null : <LockIcon aria-hidden className="size-3 shrink-0" />}
                </button>
              );
            })}
          </div>
        ) : null}

        {alerts.length > 0 ? (
          <div
            className="pointer-events-none absolute left-3 flex w-52 flex-col gap-2.5"
            style={{ top: "9.5%" }}
          >
            {alerts.map((alert) => (
              <div
                key={alertId(alert)}
                className="pointer-events-auto relative rounded-sm px-3 pt-3 pb-2 text-xs"
                style={{
                  ...PAPER,
                  transformOrigin: "50% 0%",
                  animation: "ari-billiards-note-in 0.7s cubic-bezier(.2,.8,.3,1) both",
                }}
              >
                <span
                  aria-hidden
                  className="absolute -top-1.5 left-1/2 size-3 -translate-x-1/2 rounded-full"
                  style={{
                    background: "radial-gradient(circle at 35% 30%, #ff8a7a, #c62f22)",
                    animation: "ari-billiards-pin-glow 1.6s ease-in-out 3",
                  }}
                />
                <p className="font-semibold">
                  {alert.kind === "done"
                    ? gt("Done", { $context: "a thread finished" })
                    : gt("Needs you")}
                </p>
                <p className="mt-0.5 line-clamp-2 leading-snug opacity-80">{alert.thread.title}</p>
                <div className="mt-2 flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => setDismissed(new Set([...dismissed, alertId(alert)]))}
                    className="rounded px-2 py-0.5 opacity-60 hover:opacity-100"
                  >
                    {gt("Later")}
                  </button>
                  <button
                    type="button"
                    onClick={() => openThread(alert)}
                    className="rounded px-2.5 py-0.5 font-semibold"
                    style={{ background: "#2b2114", color: "#fbf3dc" }}
                  >
                    {gt("Open")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {hud?.phase === "cleared" ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 px-5">
            <div
              className="w-full max-w-xs rounded-md px-6 py-5 text-center"
              style={{ ...CHALKBOARD, animation: "ari-billiards-board-in 0.45s ease-out both" }}
            >
              <p className="text-sm font-semibold tracking-wide" style={{ color: CHALK_DIM }}>
                {gt("Table cleared")}
              </p>
              <p className="mt-1 font-mono text-5xl font-semibold tabular-nums">
                {formatClock(result?.run.totalMs ?? hud.totalMs, true)}
              </p>
              <p className="mt-1 text-xs tabular-nums" style={{ color: CHALK_DIM }}>
                {gt("{clock} played, +{seconds} s penalties, {shots} shots", {
                  clock: formatClock(
                    (result?.run.totalMs ?? hud.totalMs) - hud.penaltySeconds * 1000,
                    true,
                  ),
                  seconds: hud.penaltySeconds,
                  shots: hud.shots,
                })}
              </p>
              {result?.medal ? (
                <p
                  className="mt-3 flex items-center justify-center gap-1.5 text-sm font-semibold"
                  style={{ color: MEDAL_COLORS[result.medal] }}
                >
                  <MedalIcon aria-hidden className="size-4" />
                  {medalLabel(result.medal)}
                </p>
              ) : null}
              {result?.rankToday === 1 ? (
                <p className="mt-1 text-sm font-semibold" style={{ color: CHALK_YELLOW }}>
                  {gt("New best today!")}
                </p>
              ) : null}
              {result?.newSkins.map((id) => (
                <p key={id} className="mt-1 flex items-center justify-center gap-1.5 text-xs">
                  <GiftIcon aria-hidden className="size-3.5" style={{ color: CHALK_YELLOW }} />
                  {gt("New stick unlocked: {name}", { name: skinName(id) })}
                </p>
              ))}
              {result && result.medal !== "gold" ? (
                <p className="mt-1 text-xs" style={{ color: CHALK_DIM }}>
                  {nextMedalText(result.run.totalMs)}
                </p>
              ) : null}
              {hud.todayRuns.length > 1 ? (
                <div
                  className="mt-4 pt-3 text-left"
                  style={{ borderTop: "1px dashed rgba(236,233,222,0.3)" }}
                >
                  <p className="text-xs font-semibold" style={{ color: CHALK_DIM }}>
                    {gt("Today on this computer")}
                  </p>
                  <ol className="mt-1.5 space-y-0.5 font-mono text-xs tabular-nums">
                    {hud.todayRuns.slice(0, 5).map((run, index) => {
                      const medal = medalFor(run.totalMs);
                      const current = run === result?.run;
                      return (
                        <li
                          key={run.finishedAt}
                          className="flex items-center gap-2 rounded px-2 py-0.5"
                          style={current ? { background: "rgba(236,233,222,0.12)" } : undefined}
                        >
                          <span className="w-4" style={{ color: CHALK_DIM }}>
                            {index + 1}
                          </span>
                          <span className="flex-1">{formatClock(run.totalMs, true)}</span>
                          {run.penaltySeconds > 0 ? (
                            <span style={{ color: "#ff9a80" }}>
                              {gt("+{seconds} s", { seconds: run.penaltySeconds })}
                            </span>
                          ) : null}
                          {medal ? (
                            <MedalIcon
                              aria-label={medalLabel(medal)}
                              className="size-3.5"
                              style={{ color: MEDAL_COLORS[medal] }}
                            />
                          ) : (
                            <span className="size-3.5" />
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </div>
              ) : null}
              <div className="mt-5 flex justify-center gap-2">
                <button
                  type="button"
                  onClick={() => sessionRef.current?.restart()}
                  className="rounded-md px-4 py-1.5 text-sm font-semibold transition-transform hover:scale-105"
                  style={{ background: CHALK, color: "#1d2823", textShadow: "none" }}
                >
                  {gt("Play again")}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md px-4 py-1.5 text-sm font-semibold hover:bg-white/10"
                  style={{ border: `1.5px solid ${CHALK_DIM}` }}
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
