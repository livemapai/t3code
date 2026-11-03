import { Link } from "@tanstack/react-router";
import { ariAttentionTarget, type EnvironmentId } from "@t3tools/contracts";
import { useAriState } from "../state/ari";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";

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
  const target = data && ariAttentionTarget(data, primary);
  if (!target) return null;
  const content = (
    <>
      <span aria-hidden className="size-2 rounded-full bg-warning" />
      Ari · {label}
    </>
  );
  const className = "flex items-center gap-2 px-3 py-2 text-xs";
  return target === "site" ? (
    <a
      className={className}
      aria-label={`Ari needs attention on ${label}`}
      href="https://www.myari.app/en/relay"
      target="_blank"
      rel="noreferrer"
    >
      {content}
    </a>
  ) : (
    <Link
      className={className}
      aria-label={`Ari needs attention on ${label}`}
      to="/settings/ari"
      search={{ machine: environmentId }}
    >
      {content}
    </Link>
  );
}
export function AriAttention() {
  const { environments } = useEnvironments();
  const primaryId = usePrimaryEnvironmentId();
  return (
    <>
      {environments.map((environment) => (
        <AriEnvironmentAttention
          key={environment.environmentId}
          environmentId={environment.environmentId}
          label={environment.label}
          primary={environment.environmentId === primaryId}
        />
      ))}
    </>
  );
}
