import * as Schema from "effect/Schema";

export const AriGroupState = Schema.Literals([
  "ok",
  "unavailable",
  "signedOut",
  "forbidden",
  "unreachable",
  "unsupported",
]);
export type AriGroupState = typeof AriGroupState.Type;
export const AriState = Schema.Struct({
  host: Schema.String,
  version: Schema.NullOr(Schema.String),
  account: Schema.NullOr(Schema.String),
  relay: Schema.Struct({
    state: AriGroupState,
    stale: Schema.Boolean,
    serviceInstalled: Schema.Boolean,
    serviceRunning: Schema.Boolean,
    listeningAt: Schema.NullOr(Schema.String),
    t3ExpiresAt: Schema.NullOr(Schema.String),
    held: Schema.Number,
    boundHeld: Schema.Number,
    senders: Schema.Array(Schema.String),
    broken: Schema.Boolean,
    fixCommand: Schema.NullOr(Schema.String),
  }),
});
export type AriState = typeof AriState.Type;

export function ariAttentionTarget(state: AriState, primary: boolean): "site" | "settings" | null {
  if (state.relay.state === "signedOut" || state.relay.stale) return "settings";
  if (state.relay.state !== "ok") return null;
  if (state.relay.broken || state.relay.stale) return "settings";
  return state.relay.boundHeld > 0 ? (primary ? "site" : "settings") : null;
}

/** The tag on a thread `ari relay` started, so clients can tell it from the person's own. */
export const ARI_RELAY_THREAD_TAG = "relay";

/** The tag a person puts on their own thread to list it for the team; threads without it stay private. */
export const ARI_TEAM_THREAD_TAG = "team";

/** A thread made from another one's data starts private: the tag is consent for that thread alone. */
export const withoutAriTeamTag = (tags: ReadonlyArray<string> | undefined) =>
  tags?.filter((tag) => tag !== ARI_TEAM_THREAD_TAG);

/** What `ari relay team` lists about a thread, and all this server ever publishes about one. */
export const AriTeamThread = Schema.Struct({
  threadId: Schema.String,
  title: Schema.String,
  project: Schema.NullOr(Schema.String),
  branch: Schema.NullOr(Schema.String),
  pullRequestUrl: Schema.NullOr(Schema.String),
  state: Schema.Literals(["working", "idle"]),
  updatedAt: Schema.String,
});
export type AriTeamThread = typeof AriTeamThread.Type;
export const AriTeamPerson = Schema.Struct({
  name: Schema.String,
  handle: Schema.String,
  self: Schema.Boolean,
  threads: Schema.Array(AriTeamThread),
});
export type AriTeamPerson = typeof AriTeamPerson.Type;
export const AriTeam = Schema.Struct({
  state: AriGroupState,
  people: Schema.Array(AriTeamPerson),
});
export type AriTeam = typeof AriTeam.Type;

/** Text markers are forgeable and confer no permissions. */
export function ariMessageMarker(text: string): { from: string } | null {
  const marker =
    /^Relay message ([0-9a-f-]{36}) from (.+?)(?:, answering [0-9a-f-]{36})?\.(?: |$)/im.exec(text);
  return marker?.[2] ? { from: marker[2] } : null;
}
