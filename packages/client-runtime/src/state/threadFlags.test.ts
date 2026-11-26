import { describe, expect, it } from "vite-plus/test";

import { groupThreadsByFlag, matchesThreadFlagFilter } from "./threadFlags.ts";

describe("matchesThreadFlagFilter", () => {
  it.each([
    [["flag:urgent"], null, true],
    [[], null, true],
    [["flag:urgent"], "urgent", true],
    [["flag:later"], "urgent", false],
    [[], "urgent", false],
    [["flag:later", "other"], "any", true],
    [["other"], "any", false],
    [undefined, "any", false],
  ] as const)("tags %j with filter %s -> %s", (tags, filter, expected) => {
    expect(matchesThreadFlagFilter(tags, filter)).toBe(expected);
  });
});

describe("groupThreadsByFlag", () => {
  it("orders sections urgent, working, later, unflagged and keeps order within each", () => {
    const threads = [
      { id: "a", tags: ["flag:later"] },
      { id: "b", tags: [] },
      { id: "c", tags: ["flag:urgent"] },
      { id: "d", tags: ["flag:later", "other"] },
      { id: "e", tags: undefined },
      { id: "f", tags: ["flag:working"] },
    ];
    const groups = groupThreadsByFlag(threads, (thread) => thread.tags);
    expect(groups.map((group) => [group.flag, group.threads.map((thread) => thread.id)])).toEqual([
      ["urgent", ["c"]],
      ["working", ["f"]],
      ["later", ["a", "d"]],
      [null, ["b", "e"]],
    ]);
  });

  it("leaves out empty sections", () => {
    const groups = groupThreadsByFlag([{ tags: [] }], (thread) => thread.tags);
    expect(groups.map((group) => group.flag)).toEqual([null]);
  });
});
