import { ARI_TEAM_THREAD_TAG, type AriTeamPerson, type AriTeamThread } from "@t3tools/contracts";
import { UsersIcon } from "lucide-react";
import { Schema } from "effect";
import { useEffect } from "react";

import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { useHandleNewThread } from "../../hooks/useHandleNewThread";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useClientSettings } from "../../hooks/useSettings";
import { resolveThreadActionProjectRef } from "../../lib/chatThreadActions";
import { cn } from "../../lib/utils";
import { readLocalApi } from "../../localApi";
import { useAriTeam } from "../../state/ari";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { RelativeTime } from "../RelativeTime";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { toastManager } from "../ui/toast";
import { askTeammatePrompt, teamSectionPeople, teamThreadActions } from "./teamThreads.logic";

const TEAM_SECTION_EXPANDED_KEY = "t3code:sidebar:team-expanded";
const TEAM_SECTION_COUNT_KEY = "t3code:sidebar:team-count";
const TEAM_REFRESH_MS = 5 * 60_000;

/** Shown whatever the Team threads switch says: the person always sees what the team sees. */
export function TeamThreadIndicator({ tags }: { tags: ReadonlyArray<string> | undefined }) {
  if (!tags?.includes(ARI_TEAM_THREAD_TAG)) return null;
  return (
    <UsersIcon
      role="img"
      aria-label="Shown to team"
      data-testid="sidebar-team"
      className="size-3 shrink-0 text-muted-foreground/65"
    />
  );
}

export function SidebarTeamSection() {
  const enabled = useClientSettings((settings) => settings.ariTeamThreadsEnabled);
  const environmentId = usePrimaryEnvironmentId();
  if (!enabled || environmentId === null) return null;
  return <TeamSection environmentId={environmentId} />;
}

function TeamSection({
  environmentId,
}: {
  environmentId: NonNullable<ReturnType<typeof usePrimaryEnvironmentId>>;
}) {
  const [expanded, setExpanded] = useLocalStorage(TEAM_SECTION_EXPANDED_KEY, true, Schema.Boolean);
  const [lastCount, setLastCount] = useLocalStorage(TEAM_SECTION_COUNT_KEY, 0, Schema.Number);
  // A collapsed header shows the last known count and reads nothing. With nothing known to show
  // there is no header to expand, so the section keeps reading until a teammate lists a thread.
  const reading = expanded || lastCount === 0;
  const { data, refresh } = useAriTeam(reading ? environmentId : null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- refetches the team list on window focus and on a timer, only while it is read
  useEffect(() => {
    if (!reading) return;
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, TEAM_REFRESH_MS);
    return () => {
      window.removeEventListener("focus", refresh);
      window.clearInterval(timer);
    };
  }, [reading, refresh]);
  const people = teamSectionPeople(data);
  const count =
    reading && data !== null
      ? people.reduce((total, person) => total + person.threads.length, 0)
      : lastCount;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- remembers the count in localStorage for the collapsed header, which reads nothing
  useEffect(() => {
    if (count !== lastCount) setLastCount(count);
  }, [count, lastCount, setLastCount]);
  const newThreadContext = useHandleNewThread();
  const { copyToClipboard } = useCopyToClipboard<{ title: string }>({
    onCopy: ({ title }) =>
      toastManager.add({ type: "success", title: "Title copied", description: title }),
  });
  const ask = async (person: AriTeamPerson, thread: AriTeamThread) => {
    const projectRef = resolveThreadActionProjectRef({
      ...newThreadContext,
      activeThread: newThreadContext.activeThread ?? undefined,
    });
    const opened =
      projectRef === null
        ? null
        : await newThreadContext
            .handleNewThread(projectRef, { prompt: askTeammatePrompt(person, thread) })
            .catch(() => null);
    if (opened === null) {
      toastManager.add({
        type: "error",
        title: "Could not open a thread",
        description: "Open a project first, then ask again.",
      });
    }
  };
  if (count === 0) return null;
  return (
    <section aria-label="Team threads" className="mx-0.5 mt-2 flex flex-col gap-px">
      <CollapsibleSectionHeader
        expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        accessory={<span className="font-normal tabular-nums">{count}</span>}
      >
        Team
      </CollapsibleSectionHeader>
      {expanded
        ? people.map((person) => (
            <div key={person.handle} className="flex flex-col gap-px">
              <span className="truncate px-2.5 pt-1 text-2xs font-medium text-sidebar-muted-foreground">
                {person.name}
              </span>
              {person.threads.map((thread) => (
                <TeamThreadRow
                  key={thread.threadId}
                  thread={thread}
                  onAsk={() => void ask(person, thread)}
                  onCopyTitle={() => copyToClipboard(thread.title, { title: thread.title })}
                />
              ))}
            </div>
          ))
        : null}
    </section>
  );
}

function TeamThreadRow({
  thread,
  onAsk,
  onCopyTitle,
}: {
  thread: AriTeamThread;
  onAsk: () => void;
  onCopyTitle: () => void;
}) {
  const working = thread.state === "working";
  return (
    <Menu>
      <MenuTrigger
        render={
          <button
            type="button"
            className="flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-left text-sm text-sidebar-foreground hover:bg-sidebar-row-hover"
          />
        }
      >
        <span
          role="img"
          aria-label={working ? "Working" : "Idle"}
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            working ? "bg-success" : "bg-sidebar-muted-foreground/40",
          )}
        />
        <span className="min-w-0 flex-1 truncate">{thread.title}</span>
        <span className="shrink-0 text-2xs text-sidebar-muted-foreground">
          {thread.project ? `${thread.project} · ` : null}
          <RelativeTime timestamp={thread.updatedAt} />
        </span>
      </MenuTrigger>
      <MenuPopup align="start">
        {teamThreadActions(thread).map((action) =>
          action === "ask" ? (
            <MenuItem key={action} onClick={onAsk}>
              Ask their agent…
            </MenuItem>
          ) : action === "open-pull-request" ? (
            <MenuItem
              key={action}
              onClick={() => {
                if (thread.pullRequestUrl) {
                  void readLocalApi()?.shell.openExternal(thread.pullRequestUrl);
                }
              }}
            >
              Open pull request
            </MenuItem>
          ) : (
            <MenuItem key={action} onClick={onCopyTitle}>
              Copy title
            </MenuItem>
          ),
        )}
      </MenuPopup>
    </Menu>
  );
}
