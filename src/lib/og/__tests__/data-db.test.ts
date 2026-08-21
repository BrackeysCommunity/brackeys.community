import { call } from "@orpc/server";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { itchJams, teamMembers, teams } from "@/db/schema";
import { seedCollabPost, seedUser, type TestDb } from "@/test/db";
import { asUser } from "@/test/orpc";

/**
 * What the cards say, not how they render — a card that loses its stat row
 * still rasterizes fine. The oRPC client is swapped for a router client:
 * `@/orpc/client`'s server branch needs a real request context.
 */

const db: TestDb = await (async () => {
  const { createTestDb } = await import("@/test/db");
  return createTestDb();
})();

vi.mock("@/db", () => ({ db }));
vi.mock("@/lib/auth", async () => (await import("@/test/orpc")).fakeAuthModule());
vi.mock("@/lib/profile-project-image-storage", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  streamStoredImage: async (objectKey: string) =>
    objectKey === "project-images/p1/cover.png"
      ? new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } })
      : new Response("Not Found", { status: 404 }),
}));
vi.mock("@/orpc/client", async () => {
  const router = (await import("@/orpc/router")).default;
  const client = new Proxy(
    {},
    {
      get: (_target, name: string) => (input: unknown) =>
        call(
          (router as unknown as Record<string, Parameters<typeof call>[0]>)[name]!,
          input,
          asUser(null),
        ),
    },
  );
  return { client, orpc: client };
});

let data: typeof import("@/lib/og/data");

beforeAll(async () => {
  data = await import("@/lib/og/data");

  await db.insert(itchJams).values({
    jamId: 42,
    slug: "brackeys-13",
    title: "Brackeys Game Jam 2026.1",
    status: "over",
    startsAt: new Date("2026-02-14T00:00:00Z"),
    endsAt: new Date("2026-02-23T00:00:00Z"),
    entriesCount: 1204,
    ratingsCount: 8912,
    hosts: [{ name: "Brackeys", url: "https://itch.io/profile/brackeys" }],
  });

  await db.insert(itchJams).values({
    jamId: 43,
    slug: "forever-jam",
    title: "Forever Jam",
    status: "running",
    startsAt: new Date("2025-01-01T00:00:00Z"),
    hosts: [],
  });

  await db.insert(itchJams).values({
    jamId: 44,
    slug: "dateless-jam",
    title: "Dateless Jam",
    status: "running",
    hosts: [],
  });

  await seedUser(db, "mellobacon", { tagline: "Composer and sound designer" });
  const [team] = await db
    .insert(teams)
    .values({ slug: "cardboard", name: "Cardboard Castle", createdBy: "mellobacon" })
    .returning({ id: teams.id });
  await db.insert(teamMembers).values({ teamId: team!.id, userId: "mellobacon", role: "owner" });
});

describe("jam cards", () => {
  it("leads with the window and the host, and counts entries and ratings", async () => {
    const card = await data.jamCard("brackeys-13");

    expect(card).not.toBeNull();
    expect(card!.kind).toBe("jam");
    expect(card!.title).toBe("Brackeys Game Jam 2026.1");
    expect(card!.subtitle).toBe("14 Feb 2026 – 23 Feb 2026 · Hosted by Brackeys");
    expect(card!.stats).toEqual([
      { value: "1,204", label: "Entries" },
      { value: "8,912", label: "Ratings" },
      { value: "Ended", label: "Status" },
    ]);
  });

  it("keeps an open-ended jam running rather than archiving it", async () => {
    const card = await data.jamCard("forever-jam");

    expect(card!.stats).toContainEqual({ value: "Running", label: "Status" });
  });

  it("claims no status for a jam with no dates at all", async () => {
    const card = await data.jamCard("dateless-jam");

    expect(card!.stats?.some((stat) => stat.label === "Status") ?? false).toBe(false);
  });

  it("is null for a jam that does not exist, so the route can 404", async () => {
    expect(await data.jamCard("no-such-jam")).toBeNull();
  });
});

describe("collab cards", () => {
  it("says the terms and who is asking", async () => {
    const postId = await seedCollabPost(db, "mellobacon", {
      title: "Need a pixel artist",
      description: "<p>Short jam project, three weeks.</p>",
      type: "paid",
    });

    const card = await data.collabCard(postId);

    expect(card!.kind).toBe("collab");
    expect(card!.title).toBe("Need a pixel artist");
    expect(card!.subtitle).toBe("Short jam project, three weeks.");
    expect(card!.stats).toContainEqual({ value: "Paid", label: "Terms" });
    expect(card!.stats).toContainEqual({ value: "mellobacon", label: "Posted by" });
  });

  it("is null for a post id nobody has", async () => {
    expect(await data.collabCard(999_999)).toBeNull();
  });
});

describe("profile and team cards", () => {
  it("uses the member's tagline and house display name", async () => {
    const card = await data.profileCard("mellobacon");

    expect(card!.kind).toBe("profile");
    expect(card!.title).toBe("mellobacon");
    expect(card!.subtitle).toBe("Composer and sound designer");
  });

  it("counts the roster", async () => {
    const card = await data.teamCard("cardboard");

    expect(card!.kind).toBe("team");
    expect(card!.title).toBe("Cardboard Castle");
    expect(card!.stats?.[0]).toEqual({ value: "1", label: "Member" });
  });
});

describe("art", () => {
  it("refuses anything that is neither an absolute http image nor a stored upload", async () => {
    expect(await data.fetchArt(null, "panel")).toBeNull();
    expect(await data.fetchArt("javascript:alert(1)", "panel")).toBeNull();
    expect(await data.fetchArt("relative/path.png", "panel")).toBeNull();
  });

  it("inlines an uploaded cover straight from the bucket", async () => {
    const art = await data.fetchArt("/images/project-images/p1/cover.png", "panel");

    expect(art).toEqual({
      dataUri: `data:image/png;base64,${Buffer.from([1, 2, 3]).toString("base64")}`,
      shape: "panel",
    });
  });

  it("refuses stored paths whose key no upload handler mints", async () => {
    expect(await data.fetchArt("/images/abc.png", "panel")).toBeNull();
    expect(await data.fetchArt("/images/project-images/../secret", "panel")).toBeNull();
  });
});

describe("board cards", () => {
  it("counts the live board for the jams listing", async () => {
    const card = await data.boardCard("jams");

    expect(card!.kind).toBe("jam");
    expect(card!.title).toBe("Every jam worth entering");
    // forever-jam is the only live one; brackeys-13 ended and dateless
    // never started. All three seeds count as tracked.
    expect(card!.stats).toContainEqual({ value: "1", label: "Live now" });
    expect(card!.stats).toContainEqual({ value: "3", label: "Tracked" });
  });

  it("leads the archive card with the archive's size", async () => {
    const card = await data.boardCard("archive");

    expect(card!.kind).toBe("jam");
    expect(card!.stats?.[0]?.label).toBe("Jams");
  });

  it("counts members and teams from the directory", async () => {
    const members = await data.boardCard("members");
    const teamsCard = await data.boardCard("teams");

    expect(members!.kind).toBe("profile");
    expect(members!.stats).toContainEqual({ value: "1", label: "Members" });
    expect(teamsCard!.kind).toBe("team");
    expect(teamsCard!.stats).toContainEqual({ value: "1", label: "Teams" });
  });

  it("reads the collab board's open-role stats", async () => {
    const card = await data.boardCard("collab");

    expect(card!.kind).toBe("collab");
    expect(card!.title).toBe("Find people to build with");
  });

  it("is null for a board nobody has, so the route can 404", async () => {
    expect(await data.boardCard("bogus")).toBeNull();
  });
});
