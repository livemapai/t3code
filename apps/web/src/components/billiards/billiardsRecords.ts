// The daily rack and this machine's best runs. Everyone racks the same balls on the same day,
// so times compare fairly; a team-wide leaderboard can later post these same runs.

const STORAGE_KEY = "ari-billiards-runs";
const MAX_RUNS = 100;

export type Medal = "gold" | "silver" | "bronze";

/** A run under these times earns the medal. Tune once the team has played a few racks. */
const MEDAL_TIMES_MS: ReadonlyArray<readonly [Medal, number]> = [
  ["gold", 150_000],
  ["silver", 210_000],
  ["bronze", 300_000],
];

export interface BilliardsRun {
  /** The rack's day, `YYYY-MM-DD` in Zürich. */
  readonly day: string;
  /** Clock plus penalties: what ranks. */
  readonly totalMs: number;
  readonly penaltySeconds: number;
  readonly shots: number;
  readonly finishedAt: string;
}

/** Today's date in Zürich, so the whole team switches racks at the same midnight. */
export function rackDay(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** A stable seed for a day's rack. */
export function rackSeed(day: string): number {
  let hash = 2166136261;
  for (let i = 0; i < day.length; i++) {
    hash ^= day.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function medalFor(totalMs: number): Medal | null {
  return MEDAL_TIMES_MS.find(([, limit]) => totalMs < limit)?.[0] ?? null;
}

/** The next medal a time could earn, and the time it takes. */
export function nextMedal(totalMs: number | null): readonly [Medal, number] | null {
  const better = MEDAL_TIMES_MS.filter(([, limit]) => totalMs === null || totalMs >= limit);
  return better.at(-1) ?? null;
}

function isRun(value: unknown): value is BilliardsRun {
  if (typeof value !== "object" || value === null) return false;
  const run = value as Record<string, unknown>;
  return (
    typeof run.day === "string" &&
    typeof run.totalMs === "number" &&
    typeof run.penaltySeconds === "number" &&
    typeof run.shots === "number" &&
    typeof run.finishedAt === "string"
  );
}

export function loadRuns(): BilliardsRun[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isRun) : [];
  } catch {
    return [];
  }
}

/** Keeps the best runs; saving can fail in a locked-down browser, and the game plays on. */
export function saveRun(runs: ReadonlyArray<BilliardsRun>, run: BilliardsRun): BilliardsRun[] {
  const next = [...runs, run].sort((a, b) => a.totalMs - b.totalMs).slice(0, MAX_RUNS);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Not saved; the run still shows for this session.
  }
  return next;
}

export function runsOn(runs: ReadonlyArray<BilliardsRun>, day: string): BilliardsRun[] {
  return runs.filter((run) => run.day === day).sort((a, b) => a.totalMs - b.totalMs);
}
