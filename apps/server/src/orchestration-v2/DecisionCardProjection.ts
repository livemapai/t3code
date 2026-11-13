import {
  DecisionCard,
  type DecisionCardId,
  type DecisionCardListInput,
  ProjectId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as SqlClient from "effect/sql/SqlClient";

const DecisionCardJson = Schema.fromJsonString(DecisionCard);
const encodeCard = Schema.encodeEffect(DecisionCardJson);
const decodeCard = Schema.decodeUnknownEffect(DecisionCardJson);

type PayloadRow = { readonly payload_json: string; readonly project_id: string };

/** Old answered and dismissed cards pile up; a sidebar needs only the newest. Open cards are never cut. */
const DECISION_CARD_CLOSED_LIST_LIMIT = 200;

/** A card belongs to the project its thread is in now; the stored `project_id` can be stale after a thread moves. */
const decodeRow = (row: PayloadRow) =>
  decodeCard(row.payload_json).pipe(
    Effect.map((card) => ({ ...card, projectId: ProjectId.make(row.project_id) })),
  );

export const upsertDecisionCard = Effect.fnUntraced(function* (
  sql: SqlClient.SqlClient,
  card: DecisionCard,
) {
  const payloadJson = yield* encodeCard(card);
  yield* sql`
    INSERT INTO orchestration_v2_projection_decision_cards (
      decision_card_id,
      project_id,
      thread_id,
      status,
      created_at,
      payload_json
    )
    VALUES (
      ${card.id},
      ${card.projectId},
      ${card.threadId},
      ${card.status},
      ${card.createdAt},
      ${payloadJson}
    )
    ON CONFLICT(decision_card_id)
    DO UPDATE SET
      project_id = excluded.project_id,
      thread_id = excluded.thread_id,
      status = excluded.status,
      created_at = excluded.created_at,
      payload_json = excluded.payload_json
  `;
});

export const readDecisionCard = Effect.fnUntraced(function* (
  sql: SqlClient.SqlClient,
  cardId: DecisionCardId,
) {
  const rows = yield* sql<PayloadRow>`
    SELECT card.payload_json, COALESCE(thread.project_id, card.project_id) AS project_id
    FROM orchestration_v2_projection_decision_cards AS card
    LEFT JOIN orchestration_v2_projection_threads AS thread ON thread.thread_id = card.thread_id
    WHERE card.decision_card_id = ${cardId}
  `;
  return rows[0] === undefined ? undefined : yield* decodeRow(rows[0]);
});

/**
 * Newest first, with the event sequence they were read at. Every open card is listed, plus the
 * newest closed ones. Cards of deleted or archived threads are left out; unarchiving lists them again.
 */
export const readDecisionCards = (sql: SqlClient.SqlClient, input: DecisionCardListInput) =>
  sql
    .withTransaction(
      Effect.all([
        sql<PayloadRow>`
          SELECT payload_json, project_id FROM (
            SELECT
              card.payload_json,
              card.status,
              card.created_at,
              card.decision_card_id,
              thread.project_id,
              ROW_NUMBER() OVER (
                PARTITION BY card.status = 'open'
                ORDER BY card.created_at DESC, card.decision_card_id DESC
              ) AS rank
            FROM orchestration_v2_projection_decision_cards AS card
            JOIN orchestration_v2_projection_threads AS thread ON thread.thread_id = card.thread_id
            WHERE thread.deleted_at IS NULL
              AND thread.archived_at IS NULL
              AND (${input.projectId ?? null} IS NULL OR thread.project_id = ${input.projectId ?? null})
              AND (${input.status ?? null} IS NULL OR card.status = ${input.status ?? null})
          )
          WHERE status = 'open' OR rank <= ${DECISION_CARD_CLOSED_LIST_LIMIT}
          ORDER BY created_at DESC, decision_card_id DESC
        `,
        sql<{ readonly snapshot_sequence: number | null }>`
          SELECT MAX(sequence) AS snapshot_sequence FROM orchestration_events
          WHERE application_event_version = 2 AND aggregate_kind = 'thread'
        `,
      ]),
    )
    .pipe(
      Effect.flatMap(([rows, sequenceRows]) =>
        Effect.forEach(rows, decodeRow).pipe(
          Effect.map((cards) => ({
            cards,
            snapshotSequence: sequenceRows[0]?.snapshot_sequence ?? 0,
          })),
        ),
      ),
    );
