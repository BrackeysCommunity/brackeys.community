import { asc, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";

import {
  engineProjects,
  engineReleaseAudit,
  engineReleaseChannels,
  engineReleases,
} from "@/db/schema";
import { createTestDb, seedUser, type TestDb } from "@/test/db";

import { writeAudit } from "../release-audit";
import { movePointer } from "../release-channels";

const PROJECT = "kitchen";
const V1 = "1".repeat(64);
const V2 = "2".repeat(64);
const person = { kind: "user", userId: "staff" } as const;
const AT = new Date("2026-11-12T15:00:00Z");

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
  await seedUser(db, "staff");
});

beforeEach(async () => {
  await db.delete(engineProjects);
  await db.insert(engineProjects).values({ projectId: PROJECT, name: "Kitchen" });
  for (const [id, version] of [
    [V1, 1],
    [V2, 2],
  ] as const) {
    await db.insert(engineReleases).values({
      id,
      projectId: PROJECT,
      version,
      manifest: "{}",
      manifestBytes: 2,
      totalBytes: 10,
      fileCount: 1,
      engineVersion: "0.14.1",
      gameId: "tactics",
      snapshot: "a".repeat(64),
      buildHash: "b".repeat(64),
      target: "web",
    });
  }
});

const pointer = async (channel: "preview" | "production") =>
  (
    await db.select().from(engineReleaseChannels).where(eq(engineReleaseChannels.channel, channel))
  )[0];

const audit = () => db.select().from(engineReleaseAudit).orderBy(asc(engineReleaseAudit.id));

const promotedAt = async (id: string) =>
  (
    await db
      .select({ at: engineReleases.firstPromotedAt })
      .from(engineReleases)
      .where(eq(engineReleases.id, id))
  )[0]?.at ?? null;

describe("movePointer", () => {
  it("creates the pointer, then moves it, one audit row per move", async () => {
    const first = await db.transaction((tx) =>
      movePointer(tx, {
        project: PROJECT,
        channel: "preview",
        release: V1,
        actor: person,
        action: "promote",
        at: AT,
      }),
    );
    expect(first).toEqual({
      from: null,
      to: V1,
      moved: true,
      rev: expect.any(Number),
      restored: [],
      skipped: [],
    });
    expect(await pointer("preview")).toMatchObject({ releaseId: V1, updatedById: "staff" });

    const second = await db.transaction((tx) =>
      movePointer(tx, {
        project: PROJECT,
        channel: "preview",
        release: V2,
        actor: { kind: "agent", userId: "staff" },
        action: "promote",
        at: AT,
      }),
    );
    expect(second).toEqual({
      from: V1,
      to: V2,
      moved: true,
      rev: expect.any(Number),
      restored: [],
      skipped: [],
    });
    expect(await pointer("preview")).toMatchObject({ releaseId: V2 });

    const rows = await audit();
    expect(
      rows.map((r) => [r.action, r.actorKind, r.channel, r.fromRelease, r.toRelease, r.releaseId]),
    ).toEqual([
      ["promote", "user", "preview", null, V1, V1],
      ["promote", "agent", "preview", V1, V2, V2],
    ]);
    // Preview never stamps a release as once-live.
    expect(await promotedAt(V1)).toBeNull();
  });

  it("stamps first_promoted_at once, on production, and keeps the first stamp", async () => {
    await movePointer(db, {
      project: PROJECT,
      channel: "production",
      release: V1,
      actor: person,
      action: "promote",
      at: AT,
    });
    const stamped = await promotedAt(V1);
    expect(stamped).toEqual(AT);
    await movePointer(db, {
      project: PROJECT,
      channel: "production",
      release: V2,
      actor: person,
      action: "promote",
      at: AT,
    });
    await movePointer(db, {
      project: PROJECT,
      channel: "production",
      release: V1,
      actor: person,
      action: "rollback",
      at: AT,
      detail: { reason: "a test" },
    });
    expect(await promotedAt(V1)).toEqual(stamped);
    expect(await promotedAt(V2)).toBeInstanceOf(Date);
    const rows = await audit();
    expect(rows.map((r) => r.action)).toEqual(["promote", "promote", "rollback"]);
    expect(rows[2]).toMatchObject({ fromRelease: V2, toRelease: V1, detail: { reason: "a test" } });
  });

  it("leaves a channel already on the release alone, with no audit row", async () => {
    const move = {
      project: PROJECT,
      channel: "preview",
      release: V1,
      actor: person,
      at: AT,
    } as const;
    await movePointer(db, { ...move, action: "promote" });
    expect(await movePointer(db, { ...move, action: "promote" })).toEqual({
      from: V1,
      to: V1,
      moved: false,
      rev: null,
      restored: [],
      skipped: [],
    });
    expect(await audit()).toHaveLength(1);
  });

  it("rolls the pointer and its audit row back with the caller's transaction", async () => {
    await expect(
      db.transaction(async (tx) => {
        await movePointer(tx, {
          project: PROJECT,
          channel: "production",
          release: V1,
          actor: person,
          action: "promote",
          at: AT,
        });
        throw new Error("the caller's next step failed");
      }),
    ).rejects.toThrow("the caller's next step failed");
    expect(await pointer("production")).toBeUndefined();
    expect(await audit()).toEqual([]);
    expect(await promotedAt(V1)).toBeNull();
  });
});

describe("writeAudit", () => {
  it("names the system with no actor, and an agent by its token", async () => {
    await writeAudit(db, {
      projectId: PROJECT,
      actor: { kind: "system" },
      action: "collect",
      releaseId: V1,
    });
    const [row] = await audit();
    expect(row).toMatchObject({
      actorKind: "system",
      actorId: null,
      agentTokenId: null,
      action: "collect",
      releaseId: V1,
      detail: {},
    });
  });
});
