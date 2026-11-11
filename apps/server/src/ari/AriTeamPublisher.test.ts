import { assert, describe, it } from "@effect/vitest";
import {
  EventId,
  MessageId,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ThreadShell,
  ProjectId,
  ProviderInstanceId,
  RunId,
  RuntimeRequestId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as AriClient from "./AriClient.ts";
import {
  ARI_TEAM_PUBLISH_LIMIT,
  ariTeamThreadState,
  makeAriTeamPublisher,
} from "./AriTeamPublisher.ts";

const PROJECT_ID = ProjectId.make("team-project");
const THREAD_ID = ThreadId.make("team-thread");
const NOW = "2026-11-11T09:00:00.000Z";

function shell(overrides: Partial<OrchestrationV2ThreadShell> = {}): OrchestrationV2ThreadShell {
  const id = overrides.id ?? THREAD_ID;
  return {
    id,
    projectId: PROJECT_ID,
    title: "Fix the map tiles",
    providerInstanceId: ProviderInstanceId.make("codex"),
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test-model" },
    runtimeMode: "full-access",
    interactionMode: "default",
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: { rootThreadId: id, parentThreadId: null, relationshipToParent: null },
    forkedFrom: null,
    createdBy: "user",
    creationSource: "web",
    activeRunId: null,
    latestVisibleMessage: null,
    hasActionableProposedPlan: false,
    itemCount: 0,
    visibleItemCount: 0,
    lastVisitedAt: null,
    deletedAt: null,
    branch: "feat/tiles",
    linkedPullRequest: null,
    status: "idle",
    activityRunStatus: null,
    pendingRuntimeRequest: null,
    pendingBackgroundTasks: [],
    latestRunId: null,
    latestUserMessageAt: null,
    createdAt: DateTime.makeUnsafe(NOW),
    updatedAt: DateTime.makeUnsafe(NOW),
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    tags: [],
    ...overrides,
  };
}

interface Published {
  readonly args: ReadonlyArray<string>;
  readonly threads: ReadonlyArray<Record<string, unknown>>;
}

const makeHarness = Effect.fnUntraced(function* (
  options: {
    readonly fail?: (call: number) => AriClient.AriReadError["state"] | null;
    readonly initial?: ReadonlyArray<OrchestrationV2ThreadShell>;
    /** What `ari` prints; by default it holds exactly what was sent. */
    readonly answer?: (call: number, sent: number) => string;
  } = {},
) {
  const threads = new Map(options.initial?.map((thread) => [thread.id, thread] as const));
  const events = yield* Queue.unbounded<OrchestrationV2DomainEvent>();
  const pulls = yield* Queue.unbounded<void>();
  const reads = yield* Queue.unbounded<void>();
  let gate: Deferred.Deferred<void> | null = null;
  const published: Array<Published> = [];
  let calls = 0;
  let projectTitle = "frontend";
  const homes: Array<string | undefined> = [];
  const publisher = yield* makeAriTeamPublisher(
    {
      events: Stream.fromEffectRepeat(
        Queue.offer(pulls, undefined).pipe(Effect.andThen(Queue.take(events))),
      ),
      readThreads: (threadIds) =>
        Queue.offer(reads, undefined).pipe(
          Effect.andThen(
            Effect.suspend(() => (gate === null ? Effect.void : Deferred.await(gate))),
          ),
          Effect.map(() =>
            [...threads.values()].filter(
              (thread) =>
                thread.archivedAt === null &&
                thread.deletedAt === null &&
                (threadIds === undefined || threadIds.includes(thread.id)),
            ),
          ),
        ),
      readProjectTitles: (projectIds) =>
        Effect.sync(() => new Map(projectIds.map((id) => [id, projectTitle] as const))),
    },
    "/srv/t3-home",
  ).pipe(
    Effect.provideService(AriClient.AriClient, {
      run: (args, runOptions) =>
        Effect.suspend(() => {
          calls += 1;
          const failure = options.fail?.(calls) ?? null;
          if (failure !== null) {
            return Effect.fail(new AriClient.AriReadError({ state: failure, cause: null }));
          }
          homes.push(runOptions?.env?.T3CODE_HOME);
          const body = JSON.parse(runOptions?.stdin ?? "{}") as { threads: Published["threads"] };
          published.push({ args, threads: body.threads });
          return Effect.succeed(
            options.answer?.(calls, body.threads.length) ??
              JSON.stringify({ published: body.threads.length }),
          );
        }),
    }),
  );
  yield* publisher.start();
  yield* Queue.take(pulls);
  yield* publisher.drain;

  const put = (thread: OrchestrationV2ThreadShell) =>
    Effect.sync(() => threads.set(thread.id, thread));
  const deliver = Effect.fnUntraced(function* (
    type: "thread.tags-updated" | "thread.archived" | "thread.deleted" | "thread.metadata-updated",
    thread: OrchestrationV2ThreadShell,
  ) {
    yield* put(thread);
    yield* Queue.offer(events, {
      id: EventId.make(`event:${type}:${published.length}`),
      type,
      threadId: thread.id,
      occurredAt: DateTime.makeUnsafe(NOW),
      payload: { ...thread, lastVisitedAt: thread.lastVisitedAt ?? null },
    });
    yield* Queue.take(pulls);
  });
  const deliverRun = Effect.fnUntraced(function* (thread: OrchestrationV2ThreadShell) {
    yield* put(thread);
    const now = DateTime.makeUnsafe(NOW);
    yield* Queue.offer(events, {
      id: EventId.make(`event:run:${published.length}`),
      type: "run.updated",
      threadId: thread.id,
      occurredAt: now,
      payload: {
        id: RunId.make("run:team"),
        threadId: thread.id,
        ordinal: 1,
        providerInstanceId: ProviderInstanceId.make("codex"),
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test-model" },
        providerThreadId: null,
        userMessageId: MessageId.make("message:team"),
        rootNodeId: null,
        activeAttemptId: null,
        status: "running",
        requestedAt: now,
        startedAt: now,
        completedAt: null,
        checkpointId: null,
        contextHandoffId: null,
      },
    });
    yield* Queue.take(pulls);
  });
  const holdReads = Effect.fnUntraced(function* () {
    const held = yield* Deferred.make<void>();
    gate = held;
    return Effect.sync(() => {
      gate = null;
    }).pipe(Effect.andThen(Deferred.succeed(held, undefined)));
  });
  const renameProject = (title: string) =>
    Effect.sync(() => {
      projectTitle = title;
    });
  return {
    publisher,
    published,
    deliver,
    deliverRun,
    put,
    reads,
    holdReads,
    renameProject,
    attempts: () => calls,
    homes,
  };
});

const listed = shell({ tags: ["team"] });

describe("AriTeamPublisher", () => {
  it.effect("publishes the empty list once at start and stays quiet while nothing is listed", () =>
    Effect.gen(function* () {
      const { publisher, published, deliver, homes } = yield* makeHarness();
      assert.deepEqual(published, [{ args: ["relay", "team", "publish", "-"], threads: [] }]);
      // `ari` names the machine from this server's home, not the installed app's.
      assert.deepEqual(homes, ["/srv/t3-home"]);
      yield* deliver("thread.metadata-updated", shell({ title: "Private work" }));
      yield* TestClock.adjust("20 minutes");
      yield* publisher.drain;
      assert.equal(published.length, 1);
    }).pipe(Effect.scoped),
  );

  it.effect("lists only tagged threads, newest first, with the listed fields alone", () =>
    Effect.gen(function* () {
      const { publisher, published, deliver } = yield* makeHarness({
        initial: [shell({ id: ThreadId.make("private"), title: "Not shared" })],
      });
      yield* deliver(
        "thread.tags-updated",
        shell({
          tags: ["team", "flag:urgent"],
          status: "running",
          linkedPullRequest: {
            projectId: PROJECT_ID,
            repository: "livemap/frontend",
            number: 7,
            url: "https://github.com/livemap/frontend/pull/7",
          },
          latestVisibleMessage: {
            id: MessageId.make("message:secret"),
            role: "assistant",
            text: "private message",
            updatedAt: DateTime.makeUnsafe(NOW),
          },
        }),
      );
      yield* publisher.drain;
      assert.deepEqual(published[1]?.threads, [
        {
          threadId: THREAD_ID,
          title: "Fix the map tiles",
          project: "frontend",
          branch: "feat/tiles",
          pullRequestUrl: "https://github.com/livemap/frontend/pull/7",
          state: "working",
          updatedAt: NOW,
        },
      ]);
      assert.notInclude(JSON.stringify(published), "private message");
      assert.notInclude(JSON.stringify(published), "Not shared");
    }).pipe(Effect.scoped),
  );

  it.effect("finds tagged threads at start and caps the list at the newest 50", () =>
    Effect.gen(function* () {
      const threads = Array.from({ length: ARI_TEAM_PUBLISH_LIMIT + 1 }, (_, index) =>
        shell({
          id: ThreadId.make(`thread-${index}`),
          tags: ["team"],
          updatedAt: DateTime.makeUnsafe(Date.parse(NOW) + index * 1000),
        }),
      );
      const { published } = yield* makeHarness({
        initial: [...threads, shell({ id: ThreadId.make("private") })],
      });
      assert.equal(published.length, 1);
      const ids = published[0]?.threads.map((thread) => thread.threadId);
      assert.equal(ids?.length, ARI_TEAM_PUBLISH_LIMIT);
      assert.equal(ids?.[0], `thread-${ARI_TEAM_PUBLISH_LIMIT}`);
      assert.notInclude(ids ?? [], "thread-0");
    }).pipe(Effect.scoped),
  );

  it.effect.each([
    ["the tag is removed", "thread.tags-updated", { tags: [] }],
    ["the thread is archived", "thread.archived", { archivedAt: DateTime.makeUnsafe(NOW) }],
    ["the thread is deleted", "thread.deleted", { deletedAt: DateTime.makeUnsafe(NOW) }],
  ] as const)("unlists at once when %s", ([, type, change]) =>
    Effect.gen(function* () {
      const { publisher, published, deliver } = yield* makeHarness();
      yield* deliver("thread.tags-updated", listed);
      yield* publisher.drain;
      assert.equal(published.at(-1)?.threads.length, 1);
      yield* deliver(type, { ...listed, ...change });
      yield* publisher.drain;
      assert.deepEqual(published.at(-1)?.threads, []);
      assert.equal(published.length, 3);
    }).pipe(Effect.scoped),
  );

  it.effect("follows runs between working and idle, and an approval reads as idle", () =>
    Effect.gen(function* () {
      const { publisher, published, deliver, deliverRun } = yield* makeHarness();
      yield* deliver("thread.tags-updated", listed);
      yield* deliverRun({ ...listed, status: "running" });
      yield* publisher.drain;
      assert.equal(published.at(-1)?.threads[0]?.state, "working");
      yield* deliverRun({
        ...listed,
        status: "waiting",
        pendingRuntimeRequest: {
          id: RuntimeRequestId.make("request:approval"),
          kind: "command",
          createdAt: DateTime.makeUnsafe(NOW),
        },
      });
      yield* publisher.drain;
      assert.equal(published.at(-1)?.threads[0]?.state, "idle");
    }).pipe(Effect.scoped),
  );

  it.effect("collapses a burst of changes into one publish", () =>
    Effect.gen(function* () {
      const { publisher, published, deliver, deliverRun, reads, holdReads } = yield* makeHarness();
      yield* deliver("thread.tags-updated", listed);
      yield* publisher.drain;
      const release = yield* holdReads();
      yield* deliverRun({ ...listed, status: "running" });
      yield* Queue.take(reads);
      for (let index = 0; index < 10; index++) {
        yield* deliverRun({ ...listed, status: "running", title: `Step ${index}` });
      }
      yield* release;
      yield* publisher.drain;
      // Eleven run updates make one publish: the burst queues one more, which finds nothing new.
      assert.equal(published.length, 3);
      assert.equal(published.at(-1)?.threads[0]?.title, "Step 9");
    }).pipe(Effect.scoped),
  );

  it.effect("republishes every 5 minutes only while something is listed", () =>
    Effect.gen(function* () {
      const { publisher, published, deliver } = yield* makeHarness();
      yield* deliver("thread.tags-updated", listed);
      yield* publisher.drain;
      assert.equal(published.length, 2);
      yield* TestClock.adjust("5 minutes");
      yield* publisher.drain;
      assert.equal(published.length, 3);
      assert.deepEqual(published[2], published[1]);
      yield* deliver("thread.tags-updated", { ...listed, tags: [] });
      yield* publisher.drain;
      assert.equal(published.length, 4);
      yield* TestClock.adjust("20 minutes");
      yield* publisher.drain;
      assert.equal(published.length, 4);
    }).pipe(Effect.scoped),
  );

  it.effect("keeps a thread marked while another one's read is in flight", () =>
    Effect.gen(function* () {
      const { publisher, published, deliver, reads, holdReads } = yield* makeHarness();
      yield* deliver("thread.tags-updated", listed);
      yield* publisher.drain;
      const release = yield* holdReads();
      yield* deliver("thread.metadata-updated", { ...listed, title: "Renamed" });
      yield* Queue.take(reads);
      const second = shell({ id: ThreadId.make("second"), tags: ["team"] });
      yield* deliver("thread.tags-updated", second);
      yield* release;
      yield* publisher.drain;
      assert.sameMembers(published.at(-1)?.threads.map((thread) => thread.threadId) ?? [], [
        THREAD_ID,
        "second",
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("retries a failed removal after 15, 30 and 60 seconds, then goes quiet", () =>
    Effect.gen(function* () {
      const { publisher, published, deliver, attempts } = yield* makeHarness({
        fail: (call) => (call >= 3 && call <= 5 ? "unreachable" : null),
      });
      yield* deliver("thread.tags-updated", listed);
      yield* deliver("thread.tags-updated", { ...listed, tags: [] });
      yield* publisher.drain;
      assert.equal(attempts(), 3);
      for (const [wait, expected] of [
        ["14 seconds", 3],
        ["1 second", 4],
        ["30 seconds", 5],
        ["59 seconds", 5],
        ["1 second", 6],
      ] as const) {
        yield* TestClock.adjust(wait);
        yield* publisher.drain;
        assert.equal(attempts(), expected);
      }
      assert.deepEqual(published.at(-1)?.threads, []);
      yield* TestClock.adjust("30 minutes");
      yield* publisher.drain;
      assert.equal(attempts(), 6);
    }).pipe(Effect.scoped),
  );

  it.effect.each([
    ["ignores the stale removal", '{"published":1}'],
    ["answers something unexpected", '{"ok":true}'],
  ] as const)("retries a removal while ari %s", ([, stale]) =>
    Effect.gen(function* () {
      const { publisher, published, deliver, attempts } = yield* makeHarness({
        answer: (call, sent) =>
          call === 3 || call === 4 ? stale : JSON.stringify({ published: sent }),
      });
      yield* deliver("thread.tags-updated", listed);
      yield* deliver("thread.tags-updated", { ...listed, tags: [] });
      yield* publisher.drain;
      assert.equal(attempts(), 3);
      for (const [wait, expected] of [
        ["14 seconds", 3],
        ["1 second", 4],
        ["29 seconds", 4],
        ["1 second", 5],
        ["30 minutes", 5],
      ] as const) {
        yield* TestClock.adjust(wait);
        yield* publisher.drain;
        assert.equal(attempts(), expected);
      }
      assert.deepEqual(published.at(-1)?.threads, []);
    }).pipe(Effect.scoped),
  );

  it.effect("rereads the project name on the 5-minute republish", () =>
    Effect.gen(function* () {
      const { publisher, published, deliver, renameProject } = yield* makeHarness();
      yield* deliver("thread.tags-updated", listed);
      yield* publisher.drain;
      yield* renameProject("map-app");
      yield* TestClock.adjust("5 minutes");
      yield* publisher.drain;
      assert.equal(published.at(-1)?.threads[0]?.project, "map-app");
    }).pipe(Effect.scoped),
  );

  it.effect.each(["unreachable", "signedOut", "unavailable", "unsupported"] as const)(
    "keeps publishing after a %s ari fails",
    (state) =>
      Effect.gen(function* () {
        const { publisher, published, deliver } = yield* makeHarness({
          fail: (call) => (call === 2 || call === 4 ? state : null),
        });
        yield* deliver("thread.tags-updated", listed);
        yield* publisher.drain;
        assert.equal(published.length, 1);
        yield* TestClock.adjust("5 minutes");
        yield* publisher.drain;
        assert.equal(published.at(-1)?.threads.length, 1);
        yield* deliver("thread.metadata-updated", { ...listed, title: "Failed" });
        yield* publisher.drain;
        assert.equal(published.length, 2);
        yield* deliver("thread.metadata-updated", { ...listed, title: "Next" });
        yield* publisher.drain;
        assert.equal(published.at(-1)?.threads[0]?.title, "Next");
      }).pipe(Effect.scoped),
  );
});

describe("ariTeamThreadState", () => {
  it.each([
    ["idle", null, "idle"],
    ["queued", null, "working"],
    ["running", null, "working"],
    ["waiting", null, "working"],
    ["waiting", "question", "idle"],
    ["failed", null, "idle"],
    ["completed", null, "idle"],
  ] as const)("%s with request %s reads as %s", (status, request, expected) => {
    assert.equal(
      ariTeamThreadState({
        status,
        pendingRuntimeRequest:
          request === null
            ? null
            : {
                id: RuntimeRequestId.make("request"),
                kind: "user_input",
                createdAt: DateTime.makeUnsafe(NOW),
              },
      }),
      expected,
    );
  });
});
