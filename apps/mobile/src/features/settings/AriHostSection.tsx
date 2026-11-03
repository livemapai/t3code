import { type EnvironmentId } from "@t3tools/contracts";
import { Linking, View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { useAriState } from "../../state/ari";
import { SettingsSection } from "./components/SettingsSection";

export function AriHostSection({ environmentId }: { environmentId: EnvironmentId }) {
  const { data } = useAriState(environmentId);
  if (!data) return null;
  return (
    <SettingsSection title={`Ari agent host · ${data.host}`}>
      <View className="gap-2 p-3">
        <Text>
          {data.version ?? "Ari unavailable"} · {data.account ?? "Signed out"}
        </Text>
        <Text>
          Relay: {data.relay.state}
          {data.relay.stale ? " (stale)" : ""}
        </Text>
        {data.relay.state === "ok" && (
          <>
            <Text>
              Service:{" "}
              {data.relay.serviceRunning
                ? "Running"
                : data.relay.serviceInstalled
                  ? "Installed"
                  : "Not installed"}
            </Text>
            <Text>Listener last seen: {data.relay.listeningAt ?? "Never"}</Text>
            <Text>T3 sign-in expires: {data.relay.t3ExpiresAt ?? "Unavailable"}</Text>
            <Text>Held across this Ari account: {data.relay.held}</Text>
            {data.relay.senders.map((sender) => (
              <Text key={sender}>From {sender}</Text>
            ))}
            <Text
              accessibilityRole="link"
              onPress={() => Linking.openURL("https://www.myari.app/en/relay")}
            >
              Open Ari relay
            </Text>
          </>
        )}
        {data.relay.fixCommand && (
          <Text selectable>
            Run on {data.host}: {data.relay.fixCommand}
          </Text>
        )}
        {data.relay.state === "unavailable" && (
          <Text>Install Ari on {data.host} using your team’s Ari setup instructions.</Text>
        )}
      </View>
    </SettingsSection>
  );
}
