import {
  threadRuntimeIsActive,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import { isListedThreadLineage } from "@t3tools/contracts";

// While the game is open, it shows a bubble for each thread that finished or started needing
// you since the game opened, so playing never hides an agent that's done.

export type ThreadAlertKind = "done" | "needsYou";

export interface ThreadAlert {
  readonly key: string;
  readonly thread: EnvironmentThreadShell;
  readonly kind: ThreadAlertKind;
}

interface ThreadMark {
  readonly completedAt: string | null;
  readonly needsYou: boolean;
}

export type ThreadBaseline = ReadonlyMap<string, ThreadMark>;

function threadAlertKey(thread: EnvironmentThreadShell): string {
  return `${thread.environmentId}:${thread.id}`;
}

function needsYou(thread: EnvironmentThreadShell): boolean {
  return (
    thread.hasPendingApprovals ||
    thread.hasPendingUserInput ||
    (thread.pendingSubagentRequest ?? null) !== null
  );
}

function finishedAt(thread: EnvironmentThreadShell): string | null {
  const run = thread.latestRun;
  if (!run?.completedAt || run.status === "interrupted" || run.status === "cancelled") return null;
  return threadRuntimeIsActive(thread.runtime) ? null : run.completedAt;
}

/** Where every thread stands when the game opens. */
export function snapshotThreads(threads: ReadonlyArray<EnvironmentThreadShell>): ThreadBaseline {
  return new Map(
    threads.map((thread) => [
      threadAlertKey(thread),
      { completedAt: finishedAt(thread), needsYou: needsYou(thread) },
    ]),
  );
}

/** Listed threads that finished, or started needing you, since `baseline`. */
export function threadAlerts(
  baseline: ThreadBaseline,
  threads: ReadonlyArray<EnvironmentThreadShell>,
): ThreadAlert[] {
  const alerts: ThreadAlert[] = [];
  for (const thread of threads) {
    if (!isListedThreadLineage(thread.lineage)) continue;
    const key = threadAlertKey(thread);
    const before = baseline.get(key);
    if (needsYou(thread)) {
      if (!before?.needsYou) alerts.push({ key, thread, kind: "needsYou" });
      continue;
    }
    const completedAt = finishedAt(thread);
    if (completedAt !== null && completedAt !== before?.completedAt) {
      alerts.push({ key, thread, kind: "done" });
    }
  }
  return alerts;
}
