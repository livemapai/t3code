import * as NodeOS from "node:os";
import * as Path from "effect/Path";
import type { AriGroupState } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as ProcessRunner from "../processRunner.ts";

export class AriReadError extends Schema.TaggedError<AriReadError>()("AriReadError", {
  state: Schema.Literals(["unavailable", "signedOut", "forbidden", "unreachable", "unsupported"]),
  cause: Schema.Defect(),
}) {}

export class AriClient extends Context.Service<
  AriClient,
  {
    readonly run: (args: ReadonlyArray<string>) => Effect.Effect<string, AriReadError>;
  }
>()("t3/ari/AriClient") {}

const decodeJson = Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown));

const make = Effect.gen(function* () {
  const runner = yield* ProcessRunner.ProcessRunner;
  const path = yield* Path.Path;
  const lock = yield* Semaphore.make(1);
  const missing = (error: ProcessRunner.ProcessSpawnError) =>
    error.cause instanceof PlatformError.PlatformError && error.cause.reason._tag === "NotFound";
  const run = Effect.fn("AriClient.run")(function* (args: ReadonlyArray<string>) {
    const invoke = (command: string) =>
      runner.run({
        command,
        args: [...args, "--json"],
        timeout: "10 seconds",
        maxOutputBytes: 1024 * 1024,
      });
    const result = yield* invoke("ari").pipe(
      Effect.catchTags({
        ProcessSpawnError: (error) =>
          missing(error)
            ? invoke(path.join(NodeOS.homedir(), ".local", "bin", "ari"))
            : Effect.fail(error),
      }),
      Effect.mapError(
        (cause) =>
          new AriReadError({
            state:
              cause._tag === "ProcessSpawnError" && missing(cause) ? "unavailable" : "unreachable",
            cause,
          }),
      ),
    );
    // Relay health failures retain a structured status envelope even with exit 1.
    if (result.code === 1 && args[0] === "relay" && args[1] === "status") {
      const status = yield* decodeJson(result.stdout).pipe(
        Effect.mapError((cause) => new AriReadError({ state: "unsupported", cause })),
      );
      if (
        typeof status === "object" &&
        status !== null &&
        "code" in status &&
        status.code === "relay_not_ready"
      )
        return result.stdout;
    }
    if (result.code !== 0) {
      const state: Exclude<AriGroupState, "ok"> =
        result.code === 2
          ? "signedOut"
          : result.code === 3
            ? "forbidden"
            : result.code === 4 || result.timedOut
              ? "unreachable"
              : "unsupported";
      return yield* new AriReadError({ state, cause: result });
    }
    return result.stdout;
  }, lock.withPermit);
  return AriClient.of({ run });
});

export const layer = Layer.effect(AriClient, make);
