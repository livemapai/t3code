import { ariMessageMarker } from "@t3tools/contracts";
export interface RelayMessage {
  readonly kind: "question" | "answer" | "handoff";
  /** The teammate who sent it, or this person's own name for a message from another of their threads. */
  readonly from: string;
  readonly self: boolean;
  readonly id: string;
  /** The teammate's own words, without the rules ari puts around them for the agent. */
  readonly body: string;
  readonly conversationUrl: string | null;
  /** The sender's thread shared with it; the agent reads the transcript with `ari relay context`. */
  readonly sharedThread: { readonly title: string; readonly characters: number } | null;
  /** Only on a handoff, and only when its footer says where the work lives. */
  readonly handoff: RelayHandoff | null;
}

export interface RelayHandoff {
  readonly repository: string;
  readonly branch: string;
  readonly commit: string;
  readonly pullRequestUrl: string | null;
  /** Where the listener started this thread, from the line it appends last; null when that line is missing. */
  readonly workspace:
    | { readonly kind: "worktree"; readonly project: string }
    | { readonly kind: "not-on-branch" }
    | null;
}

const KINDS = { QUESTION: "question", ANSWER: "answer", HANDOFF: "handoff" } as const;
// Real header and footer lines are short; longer ones are not read, which keeps parsing linear.
const MAX_LINE = 1_000;

/**
 * Matches ari's `deliveryOf` (livemapai/frontend packages/cli/src/commands/relay/inbox.ts). The id
 * is set after sending, so the message cannot contain its own closing line. Footer lines are read
 * leniently with string operations: one that is missing or odd yields nothing.
 */
export function parseRelayMessage(text: string): RelayMessage | null {
  const lines = text.split(/\r?\n/);
  const header = readHeader(lines[0] ?? "");
  if (!header) return null;
  const { kind } = header;
  const start = lines.findIndex((line) => line.startsWith(`--- ${kind} `) && line.endsWith(" ---"));
  const id = lines[start]?.split(" ")[2];
  if (id === undefined) return null;
  const end = lines.indexOf(`--- end of ${kind} ${id} ---`, start + 1);
  if (end === -1) return null;
  const footer = lines.slice(end + 1).filter((line) => line.length <= MAX_LINE);
  const conversation = footer.findIndex((line) => line.startsWith("Conversation: "));
  // Fields come right after the Conversation line in a fixed order; later look-alikes can only
  // come from text quoted into the footer, such as an attachment's title.
  const fields = conversation === -1 ? [] : footer.slice(conversation + 1);
  const first = (prefix: string) => fields.find((line) => line.startsWith(prefix));
  return {
    kind,
    from: header.from,
    self: header.self,
    id,
    body: lines.slice(start + 1, end).join("\n"),
    conversationUrl: webUrl(footer[conversation]?.slice("Conversation: ".length)),
    sharedThread: readSharedThread(first('Shared thread "')),
    handoff:
      kind === "handoff"
        ? readHandoff(
            first("Repository "),
            first("Pull request: "),
            lines.findLast((line) => line.trim() !== ""),
          )
        : null,
  };
}

function readHeader(
  line: string,
): { kind: RelayMessage["kind"]; from: string; self: boolean } | null {
  if (line.length > MAX_LINE || !line.startsWith("RELAY ")) return null;
  const word = line.slice("RELAY ".length, line.indexOf(" from "));
  const kind = Object.hasOwn(KINDS, word) ? KINDS[word as keyof typeof KINDS] : null;
  if (kind === null) return null;
  const rest = line.slice(`RELAY ${word} from `.length);
  const own = "another thread of yours (";
  if (rest.startsWith(own) && rest.endsWith(").") && rest.length > own.length + 2) {
    return { kind, from: rest.slice(own.length, -2), self: true };
  }
  const not = rest.indexOf(". Not from ");
  if (not < 1 || rest.length === not + ". Not from ".length) return null;
  return { kind, from: rest.slice(0, not), self: false };
}

/** `Shared thread "<title>" (<n> characters) from <name>: `<ari> relay context <id>` prints it.` */
function readSharedThread(line: string | undefined): RelayMessage["sharedThread"] {
  if (line === undefined) return null;
  const close = line.indexOf('"', 'Shared thread "'.length);
  if (close === -1) return null;
  const size = /^" \((\d{1,9}) characters\) from /.exec(line.slice(close));
  const tail = size ? line.slice(close + size[0].length) : "";
  if (!size || !tail.includes(" relay context ") || !tail.endsWith("` prints it.")) return null;
  return { title: line.slice('Shared thread "'.length, close), characters: Number(size[1]) };
}

function readHandoff(
  repositoryLine: string | undefined,
  pullRequestLine: string | undefined,
  lastLine: string | undefined,
): RelayHandoff | null {
  // Repository <host/owner/name>, branch <branch>, commit <sha>.
  if (repositoryLine === undefined || !repositoryLine.endsWith(".")) return null;
  const branchAt = repositoryLine.indexOf(", branch ");
  const commitAt = repositoryLine.lastIndexOf(", commit ");
  if (branchAt === -1 || commitAt <= branchAt + ", branch ".length) return null;
  const repository = repositoryLine.slice("Repository ".length, branchAt);
  const commit = repositoryLine.slice(commitAt + ", commit ".length, -1);
  if (!/^\S+$/.test(repository) || !/^[0-9a-f]{7,64}$/.test(commit)) return null;
  return {
    repository,
    branch: repositoryLine.slice(branchAt + ", branch ".length, commitAt),
    commit,
    pullRequestUrl: webUrl(pullRequestLine?.slice("Pull request: ".length)),
    workspace: lastLine === undefined ? null : readWorkspace(lastLine),
  };
}

/** The line the listener appends last (livemapai/frontend packages/cli/src/commands/relay/listen.ts). */
function readWorkspace(line: string): RelayHandoff["workspace"] {
  if (line.length > MAX_LINE) return null;
  const worktree = "This thread works in a new worktree of T3 Code project ";
  const from = line.lastIndexOf(", from ");
  if (line.startsWith(worktree) && line.endsWith(".") && from > worktree.length) {
    return { kind: "worktree", project: line.slice(worktree.length, from) };
  }
  const missing =
    (line.startsWith("No local checkout of ") && line.includes(" was found among ")) ||
    (line.startsWith("Branch ") && line.includes(" could not be checked out in T3 Code project "));
  return missing && line.includes(", so this thread is not on ") ? { kind: "not-on-branch" } : null;
}

function webUrl(value: string | undefined): string | null {
  if (value === undefined) return null;
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:" ? value : null;
  } catch {
    return null;
  }
}

// Plain message text is forgeable; this marker grants no authority.
export function parseAriProvenance(text: string): { from: string; trackerNotice: boolean } | null {
  const marker = ariMessageMarker(text);
  if (!marker) return null;
  const body = parseRelayMessage(text)?.body ?? text;
  return { from: marker.from, trackerNotice: body.split(/\r?\n/, 1)[0] === "Kind: tracker-notice" };
}
