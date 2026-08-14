import { describe, expect, it } from "vite-plus/test";

import {
  attentionCount,
  isExpiringSoon,
  pendingInvites,
  postsAwaitingTriage,
  selectJamDeadlines,
  type DashboardJamRef,
  type DashboardPost,
} from "@/components/home/dashboard/dashboard-derive";
import { DAY_MS, EXPIRY_NUDGE_DAYS } from "@/lib/collab-lifecycle";

const NOW = new Date("2026-08-14T12:00:00Z");

function post(overrides: Partial<DashboardPost> = {}): DashboardPost {
  return {
    id: 1,
    status: "recruiting",
    expiresAt: new Date(NOW.getTime() + 30 * DAY_MS),
    pendingResponseCount: 0,
    jam: null,
    ...overrides,
  };
}

function jam(jamId: number, startDays: number, endDays: number): DashboardJamRef {
  return {
    jamId,
    title: `Jam ${jamId}`,
    slug: `jam-${jamId}`,
    startsAt: new Date(NOW.getTime() + startDays * DAY_MS),
    endsAt: new Date(NOW.getTime() + endDays * DAY_MS),
  };
}

describe("attention items", () => {
  it("counts only invites still awaiting an answer", () => {
    const invites = [
      { id: 1, status: "pending" },
      { id: 2, status: "accepted" },
      { id: 3, status: "declined" },
    ];
    expect(pendingInvites(invites)).toHaveLength(1);
    expect(attentionCount(invites, [])).toBe(1);
  });

  it("adds every waiting applicant, not every post that has one", () => {
    const posts = [
      post({ id: 1, pendingResponseCount: 3 }),
      post({ id: 2, pendingResponseCount: 2 }),
      post({ id: 3, pendingResponseCount: 0 }),
    ];
    expect(postsAwaitingTriage(posts)).toHaveLength(2);
    expect(attentionCount([], posts)).toBe(5);
  });

  it("is zero when nothing is outstanding", () => {
    expect(attentionCount([{ id: 1, status: "accepted" }], [post()])).toBe(0);
  });
});

describe("expiry nudge window", () => {
  it("offers EXTEND inside the sweep's own nudge window", () => {
    const inside = post({ expiresAt: new Date(NOW.getTime() + (EXPIRY_NUDGE_DAYS - 1) * DAY_MS) });
    expect(isExpiringSoon(inside, NOW)).toBe(true);
  });

  it("stays quiet outside it", () => {
    const outside = post({ expiresAt: new Date(NOW.getTime() + (EXPIRY_NUDGE_DAYS + 1) * DAY_MS) });
    expect(isExpiringSoon(outside, NOW)).toBe(false);
  });

  // Only an open post can be extended — `extendPost` rejects the rest, so
  // offering the button on a closed post would be a guaranteed error.
  it.each(["party_full", "expired"])("never offers it on a %s post", (status) => {
    const closed = post({ status, expiresAt: new Date(NOW.getTime() + 1 * DAY_MS) });
    expect(isExpiringSoon(closed, NOW)).toBe(false);
  });

  it("treats a missing expiry as not expiring", () => {
    expect(isExpiringSoon(post({ expiresAt: null }), NOW)).toBe(false);
  });
});

describe("jam deadlines", () => {
  it("sorts by the next milestone, whichever phase each jam is in", () => {
    const running = jam(1, -2, 5);
    const soon = jam(2, 1, 8);
    const later = jam(3, 20, 27);
    const deadlines = selectJamDeadlines([{ jam: later }, { jam: running }, { jam: soon }], NOW);
    expect(deadlines.map((d) => d.jam.jamId)).toEqual([2, 1, 3]);
    expect(deadlines[0]?.phase).toBe("upcoming");
    expect(deadlines[1]?.phase).toBe("running");
  });

  it("drops ended jams — a finished deadline is not a countdown", () => {
    expect(selectJamDeadlines([{ jam: jam(1, -20, -5) }], NOW)).toHaveLength(0);
  });

  it("dedupes a jam carrying several of the viewer's posts", () => {
    const shared = jam(7, 1, 8);
    expect(selectJamDeadlines([{ jam: shared }, { jam: shared }, { jam: null }], NOW)).toHaveLength(
      1,
    );
  });

  it("caps the strip", () => {
    const many = [1, 2, 3, 4, 5, 6].map((n) => ({ jam: jam(n, n, n + 7) }));
    expect(selectJamDeadlines(many, NOW)).toHaveLength(4);
  });
});
