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

export type TeamThreadAction = "ask" | "take-over" | "open-pull-request" | "copy-title";

/** Links come from teammates' machines, so only web links open. */
export function teamThreadActions(thread: AriTeamThread): ReadonlyArray<TeamThreadAction> {
  return [
    "ask",
    "take-over",
    ...(thread.pullRequestUrl?.startsWith("https://") ? (["open-pull-request"] as const) : []),
    "copy-title",
  ];
}

/** The person finishes the question; nothing is sent until they do. */
export function askTeammatePrompt(person: AriTeamPerson, thread: AriTeamThread): string {
  return `Ask ${person.name} (${person.handle}) through ari relay about their thread "${thread.title}": `;
}

/** Asks the teammate to hand the thread over; they decide, and its handoff waits for approval. */
export function takeOverPrompt(person: AriTeamPerson, thread: AriTeamThread): string {
  return `Ask ${person.name} (${person.handle}) through ari relay to hand over their thread "${thread.title}" to me: `;
}

const HAND_OVER_PROMPT = "Hand this thread over through ari relay to ";

/** The person names the teammate and sends it; a draft already there is kept above it, once. */
export function handOverDraft(existing: string): string {
  const prefix = HAND_OVER_PROMPT.trimEnd();
  if (existing.split("\n").some((line) => line.trimStart().startsWith(prefix))) return existing;
  const kept = existing.trimEnd();
  return kept ? `${kept}\n\n${HAND_OVER_PROMPT}` : HAND_OVER_PROMPT;
}
