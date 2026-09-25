import { describe, expect, it } from "vite-plus/test";

import { addedMentions, extractMentions, MAX_MENTIONS } from "@/lib/forum-mentions";

describe("extractMentions", () => {
  it("finds handles at the start, mid-sentence and before punctuation", () => {
    expect(extractMentions("@alice thanks, and @Bob_2! also (@carol-d)")).toEqual([
      "alice",
      "bob_2",
      "carol-d",
    ]);
  });

  it("ignores emails, paths, code and too-short handles", () => {
    expect(
      extractMentions("mail me@example.com, see /u/@dave, `@erin` ```\n@frank\n``` and @g"),
    ).toEqual([]);
  });

  it("dedupes and caps", () => {
    const many = Array.from({ length: 15 }, (_, i) => `@user${i}`).join(" ");
    expect(extractMentions(`@alice @ALICE ${many}`)).toHaveLength(MAX_MENTIONS);
    expect(extractMentions("@alice @ALICE")).toEqual(["alice"]);
  });
});

describe("addedMentions", () => {
  it("returns only handles the edit introduced", () => {
    expect(addedMentions("hi @alice", "hi @alice and @bob")).toEqual(["bob"]);
    expect(addedMentions(null, "@alice")).toEqual(["alice"]);
  });
});
