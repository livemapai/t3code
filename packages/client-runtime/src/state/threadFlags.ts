/** A thread carries at most one flag, stored as a `flag:<name>` thread tag. */
export const THREAD_FLAGS = ["urgent", "later", "working"] as const;
export type ThreadFlag = (typeof THREAD_FLAGS)[number];

export const THREAD_FLAG_LABELS: Record<ThreadFlag, string> = {
  urgent: "Urgent",
  later: "Later",
  working: "Working on it",
};

export const threadFlagTag = (flag: ThreadFlag): string => `flag:${flag}`;

export function threadFlagOf(tags: ReadonlyArray<string> | undefined): ThreadFlag | null {
  if (tags === undefined) return null;
  return THREAD_FLAGS.find((flag) => tags.includes(threadFlagTag(flag))) ?? null;
}

/** A sidebar filter on flags: one flag, or `any` for every flagged thread. */
export type ThreadFlagFilter = ThreadFlag | "any";

export function matchesThreadFlagFilter(
  tags: ReadonlyArray<string> | undefined,
  filter: ThreadFlagFilter | null,
): boolean {
  if (filter === null) return true;
  const flag = threadFlagOf(tags);
  return filter === "any" ? flag !== null : flag === filter;
}
