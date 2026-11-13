import { createDecisionCardEnvironmentAtoms } from "@t3tools/client-runtime/state/decision-cards";
import type { EnvironmentId } from "@t3tools/contracts";
import { connectionAtomRuntime } from "../connection/runtime";
import { useEnvironmentQuery } from "./query";

export const decisionCardEnvironment = createDecisionCardEnvironmentAtoms(connectionAtomRuntime);

/** One stream per environment; every reader shares it. Pass null to stop reading. */
export function useDecisionCards(environmentId: EnvironmentId | null) {
  return useEnvironmentQuery(
    environmentId === null ? null : decisionCardEnvironment.cards({ environmentId, input: null }),
  );
}
