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

/** Sidebar order of the flag sections. Unflagged threads come after them. */
const THREAD_FLAG_SECTION_ORDER = [
  "urgent",
  "working",
  "later",
] as const satisfies ReadonlyArray<ThreadFlag>;

/** Section headers. "In progress" because the sidebar's "Working" shelf means an agent is running. */
export const THREAD_FLAG_SECTION_LABELS: Record<ThreadFlag | "none", string> = {
  urgent: "Urgent",
  working: "In progress",
  later: "Later",
  none: "Other",
};

export interface ThreadFlagGroup<T> {
  readonly flag: ThreadFlag | null;
  readonly threads: T[];
}

/**
 * Splits threads into flag sections, in section order, keeping each thread's
 * order within its section. Empty sections are left out.
 */
export function groupThreadsByFlag<T>(
  threads: ReadonlyArray<T>,
  tagsOf: (thread: T) => ReadonlyArray<string> | undefined,
): ThreadFlagGroup<T>[] {
  const byFlag = new Map<ThreadFlag | null, T[]>();
  for (const thread of threads) {
    const flag = threadFlagOf(tagsOf(thread));
    const group = byFlag.get(flag);
    if (group) group.push(thread);
    else byFlag.set(flag, [thread]);
  }
  return [...THREAD_FLAG_SECTION_ORDER, null].flatMap((flag) => {
    const group = byFlag.get(flag);
    return group ? [{ flag, threads: group }] : [];
  });
}
