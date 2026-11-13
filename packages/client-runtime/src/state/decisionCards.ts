import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { subscribe } from "../rpc/client.ts";
import { createEnvironmentRpcCommand, createEnvironmentSubscriptionAtomFamily } from "./runtime.ts";

/**
 * The list is global to the environment. The stream sends it again after every change, so the
 * commands below need no refresh of their own.
 */
export function createDecisionCardEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    cards: createEnvironmentSubscriptionAtomFamily(runtime, {
      label: "environment-data:decision-cards",
      idleTtlMs: 0,
      subscribe: (_input: null) => subscribe(WS_METHODS.decisionCardsSubscribe, {}),
    }),
    answer: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:decision-cards:answer",
      tag: WS_METHODS.decisionCardsAnswer,
    }),
    dismiss: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:decision-cards:dismiss",
      tag: WS_METHODS.decisionCardsDismiss,
    }),
    reopen: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:decision-cards:reopen",
      tag: WS_METHODS.decisionCardsReopen,
    }),
  };
}
