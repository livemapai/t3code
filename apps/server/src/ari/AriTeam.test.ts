import type { AriTeamThread } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as AriClient from "./AriClient.ts";
import * as AriTeam from "./AriTeam.ts";
import * as ProcessRunner from "../processRunner.ts";

const thread: AriTeamThread = {
  threadId: "t1",
  title: "Fix the map tiles",
  project: "frontend",
  branch: null,
  pullRequestUrl: null,
  state: "working",
  updatedAt: "2026-11-11T09:00:00.000Z",
};

it("drops a malformed person or thread alone", () => {
  const people = AriTeam.decodeAriTeamPeople(
    JSON.stringify({
      people: [
        {
          name: "Claudio Example",
          handle: "claudio",
          self: false,
          threads: [thread, { ...thread, threadId: "t2", state: "waiting" }, null],
          email: "ignored@example.com",
        },
        { name: "No handle", self: false, threads: [thread] },
        "garbage",
      ],
    }),
  );
  assert.deepEqual(people, [
    { name: "Claudio Example", handle: "claudio", self: false, threads: [thread] },
  ]);
  assert.isNull(AriTeam.decodeAriTeamPeople('{"teams":[]}'));
});

it.effect.each([
  { code: 0, stdout: JSON.stringify({ people: [] }), expected: "ok" },
  { code: 2, stdout: "", expected: "signedOut" },
  { code: 4, stdout: "", expected: "unreachable" },
  // An ari from before `relay team` rejects the subcommand as a usage error.
  { code: 64, stdout: "error: unrecognized subcommand 'team'", expected: "unsupported" },
  { code: 0, stdout: "not json", expected: "unsupported" },
] as const)("reads exit $code as $expected", ({ code, stdout, expected }) =>
  Effect.gen(function* () {
    const team = yield* AriTeam.AriTeam;
    assert.deepEqual(yield* team.read, { state: expected, people: [] });
  }).pipe(
    Effect.provide(
      AriTeam.layer.pipe(
        Layer.provide(AriClient.layer.pipe(Layer.provide(NodeServices.layer))),
        Layer.provide(
          Layer.succeed(ProcessRunner.ProcessRunner, {
            run: ({ args }) =>
              Effect.succeed({
                code: ChildProcessSpawner.ExitCode(
                  args.join(" ") === "relay team --json" ? code : 1,
                ),
                stdout,
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
);
