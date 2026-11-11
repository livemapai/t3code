import type { AriTeam, AriTeamPerson, AriTeamThread } from "@t3tools/contracts";

/** Teammates with listed threads, by name, each thread newest first; the viewer's own are left out. */
export function teamSectionPeople(team: AriTeam | null): ReadonlyArray<AriTeamPerson> {
  if (team === null || team.state !== "ok") return [];
  return team.people
    .filter((person) => !person.self && person.threads.length > 0)
    .map((person) => ({
      ...person,
      threads: person.threads.toSorted(
        (a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0),
      ),
    }))
    .toSorted((a, b) => a.name.localeCompare(b.name));
}

export type TeamThreadAction = "ask" | "open-pull-request" | "copy-title";

/** Links come from teammates' machines, so only web links open. */
export function teamThreadActions(thread: AriTeamThread): ReadonlyArray<TeamThreadAction> {
  return [
    "ask",
    ...(thread.pullRequestUrl?.startsWith("https://") ? (["open-pull-request"] as const) : []),
    "copy-title",
  ];
}

/** The person finishes the question; nothing is sent until they do. */
export function askTeammatePrompt(person: AriTeamPerson, thread: AriTeamThread): string {
  return `Ask ${person.name} (${person.handle}) through ari relay about their thread "${thread.title}": `;
}
