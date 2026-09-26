import { describe, expect, it } from "vite-plus/test";

import {
  describeLogEntry,
  showValue,
  type LogAction,
  type LogRefs,
} from "@/components/admin/log-entry";

const person = (id: string, displayName: string) => ({
  id,
  displayName,
  avatarUrl: null,
  urlStub: null,
});

const emptyRefs: LogRefs = {
  comments: {},
  collabPosts: {},
  forumPosts: {},
  teams: {},
  proposals: {},
  people: {},
};

function row(overrides: Partial<LogAction>): LogAction {
  return {
    id: 1,
    action: "team_hidden",
    actorId: "mod",
    actorName: "Mod",
    subjectUserId: null,
    targetType: "team",
    targetId: null,
    reason: null,
    metadata: {},
    createdAt: new Date("2026-09-20T12:00:00Z"),
    actor: null,
    subject: null,
    ...overrides,
  };
}

describe("describeLogEntry", () => {
  it("links a removed comment to where it was said and quotes its live text", () => {
    const detail = describeLogEntry(
      row({
        action: "comment_removed",
        targetType: "comment",
        targetId: "62",
        metadata: { preview: "old" },
      }),
      {
        ...emptyRefs,
        comments: {
          62: {
            id: 62,
            content: "the full comment",
            authorId: "a",
            deletedAt: null,
            subjectType: "forum_post",
            collabPostId: null,
            forumPostId: 9,
            profileUserId: null,
            responsePostId: null,
            postTitle: "Devlog #3",
          },
        },
      },
    );
    expect(detail.target).toEqual({
      kind: "forum",
      postId: "9",
      hash: "comment-62",
      label: "on “Devlog #3”",
    });
    expect(detail.quote).toEqual({ label: "Comment", text: "the full comment" });
  });

  it("falls back to the metadata preview when the comment row is gone", () => {
    const detail = describeLogEntry(
      row({
        action: "comment_restored",
        targetType: "comment",
        targetId: "7",
        metadata: { preview: "was a test" },
      }),
      emptyRefs,
    );
    expect(detail.target).toEqual({ kind: "text", label: "Comment 7 (deleted)" });
    expect(detail.quote?.text).toBe("was a test");
  });

  it("shows a skill approval as requested → granted when staff renamed it", () => {
    const detail = describeLogEntry(
      row({
        action: "skill_request_approved",
        targetType: "skill_request",
        metadata: { requestedName: "unity3d", grantedName: "Unity", renamed: true },
      }),
      emptyRefs,
    );
    expect(detail.facts).toEqual([{ label: "Skill", from: "unity3d", to: "Unity" }]);
  });

  it("diffs profile edits field by field, and degrades to the old value on legacy rows", () => {
    const withNext = describeLogEntry(
      row({
        action: "profile_updated",
        targetType: "user",
        metadata: { fields: ["bio"], previous: { bio: "rude" }, next: { bio: null } },
      }),
      emptyRefs,
    );
    expect(withNext.facts).toEqual([{ label: "Bio", from: "rude", to: "(empty)" }]);

    const legacy = describeLogEntry(
      row({
        action: "profile_updated",
        targetType: "user",
        metadata: { fields: ["websiteUrl"], previous: { websiteUrl: "https://x.test" } },
      }),
      emptyRefs,
    );
    expect(legacy.facts).toEqual([{ label: "Website was", value: "https://x.test" }]);
  });

  it("names both sides of an ownership transfer and marks a deleted team", () => {
    const detail = describeLogEntry(
      row({
        action: "team_ownership_transferred",
        targetId: "t1",
        metadata: { teamName: "Pixel Pals", from: "a", to: "b" },
      }),
      { ...emptyRefs, people: { a: person("a", "Ann"), b: person("b", "Bo") } },
    );
    expect(detail.target).toEqual({ kind: "text", label: "Pixel Pals (deleted)" });
    expect(detail.facts.map((f) => ("person" in f ? f.person?.displayName : null))).toEqual([
      "Ann",
      "Bo",
    ]);
  });

  it("carries the report context on a dismissal", () => {
    const detail = describeLogEntry(
      row({
        action: "forum_post_report_dismissed",
        targetType: "forum_post_report",
        targetId: "4",
        metadata: { postId: 12, reportReason: "spam", alsoResolved: [5, 6] },
      }),
      { ...emptyRefs, forumPosts: { 12: "Show & tell" } },
    );
    expect(detail.target).toEqual({ kind: "forum", postId: "12", label: "Show & tell" });
    expect(detail.facts).toEqual([
      { label: "Report said", value: "spam" },
      { label: "Also resolved", value: "2 duplicate reports" },
    ]);
  });
});

describe("showValue", () => {
  it("reads empties, booleans and lists the way a moderator would", () => {
    expect(showValue(null)).toBe("(empty)");
    expect(showValue("")).toBe("(empty)");
    expect(showValue(true)).toBe("yes");
    expect(showValue(["a", "b"])).toBe("a, b");
    expect(showValue([])).toBe("(none)");
  });
});
