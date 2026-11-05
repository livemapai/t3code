import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { useSearch } from "@tanstack/react-router";
import type { EnvironmentId } from "@t3tools/contracts";
import { useEnvironments } from "../../state/environments";
import { useAriState } from "../../state/ari";
import { MERGE_SHOUTS, previewMergeShout } from "../pullRequest/mergeShout";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

function AriHost({ environmentId, label }: { environmentId: EnvironmentId; label: string }) {
  const query = useAriState(environmentId);
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  const state = query.data;
  return (
    <section className="space-y-3 rounded-lg border p-4 text-sm [&_p]:text-muted-foreground">
      <h2 className="font-medium">Ari agent host · {label}</h2>
      {!state ? (
        <p>
          {query.error ??
            (query.allowed
              ? "Loading Ari host state…"
              : "Ari state requires ari:read access to this environment.")}
        </p>
      ) : (
        <>
          <p>Server host: {state.host}</p>
          <p>
            Version: {state.version ?? "Unavailable"} · Account: {state.account ?? "Signed out"}
          </p>
          <h3 className="flex items-center gap-2 font-medium">
            Relay
            <Badge variant={state.relay.state === "ok" ? "success" : "warning"}>
              {state.relay.state}
              {state.relay.stale ? " (stale)" : ""}
            </Badge>
          </h3>
          {state.relay.state === "ok" && (
            <>
              <p>
                Service:{" "}
                {state.relay.serviceRunning
                  ? "Running"
                  : state.relay.serviceInstalled
                    ? "Installed"
                    : "Not installed"}
              </p>
              <p>Listener last seen: {state.relay.listeningAt ?? "Never"}</p>
              <p>T3 sign-in expires: {state.relay.t3ExpiresAt ?? "Unavailable"}</p>
              <p>Held across this Ari account: {state.relay.held}</p>
              {state.relay.senders.map((sender) => (
                <p key={sender}>From {sender}</p>
              ))}
            </>
          )}
          {state.relay.fixCommand && (
            <div className="space-y-2">
              <p>
                Run on {state.host}: <code>{state.relay.fixCommand}</code>
              </p>
              <Button
                variant="outline"
                onClick={() => copyToClipboard(state.relay.fixCommand!, undefined)}
              >
                {isCopied ? "Copied" : "Copy command"}
              </Button>
            </div>
          )}
          {state.relay.state === "unavailable" && (
            <p>Install Ari on {state.host} using your team’s Ari setup instructions.</p>
          )}
          {state.relay.state === "ok" && (
            <a href="https://www.myari.app/en/relay" target="_blank" rel="noreferrer">
              Open Ari relay
            </a>
          )}
        </>
      )}
    </section>
  );
}
function MergeShoutRow() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const shout = MERGE_SHOUTS[settings.ariMergeShout];
  return (
    <SettingsRow
      {...searchableSetting("ari-ship-it-sound")}
      description="What the merge button shouts when you merge a pull request."
      control={
        <Select
          value={settings.ariMergeSoundEnabled ? settings.ariMergeShout : "off"}
          onValueChange={(value) => {
            if (value === "off") {
              updateSettings({ ariMergeSoundEnabled: false });
            } else if (value === "ship-it" || value === "bomboclaat") {
              updateSettings({ ariMergeSoundEnabled: true, ariMergeShout: value });
              previewMergeShout(value);
            }
          }}
        >
          <SelectTrigger size="sm" className="w-full sm:w-40" aria-label="Merge shout">
            <SelectValue>{settings.ariMergeSoundEnabled ? shout.name : "Off"}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            <SelectItem hideIndicator value="ship-it">
              {MERGE_SHOUTS["ship-it"].name}
            </SelectItem>
            <SelectItem hideIndicator value="bomboclaat">
              {MERGE_SHOUTS.bomboclaat.name}
            </SelectItem>
            <SelectItem hideIndicator value="off">
              Off
            </SelectItem>
          </SelectPopup>
        </Select>
      }
    />
  );
}

function ThreadFlagsRow() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsRow
      {...searchableSetting("ari-thread-flags")}
      description="Right-click a thread and flag it as urgent, later, or working. Flagged threads show an icon in the sidebar."
      control={
        <Switch
          checked={settings.ariThreadFlagsEnabled}
          onCheckedChange={(checked) => updateSettings({ ariThreadFlagsEnabled: Boolean(checked) })}
          aria-label="Thread flags"
        />
      }
    />
  );
}

function RelayShelfRow() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsRow
      {...searchableSetting("ari-relay-shelf")}
      description="Keep threads that Ari relay started in a Relay section of the sidebar, apart from your own. One that needs you, or that you write in, shows with your threads."
      control={
        <Switch
          checked={settings.ariRelayShelfEnabled}
          onCheckedChange={(checked) => updateSettings({ ariRelayShelfEnabled: Boolean(checked) })}
          aria-label="Relay section"
        />
      }
    />
  );
}

function LibraryLinksRow() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsRow
      {...searchableSetting("ari-library-links")}
      description="Open Ari Library files in the in-app browser beside the thread, even when links open in the system browser. Cmd/Ctrl-click still opens them externally."
      control={
        <Switch
          checked={settings.ariLibraryLinksInAppEnabled}
          onCheckedChange={(checked) =>
            updateSettings({ ariLibraryLinksInAppEnabled: Boolean(checked) })
          }
          aria-label="Open Ari Library links in the app"
        />
      }
    />
  );
}

export function AriSettings() {
  const { environments } = useEnvironments();
  const { machine } = useSearch({ from: "/_chat/settings" });
  return (
    <SettingsPageContainer>
      <SettingsSection id="ari-features" title="Features">
        <MergeShoutRow />
        <ThreadFlagsRow />
        <RelayShelfRow />
        <LibraryLinksRow />
      </SettingsSection>
      <div className="space-y-4">
        {environments
          .filter((environment) => !machine || environment.environmentId === machine)
          .map((environment) => (
            <AriHost
              key={environment.environmentId}
              environmentId={environment.environmentId}
              label={environment.label}
            />
          ))}
      </div>
    </SettingsPageContainer>
  );
}
