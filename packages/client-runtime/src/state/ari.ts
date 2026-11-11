import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { request, subscribe } from "../rpc/client.ts";
import {
  createEnvironmentQueryAtomFamily,
  createEnvironmentSubscriptionAtomFamily,
} from "./runtime.ts";

export function createAriEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return createEnvironmentSubscriptionAtomFamily(runtime, {
    label: "environment-data:ari",
    idleTtlMs: 0,
    subscribe: (_input: null) => subscribe(WS_METHODS.ariSubscribe, {}),
  });
}

/** Read only while mounted; readers refresh it themselves, so a hidden section costs nothing. */
export function createAriTeamEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return createEnvironmentQueryAtomFamily(runtime, {
    label: "environment-data:ari-team",
    idleTtlMs: 0,
    execute: (_input: null) => request(WS_METHODS.ariTeam, {}),
  });
}
