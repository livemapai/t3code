import { assert, it } from "@effect/vitest";
import type { DecisionCard, DecisionCardListResult } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { distinctSnapshots } from "./DecisionCards.ts";

const card = (id: string, status: DecisionCard["status"]) => ({ id, status }) as DecisionCard;

it.effect("a subscription drops snapshots that repeat the one before, and keeps real changes", () =>
  Effect.gen(function* () {
    const open = { cards: [card("a", "open")] } satisfies DecisionCardListResult;
    const answered = { cards: [card("a", "answered")] } satisfies DecisionCardListResult;
    const snapshots = yield* Stream.runCollect(
      distinctSnapshots(
        Stream.fromIterable([
          { cards: [] },
          { cards: [] },
          { cards: open.cards.slice() },
          open,
          answered,
          { cards: [] },
        ]),
      ),
    );
    assert.deepEqual(snapshots, [{ cards: [] }, open, answered, { cards: [] }]);
  }),
);
