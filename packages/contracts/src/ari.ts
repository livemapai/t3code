import * as Schema from "effect/Schema";

import { GuestShareId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

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
/** A guest link a teammate sent this person, as `ari relay team` lists it; every field is theirs. */
export const AriTeamInvite = Schema.Struct({
  id: Schema.String,
  from: Schema.Struct({ name: Schema.String, handle: Schema.String }),
  title: Schema.String,
  url: Schema.String,
  expiresAt: Schema.String,
  createdAt: Schema.String,
});
export type AriTeamInvite = typeof AriTeamInvite.Type;
export const AriTeam = Schema.Struct({
  state: AriGroupState,
  people: Schema.Array(AriTeamPerson),
  /** Absent from servers older than invites. */
  invites: Schema.optionalKey(Schema.Array(AriTeamInvite)),
});
export type AriTeam = typeof AriTeam.Type;

/** Someone on the team who can be sent a guest link; the viewer is left out. */
export const AriPerson = Schema.Struct({ handle: Schema.String, name: Schema.String });
export type AriPerson = typeof AriPerson.Type;
export const AriPeople = Schema.Struct({
  state: AriGroupState,
  people: Schema.Array(AriPerson),
});
export type AriPeople = typeof AriPeople.Type;

// `ari` reads a leading dash as a flag, so an argument it takes positionally never starts with one.
const AriPositional = TrimmedNonEmptyString.check(
  Schema.makeFilter((value) => !value.startsWith("-"), { description: "not a flag" }),
);

/** The server sends the thread's current guest link itself; the share id only proves which one. */
export const AriInviteInput = Schema.Struct({
  threadId: ThreadId,
  shareId: GuestShareId,
  to: AriPositional,
});
export type AriInviteInput = typeof AriInviteInput.Type;
export const AriUninviteInput = Schema.Struct({ id: AriPositional });
export type AriUninviteInput = typeof AriUninviteInput.Type;
export const AriUninviteResult = Schema.Struct({ removed: Schema.Boolean });
export type AriUninviteResult = typeof AriUninviteResult.Type;

const ARI_INVITE_MESSAGES = {
  link_ended: "This guest link has ended or was already used. Create a new one.",
  team_off: "Team threads is off on this machine. Turn it on in Settings > Ari.",
  not_teammate: "That person is not on your team in Ari.",
  unavailable: "Ari is not installed on this computer.",
  signedOut: "Sign in to Ari first.",
  forbidden: "Your Ari account cannot send invites.",
  unreachable: "Ari could not be reached. Try again.",
  unsupported: "Update Ari to send invites.",
  failed: "Ari did not confirm the invite.",
} as const;

/** The message comes from `reason` alone, so no link or `ari` output reaches a client or a log. */
export class AriInviteError extends Schema.TaggedError<AriInviteError>()("AriInviteError", {
  reason: Schema.Literals([
    "link_ended",
    "team_off",
    "not_teammate",
    "unavailable",
    "signedOut",
    "forbidden",
    "unreachable",
    "unsupported",
    "failed",
  ]),
}) {
  override get message(): string {
    return ARI_INVITE_MESSAGES[this.reason];
  }
}

/** Text markers are forgeable and confer no permissions. */
export function ariMessageMarker(text: string): { from: string } | null {
  const marker =
    /^Relay message ([0-9a-f-]{36}) from (.+?)(?:, answering [0-9a-f-]{36})?\.(?: |$)/im.exec(text);
  return marker?.[2] ? { from: marker[2] } : null;
}
