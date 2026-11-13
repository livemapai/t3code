import * as Schema from "effect/Schema";

import {
  DecisionCardId,
  IsoDateTime,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

const DECISION_CARD_MAX_OPTIONS = 6;

export const DecisionCardOptionId = TrimmedNonEmptyString.check(Schema.isMaxLength(64));
export type DecisionCardOptionId = typeof DecisionCardOptionId.Type;

export const DecisionCardOption = Schema.Struct({
  id: DecisionCardOptionId,
  label: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  description: Schema.optional(Schema.String.check(Schema.isMaxLength(2_000))),
});
export type DecisionCardOption = typeof DecisionCardOption.Type;

export const DecisionCardStatus = Schema.Literals(["open", "answered", "dismissed"]);
export type DecisionCardStatus = typeof DecisionCardStatus.Type;

export const DecisionCardTitle = TrimmedNonEmptyString.check(Schema.isMaxLength(200));
/** Markdown. */
export const DecisionCardContext = Schema.String.check(Schema.isMaxLength(20_000));
export const DecisionCardOptions = Schema.Array(DecisionCardOption).check(
  Schema.isMinLength(2),
  Schema.isMaxLength(DECISION_CARD_MAX_OPTIONS),
);
export const DecisionCardNote = Schema.String.check(Schema.isMaxLength(10_000));

/** A choice an agent posted for the user. Answering it wakes the posting thread. */
export const DecisionCard = Schema.Struct({
  id: DecisionCardId,
  projectId: ProjectId,
  threadId: ThreadId,
  title: DecisionCardTitle,
  context: DecisionCardContext,
  options: DecisionCardOptions,
  recommendedOptionId: Schema.optional(DecisionCardOptionId),
  status: DecisionCardStatus,
  chosenOptionId: Schema.optional(DecisionCardOptionId),
  note: Schema.optional(DecisionCardNote),
  createdAt: IsoDateTime,
  answeredAt: Schema.optional(IsoDateTime),
});
export type DecisionCard = typeof DecisionCard.Type;

/** Cards of deleted or archived threads are left out. Newest first. */
export const DecisionCardListInput = Schema.Struct({
  projectId: Schema.optional(ProjectId),
  status: Schema.optional(DecisionCardStatus),
});
export type DecisionCardListInput = typeof DecisionCardListInput.Type;

export const DecisionCardListResult = Schema.Struct({
  cards: Schema.Array(DecisionCard),
});
export type DecisionCardListResult = typeof DecisionCardListResult.Type;

/** Pick an option, write a note, or both. */
export const DecisionCardAnswerInput = Schema.Struct({
  cardId: DecisionCardId,
  chosenOptionId: Schema.optional(DecisionCardOptionId),
  note: Schema.optional(DecisionCardNote),
});
export type DecisionCardAnswerInput = typeof DecisionCardAnswerInput.Type;

export const DecisionCardDismissInput = Schema.Struct({ cardId: DecisionCardId });
export type DecisionCardDismissInput = typeof DecisionCardDismissInput.Type;

/** Opens an answered or dismissed card again. It does not wake the thread. */
export const DecisionCardReopenInput = Schema.Struct({ cardId: DecisionCardId });
export type DecisionCardReopenInput = typeof DecisionCardReopenInput.Type;

export const DecisionCardMutationResult = Schema.Struct({ card: DecisionCard });
export type DecisionCardMutationResult = typeof DecisionCardMutationResult.Type;

export const DecisionCardFailureReason = Schema.Literals([
  "not_found",
  "not_open",
  "already_open",
  "invalid_answer",
  "thread_closed",
  "failed",
]);
export type DecisionCardFailureReason = typeof DecisionCardFailureReason.Type;

export class DecisionCardError extends Schema.TaggedError<DecisionCardError>()(
  "DecisionCardError",
  {
    reason: DecisionCardFailureReason,
    message: Schema.String,
    cardId: Schema.optional(DecisionCardId),
    cause: Schema.optional(Schema.Defect()),
  },
) {}
