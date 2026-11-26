import { describe, expect, it } from "vite-plus/test";

import type { BilliardsRun } from "./billiardsRecords.ts";
import { unlockedSkins } from "./billiardsSkins.ts";

const run = (totalMs: number): BilliardsRun => ({
  day: "2026-11-26",
  totalMs,
  penaltySeconds: 0,
  shots: 20,
  finishedAt: "2026-11-26T12:00:00.000Z",
});

describe("unlockedSkins", () => {
  it("starts with only the classic stick", () => {
    expect([...unlockedSkins([])]).toEqual(["classic"]);
  });

  it("unlocks Ari for any cleared table, and each medal's stick with every lower one", () => {
    expect([...unlockedSkins([run(400_000)])]).toEqual(["classic", "ari"]);
    expect([...unlockedSkins([run(400_000), run(200_000)])]).toEqual([
      "classic",
      "ari",
      "copper",
      "chrome",
    ]);
    expect(unlockedSkins([run(100_000)]).has("ember")).toBe(true);
  });
});
