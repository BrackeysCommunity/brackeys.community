import { describe, expect, test } from "bun:test";

import {
  CUSTOM_ID_MAX,
  decodeCustomId,
  encodeCustomId,
  ID_BOUNDS,
  type PageState,
  SEARCH_MAX,
  truncateSearch,
} from "./custom-id.ts";

describe("custom ids", () => {
  test("round-trip the jam entries state", () => {
    const state: PageState = {
      kind: "jam_entries",
      jamId: 412345,
      sort: "ratings",
      page: 7,
      search: "cat",
    };
    expect(decodeCustomId(encodeCustomId(state))).toEqual(state);
  });

  test("round-trip the collab browse state, including a search with the separator", () => {
    const state: PageState = {
      kind: "collab_browse",
      type: "paid",
      skillId: 7,
      roleId: 3,
      jamId: 412345,
      page: 2,
      search: "a|b|c",
    };
    expect(decodeCustomId(encodeCustomId(state))).toEqual(state);
  });

  test("omitted collab filters stay omitted", () => {
    const state: PageState = { kind: "collab_browse", page: 0, search: "" };
    expect(decodeCustomId(encodeCustomId(state))).toEqual(state);
  });

  test("the widest legal state fits Discord's 100-character cap", () => {
    // Emoji are two UTF-16 units each; SEARCH_MAX counts units, so this is
    // the longest search the option can hand over.
    const search = "😀".repeat(SEARCH_MAX / 2);
    const widestCollab: PageState = {
      kind: "collab_browse",
      type: "hobby",
      skillId: ID_BOUNDS.skillId,
      roleId: ID_BOUNDS.roleId,
      jamId: ID_BOUNDS.jamId,
      page: ID_BOUNDS.page,
      search,
    };
    const widestJam: PageState = {
      kind: "jam_entries",
      jamId: ID_BOUNDS.jamId,
      sort: "ratings",
      page: ID_BOUNDS.page,
      search,
    };
    for (const state of [widestCollab, widestJam]) {
      const id = encodeCustomId(state);
      expect(id.length).toBeLessThanOrEqual(CUSTOM_ID_MAX);
      expect(decodeCustomId(id)).toEqual(state);
    }
  });

  test("an old version token decodes to null so the adapter can say 'run it again'", () => {
    expect(decodeCustomId("j0|e|1|rank|0|")).toBeNull();
    expect(decodeCustomId("c0|b||||0|")).toBeNull();
    expect(decodeCustomId("")).toBeNull();
    expect(decodeCustomId("something-else")).toBeNull();
  });

  test("malformed fields decode to null instead of garbage", () => {
    expect(decodeCustomId("j1|e|abc|rank|0|")).toBeNull();
    expect(decodeCustomId("j1|e|1|sideways|0|")).toBeNull();
    expect(decodeCustomId("c1|b|z||||0|")).toBeNull();
    expect(decodeCustomId(`c1|b|||${ID_BOUNDS.jamId + 1}||0|`)).toBeNull();
  });

  test("truncateSearch never splits a surrogate pair", () => {
    const s = `${"a".repeat(SEARCH_MAX - 1)}😀`;
    expect(truncateSearch(s)).toBe("a".repeat(SEARCH_MAX - 1));
  });
});
