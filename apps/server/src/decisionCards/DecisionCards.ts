import {
  CommandId,
  type DecisionCard,
  type DecisionCardAnswerInput,
  DecisionCardError,
  DecisionCardId,
  type DecisionCardDismissInput,
  type DecisionCardListInput,
  type DecisionCardListResult,
  type DecisionCardMutationResult,
  type DecisionCardOption,
  type DecisionCardReopenInput,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";

import {
  decideDecisionCardCommand,
  type DecisionCardCommand,
} from "../orchestration-v2/DecisionCardDecider.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";

export interface DecisionCardPostInput {
  readonly threadId: ThreadId;
  readonly title: string;
  readonly context: string;
  readonly options: ReadonlyArray<DecisionCardOption>;
  readonly recommendedOptionId?: string | undefined;
}

export class DecisionCards extends Context.Service<
  DecisionCards,
  {
    /** Posts an open card in `threadId`. Answering it later wakes that thread. */
    readonly post: (input: DecisionCardPostInput) => Effect.Effect<DecisionCard, DecisionCardError>;
    readonly list: (
      input: DecisionCardListInput,
    ) => Effect.Effect<DecisionCardListResult, DecisionCardError>;
    /** The list now, then again after every change that can alter it. */
    readonly subscribe: (
      input: DecisionCardListInput,
    ) => Stream.Stream<DecisionCardListResult, DecisionCardError>;
    readonly answer: (
      input: DecisionCardAnswerInput,
    ) => Effect.Effect<DecisionCardMutationResult, DecisionCardError>;
    readonly dismiss: (
      input: DecisionCardDismissInput,
    ) => Effect.Effect<DecisionCardMutationResult, DecisionCardError>;
    readonly reopen: (
      input: DecisionCardReopenInput,
    ) => Effect.Effect<DecisionCardMutationResult, DecisionCardError>;
  }
>()("t3/decisionCards/DecisionCards") {}

/** Events after which a list can read differently: card changes, and threads closing or opening. */
const LIST_CHANGE_EVENTS = [
  "decision-card.updated",
  "thread.archived",
  "thread.unarchived",
  "thread.deleted",
] as const;

const failed = (cause: unknown, cardId?: DecisionCardId) =>
  new DecisionCardError({
    reason: "failed",
    message: cause instanceof Error ? cause.message : "Decision card request failed.",
    ...(cardId === undefined ? {} : { cardId }),
    cause,
  });

const make = Effect.gen(function* () {
  const engine = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const random = yield* SecureRandom.SecureRandom;

  const readCard = (cardId: DecisionCardId) =>
    projections.getDecisionCard(cardId).pipe(Effect.mapError((cause) => failed(cause, cardId)));

  /**
   * Checks the command against the card as stored, so a client hears why it was refused;
   * the orchestrator checks again under its lock.
   */
  const run = Effect.fn("DecisionCards.run")(function* (command: DecisionCardCommand) {
    yield* Effect.annotateCurrentSpan({
      "decision_card.id": command.cardId,
      "decision_card.command": command.type,
      "orchestration_v2.thread_id": command.threadId,
    });
    const [thread, existing] = yield* Effect.all([
      projections.getThread(command.threadId),
      projections.getDecisionCard(command.cardId),
    ]).pipe(Effect.mapError((cause) => failed(cause, command.cardId)));
    const decided = decideDecisionCardCommand({
      command,
      thread,
      existing,
      now: DateTime.formatIso(yield* DateTime.now),
    });
    if (Result.isFailure(decided)) {
      return yield* new DecisionCardError({ ...decided.failure, cardId: command.cardId });
    }
    yield* engine.dispatch(command).pipe(Effect.mapError((cause) => failed(cause, command.cardId)));
    const card = yield* readCard(command.cardId);
    if (card === undefined) {
      return yield* new DecisionCardError({
        reason: "not_found",
        message: `Decision card ${command.cardId} was not found.`,
        cardId: command.cardId,
      });
    }
    return card;
  });

  const commandId = (action: string, cardId: DecisionCardId) =>
    random
      .uuidV4()
      .pipe(Effect.map((uuid) => CommandId.make(`decision-card:${action}:${cardId}:${uuid}`)));

  const mutate = Effect.fn("DecisionCards.mutate")(function* (
    cardId: DecisionCardId,
    action: "answer" | "dismiss" | "reopen",
    fields: Pick<DecisionCardAnswerInput, "chosenOptionId" | "note"> = {},
  ) {
    const existing = yield* readCard(cardId);
    if (existing === undefined) {
      return yield* new DecisionCardError({
        reason: "not_found",
        message: `Decision card ${cardId} was not found.`,
        cardId,
      });
    }
    const common = {
      commandId: yield* commandId(action, cardId),
      threadId: existing.threadId,
      cardId,
    };
    const card = yield* run(
      action === "answer"
        ? {
            ...common,
            type: "decision-card.answer",
            ...(fields.chosenOptionId === undefined
              ? {}
              : { chosenOptionId: fields.chosenOptionId }),
            ...(fields.note === undefined ? {} : { note: fields.note }),
          }
        : { ...common, type: `decision-card.${action}` },
    );
    return { card };
  });

  const post: DecisionCards["Service"]["post"] = Effect.fn("DecisionCards.post")(function* (input) {
    const cardId = DecisionCardId.make(`decision-card:${yield* random.uuidV4()}`);
    return yield* run({
      type: "decision-card.post",
      commandId: yield* commandId("post", cardId),
      threadId: input.threadId,
      cardId,
      title: input.title,
      context: input.context,
      options: input.options,
      ...(input.recommendedOptionId === undefined
        ? {}
        : { recommendedOptionId: input.recommendedOptionId }),
    });
  });

  const listSnapshot = (input: DecisionCardListInput) =>
    projections.listDecisionCards(input).pipe(Effect.mapError((cause) => failed(cause)));

  const list: DecisionCards["Service"]["list"] = Effect.fn("DecisionCards.list")(function* (input) {
    const { cards } = yield* listSnapshot(input);
    return { cards };
  });

  const subscribe: DecisionCards["Service"]["subscribe"] = (input) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const first = yield* listSnapshot(input);
        const changes = Stream.mergeAll(
          LIST_CHANGE_EVENTS.map((eventType) =>
            engine.streamStoredEventsFrom({
              afterSequence: first.snapshotSequence,
              eventType,
            }),
          ),
          { concurrency: "unbounded" },
        ).pipe(
          Stream.mapError((cause) => failed(cause)),
          Stream.mapEffect(() => list(input)),
        );
        return Stream.concat(Stream.make({ cards: first.cards }), changes);
      }),
    );

  return DecisionCards.of({
    post,
    list,
    subscribe,
    answer: Effect.fn("DecisionCards.answer")(function* (input) {
      return yield* mutate(input.cardId, "answer", {
        ...(input.chosenOptionId === undefined ? {} : { chosenOptionId: input.chosenOptionId }),
        ...(input.note === undefined ? {} : { note: input.note }),
      });
    }),
    dismiss: Effect.fn("DecisionCards.dismiss")(function* (input) {
      return yield* mutate(input.cardId, "dismiss");
    }),
    reopen: Effect.fn("DecisionCards.reopen")(function* (input) {
      return yield* mutate(input.cardId, "reopen");
    }),
  });
});

export const layer = Layer.effect(DecisionCards, make);
