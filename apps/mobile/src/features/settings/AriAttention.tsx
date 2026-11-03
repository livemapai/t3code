import { useNavigation } from "@react-navigation/native";
import { ariAttentionTarget, type EnvironmentId } from "@t3tools/contracts";
import { Linking, View, Pressable } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { useRemoteConnections } from "../../state/use-remote-environment-registry";

import { useAriState } from "../../state/ari";

function AriEnvironmentAttention({
  environmentId,
  label,
  primary,
}: {
  environmentId: EnvironmentId;
  label: string;
  primary: boolean;
}) {
  const { data } = useAriState(environmentId);
  const navigation = useNavigation();
  const target = data && ariAttentionTarget(data, primary);
  if (!target) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Ari needs attention on ${label}`}
      onPress={() =>
        target === "site"
          ? Linking.openURL("https://www.myari.app/en/relay")
          : navigation.navigate("SettingsEnvironmentDetail", { environmentId })
      }
    >
      <View className="flex-row items-center gap-2 p-3">
        <View className="size-2 rounded-full bg-warning" />
        <Text>Ari · {label}</Text>
      </View>
    </Pressable>
  );
}
export function AriAttention({
  currentEnvironmentId,
}: {
  currentEnvironmentId: EnvironmentId | null;
}) {
  const { connectedEnvironments } = useRemoteConnections();

  return (
    <>
      {connectedEnvironments
        .filter((environment) => environment.isEnabled)
        .map((environment) => (
          <AriEnvironmentAttention
            key={environment.environmentId}
            environmentId={environment.environmentId}
            label={environment.environmentLabel}
            primary={environment.environmentId === currentEnvironmentId}
          />
        ))}
    </>
  );
}
