export interface RelayMessage {
  readonly kind: "question" | "answer";
  /** The teammate who sent it, or this person's own name for a message from another of their threads. */
  readonly from: string;
  readonly self: boolean;
  readonly id: string;
  /** The teammate's own words, without the rules ari puts around them for the agent. */
  readonly body: string;
  readonly conversationUrl: string | null;
}

const HEADER =
  /^RELAY (QUESTION|ANSWER) from (?:another thread of yours \((.+)\)\.|(.+?)\. Not from .+)$/;

/**
 * The words `ari relay` hands a thread (livemapai/frontend, packages/cli/src/commands/relay/inbox.ts
 * `deliveryOf`): a header line, rules, the message between `--- question <id> ---` and
 * `--- end of question <id> ---`, then a footer with a `Conversation:` link. The id is set after
 * sending, so the message itself cannot contain its own closing line.
 */
export function parseRelayMessage(text: string): RelayMessage | null {
  const lines = text.split(/\r?\n/);
  const header = HEADER.exec(lines[0] ?? "");
  if (!header) return null;
  const kind = header[1] === "ANSWER" ? "answer" : "question";
  const start = lines.findIndex((line) => line.startsWith(`--- ${kind} `) && line.endsWith(" ---"));
  const id = lines[start]?.split(" ")[2];
  if (id === undefined) return null;
  const end = lines.indexOf(`--- end of ${kind} ${id} ---`, start + 1);
  if (end === -1) return null;
  const link = lines
    .slice(end + 1)
    .find((line) => line.startsWith("Conversation: "))
    ?.slice("Conversation: ".length);
  return {
    kind,
    from: header[2] ?? header[3] ?? "",
    self: header[2] !== undefined,
    id,
    body: lines.slice(start + 1, end).join("\n"),
    conversationUrl: link !== undefined && isWebUrl(link) ? link : null,
  };
}

function isWebUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}
