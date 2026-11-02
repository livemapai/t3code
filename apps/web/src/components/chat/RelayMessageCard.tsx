import { ArrowDownUpIcon } from "lucide-react";
import { use } from "react";
import ChatMarkdown from "../ChatMarkdown";
import type { RelayMessage } from "./relayMessage";
import { TimelineRowCtx, type TimelineRow } from "./timelineRowContext";
import {
  MESSAGE_HEADING_LEVEL,
  MessageAuthorHeading,
  TimelineRowTimestamp,
} from "./TimelineRowParts";

/** A teammate's message that `ari relay` delivered, shown as theirs instead of as an agent's prompt. */
export function RelayMessageCard({
  row,
  relay,
}: {
  row: Extract<TimelineRow, { kind: "message" }>;
  relay: RelayMessage;
}) {
  const ctx = use(TimelineRowCtx);
  const sender = relay.self ? "Your other thread" : relay.from;
  const initials = relay.from
    .split(/\s+/)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <div className="flex flex-col items-start" data-user-message-attribution="relay">
      <article className="w-full min-w-0 max-w-[88%] overflow-hidden rounded-2xl border bg-card text-card-foreground">
        <MessageAuthorHeading>{`${sender} via relay`}</MessageAuthorHeading>
        <header className="flex items-center gap-2.5 border-b px-3 py-2.5">
          <span
            aria-hidden
            className="grid size-7 shrink-0 place-items-center rounded-full bg-(--stage-livemap-sun) font-semibold text-(--stage-livemap-bottom) text-2xs"
          >
            {initials}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">
              <span className="font-medium">{sender}</span>{" "}
              <span className="text-muted-foreground">
                {relay.kind === "answer" ? "answered" : "asked"}
              </span>
            </p>
            <p className="flex items-center gap-1 text-muted-foreground text-xs">
              via relay ·
              <TimelineRowTimestamp
                createdAt={row.message.createdAt}
                timestampFormat={ctx.timestampFormat}
                className="me-0"
                alwaysVisible
              />
            </p>
          </div>
          <ArrowDownUpIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        </header>
        <div className="px-3 py-3" data-thread-find-text="true">
          <ChatMarkdown
            text={relay.body}
            cwd={ctx.markdownCwd}
            threadRef={ctx.threadRef ?? undefined}
            skills={ctx.skills}
            className="text-foreground"
            lineBreaks
            parseRawHtml={false}
            headingLevelOffset={MESSAGE_HEADING_LEVEL}
          />
        </div>
        <footer className="flex items-center gap-3 border-t px-3 py-2 text-muted-foreground text-xs">
          <code className="font-mono">{relay.id.slice(0, 8)}</code>
          {relay.conversationUrl ? (
            <a
              href={relay.conversationUrl}
              target="_blank"
              rel="noreferrer"
              className="ms-auto text-foreground hover:underline"
            >
              Open conversation →
            </a>
          ) : null}
        </footer>
      </article>
    </div>
  );
}
