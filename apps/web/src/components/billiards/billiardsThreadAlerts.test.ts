import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { describe, expect, it } from "vite-plus/test";

import { snapshotThreads, threadAlerts } from "./billiardsThreadAlerts.ts";

function shell(
  id: string,
  state: {
    running?: boolean;
    completedAt?: string | null;
    needsInput?: boolean;
    subagent?: boolean;
    runStatus?: string;
  } = {},
): EnvironmentThreadShell {
  return {
    environmentId: "env",
    id,
    title: id,
    lineage: { relationshipToParent: state.subagent ? "subagent" : null, sideChat: false },
    runtime: state.running ? { status: "running" } : { status: "completed" },
    latestRun:
      state.completedAt === undefined
        ? null
        : { status: state.runStatus ?? "completed", completedAt: state.completedAt },
    hasPendingApprovals: false,
    hasPendingUserInput: state.needsInput ?? false,
    pendingSubagentRequest: null,
  } as unknown as EnvironmentThreadShell;
}

describe("threadAlerts", () => {
  it("says nothing about threads that were already done when the game opened", () => {
    const threads = [shell("a", { completedAt: "2026-11-26T10:00:00Z" })];
    expect(threadAlerts(snapshotThreads(threads), threads)).toEqual([]);
  });

  it("reports a thread that finishes while playing", () => {
    const baseline = snapshotThreads([shell("a", { running: true, completedAt: null })]);
    const alerts = threadAlerts(baseline, [shell("a", { completedAt: "2026-11-26T10:05:00Z" })]);
    expect(alerts.map((alert) => [alert.thread.id, alert.kind])).toEqual([["a", "done"]]);
  });

  it("reports a thread that starts needing you, but not a subagent or a stopped run", () => {
    const baseline = snapshotThreads([
      shell("a", { running: true }),
      shell("b", { running: true, subagent: true }),
      shell("c", { running: true }),
    ]);
    const alerts = threadAlerts(baseline, [
      shell("a", { running: true, needsInput: true }),
      shell("b", { completedAt: "2026-11-26T10:05:00Z", subagent: true }),
      shell("c", { completedAt: "2026-11-26T10:05:00Z", runStatus: "interrupted" }),
    ]);
    expect(alerts.map((alert) => [alert.thread.id, alert.kind])).toEqual([["a", "needsYou"]]);
  });
});
