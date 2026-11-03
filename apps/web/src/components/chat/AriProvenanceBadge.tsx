import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";
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
  const messages = Option.getOrNull(thread.data)?.messages ?? [];
  const provenance = messages
    .filter((message) => message.role === "user")
    .map((message) => parseAriProvenance(message.text))
    .find((value) => value !== null);
  if (!provenance) return null;
  return (
    <Tooltip>
      <TooltipTrigger render={<span tabIndex={0} />}>
        <Badge variant="info" size="sm">
          {provenance.trackerNotice ? "Tracker notice" : "Relay"} · {provenance.from}
        </Badge>
      </TooltipTrigger>
      <TooltipPopup>Display-only marker from message text; sender is unverified.</TooltipPopup>
    </Tooltip>
  );
}
