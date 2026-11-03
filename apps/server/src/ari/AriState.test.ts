import { EnvironmentId } from "@t3tools/contracts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as PlatformError from "effect/PlatformError";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as AriClient from "./AriClient.ts";
import * as AriState from "./AriState.ts";
import * as ProcessRunner from "../processRunner.ts";

const stateLayer = AriState.layer.pipe(
  Layer.provide(
    Layer.succeed(ServerEnvironment.ServerEnvironment, {
      getEnvironmentId: Effect.succeed(EnvironmentId.make("environment-a")),
      getDescriptor: Effect.never,
    }),
  ),
);

it.effect("maps CLI failures without exposing stdout", () =>
  Effect.forEach(
    [
      { code: 2, expected: "signedOut" },
      { code: 3, expected: "forbidden" },
      { code: 4, expected: "unreachable" },
      { code: 1, expected: "unsupported" },
    ],
    ({ code, expected }) =>
      Effect.gen(function* () {
        const service = yield* AriState.AriState;
        const snapshot = yield* service.subscribe.pipe(Stream.runHead);
        expect(snapshot).toMatchObject({
          value: { version: "0.36.1", relay: { state: expected, senders: [] } },
        });
        expect(JSON.stringify(snapshot)).not.toContain("private prompt");
      }).pipe(
        Effect.provide(
          stateLayer.pipe(
            Layer.provide(AriClient.layer.pipe(Layer.provide(NodeServices.layer))),
            Layer.provide(
              Layer.succeed(ProcessRunner.ProcessRunner, {
                run: ({ args }) =>
                  Effect.succeed({
                    code: ChildProcessSpawner.ExitCode(args[0] === "--version" ? 0 : code),
                    stdout: args[0] === "--version" ? "ari 0.36.1" : '{"prompt":"private prompt"}',
                    stderr: "",
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
      ),
  ),
);

it.effect("makes no idle calls, caches reconnects and stops refreshing after unsubscribe", () =>
  Effect.gen(function* () {
    let calls = 0;
    const client = AriClient.AriClient.of({
      run: () =>
        Effect.sync(() => {
          calls++;
        }).pipe(
          Effect.andThen(
            Effect.fail(new AriClient.AriReadError({ state: "unavailable", cause: null })),
          ),
        ),
    });
    yield* Effect.gen(function* () {
      const service = yield* AriState.AriState;
      yield* TestClock.adjust("60 seconds");
      expect(calls).toBe(0);
      yield* service.subscribe.pipe(Stream.runHead);
      expect(calls).toBe(1);
      yield* service.subscribe.pipe(Stream.runHead);
      expect(calls).toBe(1);
      yield* TestClock.adjust("60 seconds");
      expect(calls).toBe(1);
      yield* service.subscribe.pipe(Stream.runHead);
      expect(calls).toBe(2);
    }).pipe(Effect.provide(stateLayer), Effect.provideService(AriClient.AriClient, client));
  }),
);

it.effect("reports unavailable when neither PATH nor the home fallback contains ari", () =>
  Effect.gen(function* () {
    const client = yield* AriClient.AriClient;
    const error = yield* client.run(["whoami"]).pipe(Effect.flip);
    expect(error.state).toBe("unavailable");
  }).pipe(
    Effect.provide(AriClient.layer.pipe(Layer.provide(NodeServices.layer))),
    Effect.provideService(ProcessRunner.ProcessRunner, {
      run: () =>
        Effect.fail(
          new ProcessRunner.ProcessSpawnError({
            command: "ari",
            argumentCount: 2,
            cause: PlatformError.systemError({
              _tag: "NotFound",
              module: "ChildProcess",
              method: "spawn",
            }),
          }),
        ),
    }),
  ),
);

it.effect("reads only status and held senders and keeps credentials and prompts off the wire", () =>
  Effect.gen(function* () {
    const service = yield* AriState.AriState;
    const snapshot = yield* service.subscribe.pipe(Stream.runHead);
    expect(snapshot).toMatchObject({
      value: {
        version: "0.36.1",
        account: "Host owner",
        relay: { state: "ok", held: 3, boundHeld: 1, senders: ["Teammate"] },
      },
    });
    expect(JSON.stringify(snapshot)).not.toMatch(/private prompt|secret-token/);
  }).pipe(
    Effect.provide(stateLayer),
    Effect.provideService(AriClient.AriClient, {
      run: (args) =>
        Effect.succeed(
          args[0] === "--version"
            ? "ari 0.36.1"
            : args[0] === "whoami"
              ? '{"account":{"name":"Host owner"},"token":"secret-token"}'
              : args[1] === "status"
                ? '{"service":{"installed":true,"running":true},"listeningAt":"2026-11-03T12:00:00Z","held":1,"problems":[],"log":["private prompt"]}'
                : '{"messages":[{"from":{"name":"Teammate"},"to":{"machine":"environment-a"},"prompt":"private prompt"},{"from":{"name":"Teammate"},"to":{"machine":"environment-b"}},{"from":{"name":"Teammate"},"to":{"machine":null}}]}',
        ),
    }),
  ),
);
