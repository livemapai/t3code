import {
  AriInviteError,
  type AriInviteInput,
  type AriUninviteInput,
  type AriUninviteResult,
  type GuestShareId,
  type OrchestrationV2DomainEvent,
  type ThreadId,
} from "@t3tools/contracts";
import { type DrainableWorker, makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as GuestShareService from "../guest/GuestShareService.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import { forkParked } from "../serverActivation.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as AriClient from "./AriClient.ts";
import * as AriTeam from "./AriTeam.ts";
import { ariThreadTitle } from "./AriTeamPublisher.ts";

// As the team list's retries: a relay that is briefly unreachable gets three more tries.
const WITHDRAW_RETRY_SECONDS = [15, 30, 60];

export class AriInvites extends Context.Service<
  AriInvites,
  {
    /** Sends the thread's current guest link to a teammate, replacing one sent them before. */
    readonly invite: (input: AriInviteInput) => Effect.Effect<void, AriInviteError>;
    /** Withdraws an invite this person sent, or dismisses one sent to them. */
    readonly uninvite: (
      input: AriUninviteInput,
    ) => Effect.Effect<AriUninviteResult, AriInviteError>;
  }
>()("t3/ari/AriInvites") {}

export interface AriInvitesSource<E> {
  readonly events: Stream.Stream<OrchestrationV2DomainEvent, E>;
  /** Whether Team threads is on for this machine; invites are part of it. */
  readonly enabled: Effect.Effect<boolean>;
  readonly inviteLink: GuestShareService.GuestShareService["Service"]["inviteLink"];
}

const decodeInvited = Schema.decodeOption(
  Schema.fromJsonString(Schema.Struct({ id: Schema.String })),
);
const decodeRemoved = Schema.decodeOption(
  Schema.fromJsonString(Schema.Struct({ removed: Schema.Boolean })),
);

const toInviteError = (error: AriClient.AriReadError) =>
  new AriInviteError({ reason: error.state });

/** The share a thread event leaves an invite link pointing at, or null once nobody can use it. */
function liveShareAfter(event: OrchestrationV2DomainEvent): GuestShareId | null | undefined {
  if (event.type === "thread.archived" || event.type === "thread.deleted") return null;
  if (event.type !== "thread.guest-share-updated") return undefined;
  const share = event.payload.guestShare;
  // A redeemed link opens for no one else, so the other invites to it only mislead.
  return share && share.guestName === null ? share.id : null;
}

export const makeAriInvites = Effect.fn("AriInvites.make")(function* <E>(
  source: AriInvitesSource<E>,
) {
  const client = yield* AriClient.AriClient;
  const team = yield* AriTeam.AriTeam;
  // Only in memory: after a restart an invite lasts until it expires or is dismissed.
  const sent = new Map<ThreadId, { shareId: GuestShareId; byHandle: Map<string, string> }>();

  const scope = yield* Effect.scope;
  // Each withdrawal waits here until `ari` answers, or until its last retry fails.
  const withdrawing = new Map<string, number>();
  const withdrawals: DrainableWorker<string> = yield* makeDrainableWorker((id: string) =>
    client.run(["relay", "uninvite", id]).pipe(
      Effect.matchEffect({
        // Gone on the API's side already counts as done.
        onSuccess: () => Effect.sync(() => void withdrawing.delete(id)),
        onFailure: (error) =>
          Effect.suspend(() => {
            const failures = (withdrawing.get(id) ?? 0) + 1;
            const delay = WITHDRAW_RETRY_SECONDS[failures - 1];
            if (delay === undefined) {
              withdrawing.delete(id);
              return Effect.logInfo("ari invite could not be withdrawn", { state: error.state });
            }
            withdrawing.set(id, failures);
            return Effect.sleep(Duration.seconds(delay)).pipe(
              Effect.andThen(withdrawals.enqueue(id)),
              Effect.forkIn(scope),
              Effect.asVoid,
            );
          }),
      }),
    ),
  );
  const withdraw = (id: string) =>
    Effect.suspend(() => {
      if (withdrawing.has(id)) return Effect.void;
      withdrawing.set(id, 0);
      return withdrawals.enqueue(id);
    });

  const invite = Effect.fn("AriInvites.invite")(function* (input: AriInviteInput) {
    if (!(yield* source.enabled)) return yield* new AriInviteError({ reason: "team_off" });
    const link = yield* source.inviteLink(input.threadId, input.shareId);
    if (Option.isNone(link)) return yield* new AriInviteError({ reason: "link_ended" });
    const people = yield* team.people;
    if (people.state !== "ok") return yield* new AriInviteError({ reason: people.state });
    if (!people.people.some((person) => person.handle === input.to)) {
      return yield* new AriInviteError({ reason: "not_teammate" });
    }
    const earlier = sent.get(input.threadId);
    const previous =
      earlier?.shareId === input.shareId ? earlier.byHandle.get(input.to) : undefined;
    if (previous !== undefined) {
      earlier?.byHandle.delete(input.to);
      yield* withdraw(previous);
    }
    // The switch can go off while the link and the team are read.
    if (!(yield* source.enabled)) return yield* new AriInviteError({ reason: "team_off" });
    // The link goes on stdin, out of the process list; `=` keeps a title that starts with a dash
    // a value; `redact` keeps whatever `ari` prints out of errors.
    const answer = yield* client
      .run(
        [
          "relay",
          "invite",
          input.to,
          "--url=-",
          `--title=${ariThreadTitle(link.value.title)}`,
          `--expires=${link.value.expiresAt}`,
        ],
        { stdin: link.value.url, redact: true },
      )
      .pipe(Effect.mapError(toInviteError));
    const invited = decodeInvited(answer);
    if (Option.isNone(invited)) return yield* new AriInviteError({ reason: "failed" });
    const current = sent.get(input.threadId);
    const entry =
      current?.shareId === input.shareId
        ? current
        : { shareId: input.shareId, byHandle: new Map<string, string>() };
    entry.byHandle.set(input.to, invited.value.id);
    sent.set(input.threadId, entry);
    // A share that ended while `ari` ran sent no event this could act on; withdraw it now.
    if (Option.isNone(yield* source.inviteLink(input.threadId, input.shareId))) {
      const recorded = sent.get(input.threadId);
      if (recorded?.byHandle.get(input.to) === invited.value.id) {
        recorded.byHandle.delete(input.to);
        if (recorded.byHandle.size === 0) sent.delete(input.threadId);
        yield* withdraw(invited.value.id);
      }
      return yield* new AriInviteError({ reason: "link_ended" });
    }
  });

  const uninvite = Effect.fn("AriInvites.uninvite")(function* (input: AriUninviteInput) {
    const answer = yield* client
      .run(["relay", "uninvite", input.id])
      .pipe(Effect.mapError(toInviteError));
    const removed = decodeRemoved(answer);
    if (Option.isNone(removed)) return yield* new AriInviteError({ reason: "failed" });
    yield* team.invalidate;
    return removed.value;
  });

  // Untraced: runs on every domain event, and nearly all of them return at once.
  const onEvent = Effect.fnUntraced(function* (event: OrchestrationV2DomainEvent) {
    const entry = sent.get(event.threadId);
    if (entry === undefined) return;
    const live = liveShareAfter(event);
    if (live === undefined || live === entry.shareId) return;
    sent.delete(event.threadId);
    for (const id of entry.byHandle.values()) yield* withdraw(id);
  });

  const start = Effect.fn("AriInvites.start")(function* (): Effect.fn.Return<
    void,
    never,
    Scope.Scope
  > {
    yield* forkParked(Stream.runForEach(source.events, onEvent));
  });

  return { invite, uninvite, start, drain: withdrawals.drain };
});

export const layer = Layer.effect(
  AriInvites,
  Effect.gen(function* () {
    const threads = yield* ThreadManagement.ThreadManagementService;
    const guestShares = yield* GuestShareService.GuestShareService;
    const settings = yield* ServerSettings.ServerSettingsService;
    const invites = yield* makeAriInvites({
      events: threads.streamDomainEvents,
      enabled: settings.getSettings.pipe(
        Effect.map((value) => value.ariTeamThreadsEnabled),
        Effect.orElseSucceed(() => false),
      ),
      inviteLink: guestShares.inviteLink,
    });
    yield* invites.start();
    return AriInvites.of({ invite: invites.invite, uninvite: invites.uninvite });
  }),
);
