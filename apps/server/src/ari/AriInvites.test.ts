import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  EventId,
  GuestShareId,
  type OrchestrationV2AppThread,
  type OrchestrationV2DomainEvent,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as TestClock from "effect/testing/TestClock";

import * as ProcessRunner from "../processRunner.ts";
import * as AriClient from "./AriClient.ts";
import { makeAriInvites } from "./AriInvites.ts";
import * as AriTeam from "./AriTeam.ts";

const NOW = "2026-11-11T09:00:00.000Z";
const EXPIRES = "2026-11-12T09:00:00.000Z";
const THREAD = ThreadId.make("thread:shared");
const OTHER_THREAD = ThreadId.make("thread:other");
const SHARE = GuestShareId.make("share-current");
const URL = "https://env.t3.test/guest#share-current.secret-signature";

function appThread(
  guestShare: OrchestrationV2AppThread["guestShare"],
  id: ThreadId = THREAD,
): OrchestrationV2AppThread {
  return {
    id,
    projectId: ProjectId.make("project"),
    title: "-Fix the map tiles",
    providerInstanceId: ProviderInstanceId.make("codex"),
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test-model" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: { rootThreadId: id, parentThreadId: null, relationshipToParent: null },
    forkedFrom: null,
    createdBy: "user",
    creationSource: "web",
    createdAt: DateTime.makeUnsafe(NOW),
    updatedAt: DateTime.makeUnsafe(NOW),
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
    guestShare,
  };
}

const share = (overrides: { id?: GuestShareId; guestName?: string | null } = {}) => ({
  id: overrides.id ?? SHARE,
  host: "env.t3.test",
  createdAt: NOW,
  expiresAt: EXPIRES,
  guestName: overrides.guestName ?? null,
  messages: [],
});

const makeHarness = Effect.fnUntraced(function* (
  answer: (args: ReadonlyArray<string>) => { code: number; stdout: string; stderr?: string } = (
    args,
  ) => ({
    code: 0,
    stdout: args[1] === "invite" ? JSON.stringify({ id: `inv-${args[2]}` }) : '{"removed":true}',
  }),
) {
  const calls: Array<ReadonlyArray<string>> = [];
  const stdins: Array<string | undefined> = [];
  const events = yield* Queue.unbounded<OrchestrationV2DomainEvent>();
  const pulls = yield* Queue.unbounded<void>();
  let invalidated = 0;
  // Read once per check, in order; the last answer repeats.
  let teamOn: ReadonlyArray<boolean> = [true];
  let linkLive = true;
  let linkTitle = "-Fix the map tiles";
  let held: Deferred.Deferred<void> | null = null;
  const inviting = yield* Queue.unbounded<void>();
  const runner = Layer.succeed(ProcessRunner.ProcessRunner, {
    run: ({ args, stdin }) =>
      Effect.suspend(() => {
        calls.push(args);
        stdins.push(stdin);
        const result = answer(args);
        const wait =
          args[1] === "invite" && held !== null
            ? Queue.offer(inviting, undefined).pipe(Effect.andThen(Deferred.await(held)))
            : Effect.void;
        return wait.pipe(
          Effect.as({
            code: ChildProcessSpawner.ExitCode(result.code),
            stdout: result.stdout,
            stderr: result.stderr ?? "",
            timedOut: false,
            stdoutTruncated: false,
            stderrTruncated: false,
            stdoutInvalidUtf8: false,
            stderrInvalidUtf8: false,
          }),
        );
      }),
  });
  const team = Layer.succeed(
    AriTeam.AriTeam,
    AriTeam.AriTeam.of({
      read: Effect.die("unused"),
      people: Effect.succeed({
        state: "ok",
        people: [
          { handle: "anna", name: "Anna" },
          { handle: "ben", name: "Ben" },
        ],
      }),
      invalidate: Effect.sync(() => {
        invalidated += 1;
      }),
    }),
  );
  const context = yield* Layer.build(
    Layer.merge(AriClient.layer.pipe(Layer.provide(Layer.merge(runner, NodeServices.layer))), team),
  );
  const invites = yield* makeAriInvites({
    events: Stream.fromEffectRepeat(
      Queue.offer(pulls, undefined).pipe(Effect.andThen(Queue.take(events))),
    ),
    enabled: Effect.sync(() => {
      const [answer = true, ...rest] = teamOn;
      if (rest.length > 0) teamOn = rest;
      return answer;
    }),
    inviteLink: (threadId, shareId) =>
      Effect.sync(() =>
        linkLive && threadId === THREAD && shareId === SHARE
          ? Option.some({ url: URL, title: linkTitle, expiresAt: EXPIRES })
          : Option.none(),
      ),
  }).pipe(Effect.provideContext(context));
  yield* invites.start();
  yield* Queue.take(pulls);
  const deliver = Effect.fnUntraced(function* (
    type: "thread.guest-share-updated" | "thread.archived" | "thread.deleted",
    payload: OrchestrationV2AppThread,
  ) {
    yield* Queue.offer(events, {
      id: EventId.make(`event:${type}:${calls.length}`),
      type,
      threadId: payload.id,
      occurredAt: DateTime.makeUnsafe(NOW),
      payload,
    } as OrchestrationV2DomainEvent);
    yield* Queue.take(pulls);
    yield* invites.drain;
  });
  const setTeamOn = (...answers: ReadonlyArray<boolean>) =>
    Effect.sync(() => {
      teamOn = answers;
    });
  const setLink = (live: boolean, title = linkTitle) =>
    Effect.sync(() => {
      linkLive = live;
      linkTitle = title;
    });
  /** Holds the next `ari relay invite` until the returned effect releases it. */
  const holdInvite = Effect.fnUntraced(function* () {
    const gate = yield* Deferred.make<void>();
    held = gate;
    return Deferred.succeed(gate, undefined).pipe(
      Effect.andThen(
        Effect.sync(() => {
          held = null;
        }),
      ),
    );
  });
  return {
    invites,
    calls,
    stdins,
    deliver,
    setTeamOn,
    setLink,
    holdInvite,
    inviting,
    invalidated: () => invalidated,
  };
});

const sendTo = (to: string) => ({ threadId: THREAD, shareId: SHARE, to });

describe("AriInvites", () => {
  it.effect("sends only the thread's current link, to a teammate, with its title and expiry", () =>
    Effect.gen(function* () {
      const { invites, calls, stdins, setTeamOn, setLink } = yield* makeHarness();
      yield* setTeamOn(false);
      assert.equal((yield* Effect.flip(invites.invite(sendTo("anna")))).reason, "team_off");
      // Turned off while the link and the team were read: checked again before `ari` runs.
      yield* setTeamOn(true, false);
      assert.equal((yield* Effect.flip(invites.invite(sendTo("anna")))).reason, "team_off");
      yield* setTeamOn(true);
      for (const [input, reason] of [
        [{ ...sendTo("anna"), shareId: GuestShareId.make("share-replaced") }, "link_ended"],
        [{ ...sendTo("anna"), threadId: OTHER_THREAD }, "link_ended"],
        [sendTo("mallory"), "not_teammate"],
      ] as const) {
        assert.equal((yield* Effect.flip(invites.invite(input))).reason, reason);
      }
      assert.deepEqual(calls, []);

      yield* invites.invite(sendTo("anna"));
      assert.deepEqual(calls, [
        [
          "relay",
          "invite",
          "anna",
          "--url=-",
          "--title=-Fix the map tiles",
          `--expires=${EXPIRES}`,
          "--json",
        ],
      ]);
      // The link is a credential: it goes on stdin, never into an argument the process list shows.
      assert.deepEqual(stdins, [URL]);
      for (const arg of calls.flat()) {
        assert.notInclude(arg, URL);
        assert.notInclude(arg, "secret-signature");
      }
      // A title the API would refuse is shortened as the team list does.
      yield* setLink(true, "x".repeat(2500));
      yield* invites.invite(sendTo("ben"));
      assert.include(calls.at(-1) ?? [], `--title=${"x".repeat(199)}…`);
    }).pipe(Effect.scoped),
  );

  it.effect("withdraws the earlier invite before sending the same link to someone again", () =>
    Effect.gen(function* () {
      const { invites, calls } = yield* makeHarness();
      yield* invites.invite(sendTo("anna"));
      yield* invites.invite(sendTo("ben"));
      yield* invites.invite(sendTo("anna"));
      yield* invites.drain;
      assert.sameDeepMembers(
        calls.map((args) => args.slice(1, 3)),
        [
          ["invite", "anna"],
          ["invite", "ben"],
          ["uninvite", "inv-anna"],
          ["invite", "anna"],
        ],
      );
    }).pipe(Effect.scoped),
  );

  it.effect("withdraws an invite whose link ended while `ari` was sending it", () =>
    Effect.gen(function* () {
      const { invites, calls, deliver, setLink, holdInvite, inviting } = yield* makeHarness();
      const release = yield* holdInvite();
      const sending = yield* invites.invite(sendTo("anna")).pipe(Effect.flip, Effect.forkChild);
      yield* Queue.take(inviting);
      yield* setLink(false);
      // The event arrives while nothing is recorded yet for the thread.
      yield* deliver("thread.guest-share-updated", appThread(null));
      yield* release;
      assert.equal((yield* Fiber.join(sending)).reason, "link_ended");
      yield* invites.drain;
      assert.deepEqual(
        calls.map((args) => args.slice(1, 3)),
        [
          ["invite", "anna"],
          ["uninvite", "inv-anna"],
        ],
      );
    }).pipe(Effect.scoped),
  );

  it.effect.each([
    { name: "retries a failed withdrawal until it goes through", failures: 1, attempts: 2 },
    { name: "gives up on a withdrawal after three retries", failures: 9, attempts: 4 },
  ])("$name", ({ failures, attempts }) =>
    Effect.gen(function* () {
      let failed = 0;
      const { invites, calls, deliver } = yield* makeHarness((args) =>
        args[1] === "uninvite" && failed++ < failures
          ? { code: 4, stdout: "" }
          : {
              code: 0,
              stdout:
                args[1] === "invite" ? JSON.stringify({ id: "inv-anna" }) : '{"removed":false}',
            },
      );
      const withdrawals = () => calls.filter((args) => args[1] === "uninvite").length;
      yield* invites.invite(sendTo("anna"));
      yield* deliver("thread.guest-share-updated", appThread(null));
      assert.equal(withdrawals(), 1);
      for (const wait of ["15 seconds", "30 seconds", "60 seconds", "30 minutes"] as const) {
        yield* TestClock.adjust(wait);
        yield* invites.drain;
      }
      assert.equal(withdrawals(), attempts);
    }).pipe(Effect.scoped),
  );

  it.effect("keeps the link out of what a failed invite reports", () =>
    Effect.gen(function* () {
      const { invites } = yield* makeHarness(() => ({ code: 3, stdout: "", stderr: URL }));
      const error = yield* Effect.flip(invites.invite(sendTo("anna")));
      assert.equal(error.reason, "forbidden");
      assert.notInclude(error.message, "secret-signature");
      const client = yield* AriClient.AriClient;
      const failure = yield* Effect.flip(
        client.run(["relay", "invite", "anna", "--url=-"], { stdin: URL, redact: true }),
      );
      assert.notInclude(JSON.stringify(failure), "secret-signature");
    }).pipe(
      Effect.provide(
        AriClient.layer.pipe(
          Layer.provide(NodeServices.layer),
          Layer.provide(
            Layer.succeed(ProcessRunner.ProcessRunner, {
              run: () =>
                Effect.succeed({
                  code: ChildProcessSpawner.ExitCode(3),
                  stdout: "",
                  stderr: `forbidden: ${URL}`,
                  timedOut: false,
                  stdoutTruncated: false,
                  stderrTruncated: false,
                  stdoutInvalidUtf8: false,
                  stderrInvalidUtf8: false,
                }),
            }),
          ),
        ),
      ),
      Effect.scoped,
    ),
  );

  it.effect("dismisses an invite and reads the team again", () =>
    Effect.gen(function* () {
      const { invites, calls, invalidated } = yield* makeHarness();
      assert.deepEqual(yield* invites.uninvite({ id: "inv-9" }), { removed: true });
      assert.deepEqual(calls, [["relay", "uninvite", "inv-9", "--json"]]);
      assert.equal(invalidated(), 1);
    }).pipe(Effect.scoped),
  );

  it.effect.each([
    { name: "a new link replaces it", end: appThread(share({ id: GuestShareId.make("new") })) },
    { name: "sharing stops", end: appThread(null) },
    { name: "a guest joins", end: appThread(share({ guestName: "Anna" })) },
    { name: "the thread is archived", end: appThread(share()), type: "thread.archived" as const },
    { name: "the thread is deleted", end: appThread(share()), type: "thread.deleted" as const },
  ])("withdraws a link's invites once when $name", ({ end, type }) =>
    Effect.gen(function* () {
      const { invites, calls, deliver } = yield* makeHarness();
      // Nothing was sent for the other thread, so its link ending runs nothing.
      yield* deliver("thread.guest-share-updated", appThread(null, OTHER_THREAD));
      assert.deepEqual(calls, []);

      yield* invites.invite(sendTo("anna"));
      yield* invites.invite(sendTo("ben"));
      // The same share, still unused, keeps them.
      yield* deliver("thread.guest-share-updated", appThread(share()));
      yield* deliver(type ?? "thread.guest-share-updated", end);
      yield* deliver(type ?? "thread.guest-share-updated", end);
      assert.deepEqual(
        calls.slice(2).map((args) => args.slice(1)),
        [
          ["uninvite", "inv-anna", "--json"],
          ["uninvite", "inv-ben", "--json"],
        ],
      );
    }).pipe(Effect.scoped),
  );
});
