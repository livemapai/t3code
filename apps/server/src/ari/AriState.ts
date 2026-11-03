import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as NodeOS from "node:os";
import type { AriState as Snapshot } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as AriClient from "./AriClient.ts";

const Status = Schema.Struct({
  service: Schema.NullOr(Schema.Struct({ installed: Schema.Boolean, running: Schema.Boolean })),
  t3: Schema.optional(Schema.Struct({ expiresAt: Schema.optional(Schema.NullOr(Schema.String)) })),
  listeningAt: Schema.NullOr(Schema.String),
  held: Schema.NullOr(Schema.Number),
  problems: Schema.Array(Schema.String),
});
const Account = Schema.Struct({ account: Schema.Struct({ name: Schema.String }) });
const Inbox = Schema.Struct({
  messages: Schema.Array(
    Schema.Struct({
      from: Schema.Struct({ name: Schema.String }),
      to: Schema.Struct({ machine: Schema.NullOr(Schema.String) }),
    }),
  ),
});
const decode = <S extends Schema.Top & { readonly DecodingServices: never }>(
  schema: S,
  text: string,
) =>
  Schema.decodeEffect(Schema.fromJsonString(schema))(text).pipe(
    Effect.mapError((cause) => new AriClient.AriReadError({ state: "unsupported", cause })),
  );

export class AriState extends Context.Service<
  AriState,
  {
    readonly subscribe: Stream.Stream<Snapshot>;
  }
>()("t3/ari/AriState") {}

const make = Effect.gen(function* () {
  const client = yield* AriClient.AriClient;
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const environmentId = yield* environment.getEnvironmentId;
  let cached: Snapshot | undefined;
  let refreshedAt = -Infinity;
  const refresh = Effect.fn("AriState.refresh")(function* () {
    const now = yield* Clock.currentTimeMillis;
    if (cached && now - refreshedAt < 30_000) return cached;
    const previous = cached;
    let version = previous?.version ?? null;
    let accountName = previous?.account ?? null;
    const result = yield* Effect.gen(function* () {
      version = (yield* client.run(["--version"])).trim();
      const semver = /\b(\d+)\.(\d+)\.(\d+)\b/.exec(version);
      if (
        !semver ||
        (Number(semver[1]) === 0 &&
          (Number(semver[2]) < 36 || (Number(semver[2]) === 36 && Number(semver[3]) < 1)))
      ) {
        return yield* new AriClient.AriReadError({ state: "unsupported", cause: version });
      }
      version = semver[0];
      const account = yield* client
        .run(["whoami"])
        .pipe(Effect.flatMap((text) => decode(Account, text)));
      accountName = account.account.name;
      const status = yield* client
        .run(["relay", "status"])
        .pipe(Effect.flatMap((text) => decode(Status, text)));
      const inbox = yield* client
        .run(["relay", "inbox", "--held"])
        .pipe(Effect.flatMap((text) => decode(Inbox, text)));
      const broken =
        status.problems.length > 0 ||
        !status.listeningAt ||
        now - Date.parse(status.listeningAt) > 30_000;
      return {
        host: NodeOS.hostname(),
        version,
        account: account.account.name,
        relay: {
          state: "ok",
          stale: false,
          serviceInstalled: status.service?.installed ?? false,
          serviceRunning: status.service?.running ?? false,
          listeningAt: status.listeningAt,
          t3ExpiresAt: status.t3?.expiresAt ?? null,
          held: inbox.messages.length,
          boundHeld: inbox.messages.filter((message) => message.to.machine === environmentId)
            .length,
          senders: [...new Set(inbox.messages.map((message) => message.from.name))],
          broken,
          fixCommand:
            !status.t3?.expiresAt || Date.parse(status.t3.expiresAt) <= now
              ? "ari relay connect"
              : broken
                ? "ari relay install"
                : null,
        },
      } satisfies Snapshot;
    }).pipe(
      Effect.catchTags({
        AriReadError: (error) =>
          Effect.succeed<Snapshot>({
            host: NodeOS.hostname(),
            version,
            account: error.state === "signedOut" ? null : accountName,
            relay: {
              ...(error.state === "unreachable" && previous
                ? previous.relay
                : {
                    serviceInstalled: false,
                    serviceRunning: false,
                    listeningAt: null,
                    t3ExpiresAt: null,
                    held: 0,
                    boundHeld: 0,
                    senders: [],
                    broken: false,
                  }),
              state: error.state,
              stale: error.state === "unreachable",
              fixCommand:
                error.state === "signedOut"
                  ? "ari login"
                  : error.state === "unsupported"
                    ? "ari update"
                    : error.state === "unavailable"
                      ? null
                      : "ari relay status",
            },
          }),
      }),
    );
    cached = result;
    refreshedAt = now;
    return result;
  });
  const subscribe = yield* Stream.fromEffectSchedule(refresh(), Schedule.spaced("30 seconds")).pipe(
    Stream.share({ capacity: 1, replay: 1 }),
  );
  return AriState.of({ subscribe });
});
export const layer = Layer.effect(AriState, make);
