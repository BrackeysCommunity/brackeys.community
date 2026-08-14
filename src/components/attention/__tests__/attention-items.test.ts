import { describe, expect, it } from "vite-plus/test";

import {
  attentionCount,
  inviteAttentionKey,
  pendingInvites,
  postsAwaitingTriage,
  triageAttentionKey,
  visibleAttention,
  type AttentionPost,
} from "@/components/attention/attention-items";

function invite(id: number, status = "pending") {
  return { id, status };
}

function post(id: number, pendingResponseCount: number): AttentionPost & { id: number } {
  return { id, pendingResponseCount };
}

const NONE: ReadonlySet<string> = new Set();

describe("what counts as attention", () => {
  it("counts only invites still awaiting an answer", () => {
    const invites = [invite(1), invite(2, "accepted"), invite(3, "declined")];
    expect(pendingInvites(invites)).toHaveLength(1);
    expect(attentionCount(invites, [])).toBe(1);
  });

  it("counts every waiting applicant, not every post that has one", () => {
    const posts = [post(1, 3), post(2, 2), post(3, 0)];
    expect(postsAwaitingTriage(posts)).toHaveLength(2);
    expect(attentionCount([], posts)).toBe(5);
  });

  it("is zero when nothing is outstanding", () => {
    expect(attentionCount([invite(1, "accepted")], [post(1, 0)])).toBe(0);
  });
});

describe("dismissal keys", () => {
  it("versions a triage key by its pending count", () => {
    expect(triageAttentionKey(post(12, 3))).toBe("post:12:3");
    expect(triageAttentionKey(post(12, 4))).toBe("post:12:4");
  });

  it("keys an invite by identity alone — its content never changes", () => {
    expect(inviteAttentionKey(invite(7))).toBe("invite:7");
  });
});

describe("visibleAttention", () => {
  it("hides what was dismissed and reports how much", () => {
    const invites = [invite(1), invite(2)];
    const posts = [post(10, 2), post(11, 1)];
    const dismissed = new Set([inviteAttentionKey(invite(1)), triageAttentionKey(post(11, 1))]);

    const visible = visibleAttention(invites, posts, dismissed);
    expect(visible.invites.map((i) => i.id)).toEqual([2]);
    expect(visible.posts.map((p) => p.id)).toEqual([10]);
    expect(visible.hiddenCount).toBe(2);
  });

  // The failure this whole design exists to prevent: a dismissal made before
  // someone applied must never swallow them.
  it("brings a triage row back when another applicant lands", () => {
    const dismissed = new Set([triageAttentionKey(post(10, 2))]);
    expect(visibleAttention([], [post(10, 2)], dismissed).posts).toHaveLength(0);
    expect(visibleAttention([], [post(10, 3)], dismissed).posts).toHaveLength(1);
  });

  it("never counts an already-resolved item as hidden", () => {
    const dismissed = new Set([inviteAttentionKey(invite(1))]);
    const visible = visibleAttention([invite(1, "accepted")], [post(10, 0)], dismissed);
    expect(visible.hiddenCount).toBe(0);
  });

  it("passes everything through when nothing is dismissed", () => {
    const visible = visibleAttention([invite(1)], [post(10, 2)], NONE);
    expect(visible.invites).toHaveLength(1);
    expect(visible.posts).toHaveLength(1);
    expect(visible.hiddenCount).toBe(0);
  });
});
