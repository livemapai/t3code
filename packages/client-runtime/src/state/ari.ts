import { WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { request, subscribe } from "../rpc/client.ts";
import {
  createEnvironmentQueryAtomFamily,
  createEnvironmentRpcCommand,
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
  const team = createEnvironmentQueryAtomFamily(runtime, {
    label: "environment-data:ari-team",
    idleTtlMs: 0,
    execute: (_input: null) => request(WS_METHODS.ariTeam, {}),
  });
  return {
    team,
    /** Read only while the guest link dialog shows a link. */
    people: createEnvironmentQueryAtomFamily(runtime, {
      label: "environment-data:ari-people",
      idleTtlMs: 0,
      execute: (_input: null) => request(WS_METHODS.ariPeople, {}),
    }),
    invite: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:ari:invite",
      tag: WS_METHODS.ariInvite,
    }),
    uninvite: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:ari:uninvite",
      tag: WS_METHODS.ariUninvite,
      onSuccess: ({ environmentId }, registry) =>
        Effect.sync(() => registry.refresh(team({ environmentId, input: null }))),
    }),
  };
}
