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

it("drops a malformed person, thread or invite alone", () => {
  const invite = {
    id: "inv-1",
    from: { name: "Claudio Example", handle: "claudio" },
    title: "Fix the map tiles",
    url: "https://env.t3.test/guest#share.signature",
    expiresAt: "2026-11-12T09:00:00.000Z",
    createdAt: "2026-11-11T09:00:00.000Z",
  };
  const team = AriTeam.decodeAriTeam(
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
      invites: [invite, { ...invite, id: "inv-2", from: "claudio" }, { ...invite, url: null }, 7],
    }),
  );
  assert.deepEqual(team, {
    people: [{ name: "Claudio Example", handle: "claudio", self: false, threads: [thread] }],
    invites: [invite],
  });
  // An `ari` from before invites prints no `invites` key.
  assert.deepEqual(AriTeam.decodeAriTeam('{"people":[]}'), { people: [] });
  assert.isNull(AriTeam.decodeAriTeam('{"teams":[]}'));
});

it("lists people to invite without the viewer, their email, or a malformed entry", () => {
  const text = JSON.stringify({
    people: [
      { handle: "tomas", name: "Tomas", email: "tomas@example.com" },
      { handle: "anna", name: "Anna", email: "anna@example.com", listeningAt: "2026-11-11" },
      { name: "No handle" },
    ],
  });
  assert.deepEqual(AriTeam.decodeAriPeople(text, "tomas"), [{ handle: "anna", name: "Anna" }]);
  assert.isNull(AriTeam.decodeAriPeople("not json", null));
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

it.effect.each([
  // An `ari` that lists no invites cannot send them either, so the picker stays empty.
  { invites: undefined, expected: { state: "unsupported", people: [] }, runs: ["relay team"] },
  {
    invites: [],
    expected: { state: "ok", people: [{ handle: "anna", name: "Anna" }] },
    runs: ["relay team", "relay people"],
  },
] as const)(
  "lists people to invite only from an ari that has invites",
  ({ invites, expected, runs }) => {
    const calls: Array<string> = [];
    const output: Record<string, string> = {
      "relay team": JSON.stringify({
        people: [{ name: "Tomas", handle: "tomas", self: true, threads: [] }],
        ...(invites === undefined ? {} : { invites }),
      }),
      "relay people": JSON.stringify({
        people: [
          { handle: "tomas", name: "Tomas", email: "tomas@example.com" },
          { handle: "anna", name: "Anna", email: "anna@example.com" },
        ],
      }),
    };
    return Effect.gen(function* () {
      const team = yield* AriTeam.AriTeam;
      assert.deepEqual(yield* team.people, expected);
      assert.deepEqual(calls, [...runs]);
    }).pipe(
      Effect.provide(
        AriTeam.layer.pipe(
          Layer.provide(AriClient.layer.pipe(Layer.provide(NodeServices.layer))),
          Layer.provide(
            Layer.succeed(ProcessRunner.ProcessRunner, {
              run: ({ args }) =>
                Effect.sync(() => {
                  const command = args.slice(0, 2).join(" ");
                  calls.push(command);
                  return {
                    code: ChildProcessSpawner.ExitCode(0),
                    stdout: output[command] ?? "",
                    stderr: "",
                    timedOut: false,
                    stdoutTruncated: false,
                    stderrTruncated: false,
                    stdoutInvalidUtf8: false,
                    stderrInvalidUtf8: false,
                  };
                }),
            }),
          ),
        ),
      ),
    );
  },
);
