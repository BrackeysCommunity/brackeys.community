import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";

import {
  engineProjects,
  engineReleaseChannels,
  engineReleases,
  projects,
  teams,
} from "@/db/schema";
import { seedUser, type TestDb } from "@/test/db";

const db: TestDb = await (async () => {
  const { createTestDb } = await import("@/test/db");
  return createTestDb();
})();

vi.mock("@/db", () => ({ db }));

const gate = vi.hoisted(() => ({ allowed: true, flag: true }));
vi.mock("@/lib/engine/guard", () => ({ engineGamesAllowed: () => gate.allowed }));
vi.mock("@/lib/posthog-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/posthog-server")>()),
  isServerFlagEnabled: async (flag: string) => flag === "engine-games-enabled" && gate.flag,
}));

let data: typeof import("@/lib/og/data");
let route: typeof import("@/routes/og.$");

const hex = (digit: string) => digit.repeat(64);

async function seedGame(
  projectId: string,
  release: string,
  overrides: Partial<typeof engineProjects.$inferInsert> = {},
  { production = true }: { production?: boolean } = {},
) {
  await db.insert(engineProjects).values({
    projectId,
    name: `${projectId} project`,
    visibility: "public",
    publicApprovedAt: new Date("2026-11-01T00:00:00Z"),
    ...overrides,
  });
  await db.insert(engineReleases).values({
    id: hex(release),
    projectId,
    version: 3,
    manifest: "{}",
    manifestBytes: 2,
    totalBytes: 10,
    fileCount: 1,
    engineVersion: "0.14.1",
    gameId: "tactics",
    snapshot: hex("a"),
    buildHash: hex("b"),
    target: "web",
  });
  if (production) {
    await db
      .insert(engineReleaseChannels)
      .values({ projectId, channel: "production", releaseId: hex(release) });
  }
}

beforeAll(async () => {
  data = await import("@/lib/og/data");
  route = await import("@/routes/og.$");

  await seedUser(db, "keeper");
  const [team] = await db
    .insert(teams)
    .values({ slug: "lighthouse", name: "Lighthouse Crew", createdBy: "keeper" })
    .returning({ id: teams.id });
  const [showcase] = await db
    .insert(projects)
    .values({
      slug: "lantern-keep",
      title: "Lantern Keep",
      description: "Hold the light through the storm.",
    })
    .returning({ id: projects.id });

  await seedGame("lantern", "1", { teamId: team!.id, showcaseProjectId: showcase!.id });
  await seedGame("bare", "2");
  await seedGame("quiet", "3", { visibility: "unlisted" });
  await seedGame("awaiting", "4", { publicApprovedAt: null });
  await seedGame("hidden", "5", { hiddenAt: new Date() });
  await seedGame("unreleased", "6", {}, { production: false });
  await seedGame("pulled", "7");
  await db
    .update(engineReleases)
    .set({ hiddenAt: new Date() })
    .where(eq(engineReleases.id, hex("7")));
  await seedGame("collected", "8");
  await db
    .update(engineReleases)
    .set({ collectedAt: new Date() })
    .where(eq(engineReleases.id, hex("8")));
});

describe("game cards", () => {
  it("titles a public game by its showcase project and counts its live version", async () => {
    const card = await data.gameCard("lantern");

    expect(card).toEqual({
      kind: "game",
      eyebrow: "Play in your browser",
      title: "Lantern Keep",
      subtitle: "Hold the light through the storm.",
      stats: [
        { value: "v3", label: "Version" },
        { value: "Lighthouse Crew", label: "Team" },
      ],
      art: null,
    });
  });

  it("falls back to the engine project's name without a showcase project", async () => {
    expect(await data.gameCard("bare")).toMatchObject({
      title: "bare project",
      subtitle: null,
      stats: [{ value: "v3", label: "Version" }],
    });
  });

  it("cards no unlisted, unapproved, hidden, unreleased or collected game", async () => {
    const unshared = ["quiet", "awaiting", "hidden", "unreleased", "pulled", "collected", "nobody"];
    for (const projectId of unshared) {
      expect(await data.gameCard(projectId)).toBeNull();
    }
  });

  it("cards nothing on production, or while games are closed to signed-out visitors", async () => {
    gate.allowed = false;
    try {
      expect(await data.gameCard("lantern")).toBeNull();
    } finally {
      gate.allowed = true;
    }
    gate.flag = false;
    try {
      expect(await data.gameCard("lantern")).toBeNull();
    } finally {
      gate.flag = true;
    }
  });

  it("is what the og route resolves `game/<id>.png` to", async () => {
    expect(await route.resolveCard("game/lantern.png")).toMatchObject({ kind: "game" });
    expect(await route.resolveCard("game/quiet.png")).toBeNull();
  });

  it("rasterizes", async () => {
    const { ogCard } = await import("@/lib/og/card");
    const { renderOgPng } = await import("@/lib/og/render");
    const png = await renderOgPng(ogCard((await data.gameCard("lantern"))!));
    expect([...png.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  }, 30_000);
});
