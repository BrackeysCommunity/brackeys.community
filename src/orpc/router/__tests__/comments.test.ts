import { describe, expect, it } from "vite-plus/test";

import router from "@/orpc/router";
import { deriveChildPlacement, serializeComments } from "@/orpc/router/comments";

describe("comments router surface", () => {
  it("registers the comment procedures", () => {
    expect(router.listComments).toBeDefined();
    expect(router.listReplies).toBeDefined();
    expect(router.createComment).toBeDefined();
    expect(router.editComment).toBeDefined();
    expect(router.deleteComment).toBeDefined();
    expect(router.reportComment).toBeDefined();
    expect(router.setThreadSubscription).toBeDefined();
    expect(router.lockThread).toBeDefined();
    expect(router.listCommentReports).toBeDefined();
    expect(router.resolveCommentReport).toBeDefined();
    expect(router.blockUser).toBeDefined();
    expect(router.unblockUser).toBeDefined();
    expect(router.listBlockedUsers).toBeDefined();
  });
});

describe("deriveChildPlacement", () => {
  it("places a top-level comment at depth 0 with no root", () => {
    expect(deriveChildPlacement(null)).toEqual({ parentId: null, rootId: null, depth: 0 });
  });

  it("roots a first reply at its parent", () => {
    expect(deriveChildPlacement({ id: 7, rootId: null, depth: 0 })).toEqual({
      parentId: 7,
      rootId: 7,
      depth: 1,
    });
  });

  it("inherits the chain root for nested replies", () => {
    expect(deriveChildPlacement({ id: 12, rootId: 7, depth: 3 })).toEqual({
      parentId: 12,
      rootId: 7,
      depth: 4,
    });
  });

  it("caps depth at 8 instead of erroring", () => {
    expect(deriveChildPlacement({ id: 20, rootId: 7, depth: 8 })).toEqual({
      parentId: 20,
      rootId: 7,
      depth: 8,
    });
  });
});

// ── Serialization contract ───────────────────────────────────────────────────

const AUTHOR = { id: "u1", name: "Mika", avatarUrl: null, urlStub: "mika" };

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    threadId: 1,
    parentId: null,
    rootId: null,
    depth: 0,
    authorId: "u1",
    content: "hello",
    replyCount: 0,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    editedAt: null,
    deletedAt: null,
    deletedById: null,
    ...overrides,
  } as Parameters<typeof serializeComments>[0][number];
}

function serializeOne(
  r: ReturnType<typeof row>,
  opts: Partial<Parameters<typeof serializeComments>[1]> = {},
) {
  const [out] = serializeComments([r], {
    authors: new Map([["u1", AUTHOR]]),
    blocked: new Set(),
    viewerId: null,
    isStaff: false,
    subjectOwnerId: "owner",
    ...opts,
  });
  return out!;
}

describe("serializeComments render contract", () => {
  it("ships content and author for a live comment", () => {
    const out = serializeOne(row());
    expect(out.content).toBe("hello");
    expect(out.author).toEqual(AUTHOR);
    expect(out.tombstone).toBeNull();
    expect(out.hidden).toBe(false);
  });

  it("never ships content on author-deleted tombstones", () => {
    const out = serializeOne(row({ deletedAt: new Date(), deletedById: "u1" }));
    expect(out.content).toBeNull();
    expect(out.tombstone).toBe("author");
  });

  it("marks staff/owner removals as moderator tombstones", () => {
    const out = serializeOne(row({ deletedAt: new Date(), deletedById: "staff-1" }));
    expect(out.content).toBeNull();
    expect(out.tombstone).toBe("moderator");
  });

  it('renders account-deleted authors as null author ("Deleted User")', () => {
    const out = serializeOne(row({ authorId: null, content: "", deletedAt: new Date() }));
    expect(out.author).toBeNull();
    expect(out.content).toBeNull();
  });

  it("nulls both content and author on rows the viewer blocked", () => {
    const out = serializeOne(row(), { blocked: new Set(["u1"]), viewerId: "v1" });
    expect(out.hidden).toBe(true);
    expect(out.content).toBeNull();
    expect(out.author).toBeNull();
  });

  it("does not hide the viewer's own comments via someone else's semantics", () => {
    const out = serializeOne(row(), { viewerId: "u1" });
    expect(out.viewer.isMine).toBe(true);
    expect(out.viewer.canEdit).toBe(true);
    expect(out.viewer.canDelete).toBe(true);
  });

  it("grants delete to the subject owner and staff but not strangers", () => {
    expect(serializeOne(row(), { viewerId: "owner" }).viewer.canDelete).toBe(true);
    expect(serializeOne(row(), { viewerId: "v1", isStaff: true }).viewer.canDelete).toBe(true);
    expect(serializeOne(row(), { viewerId: "v1" }).viewer.canDelete).toBe(false);
  });

  it("revokes edit on tombstoned rows even for the author", () => {
    const out = serializeOne(row({ deletedAt: new Date(), deletedById: "u1" }), {
      viewerId: "u1",
    });
    expect(out.viewer.canEdit).toBe(false);
    expect(out.viewer.canDelete).toBe(false);
  });

  it("flags truncated chains with hasMoreReplies", () => {
    const out = serializeOne(row(), { truncatedRoots: new Set([1]) });
    expect(out.hasMoreReplies).toBe(true);
  });
});
