import { call } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  developerProfiles,
  engineProjects,
  imageFlags,
  imageScans,
  projects,
  user,
} from "@/db/schema";
import { listImageFlags } from "@/orpc/router/admin";
import { seedUser, type TestDb } from "@/test/db";
import { asUser } from "@/test/orpc";

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return { db: await createTestDb() } as unknown as typeof import("@/db");
});
vi.mock("@/lib/auth", async () => {
  const { fakeAuthModule } = await import("@/test/orpc");
  return fakeAuthModule();
});
vi.mock("@/lib/guild-sync", () => ({
  refreshDiscordProfileThrottled: async () => {},
}));

let db: TestDb;

async function flag(objectKey: string, ownerType: "engine_blob" | "engine_release_file") {
  const ownerId = objectKey.split("/")[1]!;
  await db.insert(imageScans).values({
    objectKey,
    ownerType,
    ownerId,
    uploaderId: "rita",
    status: "scanned",
    detectorVersion: 1,
  });
  await db.insert(imageFlags).values({
    objectKey,
    ownerType,
    ownerId,
    uploaderId: "rita",
    kind: "nsfw",
    source: "auto",
    score: 0.99,
    evidence: { nsfwScore: 0.99, quarantined: false },
  });
}

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  await db.delete(imageFlags);
  await db.delete(imageScans);
  await db.delete(engineProjects);
  await db.delete(projects);
  await db.delete(developerProfiles);
  await db.delete(user);
  await seedUser(db, "staff", { guildRoles: ["Staff"] });
  await seedUser(db, "rita");
});

describe("listImageFlags on hosted game images", () => {
  it("names the game by its showcase title or project name and links its page", async () => {
    await db.insert(projects).values({ id: "show-1", slug: "star-hop", title: "Star Hop" });
    await db.insert(engineProjects).values([
      { projectId: "linked", name: "linked-project", showcaseProjectId: "show-1" },
      { projectId: "plain", name: "Plain Game" },
    ]);
    await flag("engine-releases/linked/1/cover.png", "engine_release_file");
    await flag("engine-assets/plain/abc.png", "engine_blob");
    await flag("engine-assets/gone/abc.png", "engine_blob");

    const { items } = await call(
      listImageFlags,
      { includeResolved: false, page: 1, pageSize: 20 },
      asUser("staff"),
    );
    const owners = Object.fromEntries(items.map((item) => [item.ownerId, item.owner]));
    expect(owners).toEqual({
      linked: { label: "Star Hop", href: "/games/linked" },
      plain: { label: "Plain Game", href: "/games/plain" },
      gone: null,
    });
  });
});
