import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { useSearch } from "@tanstack/react-router";
import type { EnvironmentId } from "@t3tools/contracts";
import { useEnvironments } from "../../state/environments";
import { useAriState } from "../../state/ari";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

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
export function AriSettings() {
  const { environments } = useEnvironments();
  const { machine } = useSearch({ from: "/_chat/settings" });
  return (
    <div className="space-y-4 p-6">
      <h1 className="text-xl font-semibold">Ari</h1>
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
  );
}
