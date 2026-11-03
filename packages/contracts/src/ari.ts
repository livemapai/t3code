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

/** Text markers are forgeable and confer no permissions. */
export function ariMessageMarker(text: string): { from: string } | null {
  const marker =
    /^Relay message ([0-9a-f-]{36}) from (.+?)(?:, answering [0-9a-f-]{36})?\.(?: |$)/im.exec(text);
  return marker?.[2] ? { from: marker[2] } : null;
}
