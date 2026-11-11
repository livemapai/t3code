import type { ScopedThreadRef } from "@t3tools/contracts";

import { useComposerDraftStore } from "../../composerDraftStore";
import { handOverDraft } from "./teamThreads.logic";

/** Nothing is sent: the thread's agent runs `ari relay send --handoff` once the person sends it. */
export function placeHandOverDraft(threadRef: ScopedThreadRef): void {
  const drafts = useComposerDraftStore.getState();
  drafts.setPrompt(threadRef, handOverDraft(drafts.getComposerDraft(threadRef)?.prompt ?? ""));
}
