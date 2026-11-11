import {
  createAriEnvironmentAtoms,
  createAriTeamEnvironmentAtoms,
} from "@t3tools/client-runtime/state/ari";
import { type EnvironmentId, AuthAriReadScope } from "@t3tools/contracts";
import { connectionAtomRuntime } from "../connection/runtime";
import { useEnvironmentQuery } from "./query";
import { useEnvironmentScope } from "./session";

const ariEnvironment = createAriEnvironmentAtoms(connectionAtomRuntime);
export function useAriState(environmentId: EnvironmentId) {
  const allowed = useEnvironmentScope(environmentId, AuthAriReadScope);
  const query = useEnvironmentQuery(
    allowed ? ariEnvironment({ environmentId, input: null }) : null,
  );
  return { ...query, allowed };
}

export const ariTeamEnvironment = createAriTeamEnvironmentAtoms(connectionAtomRuntime);
/** Pass null to stop reading: the query unmounts and nothing runs `ari`. */
export function useAriTeam(environmentId: EnvironmentId | null) {
  const allowed = useEnvironmentScope(environmentId, AuthAriReadScope);
  return useEnvironmentQuery(
    allowed && environmentId !== null
      ? ariTeamEnvironment.team({ environmentId, input: null })
      : null,
  );
}

/** Teammates a guest link can be sent to; pass null to stop reading. */
export function useAriPeople(environmentId: EnvironmentId | null) {
  const allowed = useEnvironmentScope(environmentId, AuthAriReadScope);
  return useEnvironmentQuery(
    allowed && environmentId !== null
      ? ariTeamEnvironment.people({ environmentId, input: null })
      : null,
  );
}
