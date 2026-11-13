import type { DecisionCard } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  canSubmitDecisionAnswer,
  decisionCardErrorMessage,
  hiddenDecisionCardCount,
  openDecisionCardCount,
  visibleDecisionCards,
} from "./decisionCards.logic";

const card = (id: string, projectId: string, status: DecisionCard["status"]) =>
  ({ id, projectId, status }) as unknown as DecisionCard;

const cards = [
  card("a", "p1", "open"),
  card("b", "p2", "open"),
  card("c", "p1", "answered"),
  card("d", "p2", "dismissed"),
];
const p1 = "p1" as DecisionCard["projectId"];

describe("decision card filtering", () => {
  it("counts open cards of every project, whatever the filter", () => {
    expect(openDecisionCardCount(cards)).toBe(2);
  });

  it("counts what the project filter hides for the selected status", () => {
    const hidden = (status: DecisionCard["status"], activeProjectId: typeof p1 | null) =>
      hiddenDecisionCardCount({ cards, status, activeProjectId });
    expect(hidden("open", p1)).toBe(1);
    // Project 2 has no open cards here, yet its dismissed one is still hidden.
    expect(hidden("dismissed", p1)).toBe(1);
    expect(hidden("answered", p1)).toBe(0);
    expect(hidden("open", null)).toBe(0);
  });

  it("filters to the active project unless all projects are shown", () => {
    const ids = (showAllProjects: boolean, status: DecisionCard["status"]) =>
      visibleDecisionCards({ cards, status, activeProjectId: p1, showAllProjects }).map(
        (c) => c.id,
      );
    expect(ids(false, "open")).toEqual(["a"]);
    expect(ids(true, "open")).toEqual(["a", "b"]);
    expect(ids(false, "dismissed")).toEqual([]);
    expect(
      visibleDecisionCards({ cards, status: "open", activeProjectId: null, showAllProjects: false })
        .length,
    ).toBe(2);
  });
});

describe("decision card answers", () => {
  it("needs a pick or a non-blank note", () => {
    const option = "opt" as never;
    expect(canSubmitDecisionAnswer({ chosenOptionId: null, note: "  " })).toBe(false);
    expect(canSubmitDecisionAnswer({ chosenOptionId: option, note: "" })).toBe(true);
    expect(canSubmitDecisionAnswer({ chosenOptionId: null, note: "go" })).toBe(true);
  });

  it("explains each failure in plain words", () => {
    expect(
      decisionCardErrorMessage({ _tag: "DecisionCardError", reason: "thread_closed" }),
    ).toMatch(/archived or deleted/);
    expect(decisionCardErrorMessage({ _tag: "DecisionCardError", reason: "not_open" })).toMatch(
      /already answered/,
    );
    expect(decisionCardErrorMessage({ _tag: "EnvironmentAuthorizationError" })).toMatch(
      /permission/,
    );
    expect(decisionCardErrorMessage(new Error("boom"))).toBe("Something went wrong. Try again.");
  });
});
