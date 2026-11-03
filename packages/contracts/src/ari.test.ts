import { expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { AriState, ariAttentionTarget } from "./ari.ts";

const decode = Schema.decodeUnknownSync(AriState);
const state: AriState = {
  host: "host-a",
  version: "0.36.1",
  account: "A",
  relay: {
    state: "ok",
    stale: false,
    serviceInstalled: true,
    serviceRunning: true,
    listeningAt: "2026-11-03T12:00:00Z",
    t3ExpiresAt: null,
    held: 2,
    boundHeld: 2,
    senders: ["B"],
    broken: false,
    fixCommand: null,
  },
};
it("keeps attention specific to the destination environment", () => {
  const other = { ...state, host: "host-b", relay: { ...state.relay, held: 0, boundHeld: 0 } };
  expect(
    ariAttentionTarget({ ...state, relay: { ...state.relay, boundHeld: 0 } }, true),
  ).toBeNull();
  expect(ariAttentionTarget(state, true)).toBe("site");
  expect(ariAttentionTarget(state, false)).toBe("settings");
  expect(ariAttentionTarget(other, false)).toBeNull();
  expect(
    ariAttentionTarget({ ...other, relay: { ...other.relay, state: "signedOut" } }, true),
  ).toBe("settings");
  expect(ariAttentionTarget({ ...other, relay: { ...other.relay, broken: true } }, false)).toBe(
    "settings",
  );
});
it("drops prompt text at the wire boundary", () => {
  const decoded = decode({
    ...state,
    prompt: "private",
    relay: { ...state.relay, prompt: "private" },
  });
  expect(JSON.stringify(decoded)).not.toContain("private");
});
