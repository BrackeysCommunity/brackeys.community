import { and, desc, eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { db as mockedDb } from "@/db";
import {
  engineProjects,
  engineReleaseAudit,
  engineReleases,
  engineSceneVersions,
} from "@/db/schema";
import { seedUser, type TestDb } from "@/test/db";

import { engineLive } from "../live-events";
import { blockSceneVersion, reportLiveOutcome } from "../live-moderation";
import { moveScenePointer, setLiveRev } from "../live-pointers";
import { getSceneVersion, listSceneVersions } from "../live-versions";
import type { ReleaseDb } from "../release-audit";
import { memoryReleaseStore } from "../release-storage";
import type { Actor, ReleaseTxDb } from "../release-upload";
import { fixtureVersion } from "./fixtures/live/scene-versions";
import { plannedRelease, type PlannedRelease } from "./release-fixture";
import { liveRev, uploadDeps, uploadRelease, uploadSceneVersion } from "./upload-rig";

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return { db: await createTestDb() } as unknown as typeof import("@/db");
});

const db = mockedDb as unknown as TestDb;

const PROJECT = "fixture";
const GAME = "fixture-game";
const NOW = new Date("2026-11-13T15:00:00Z");

const publisher: Actor = { kind: "user", userId: "pub" };

let store = memoryReleaseStore();
let release: PlannedRelease;

const deps = () => uploadDeps(store, { now: () => NOW });
const readDeps = () => ({ db: db as unknown as ReleaseTxDb, now: () => NOW });

/** A version of the hall published on no channel, then pointed at by production; its number and id. */
async function liveHall() {
  const v = await fixtureVersion(release, {
    scene: "hall",
    edit: (scene) => {
      const [start] = scene.entities as { at: [number, number] }[];
      start!.at = [4, 1];
    },
  });
  const { committed } = await uploadSceneVersion(deps(), v, {
    channel: "none",
    actor: publisher,
  });
  await moveScenePointer(deps(), {
    projectId: PROJECT,
    scene: "hall",
    channel: "production",
    to: { number: committed.number },
    timing: "next-load",
    action: "scene-promote",
    actor: publisher,
  });
  return { number: committed.number, id: committed.versionId };
}

const versionRow = async (id: string) =>
  (await db.select().from(engineSceneVersions).where(eq(engineSceneVersions.id, id)))[0]!;

beforeAll(async () => {
  await seedUser(db, "pub");
  release = await plannedRelease({ projectId: PROJECT, gameId: GAME, engineVersion: "0.14.1" });
});

let announced: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  store = memoryReleaseStore();
  announced = vi.spyOn(engineLive, "announce").mockResolvedValue(undefined);
  await db.delete(engineProjects);
  await db
    .insert(engineProjects)
    .values({ projectId: PROJECT, name: "Fixture", game: GAME, createdById: "pub" });
  await uploadRelease(deps(), release, { actor: publisher, promoteTo: "production" });
});

afterEach(() => {
  announced.mockRestore();
});

describe("getSceneVersion's fit per release", () => {
  const compat = async (number: number) =>
    (
      await getSceneVersion(
        { projectId: PROJECT, scene: "hall", number, actor: publisher },
        readDeps(),
      )
    ).compat;

  it("fits the release it was built for", async () => {
    const { number } = await liveHall();
    expect(await compat(number)).toEqual([
      expect.objectContaining({ version: 1, fits: true, issue: null }),
    ]);
  });

  it("doesn't fit a release that takes no live scenes, as a move would refuse", async () => {
    const { number } = await liveHall();
    await db.update(engineReleases).set({ liveCompatKey: "" });
    expect(await compat(number)).toEqual([
      expect.objectContaining({
        fits: false,
        issue: expect.objectContaining({ code: "live-incompatible" }),
      }),
    ]);
  });

  it("doesn't fit a release whose compat key differs from the version's", async () => {
    const { number, id } = await liveHall();
    await db
      .update(engineSceneVersions)
      .set({ compatKey: "0".repeat(64) })
      .where(eq(engineSceneVersions.id, id));
    const [only] = await compat(number);
    expect(only).toMatchObject({ fits: false, issue: { code: "live-incompatible" } });
    expect(only?.issue?.message).toBe("hall@1 was built for another release than v1.");
  });
});

describe("listSceneVersions", () => {
  const hex = (n: number) => n.toString(16).padStart(64, "0");
  const row = (number: number, collected: boolean) => ({
    id: hex(3000 + number),
    projectId: PROJECT,
    sceneId: "cellar",
    number,
    descriptor: collected ? null : "{}",
    compatKey: hex(1),
    physics: "none",
    sceneHash: hex(2),
    dataBytes: 10,
    createdAt: new Date(NOW.getTime() - (20 - number) * 3_600_000),
    collectedAt: collected ? NOW : null,
  });

  it("lists every version still stored, each scene's newest removed ones and every pointer", async () => {
    const hall = await liveHall();
    await db
      .insert(engineSceneVersions)
      .values(Array.from({ length: 10 }, (_, i) => row(i + 1, i < 8)));
    const listed = await listSceneVersions({ projectId: PROJECT, actor: publisher }, readDeps());
    expect(listed.filter((v) => v.scene === "cellar").map((v) => v.number)).toEqual([
      10, 9, 8, 7, 6, 5, 4,
    ]);
    expect(listed.find((v) => v.scene === "hall")).toMatchObject({
      number: hall.number,
      pointers: [expect.objectContaining({ channel: "production", timing: "next-load" })],
    });
    // One removed long ago is still there to read on its own.
    const old = await getSceneVersion(
      { projectId: PROJECT, scene: "cellar", number: 1, actor: publisher },
      readDeps(),
    );
    expect(old).toMatchObject({ number: 1, collectedAt: NOW });
  });
});

describe("outcome reports", () => {
  const report = (versionId: string, outcome: "applied" | "refused" | "failed") =>
    reportLiveOutcome(
      { projectId: PROJECT, versionId, channel: "production", outcome, userId: "pub" },
      { ...readDeps(), rateLimit: async () => true },
    );

  it("counts a refused version as no failure: the game went on with the one it had", async () => {
    const { id } = await liveHall();
    await report(id, "refused");
    expect(await versionRow(id)).toMatchObject({ reportsOk: 1, reportsFailed: 0 });
    await report(id, "failed");
    expect(await versionRow(id)).toMatchObject({ reportsOk: 1, reportsFailed: 1 });
  });
});

describe("live_rev", () => {
  it("never goes back to a lower rev", async () => {
    await liveHall();
    const rev = (await liveRev(PROJECT, "production"))!;
    await setLiveRev(db as unknown as ReleaseDb, PROJECT, ["production"], rev - 1);
    expect(await liveRev(PROJECT, "production")).toBe(rev);
    await setLiveRev(db as unknown as ReleaseDb, PROJECT, ["production"], rev + 5);
    expect(await liveRev(PROJECT, "production")).toBe(rev + 5);
  });

  it("takes a block's audit id on every channel that points at the version, and announces it", async () => {
    const { number, id } = await liveHall();
    await blockSceneVersion(
      { projectId: PROJECT, scene: "hall", number, actor: publisher },
      readDeps(),
    );
    const [block] = await db
      .select({ id: engineReleaseAudit.id })
      .from(engineReleaseAudit)
      .where(
        and(
          eq(engineReleaseAudit.sceneVersionId, id),
          eq(engineReleaseAudit.action, "scene-block"),
        ),
      )
      .orderBy(desc(engineReleaseAudit.id));
    expect(await liveRev(PROJECT, "production")).toBe(block!.id);
    expect(announced).toHaveBeenLastCalledWith({
      projectId: PROJECT,
      channel: "production",
      rev: block!.id,
    });
  });
});
