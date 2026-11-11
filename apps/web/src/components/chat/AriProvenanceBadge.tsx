import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { ARI_TEAM_THREAD_TAG, type EnvironmentId, type ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { useQuietThreadShell } from "../../state/entities";
import { useEnvironmentThread } from "../../state/threads";
import { parseAriProvenance } from "./relayMessage";
import { Badge } from "../ui/badge";

export function AriProvenanceBadge({
  environmentId,
  threadId,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
}) {
  const thread = useEnvironmentThread(environmentId, threadId);
  const shell = useQuietThreadShell(scopeThreadRef(environmentId, threadId));
  const messages = Option.getOrNull(thread.data)?.messages ?? [];
  const provenance = messages
    .filter((message) => message.role === "user")
    .map((message) => parseAriProvenance(message.text))
    .find((value) => value !== null);
  const team = shell?.source.tags?.includes(ARI_TEAM_THREAD_TAG) ? (
    <Tooltip>
      <TooltipTrigger render={<span tabIndex={0} />}>
        <Badge variant="outline" size="sm">
          Team
        </Badge>
      </TooltipTrigger>
      <TooltipPopup>
        Your team sees this thread’s title, project, branch, pull request, and whether its agent is
        working.
      </TooltipPopup>
    </Tooltip>
  ) : null;
  if (!provenance) return team;
  return (
    <>
      {team}
      <Tooltip>
        <TooltipTrigger render={<span tabIndex={0} />}>
          <Badge variant="info" size="sm">
            {provenance.trackerNotice ? "Tracker notice" : "Relay"} · {provenance.from}
          </Badge>
        </TooltipTrigger>
        <TooltipPopup>Display-only marker from message text; sender is unverified.</TooltipPopup>
      </Tooltip>
    </>
  );
}
