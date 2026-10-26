import { useId, useState } from "react";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import {
  AuthSettingsWriteScope,
  type EnvironmentId,
  type LimrunDeviceHostConfig,
  type LimrunJurisdiction,
} from "@t3tools/contracts";
import { CloudIcon, PlusIcon, XIcon } from "lucide-react";

import { randomUUID } from "../../lib/utils";
import { serverEnvironment } from "../../state/server";
import { readEnvironmentScope, useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import {
  limrunInstanceLimits,
  newLimrunDeviceHost,
  parseLimrunDeviceHostDraft,
  updateLimrunDeviceHosts,
} from "./limrunDeviceHostsSettings.logic";
import { SecretInput } from "./SecretInput";
import { useSettingsScope } from "./SettingsScopeContext";
import { SettingsRow } from "./settingsLayout";

const NEAREST = "nearest";
const JURISDICTIONS: Record<LimrunJurisdiction | typeof NEAREST, string> = {
  nearest: "Nearest region",
  us: "United States",
  eu: "Europe",
  as: "Asia",
};

const failureMessage = (cause: Cause.Cause<unknown>) => {
  const error = Cause.squash(cause);
  return error instanceof Error ? error.message : String(error);
};

/** Limrun hosts belong to one environment: its server holds the API key and runs the instances. */
export function LimrunDeviceHostsSettings(props: { environmentId: EnvironmentId | null }) {
  const { scope, connectedEnvironments } = useSettingsScope();
  const canConfigure = useEnvironmentScope(props.environmentId, AuthSettingsWriteScope);
  const projectScope = scope.kind === "project" || scope.kind === "checkout";
  const update = useAtomCommand(serverEnvironment.updateSettings, { reportFailure: false });
  const environment = connectedEnvironments.find(
    (candidate) => candidate.environmentId === props.environmentId,
  );
  const hosts = environment?.serverConfig?.settings.limrunDeviceHosts ?? [];
  const [editing, setEditing] = useState<{ host: LimrunDeviceHostConfig; isNew: boolean } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const disabled = !canConfigure || projectScope || busy || !props.environmentId;

  const save = async (host: LimrunDeviceHostConfig, remove: boolean) => {
    if (!props.environmentId || !readEnvironmentScope(props.environmentId, AuthSettingsWriteScope))
      return;
    setBusy(true);
    const result = await update({
      environmentId: props.environmentId,
      input: { patch: { limrunDeviceHosts: updateLimrunDeviceHosts(hosts, host, remove) } },
    });
    setBusy(false);
    if (result._tag === "Success") setEditing(null);
    else
      toastManager.add({
        type: "error",
        title: remove ? "Limrun host not removed" : "Limrun host not saved",
        description: failureMessage(result.cause),
      });
  };

  return (
    <SettingsRow
      id="limrun-device-hosts"
      title="Limrun"
      serverScoped
      settingKeys={["limrunDeviceHosts"]}
      description="Run iOS Simulators and Android Emulators in Limrun's cloud from this environment. Instances bill the Limrun organization until they stop, so each host limits how many run and for how long. Editing or removing a host stops its running instances."
      control={
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || editing !== null}
          onClick={() => setEditing({ host: newLimrunDeviceHost(randomUUID()), isNew: true })}
        >
          <PlusIcon className="size-3.5" /> Add Limrun host
        </Button>
      }
    >
      <div className="pt-3 pb-2">
        {hosts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No Limrun hosts.</p>
        ) : (
          <ul className="divide-y divide-border/40">
            {hosts.map((host) => (
              <li key={host.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 truncate font-medium">
                    <CloudIcon className="size-3.5 shrink-0" /> {host.label}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {limrunInstanceLimits(host)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={disabled}
                    onClick={() => setEditing({ host, isNew: false })}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost-destructive"
                    disabled={disabled}
                    onClick={() => void save(host, true)}
                  >
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {editing ? (
          <LimrunDeviceHostEditor
            key={editing.host.id}
            host={editing.host}
            isNew={editing.isNew}
            busy={busy}
            onSave={(host) => void save(host, false)}
            onClose={() => setEditing(null)}
          />
        ) : null}
      </div>
    </SettingsRow>
  );
}

function LimrunDeviceHostEditor(props: {
  host: LimrunDeviceHostConfig;
  isNew: boolean;
  busy: boolean;
  onSave: (host: LimrunDeviceHostConfig) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(props.host);
  const keyId = useId();
  // A saved key arrives redacted; only a replacement or a clear changes it.
  const [apiKey, setApiKey] = useState<
    { kind: "saved" } | { kind: "new"; value: string } | { kind: "cleared" }
  >(props.host.apiKey ? { kind: "saved" } : { kind: "cleared" });
  const next: LimrunDeviceHostConfig = {
    ...draft,
    label: draft.label.trim(),
    apiKey: apiKey.kind === "saved" ? props.host.apiKey : apiKey.kind === "new" ? apiKey.value : "",
  };
  const valid = Option.isSome(parseLimrunDeviceHostDraft(next));
  const problem = valid
    ? null
    : draft.maxSessionMinutes > 0 && draft.idleMinutes >= draft.maxSessionMinutes
      ? "Idle minutes must be smaller than session minutes."
      : "Give the host a label and limits within the ranges shown.";

  const limit = (
    field: "maxSessionMinutes" | "idleMinutes" | "maxConcurrentSessions",
    label: string,
    max: number,
  ) => (
    <label className="block space-y-1.5">
      <span>{label}</span>
      <Input
        type="number"
        min={1}
        max={max}
        value={draft[field]}
        disabled={props.busy}
        onChange={(event) => {
          const value = Number(event.target.value);
          setDraft((current) => ({ ...current, [field]: value }));
        }}
      />
    </label>
  );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !props.busy) props.onClose();
      }}
    >
      <DialogPopup showCloseButton={!props.busy}>
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid && !props.busy) props.onSave(next);
          }}
        >
          <DialogHeader>
            <DialogTitle>{props.isNew ? "Add Limrun host" : "Edit Limrun host"}</DialogTitle>
            <DialogDescription>
              The environment's server starts the instances with this API key. Without one here it
              uses LIM_API_KEY, then its lim login.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <label className="block space-y-1.5 text-sm">
              <span>Name</span>
              <Input
                autoFocus
                required
                value={draft.label}
                disabled={props.busy}
                onChange={(event) => {
                  const label = event.target.value;
                  setDraft((current) => ({ ...current, label }));
                }}
              />
            </label>
            <div className="space-y-1.5 text-sm">
              <label htmlFor={keyId} className="block">
                Limrun API key
              </label>
              <div className="flex items-center gap-2">
                <SecretInput
                  id={keyId}
                  className="min-w-0 flex-1"
                  configured={apiKey.kind === "saved"}
                  value={apiKey.kind === "new" ? apiKey.value : ""}
                  disabled={props.busy}
                  placeholder="Optional"
                  onChange={(event) => {
                    const value = event.target.value;
                    setApiKey(
                      value
                        ? { kind: "new", value }
                        : props.host.apiKey
                          ? { kind: "saved" }
                          : { kind: "cleared" },
                    );
                  }}
                />
                {apiKey.kind !== "cleared" ? (
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost-destructive"
                    aria-label="Clear API key"
                    onClick={() => setApiKey({ kind: "cleared" })}
                  >
                    <XIcon className="size-3.5" />
                  </Button>
                ) : null}
              </div>
            </div>
            <div className="space-y-1.5 text-sm">
              <span>Region</span>
              <Select
                value={draft.jurisdiction ?? NEAREST}
                disabled={props.busy}
                onValueChange={(value) => {
                  if (typeof value !== "string") return;
                  setDraft((current) => {
                    const { jurisdiction: _, ...rest } = current;
                    return value === NEAREST
                      ? rest
                      : { ...rest, jurisdiction: value as LimrunJurisdiction };
                  });
                }}
              >
                <SelectTrigger size="sm" aria-label="Region">
                  <SelectValue>
                    {(value: string) => JURISDICTIONS[value as keyof typeof JURISDICTIONS]}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {Object.entries(JURISDICTIONS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-3 text-sm">
              {limit("maxConcurrentSessions", "Devices at once", 20)}
              {limit("maxSessionMinutes", "Session minutes", 240)}
              {limit("idleMinutes", "Idle minutes", 60)}
            </div>
            <p className="text-xs text-muted-foreground">
              Limrun ends an instance after the session minutes, or after the idle minutes without
              activity, so idle minutes must be smaller than session minutes.
              {props.isNew
                ? null
                : " Saving restarts this host, which stops its running instances."}
            </p>
            {problem === null ? null : (
              <p className="text-xs text-destructive" role="alert">
                {problem}
              </p>
            )}
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={props.busy} onClick={props.onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={props.busy || !valid}>
              {props.busy ? <Spinner size="xs" /> : null} Save host
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
