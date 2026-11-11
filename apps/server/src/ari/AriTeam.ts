import { AriTeamThread, type AriTeam as Snapshot, type AriTeamPerson } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as AriClient from "./AriClient.ts";

const decodeEnvelope = Schema.decodeOption(
  Schema.fromJsonString(Schema.Struct({ people: Schema.Array(Schema.Unknown) })),
);
const Person = Schema.Struct({
  name: Schema.String,
  handle: Schema.String,
  self: Schema.Boolean,
  threads: Schema.Array(Schema.Unknown),
});
const decodePerson = Schema.decodeUnknownOption(Person);
const decodeThread = Schema.decodeUnknownOption(AriTeamThread);

/** A malformed person or thread drops alone, so one bad entry never hides the whole team. */
export function decodeAriTeamPeople(text: string): ReadonlyArray<AriTeamPerson> | null {
  const envelope = decodeEnvelope(text);
  if (Option.isNone(envelope)) return null;
  return envelope.value.people.flatMap((entry) =>
    Option.match(decodePerson(entry), {
      onNone: () => [],
      onSome: (person) => [
        {
          ...person,
          threads: person.threads.flatMap((thread) => Option.toArray(decodeThread(thread))),
        },
      ],
    }),
  );
}

export class AriTeam extends Context.Service<
  AriTeam,
  {
    readonly read: Effect.Effect<Snapshot>;
  }
>()("t3/ari/AriTeam") {}

const make = Effect.gen(function* () {
  const client = yield* AriClient.AriClient;
  let cached: { readonly at: number; readonly snapshot: Snapshot } | undefined;
  const read = Effect.fn("AriTeam.read")(function* () {
    const now = yield* Clock.currentTimeMillis;
    // Several clients refresh on focus; one `ari` process answers them all.
    if (cached && now - cached.at < 15_000) return cached.snapshot;
    const snapshot = yield* client.run(["relay", "team"]).pipe(
      Effect.map((text): Snapshot => {
        const people = decodeAriTeamPeople(text);
        return people === null ? { state: "unsupported", people: [] } : { state: "ok", people };
      }),
      Effect.catchTags({
        AriReadError: (error) => Effect.succeed<Snapshot>({ state: error.state, people: [] }),
      }),
    );
    cached = { at: now, snapshot };
    return snapshot;
  });
  return AriTeam.of({ read: read() });
});

export const layer = Layer.effect(AriTeam, make);
