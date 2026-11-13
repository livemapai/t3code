import { useAtomValue } from "@effect/atom-react";
import {
  type DecisionCard,
  type DecisionCardOptionId,
  type DecisionCardStatus,
  type EnvironmentId,
  type ProjectId,
} from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useThreadRouteTarget } from "../../hooks/useThreadRouteTarget";
import { cn } from "../../lib/utils";
import { decisionCardEnvironment, useDecisionCards } from "../../state/decisionCards";
import { useQuietThreadShell } from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import ChatMarkdown from "../ChatMarkdown";
import { RelativeTime } from "../RelativeTime";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import { Radio, RadioGroup } from "../ui/radio-group";
import { useSidebar } from "../ui/sidebar";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import {
  canSubmitDecisionAnswer,
  DECISION_CARD_STATUS_FILTERS,
  decisionCardErrorMessage,
  hiddenOpenDecisionCardCount,
  openDecisionCardCount,
  visibleDecisionCards,
} from "./decisionCards.logic";

const DECISIONS_EXPANDED_KEY = "t3code:sidebar:decisions-expanded";

/** Cards live in the primary environment; a project of another environment never matches. */
function useActiveProjectId(environmentId: EnvironmentId): ProjectId | null {
  const target = useThreadRouteTarget();
  const threadShell = useQuietThreadShell(target?.kind === "server" ? target.threadRef : null);
  const draftId = target?.kind === "draft" ? target.draftId : null;
  const draft = useComposerDraftStore((store) =>
    draftId === null ? null : (store.getDraftSession(draftId) ?? null),
  );
  const active = threadShell ?? draft;
  return active !== null && active.environmentId === environmentId ? active.projectId : null;
}

export function SidebarDecisionsSection() {
  const environmentId = usePrimaryEnvironmentId();
  if (environmentId === null) return null;
  return <DecisionsSection environmentId={environmentId} />;
}

function DecisionsSection({ environmentId }: { environmentId: EnvironmentId }) {
  const [expanded, setExpanded] = useLocalStorage(DECISIONS_EXPANDED_KEY, true, Schema.Boolean);
  const { data } = useDecisionCards(environmentId);
  const activeProjectId = useActiveProjectId(environmentId);
  const [status, setStatus] = useState<DecisionCardStatus>("open");
  const [showAllProjects, setShowAllProjects] = useState(false);
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const cards = data?.cards ?? [];
  if (cards.length === 0) return null;
  const openCount = openDecisionCardCount(cards);
  const hiddenOpenCount = hiddenOpenDecisionCardCount({ cards, activeProjectId });
  const visible = visibleDecisionCards({ cards, status, activeProjectId, showAllProjects });
  const filtered = activeProjectId !== null && !showAllProjects;
  return (
    <section aria-label="Decisions" className="mx-0.5 mt-2 flex flex-col gap-px">
      <CollapsibleSectionHeader
        expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        accessory={
          openCount > 0 ? (
            <Badge
              variant="warning"
              size="sm"
              aria-label={`${openCount} open ${openCount === 1 ? "decision" : "decisions"}`}
            >
              {openCount}
            </Badge>
          ) : undefined
        }
      >
        Decisions
      </CollapsibleSectionHeader>
      {expanded ? (
        <>
          <div className="flex flex-wrap items-center gap-0.5 px-1 pb-1">
            {DECISION_CARD_STATUS_FILTERS.map((filter) => (
              <Button
                key={filter.status}
                size="xs"
                variant={status === filter.status ? "secondary" : "ghost-muted"}
                aria-pressed={status === filter.status}
                onClick={() => setStatus(filter.status)}
              >
                {filter.label}
              </Button>
            ))}
            {activeProjectId !== null && (showAllProjects || hiddenOpenCount > 0) ? (
              <Button
                size="xs"
                variant="ghost-muted"
                className="ms-auto"
                onClick={() => setShowAllProjects((value) => !value)}
              >
                {showAllProjects
                  ? "This project only"
                  : `Show all projects (${hiddenOpenCount} more open)`}
              </Button>
            ) : null}
          </div>
          {visible.length === 0 ? (
            <p className="px-2.5 py-1.5 text-xs text-sidebar-muted-foreground">
              {filtered ? `No ${status} decisions in this project.` : `No ${status} decisions.`}
            </p>
          ) : (
            visible.map((card) => (
              <DecisionCardRow
                key={card.id}
                environmentId={environmentId}
                card={card}
                expanded={openCardId === card.id}
                onToggle={() => setOpenCardId((id) => (id === card.id ? null : card.id))}
              />
            ))
          )}
        </>
      ) : null}
    </section>
  );
}

function DecisionCardRow({
  environmentId,
  card,
  expanded,
  onToggle,
}: {
  environmentId: EnvironmentId;
  card: DecisionCard;
  expanded: boolean;
  onToggle: () => void;
}) {
  const chosen = card.options.find((option) => option.id === card.chosenOptionId);
  return (
    <div className="flex flex-col rounded-md">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="flex min-h-9 w-full cursor-pointer items-start gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-sidebar-foreground hover:bg-sidebar-row-hover"
      >
        <ChevronRightIcon
          aria-hidden
          className={cn(
            "mt-0.5 size-3.5 shrink-0 text-sidebar-muted-foreground transition-transform",
            expanded && "rotate-90",
          )}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cn("truncate", !expanded && "font-medium")}>{card.title}</span>
          {card.status !== "open" ? (
            <span className="truncate text-2xs text-sidebar-muted-foreground">
              {card.status === "dismissed"
                ? "Dismissed"
                : chosen !== undefined
                  ? `Chose ${chosen.label}`
                  : "Answered with a note"}
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 shrink-0 text-2xs text-sidebar-muted-foreground">
          <RelativeTime timestamp={card.answeredAt ?? card.createdAt} />
        </span>
      </button>
      {expanded ? <DecisionCardDetail environmentId={environmentId} card={card} /> : null}
    </div>
  );
}

function DecisionCardDetail({
  environmentId,
  card,
}: {
  environmentId: EnvironmentId;
  card: DecisionCard;
}) {
  const { setOpenMobile } = useSidebar();
  const canAnswer = useAtomValue(decisionCardEnvironment.answer.permissionAtom(environmentId));
  const canDismiss = useAtomValue(decisionCardEnvironment.dismiss.permissionAtom(environmentId));
  const canReopen = useAtomValue(decisionCardEnvironment.reopen.permissionAtom(environmentId));
  const answer = useAtomCommand(decisionCardEnvironment.answer, "answer decision card");
  const dismiss = useAtomCommand(decisionCardEnvironment.dismiss, "dismiss decision card");
  const reopen = useAtomCommand(decisionCardEnvironment.reopen, "reopen decision card");
  const [chosenOptionId, setChosenOptionId] = useState<DecisionCardOptionId | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (
    action: () => Promise<{ _tag: "Success" } | { _tag: "Failure"; cause: Cause.Cause<unknown> }>,
  ) => {
    setBusy(true);
    const result = await action();
    setBusy(false);
    if (result._tag === "Failure" && !Cause.hasInterruptsOnly(result.cause)) {
      toastManager.add({
        type: "error",
        title: "Could not update the decision",
        description: decisionCardErrorMessage(
          Option.getOrUndefined(Cause.findErrorOption(result.cause)),
        ),
      });
    }
  };
  const trimmedNote = note.trim();

  return (
    <div className="flex flex-col gap-2 px-2.5 pt-0.5 pb-2 ps-8 text-sm">
      {card.context.trim().length > 0 ? (
        <div className="max-h-56 overflow-y-auto text-xs text-sidebar-foreground">
          <ChatMarkdown
            text={card.context}
            cwd={undefined}
            lineBreaks
            parseRawHtml={false}
            headingLevelOffset={3}
          />
        </div>
      ) : null}
      {card.status === "open" ? (
        <>
          <RadioGroup
            aria-label="Options"
            value={chosenOptionId}
            onValueChange={(value) => setChosenOptionId(value as DecisionCardOptionId)}
          >
            {card.options.map((option) => (
              <label
                key={option.id}
                className="flex cursor-pointer items-start gap-2 rounded-md border px-2 py-1.5 text-xs"
              >
                <Radio value={option.id} className="mt-0.5" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex items-center gap-1.5">
                    <span className="min-w-0 font-medium">{option.label}</span>
                    {option.id === card.recommendedOptionId ? (
                      <Badge variant="success" size="sm">
                        Recommended
                      </Badge>
                    ) : null}
                  </span>
                  {option.description ? (
                    <span className="text-sidebar-muted-foreground">{option.description}</span>
                  ) : null}
                </span>
              </label>
            ))}
          </RadioGroup>
          <Textarea
            size="sm"
            rows={2}
            aria-label="Note"
            placeholder="Add a note (optional)"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          {!canAnswer ? (
            <p className="text-2xs text-sidebar-muted-foreground">
              You can't answer decisions on this machine.
            </p>
          ) : null}
        </>
      ) : card.note ? (
        <p className="text-xs whitespace-pre-wrap text-sidebar-foreground">{card.note}</p>
      ) : null}
      <div className="flex items-center gap-1">
        <Button
          size="xs"
          variant="link"
          render={
            <Link
              to="/$environmentId/$threadId"
              params={{ environmentId, threadId: card.threadId }}
            />
          }
          onClick={() => setOpenMobile(false)}
        >
          Open thread
        </Button>
        <span className="flex-1" />
        {card.status === "open" ? (
          <>
            <Button
              size="xs"
              variant="ghost-muted"
              disabled={busy || !canDismiss}
              onClick={() => void run(() => dismiss({ environmentId, input: { cardId: card.id } }))}
            >
              Dismiss
            </Button>
            <Button
              size="xs"
              disabled={busy || !canAnswer || !canSubmitDecisionAnswer({ chosenOptionId, note })}
              onClick={() =>
                void run(() =>
                  answer({
                    environmentId,
                    input: {
                      cardId: card.id,
                      ...(chosenOptionId === null ? {} : { chosenOptionId }),
                      ...(trimmedNote.length === 0 ? {} : { note: trimmedNote }),
                    },
                  }),
                )
              }
            >
              Answer
            </Button>
          </>
        ) : (
          <Button
            size="xs"
            variant="ghost-muted"
            disabled={busy || !canReopen}
            onClick={() => void run(() => reopen({ environmentId, input: { cardId: card.id } }))}
          >
            Reopen
          </Button>
        )}
      </div>
    </div>
  );
}
