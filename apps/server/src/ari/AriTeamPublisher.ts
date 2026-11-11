import {
  ARI_TEAM_THREAD_TAG,
  AriTeamThread,
  isListedThreadLineage,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ThreadShell,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import type * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ServerConfig from "../config.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ServerSettings from "../serverSettings.ts";
import { forkParked } from "../serverActivation.ts";
import * as AriClient from "./AriClient.ts";

export const ARI_TEAM_PUBLISH_LIMIT = 50;
/** The team API drops entries 15 minutes after their last publish. */
const ARI_TEAM_REPUBLISH_INTERVAL = Duration.minutes(5);
const RETRY_SECONDS = [15, 30, 60];

export interface AriTeamPublisherSource<E> {
  readonly events: Stream.Stream<OrchestrationV2DomainEvent, E>;
  /** Whether Team threads is on for this machine: the current value, then each change. */
  readonly enabled: Stream.Stream<boolean>;
  /** Active threads; every one of them when `threadIds` is absent. */
  readonly readThreads: (
    threadIds?: ReadonlyArray<ThreadId>,
  ) => Effect.Effect<ReadonlyArray<OrchestrationV2ThreadShell>, E>;
  readonly readProjectTitles: (
    projectIds: ReadonlyArray<ProjectId>,
  ) => Effect.Effect<ReadonlyMap<ProjectId, string>, E>;
}

// `published` counts what the API holds for this machine; a stale publish it ignored reads as
// the stored count, not the one sent.
const decodePublishAnswer = Schema.decodeOption(
  Schema.fromJsonString(Schema.Struct({ published: Schema.Number })),
);
type PublishFailure = AriClient.AriReadError["state"] | "read" | "ignored" | "unexpected";

const encodePublishBody = Schema.encodeEffect(
  Schema.fromJsonString(Schema.Struct({ threads: Schema.Array(AriTeamThread) })),
);

// What a listed thread shows, plus the events that remove it; the rest can't change a listing.
const LISTED_FIELD_EVENTS: ReadonlySet<OrchestrationV2DomainEvent["type"]> = new Set([
  "thread.archived",
  "thread.deleted",
  "thread.tags-updated",
  "thread.metadata-updated",
  "thread.pull-request-link-updated",
  "thread.pull-request-synced",
  "run.created",
  "run.updated",
  "runtime-request.updated",
]);

const RUN_IN_PROGRESS: ReadonlySet<OrchestrationV2ThreadShell["status"]> = new Set([
  "queued",
  "preparing",
  "starting",
  "running",
  "waiting",
]);

const isTeamListed = (thread: OrchestrationV2ThreadShell) =>
  thread.tags?.includes(ARI_TEAM_THREAD_TAG) === true &&
  thread.archivedAt === null &&
  thread.deletedAt === null &&
  isListedThreadLineage(thread.lineage);

// The relay API's limits: past one, it refuses this machine's whole list.
const TITLE_MAX = 200;
const PROJECT_MAX = 200;
const BRANCH_MAX = 250;
const PULL_REQUEST_URL_MAX = 500;
const THREAD_ID = /^[A-Za-z0-9._:-]{1,200}$/;

const shorten = (text: string, max: number) => {
  if (text.length <= max) return text;
  // By code point, so no surrogate pair is cut in half.
  let kept = "";
  for (const char of text) {
    if (kept.length + char.length > max - 1) break;
    kept += char;
  }
  return `${kept}…`;
};
/** A thread title as the relay API takes it, here and in an invite. */
export const ariThreadTitle = (title: string) => shorten(title, TITLE_MAX);
const fitsOrNull = (text: string | null, max: number) =>
  text === null || text.trim() === "" || text.length > max ? null : text;

/** A plain http(s) link without a sign-in, query or fragment, which is all a pull request needs. */
function plainPullRequestUrl(input: string | null): string | null {
  if (input === null || /\p{Cc}/u.test(input)) return null;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
    return null;
  }
  const plain = `${url.origin}${url.pathname}`;
  return plain.length > PULL_REQUEST_URL_MAX ? null : plain;
}

/** What is published about a thread, fitted to the API's limits; null for an id it would refuse. */
export function ariTeamThreadEntry(
  thread: OrchestrationV2ThreadShell,
  project: string | null,
): AriTeamThread | null {
  if (!THREAD_ID.test(thread.id)) return null;
  return {
    threadId: thread.id,
    title: ariThreadTitle(thread.title),
    project: fitsOrNull(project, PROJECT_MAX),
    branch: fitsOrNull(thread.branch, BRANCH_MAX),
    pullRequestUrl: plainPullRequestUrl(
      thread.linkedPullRequest?.url ?? thread.branchPullRequest?.url ?? null,
    ),
    state: ariTeamThreadState(thread),
    updatedAt: DateTime.formatIso(thread.updatedAt),
  };
}

/** Approvals, questions and errors read as idle: the team sees only whether the agent works. */
export function ariTeamThreadState(
  thread: Pick<OrchestrationV2ThreadShell, "status" | "pendingRuntimeRequest">,
): AriTeamThread["state"] {
  return RUN_IN_PROGRESS.has(thread.status) && thread.pendingRuntimeRequest === null
    ? "working"
    : "idle";
}

export const makeAriTeamPublisher = Effect.fn("AriTeamPublisher.make")(function* <E>(
  source: AriTeamPublisherSource<E>,
  // `ari` names this machine by `$T3CODE_HOME/userdata/environment-id`, so pass this server's home.
  home?: string,
) {
  const client = yield* AriClient.AriClient;
  // Null until the setting is read; nothing publishes before that.
  let enabled: boolean | null = null;
  // Only the worker writes membership; events add candidates it merges in on its next pass.
  let teamThreadIds = new Set<ThreadId>();
  const candidates = new Set<ThreadId>();
  let scanAll = true;
  let listedCount = 0;
  let published: string | null = null;
  let acknowledged = false;
  let failures = 0;
  let failure: PublishFailure | null = null;
  let queued = false;
  let forceNext = false;
  // Signalled after each publish attempt, so the timer restarts from it.
  const attempted = yield* Queue.sliding<void>(1);

  const noteFailure = (state: PublishFailure) =>
    Effect.suspend(() => {
      acknowledged = false;
      failures += 1;
      const changed = failure !== state;
      failure = state;
      return changed ? Effect.logInfo("ari team threads publish failed", { state }) : Effect.void;
    });

  const publish = Effect.fn("AriTeamPublisher.publish")(function* (force: boolean) {
    let shown: ReadonlyArray<AriTeamThread> = [];
    if (enabled) {
      const ids = [...teamThreadIds, ...candidates];
      candidates.clear();
      const threads = yield* source.readThreads(scanAll ? undefined : ids);
      scanAll = false;
      const listed = threads
        .filter(isTeamListed)
        .toSorted(
          (a, b) => DateTime.toEpochMillis(b.updatedAt) - DateTime.toEpochMillis(a.updatedAt),
        );
      teamThreadIds = new Set(listed.map((thread) => thread.id));
      const titles = yield* source.readProjectTitles([
        ...new Set(listed.slice(0, ARI_TEAM_PUBLISH_LIMIT).map((thread) => thread.projectId)),
      ]);
      shown = listed
        .flatMap((thread) => {
          const entry = ariTeamThreadEntry(thread, titles.get(thread.projectId) ?? null);
          return entry === null ? [] : [entry];
        })
        .slice(0, ARI_TEAM_PUBLISH_LIMIT);
    }
    const listNothing = () => {
      // Off lists nothing; turning it back on reads every thread again.
      shown = [];
      candidates.clear();
      teamThreadIds = new Set();
      scanAll = true;
    };
    if (!enabled) listNothing();
    let body = yield* encodePublishBody({ threads: shown });
    // The switch can go off while the threads are read; checked again right before sending.
    if (!enabled && shown.length > 0) {
      listNothing();
      body = yield* encodePublishBody({ threads: shown });
    }
    listedCount = shown.length;
    if (!force && acknowledged && body === published) return;
    yield* client
      .run(["relay", "team", "publish", "-"], {
        stdin: body,
        ...(home === undefined ? {} : { env: { T3CODE_HOME: home } }),
      })
      .pipe(
        Effect.flatMap((answer) =>
          Effect.suspend(() => {
            const held = decodePublishAnswer(answer);
            if (Option.isNone(held)) return noteFailure("unexpected");
            if (held.value.published !== shown.length) return noteFailure("ignored");
            published = body;
            acknowledged = true;
            failures = 0;
            const recovered = failure !== null;
            failure = null;
            return recovered ? Effect.logInfo("ari team threads publish recovered") : Effect.void;
          }),
        ),
        Effect.catchTags({ AriReadError: (error) => noteFailure(error.state) }),
        Effect.ensuring(Queue.offer(attempted, undefined)),
      );
  });

  const worker = yield* makeDrainableWorker((_: void) =>
    Effect.suspend(() => {
      queued = false;
      const force = forceNext;
      forceNext = false;
      return publish(force);
    }).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.void
          : Effect.logWarning("ari team threads could not be read", { cause }).pipe(
              Effect.andThen(noteFailure("read")),
              Effect.andThen(Queue.offer(attempted, undefined)),
            ),
      ),
    ),
  );
  // Events that arrive while a publish waits collapse into it: it reads the state as it is then.
  const request = (force: boolean) =>
    Effect.suspend(() => {
      if (enabled === null) return Effect.void;
      if (force) forceNext = true;
      if (queued) return Effect.void;
      queued = true;
      return worker.enqueue(undefined).pipe(Effect.asVoid);
    }).pipe(Effect.uninterruptible);

  const onEvent = (event: OrchestrationV2DomainEvent) => {
    if (!enabled) return Effect.void;
    if (teamThreadIds.has(event.threadId) || candidates.has(event.threadId)) {
      return LISTED_FIELD_EVENTS.has(event.type) ? request(false) : Effect.void;
    }
    if ("tags" in event.payload && event.payload.tags?.includes(ARI_TEAM_THREAD_TAG)) {
      candidates.add(event.threadId);
      return request(false);
    }
    return Effect.void;
  };

  // Removal is the private direction, so an unacknowledged list is retried well before the
  // API's 15-minute expiry. Only an acknowledged empty list lets the timer stop.
  const nextAttempt = () =>
    !acknowledged
      ? Duration.seconds(RETRY_SECONDS[Math.min(failures, RETRY_SECONDS.length) - 1] ?? 15)
      : listedCount > 0
        ? ARI_TEAM_REPUBLISH_INTERVAL
        : null;
  const schedule = Effect.suspend(() => {
    const delay = nextAttempt();
    return delay === null
      ? Queue.take(attempted)
      : Queue.take(attempted).pipe(
          Effect.timeoutOption(delay),
          Effect.flatMap((woke) => (Option.isSome(woke) ? Effect.void : request(true))),
        );
  });

  const start = Effect.fn("AriTeamPublisher.start")(function* (): Effect.fn.Return<
    void,
    never,
    Scope.Scope
  > {
    yield* forkParked(Stream.runForEach(source.events, onEvent));
    // The first value publishes once, which replaces whatever this machine listed before a
    // restart; each change after it publishes at once, so turning it off takes the list down.
    yield* forkParked(
      Stream.runForEach(Stream.changes(source.enabled), (value) =>
        Effect.suspend(() => {
          enabled = value;
          return request(true);
        }),
      ),
    );
    yield* forkParked(Effect.forever(schedule));
  });

  return { start, drain: worker.drain };
});

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    // A dev server shares the checkout's data copy; let only real installs list threads.
    if (config.devUrl !== undefined) return;
    const threads = yield* ThreadManagement.ThreadManagementService;
    const projects = yield* ProjectService.ProjectService;
    const settings = yield* ServerSettings.ServerSettingsService;
    const source: AriTeamPublisherSource<
      Orchestrator.OrchestratorV2Error | ProjectService.ProjectOperationError
    > = {
      events: threads.streamDomainEvents,
      // Subscribed before the read, so a change in between is not lost. An unreadable setting
      // reads as off, the private direction.
      enabled: Stream.unwrap(
        Effect.gen(function* () {
          const changes = yield* settings.subscribeChanges;
          const current = yield* settings.getSettings.pipe(
            Effect.map((value) => value.ariTeamThreadsEnabled),
            Effect.orElseSucceed(() => false),
          );
          return Stream.concat(
            Stream.make(current),
            changes.pipe(Stream.map((value) => value.ariTeamThreadsEnabled)),
          );
        }),
      ),
      readThreads: (threadIds) =>
        threadIds?.length === 0
          ? Effect.succeed([])
          : threads
              .getShellSnapshot({
                location: "active",
                ...(threadIds === undefined ? {} : { threadIds }),
              })
              .pipe(Effect.map((snapshot) => snapshot.threads)),
      readProjectTitles: (projectIds) =>
        projectIds.length === 0
          ? Effect.succeed(new Map())
          : projects
              .listShells({ projectIds })
              .pipe(
                Effect.map(
                  (shells) => new Map(shells.map((project) => [project.id, project.title])),
                ),
              ),
    };
    const publisher = yield* makeAriTeamPublisher(source, config.baseDir);
    yield* publisher.start();
  }),
);
