import { T, Var, useGT } from "gt-react";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { useSearch } from "@tanstack/react-router";
import { AriMergeShout, type EnvironmentId } from "@t3tools/contracts";
import { Schema } from "effect";
import { useEnvironments } from "../../state/environments";
import { useAriState } from "../../state/ari";
import { MERGE_SHOUTS, previewMergeShout } from "../pullRequest/mergeShout";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

function AriHost({ environmentId, label }: { environmentId: EnvironmentId; label: string }) {
  const gt = useGT();
  const query = useAriState(environmentId);
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  const state = query.data;
  return (
    <section className="space-y-3 rounded-lg border p-4 text-sm [&_p]:text-muted-foreground">
      <h2 className="font-medium">
        <T>
          Ari agent host · <Var>{label}</Var>
        </T>
      </h2>
      {!state ? (
        <p>
          {query.error ??
            (query.allowed
              ? gt("Loading Ari host state…")
              : gt("Ari state requires ari:read access to this environment."))}
        </p>
      ) : (
        <>
          <p>
            <T>
              Server host: <Var>{state.host}</Var>
            </T>
          </p>
          <p>
            <T>
              Version: <Var>{state.version ?? gt("Unavailable")}</Var> · Account:{" "}
              <Var>{state.account ?? gt("Signed out")}</Var>
            </T>
          </p>
          <h3 className="flex items-center gap-2 font-medium">
            <T>Relay</T>
            <Badge variant={state.relay.state === "ok" ? "success" : "warning"}>
              {state.relay.state}
              {state.relay.stale ? gt(" (stale)") : ""}
            </Badge>
          </h3>
          {state.relay.state === "ok" && (
            <>
              <p>
                <T>Service: </T>{" "}
                {state.relay.serviceRunning
                  ? gt("Running")
                  : state.relay.serviceInstalled
                    ? gt("Installed")
                    : gt("Not installed")}
              </p>
              <p>
                <T>
                  Listener last seen: <Var>{state.relay.listeningAt ?? gt("Never")}</Var>
                </T>
              </p>
              <p>
                <T>
                  T3 sign-in expires: <Var>{state.relay.t3ExpiresAt ?? gt("Unavailable")}</Var>
                </T>
              </p>
              <p>
                <T>
                  Held across this Ari account: <Var>{state.relay.held}</Var>
                </T>
              </p>
              {state.relay.senders.map((sender) => (
                <p key={sender}>
                  <T>
                    From <Var>{sender}</Var>
                  </T>
                </p>
              ))}
            </>
          )}
          {state.relay.fixCommand && (
            <div className="space-y-2">
              <p>
                <T>
                  Run on <Var>{state.host}</Var>:{" "}
                  <code>
                    <Var>{state.relay.fixCommand}</Var>
                  </code>
                </T>
              </p>
              <Button
                variant="outline"
                onClick={() => copyToClipboard(state.relay.fixCommand!, undefined)}
              >
                {isCopied ? gt("Copied") : gt("Copy command")}
              </Button>
            </div>
          )}
          {state.relay.state === "unavailable" && (
            <p>
              <T>
                Install Ari on <Var>{state.host}</Var> using your team’s Ari setup instructions.
              </T>
            </p>
          )}
          {state.relay.state === "ok" && (
            <a href="https://www.myari.app/en/relay" target="_blank" rel="noreferrer">
              <T>Open Ari relay</T>
            </a>
          )}
        </>
      )}
    </section>
  );
}
const isMergeShout = Schema.is(AriMergeShout);

function MergeShoutRow() {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const shout = MERGE_SHOUTS[settings.ariMergeShout];
  return (
    <SettingsRow
      {...searchableSetting("ari-ship-it-sound")}
      description={gt("What the merge button shouts when you merge a pull request.")}
      control={
        <Select
          value={settings.ariMergeSoundEnabled ? settings.ariMergeShout : "off"}
          onValueChange={(value) => {
            if (value === "off") {
              updateSettings({ ariMergeSoundEnabled: false });
            } else if (isMergeShout(value)) {
              updateSettings({ ariMergeSoundEnabled: true, ariMergeShout: value });
              previewMergeShout(value);
            }
          }}
        >
          <SelectTrigger size="sm" className="w-full sm:w-40" aria-label={gt("Merge shout")}>
            <SelectValue>{settings.ariMergeSoundEnabled ? shout.name : gt("Off")}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {Object.entries(MERGE_SHOUTS).map(([value, { name }]) => (
              <SelectItem key={value} hideIndicator value={value}>
                {name}
              </SelectItem>
            ))}
            <SelectItem hideIndicator value="off">
              <T>Off</T>
            </SelectItem>
          </SelectPopup>
        </Select>
      }
    />
  );
}

function ThreadFlagsRow() {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsRow
      {...searchableSetting("ari-thread-flags")}
      description={gt(
        "Right-click a thread and flag it as urgent, later, or working. Flagged threads show an icon in the sidebar.",
      )}
      control={
        <Switch
          checked={settings.ariThreadFlagsEnabled}
          onCheckedChange={(checked) => updateSettings({ ariThreadFlagsEnabled: Boolean(checked) })}
          aria-label={gt("Thread flags")}
        />
      }
    />
  );
}

function ThreadFlagSectionsRow() {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsRow
      {...searchableSetting("ari-thread-flag-sections")}
      description={gt(
        "Group flagged threads under Urgent, In progress and Later headers at the top of the sidebar, with a colour rail on flagged rows. Off keeps the usual order with only the flag icon. Needs Thread flags.",
      )}
      control={
        <Switch
          checked={settings.ariThreadFlagsEnabled && settings.ariThreadFlagSectionsEnabled}
          disabled={!settings.ariThreadFlagsEnabled}
          onCheckedChange={(checked) =>
            updateSettings({ ariThreadFlagSectionsEnabled: Boolean(checked) })
          }
          aria-label={gt("Flag sections")}
        />
      }
    />
  );
}

function RelayShelfRow() {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsRow
      {...searchableSetting("ari-relay-shelf")}
      description={gt(
        "Keep threads that Ari relay started in a Relay section of the sidebar, apart from your own. One that needs you, or that you write in, shows with your threads.",
      )}
      control={
        <Switch
          checked={settings.ariRelayShelfEnabled}
          onCheckedChange={(checked) => updateSettings({ ariRelayShelfEnabled: Boolean(checked) })}
          aria-label={gt("Relay section")}
        />
      }
    />
  );
}

function TeamThreadsRow() {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsRow
      serverScoped
      {...searchableSetting("ari-team-threads")}
      settingKeys={["ariTeamThreadsEnabled"]}
      description={gt(
        "Show teammates' threads in a Team section, and show yours from a thread's menu. Off takes this machine's threads off the team's list at once; turning it back on lists the ones you marked.",
      )}
      control={
        <Switch
          checked={settings.ariTeamThreadsEnabled}
          onCheckedChange={(checked) => updateSettings({ ariTeamThreadsEnabled: Boolean(checked) })}
          aria-label={gt("Team threads")}
        />
      }
    />
  );
}

function LibraryLinksRow() {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsRow
      {...searchableSetting("ari-library-links")}
      description={gt(
        "Open Ari Library files in the in-app browser beside the thread, even when links open in the system browser. Cmd/Ctrl-click still opens them externally.",
      )}
      control={
        <Switch
          checked={settings.ariLibraryLinksInAppEnabled}
          onCheckedChange={(checked) =>
            updateSettings({ ariLibraryLinksInAppEnabled: Boolean(checked) })
          }
          aria-label={gt("Open Ari Library links in the app")}
        />
      }
    />
  );
}

export function AriSettings() {
  const gt = useGT();
  const { environments } = useEnvironments();
  const { machine } = useSearch({ from: "/_chat/settings" });
  return (
    <SettingsPageContainer>
      <SettingsSection id="ari-features" title={gt("Features")}>
        <MergeShoutRow />
        <ThreadFlagsRow />
        <ThreadFlagSectionsRow />
        <RelayShelfRow />
        <TeamThreadsRow />
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
