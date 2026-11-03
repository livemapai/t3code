import { ariMessageMarker, type EnvironmentId, type ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AppText as Text } from "../../components/ui/AppText";
import { useEnvironmentThread } from "../../state/threads";

export function AriProvenanceBadge({
  environmentId,
  threadId,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
}) {
  const thread = useEnvironmentThread(environmentId, threadId);
  const marker = Option.getOrNull(thread.data)
    ?.messages.filter((message) => message.role === "user")
    .map((message) => ariMessageMarker(message.text))
    .find((value) => value !== null);
  return marker ? (
    <Text accessibilityLabel={`Relay from ${marker.from}, unverified message marker`}>
      Relay · {marker.from}
    </Text>
  ) : null;
}
