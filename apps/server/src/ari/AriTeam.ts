import {
  AriPerson,
  AriTeamInvite,
  AriTeamThread,
  type AriPeople,
  type AriTeam as Snapshot,
  type AriTeamPerson,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as AriClient from "./AriClient.ts";

const CACHE_MS = 15_000;

const decodeEnvelope = Schema.decodeOption(
  Schema.fromJsonString(
    Schema.Struct({
      people: Schema.Array(Schema.Unknown),
      invites: Schema.optionalKey(Schema.Array(Schema.Unknown)),
    }),
  ),
);
const Person = Schema.Struct({
  name: Schema.String,
  handle: Schema.String,
  self: Schema.Boolean,
  threads: Schema.Array(Schema.Unknown),
});
const decodePerson = Schema.decodeUnknownOption(Person);
const decodeThread = Schema.decodeUnknownOption(AriTeamThread);
const decodeInvite = Schema.decodeUnknownOption(AriTeamInvite);

/** A malformed person, thread or invite drops alone, so one bad entry never hides the whole team. */
export function decodeAriTeam(text: string): Omit<Snapshot, "state"> | null {
  const envelope = decodeEnvelope(text);
  if (Option.isNone(envelope)) return null;
  const { invites } = envelope.value;
  return {
    people: envelope.value.people.flatMap((entry): ReadonlyArray<AriTeamPerson> =>
      Option.match(decodePerson(entry), {
        onNone: () => [],
        onSome: (person) => [
          {
            ...person,
            threads: person.threads.flatMap((thread) => Option.toArray(decodeThread(thread))),
          },
        ],
      }),
    ),
    // Left out for an `ari` from before invites, which can send none either.
    ...(invites === undefined
      ? {}
      : { invites: invites.flatMap((invite) => Option.toArray(decodeInvite(invite))) }),
  };
}

const decodePeopleEnvelope = Schema.decodeOption(
  Schema.fromJsonString(Schema.Struct({ people: Schema.Array(Schema.Unknown) })),
);
// Email and listening state stay on the server: the picker needs only who to send to.
const decodeAriPerson = Schema.decodeUnknownOption(AriPerson);

/** Who `ari relay people` lists, without `selfHandle`; null when the output is not that shape. */
export function decodeAriPeople(
  text: string,
  selfHandle: string | null,
): ReadonlyArray<AriPerson> | null {
  const envelope = decodePeopleEnvelope(text);
  if (Option.isNone(envelope)) return null;
  return envelope.value.people.flatMap((entry) =>
    Option.match(decodeAriPerson(entry), {
      onNone: () => [],
      onSome: ({ handle, name }) => (handle === selfHandle ? [] : [{ handle, name }]),
    }),
  );
}

export class AriTeam extends Context.Service<
  AriTeam,
  {
    readonly read: Effect.Effect<Snapshot>;
    /** Teammates a guest link can be sent to. */
    readonly people: Effect.Effect<AriPeople>;
    /** The next read asks `ari` again, as after an invite is dismissed. */
    readonly invalidate: Effect.Effect<void>;
  }
>()("t3/ari/AriTeam") {}

const make = Effect.gen(function* () {
  const client = yield* AriClient.AriClient;
  let cached: { readonly at: number; readonly snapshot: Snapshot } | undefined;
  let cachedPeople: { readonly at: number; readonly people: AriPeople } | undefined;
  const read = Effect.fn("AriTeam.read")(function* () {
    const now = yield* Clock.currentTimeMillis;
    // Several clients refresh on focus; one `ari` process answers them all.
    if (cached && now - cached.at < CACHE_MS) return cached.snapshot;
    const snapshot = yield* client.run(["relay", "team"]).pipe(
      Effect.map((text): Snapshot => {
        const team = decodeAriTeam(text);
        return team === null ? { state: "unsupported", people: [] } : { state: "ok", ...team };
      }),
      Effect.catchTags({
        AriReadError: (error) => Effect.succeed<Snapshot>({ state: error.state, people: [] }),
      }),
    );
    cached = { at: now, snapshot };
    return snapshot;
  });
  const people = Effect.fn("AriTeam.people")(function* (): Effect.fn.Return<AriPeople> {
    const now = yield* Clock.currentTimeMillis;
    if (cachedPeople && now - cachedPeople.at < CACHE_MS) return cachedPeople.people;
    const team = yield* read();
    if (team.state !== "ok") return { state: team.state, people: [] };
    // The same `ari` release lists invites and sends them.
    if (team.invites === undefined) return { state: "unsupported", people: [] };
    const selfHandle = team.people.find((person) => person.self)?.handle ?? null;
    const result = yield* client.run(["relay", "people"]).pipe(
      Effect.map((text): AriPeople => {
        const listed = decodeAriPeople(text, selfHandle);
        return listed === null
          ? { state: "unsupported", people: [] }
          : { state: "ok", people: listed };
      }),
      Effect.catchTags({
        AriReadError: (error) => Effect.succeed<AriPeople>({ state: error.state, people: [] }),
      }),
    );
    cachedPeople = { at: now, people: result };
    return result;
  });
  const invalidate = Effect.sync(() => {
    cached = undefined;
  });
  return AriTeam.of({ read: read(), people: people(), invalidate });
});

export const layer = Layer.effect(AriTeam, make);
