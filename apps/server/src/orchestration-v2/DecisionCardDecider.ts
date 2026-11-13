import {
  type DecisionCard,
  type DecisionCardFailureReason,
  MessageId,
  type OrchestrationV2AppThread,
  type OrchestrationV2InternalCommand,
  type OrchestrationV2Notification,
} from "@t3tools/contracts";
import * as Result from "effect/Result";

export type DecisionCardCommand = Extract<
  OrchestrationV2InternalCommand,
  {
    readonly type:
      | "decision-card.post"
      | "decision-card.answer"
      | "decision-card.dismiss"
      | "decision-card.reopen";
  }
>;

export interface DecisionCardFailure {
  readonly reason: DecisionCardFailureReason;
  readonly message: string;
}

export interface DecisionCardDecision {
  /** Undefined when the command leaves the card as it is, as a retried post does. */
  readonly card: DecisionCard | undefined;
  readonly wake: boolean;
}

const fail = (reason: DecisionCardFailureReason, message: string) =>
  Result.fail<DecisionCardFailure>({ reason, message });

const samePost = (
  card: DecisionCard,
  command: DecisionCardCommand & { type: "decision-card.post" },
) =>
  card.threadId === command.threadId &&
  card.title === command.title &&
  card.context === command.context &&
  card.recommendedOptionId === command.recommendedOptionId &&
  JSON.stringify(card.options) === JSON.stringify(command.options);

export function decideDecisionCardCommand(input: {
  readonly command: DecisionCardCommand;
  readonly thread: Pick<OrchestrationV2AppThread, "id" | "projectId" | "archivedAt" | "deletedAt">;
  readonly existing: DecisionCard | undefined;
  readonly now: string;
}): Result.Result<DecisionCardDecision, DecisionCardFailure> {
  const { command, thread, existing, now } = input;
  if (thread.deletedAt !== null || thread.archivedAt !== null) {
    return fail(
      "thread_closed",
      `Thread ${thread.id} is ${thread.deletedAt !== null ? "deleted" : "archived"}.`,
    );
  }
  if (command.type === "decision-card.post") {
    if (existing !== undefined) {
      return samePost(existing, command)
        ? Result.succeed({ card: undefined, wake: false })
        : fail("failed", `Decision card ${command.cardId} already exists.`);
    }
    const optionIds = new Set(command.options.map((option) => option.id));
    if (optionIds.size !== command.options.length) {
      return fail("invalid_answer", "Each option needs its own id.");
    }
    if (command.recommendedOptionId !== undefined && !optionIds.has(command.recommendedOptionId)) {
      return fail(
        "invalid_answer",
        `recommendedOptionId ${command.recommendedOptionId} is not one of the options.`,
      );
    }
    return Result.succeed({
      card: {
        id: command.cardId,
        projectId: thread.projectId,
        threadId: thread.id,
        title: command.title,
        context: command.context,
        options: command.options,
        ...(command.recommendedOptionId === undefined
          ? {}
          : { recommendedOptionId: command.recommendedOptionId }),
        status: "open",
        createdAt: now,
      },
      wake: false,
    });
  }
  if (existing === undefined || existing.threadId !== command.threadId) {
    return fail("not_found", `Decision card ${command.cardId} was not found.`);
  }
  const {
    chosenOptionId: _chosenOptionId,
    note: _note,
    answeredAt: _answeredAt,
    ...unanswered
  } = existing;
  switch (command.type) {
    case "decision-card.answer": {
      if (existing.status !== "open") {
        return fail("not_open", `Decision card ${existing.id} is already ${existing.status}.`);
      }
      const note = command.note?.trim() || undefined;
      if (command.chosenOptionId === undefined && note === undefined) {
        return fail("invalid_answer", "Choose an option or write a note.");
      }
      if (
        command.chosenOptionId !== undefined &&
        !existing.options.some((option) => option.id === command.chosenOptionId)
      ) {
        return fail("invalid_answer", `Option ${command.chosenOptionId} is not on this card.`);
      }
      return Result.succeed({
        card: {
          ...unanswered,
          status: "answered",
          ...(command.chosenOptionId === undefined
            ? {}
            : { chosenOptionId: command.chosenOptionId }),
          ...(note === undefined ? {} : { note }),
          answeredAt: now,
        },
        wake: true,
      });
    }
    case "decision-card.dismiss":
      if (existing.status !== "open") {
        return fail("not_open", `Decision card ${existing.id} is already ${existing.status}.`);
      }
      return Result.succeed({ card: { ...unanswered, status: "dismissed" }, wake: false });
    case "decision-card.reopen":
      if (existing.status === "open") {
        return fail("already_open", `Decision card ${existing.id} is already open.`);
      }
      // The earlier answer already woke the thread; reopening only takes it back for the user.
      return Result.succeed({ card: { ...unanswered, status: "open" }, wake: false });
  }
}

/** The message that brings an answered card back to the thread that posted it. */
export function decisionCardWake(
  card: DecisionCard,
  commandId: string,
): {
  readonly messageId: MessageId;
  readonly text: string;
  readonly notification: OrchestrationV2Notification;
} {
  const chosen = card.options.find((option) => option.id === card.chosenOptionId);
  const lines = [`The user answered your decision card "${card.title}" (${card.id}).`];
  if (chosen !== undefined) lines.push(`Choice: ${chosen.label} (option ${chosen.id}).`);
  if (card.note !== undefined) {
    lines.push(chosen === undefined ? `Answer: ${card.note}` : `Note: ${card.note}`);
  }
  lines.push("Continue with this decision.");
  const text = lines.join("\n");
  return {
    messageId: MessageId.make(`message:decision-card:${commandId}`),
    text,
    notification: {
      source: { kind: "system" },
      outcome: "updated",
      summary: `Decision answered: ${card.title}`,
      detail: text,
    },
  };
}
