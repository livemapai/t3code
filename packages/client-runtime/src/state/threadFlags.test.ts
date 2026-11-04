import { describe, expect, it } from "vite-plus/test";

import { matchesThreadFlagFilter } from "./threadFlags.ts";

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
