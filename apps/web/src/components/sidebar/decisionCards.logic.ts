import type {
  DecisionCard,
  DecisionCardFailureReason,
  DecisionCardOptionId,
  DecisionCardStatus,
  ProjectId,
} from "@t3tools/contracts";

export const DECISION_CARD_STATUS_FILTERS: ReadonlyArray<{
  status: DecisionCardStatus;
  label: string;
}> = [
  { status: "open", label: "Open" },
  { status: "answered", label: "Answered" },
  { status: "dismissed", label: "Dismissed" },
];

/** Counts every project, so a card from another project is not missed while one is filtered. */
export function openDecisionCardCount(cards: ReadonlyArray<DecisionCard>): number {
  let count = 0;
  for (const card of cards) {
    if (card.status === "open") count += 1;
  }
  return count;
}

/** `activeProjectId` filters only when it is set and `showAllProjects` is off. */
export function visibleDecisionCards(input: {
  cards: ReadonlyArray<DecisionCard>;
  status: DecisionCardStatus;
  activeProjectId: ProjectId | null;
  showAllProjects: boolean;
}): ReadonlyArray<DecisionCard> {
  const projectId = input.showAllProjects ? null : input.activeProjectId;
  return input.cards.filter(
    (card) => card.status === input.status && (projectId === null || card.projectId === projectId),
  );
}

/** How many open cards the project filter hides; the toggle names it. */
export function hiddenOpenDecisionCardCount(input: {
  cards: ReadonlyArray<DecisionCard>;
  activeProjectId: ProjectId | null;
}): number {
  if (input.activeProjectId === null) return 0;
  let count = 0;
  for (const card of input.cards) {
    if (card.status === "open" && card.projectId !== input.activeProjectId) count += 1;
  }
  return count;
}

/** The server needs a pick, a note, or both. */
export function canSubmitDecisionAnswer(input: {
  chosenOptionId: DecisionCardOptionId | null;
  note: string;
}): boolean {
  return input.chosenOptionId !== null || input.note.trim().length > 0;
}

const FAILURE_MESSAGES: Record<DecisionCardFailureReason, string> = {
  not_found: "This decision no longer exists. Its thread may have been deleted.",
  not_open: "This decision was already answered or dismissed. Reopen it to change it.",
  already_open: "This decision is already open.",
  invalid_answer: "Pick an option or write a note first.",
  thread_closed: "The thread that asked is archived or deleted, so it can't take an answer.",
  failed: "Something went wrong. Try again.",
};

/** Plain-language text for a failed card command; `error` is whatever the command failed with. */
export function decisionCardErrorMessage(error: unknown): string {
  const tag =
    typeof error === "object" && error !== null && "_tag" in error ? error._tag : undefined;
  if (tag === "DecisionCardError") {
    const reason = (error as { reason?: unknown }).reason;
    if (typeof reason === "string" && reason in FAILURE_MESSAGES) {
      return FAILURE_MESSAGES[reason as DecisionCardFailureReason];
    }
  }
  if (tag === "EnvironmentAuthorizationError") {
    return "You don't have permission to answer decisions on this machine.";
  }
  return FAILURE_MESSAGES.failed;
}
