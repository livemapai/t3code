import type { ClientSettings } from "@t3tools/contracts";

import bomboclaatUrl from "../../assets/bomboclaat.mp3?url";
import shipItUrl from "../../assets/ship-it.mp3?url";
import { getClientSettings, useClientSettings } from "../../hooks/useSettings";

/** What an armed merge button says, and what a landed merge sounds like (Labs > Ari). */
export const MERGE_SHOUTS: Record<
  ClientSettings["ariMergeShout"],
  { name: string; label: string; soundUrl: string }
> = {
  "ship-it": { name: "Ship it", label: "SHHHHHIPPPPP ITTTTTTTTT 🚂🚂🚂🚂", soundUrl: shipItUrl },
  bomboclaat: { name: "Bomboclaaaat", label: "Bomboclaaaat", soundUrl: bomboclaatUrl },
};

export function useMergeShoutLabel(): string {
  return useClientSettings((settings) =>
    settings.ariMergeSoundEnabled ? MERGE_SHOUTS[settings.ariMergeShout].label : "Confirm merge?",
  );
}

export function previewMergeShout(shout: ClientSettings["ariMergeShout"]): void {
  new Audio(MERGE_SHOUTS[shout].soundUrl).play().catch(() => undefined);
}

export function playMergeShout(): void {
  const settings = getClientSettings();
  if (settings.ariMergeSoundEnabled) previewMergeShout(settings.ariMergeShout);
}
