import { beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { db as mockedDb } from "@/db";
import { engineProjects, engineReleases } from "@/db/schema";
import type { PurgeResult } from "@/lib/cloudflare-purge";
import { seedUser, type TestDb } from "@/test/db";

import { setGameSettings, type GameSettingsDeps, type GameSettingsPatch } from "../game-settings";
import type { Actor, ReleaseTxDb } from "../release-upload";

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return { db: await createTestDb() } as unknown as typeof import("@/db");
});

const db = mockedDb as unknown as TestDb;

const PROJECT = "settings-purge-fixture";
const NOW = new Date("2026-11-12T15:00:00Z");
const creator: Actor = { kind: "user", userId: "purge-creator" };
const hex = (n: number) => n.toString(16).padStart(64, "0");

let purged: string[] = [];
let answer: PurgeResult = { purged: true, urls: 5 };

const deps: GameSettingsDeps = {
  db: db as unknown as ReleaseTxDb,
  now: () => NOW,
  siteOrigins: () => ["https://jams.test"],
  forget: () => {},
  purge: async (releaseId) => {
    purged.push(releaseId);
    return answer;
  },
};

const set = (patch: GameSettingsPatch) =>
  setGameSettings({ projectId: PROJECT, patch, actor: creator }, deps);

async function insertRelease(version: number, collectedAt: Date | null = null) {
  await db.insert(engineReleases).values({
    id: hex(version),
    projectId: PROJECT,
    version,
    manifest: collectedAt ? null : "{}",
    manifestBytes: 2,
    totalBytes: 1_000,
    fileCount: 3,
    engineVersion: "0.14.1",
    gameId: "fixture-game",
    snapshot: "a".repeat(64),
    buildHash: "b".repeat(64),
    target: "web",
    createdById: "purge-creator",
    collectedAt,
  });
}

beforeAll(async () => {
  await seedUser(db, "purge-creator");
});

beforeEach(async () => {
  purged = [];
  answer = { purged: true, urls: 5 };
  await db.delete(engineProjects);
  await db.insert(engineProjects).values({
    projectId: PROJECT,
    name: "Purge Fixture",
    game: "fixture-game",
    createdById: "purge-creator",
    visibility: "unlisted",
  });
  await insertRelease(1);
  await insertRelease(2);
  await insertRelease(3, NOW);
});

describe("setGameSettings: the edge after going private", () => {
  it("purges every release still served from the public prefix", async () => {
    const saved = await set({ visibility: "private" });
    expect(saved.visibility).toBe("private");
    expect(saved.edgeNote).toBeUndefined();
    expect(purged.sort()).toEqual([hex(1), hex(2)]);
  });

  it("says why when the edge can't be purged", async () => {
    await db.update(engineProjects).set({ visibility: "public", publicApprovedAt: NOW });
    answer = { purged: false, reason: "Edge purge isn't configured." };
    const saved = await set({ visibility: "private" });
    expect(saved.edgeNote).toBe("Edge purge isn't configured.");
    expect(purged).toHaveLength(2);
  });

  it("leaves the edge alone between public audiences and between private ones", async () => {
    await set({ saveMode: "none" });
    await set({ visibility: "unlisted" });
    expect(purged).toEqual([]);
    await set({ visibility: "private" });
    purged = [];
    await set({ visibility: "private" });
    expect(purged).toEqual([]);
  });
});

describe("setGameSettings: the edge after a CSP change", () => {
  it("purges a public game's shells when its connect origins or online change", async () => {
    await set({ connectOrigins: ["https://api.example.test"] });
    expect(purged.sort(), "a wider connect-src").toEqual([hex(1), hex(2)]);
    purged = [];
    await set({ connectOrigins: [] });
    expect(purged.sort(), "a narrower one").toEqual([hex(1), hex(2)]);
    purged = [];
    await set({ online: true });
    expect(purged.sort(), "the sync origin").toEqual([hex(1), hex(2)]);
  });

  it("leaves the edge alone for a private game, or when the origins stay the same", async () => {
    await set({ connectOrigins: ["https://api.example.test"] });
    purged = [];
    await set({ connectOrigins: ["https://api.example.test"] });
    expect(purged).toEqual([]);
    await set({ visibility: "private" });
    purged = [];
    await set({ connectOrigins: [], online: true });
    expect(purged).toEqual([]);
  });
});

describe("setGameSettings: other web processes", () => {
  it("announces the project to every frame cache by default", async () => {
    const notices = await import("../frame-cache-notice");
    const announce = vi.spyOn(notices, "announceReleaseChange").mockResolvedValue();
    try {
      const { forget: _local, ...rest } = deps;
      await setGameSettings(
        { projectId: PROJECT, patch: { saveMode: "none" }, actor: creator },
        rest,
      );
      expect(announce).toHaveBeenCalledWith({ releaseIds: [], projectIds: [PROJECT] });
    } finally {
      announce.mockRestore();
    }
  });
});
