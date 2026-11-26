import { describe, expect, it } from "vite-plus/test";

import {
  medalFor,
  nextMedal,
  rackDay,
  rackSeed,
  runsOn,
  type BilliardsRun,
} from "./billiardsRecords.ts";

const run = (day: string, totalMs: number): BilliardsRun => ({
  day,
  totalMs,
  penaltySeconds: 0,
  shots: 20,
  finishedAt: `${day}T12:00:00.000Z`,
});

describe("daily rack", () => {
  it("switches racks at midnight in Zürich, not UTC", () => {
    expect(rackDay(new Date("2026-11-26T22:30:00Z"))).toBe("2026-11-26");
    expect(rackDay(new Date("2026-11-26T23:30:00Z"))).toBe("2026-11-27");
  });

  it("gives each day its own stable seed", () => {
    expect(rackSeed("2026-11-26")).toBe(rackSeed("2026-11-26"));
    expect(rackSeed("2026-11-26")).not.toBe(rackSeed("2026-11-27"));
  });
});

describe("medals", () => {
  it("awards the best medal a time is under", () => {
    expect(medalFor(140_000)).toBe("gold");
    expect(medalFor(200_000)).toBe("silver");
    expect(medalFor(299_000)).toBe("bronze");
    expect(medalFor(301_000)).toBeNull();
  });

  it("names the next medal to chase", () => {
    expect(nextMedal(400_000)?.[0]).toBe("bronze");
    expect(nextMedal(250_000)?.[0]).toBe("silver");
    expect(nextMedal(140_000)).toBeNull();
  });
});

describe("runsOn", () => {
  it("lists one day's runs, fastest first", () => {
    const runs = [
      run("2026-11-26", 200_000),
      run("2026-11-25", 100_000),
      run("2026-11-26", 150_000),
    ];
    expect(runsOn(runs, "2026-11-26").map((r) => r.totalMs)).toEqual([150_000, 200_000]);
  });
});
