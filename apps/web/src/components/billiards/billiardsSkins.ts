import { medalFor, type BilliardsRun, type Medal } from "./billiardsRecords.ts";

// Stick skins: looks earned with results on this machine. A power-up's look still wins while it's
// armed, so a skin never hides that one is ready.

const STORAGE_KEY = "ari-billiards-skin";

export type SkinId = "classic" | "ari" | "copper" | "chrome" | "ember";

export interface Skin {
  readonly id: SkinId;
  /** What earns it: nothing, any cleared table, or a medal. */
  readonly unlock: null | "clear" | Medal;
  /** A CSS gradient for the picker swatch. */
  readonly swatch: string;
}

export const SKINS: ReadonlyArray<Skin> = [
  {
    id: "classic",
    unlock: null,
    swatch: "linear-gradient(90deg, #120a06, #2a1810 35%, #d4af37 37%, #b8875a 40%, #e0c69c)",
  },
  {
    id: "ari",
    unlock: "clear",
    swatch: "linear-gradient(90deg, #2a0f42, #5b2a86 45%, #ffc83d 47%, #5b2a86 50%, #8a4fc0)",
  },
  {
    id: "copper",
    unlock: "bronze",
    swatch: "linear-gradient(90deg, #5a2e14, #b87333 30%, #e8a476 50%, #b87333 70%, #f3c6a0)",
  },
  {
    id: "chrome",
    unlock: "silver",
    swatch: "linear-gradient(90deg, #3c434c, #9aa4b0 30%, #f4f7fa 50%, #9aa4b0 70%, #dfe5ec)",
  },
  {
    id: "ember",
    unlock: "gold",
    swatch: "linear-gradient(90deg, #120604, #3a1408 30%, #ff7a1a 45%, #3a1408 60%, #ffb347)",
  },
];

const MEDAL_RANK: Readonly<Record<Medal, number>> = { bronze: 1, silver: 2, gold: 3 };

/** The skins these runs have earned. */
export function unlockedSkins(runs: ReadonlyArray<BilliardsRun>): ReadonlySet<SkinId> {
  let best = 0;
  for (const run of runs) {
    const medal = medalFor(run.totalMs);
    if (medal) best = Math.max(best, MEDAL_RANK[medal]);
  }
  return new Set(
    SKINS.filter(
      (skin) =>
        skin.unlock === null ||
        (skin.unlock === "clear" ? runs.length > 0 : best >= MEDAL_RANK[skin.unlock]),
    ).map((skin) => skin.id),
  );
}

export function loadSkin(): SkinId {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return SKINS.find((skin) => skin.id === stored)?.id ?? "classic";
  } catch {
    return "classic";
  }
}

export function saveSkin(id: SkinId): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Not saved; the choice still holds for this game.
  }
}
