import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { canvasDocs, canvasDocVersions, canvases } from "@/db/schema";
import { sweepCanvases } from "@/lib/canvas-sweep";
import { SOFT_DELETE_DAYS, VERSION_RETENTION_DAYS } from "@/lib/canvas/limits";
import { createTestDb, seedUser, type TestDb } from "@/test/db";

const DAY_MS = 86_400_000;
const now = new Date("2026-10-01T12:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * DAY_MS);

let db: TestDb;

async function seedCanvas(path: string, deletedAt: Date | null = null): Promise<string> {
  const [row] = await db
    .insert(canvases)
    .values({ ownerId: "owner", path, deletedAt })
    .returning({ id: canvases.id });
  await db.insert(canvasDocs).values({ canvasId: row!.id, state: Buffer.from([0, 0]) });
  return row!.id;
}

async function seedVersion(docId: string, takenAt: Date): Promise<number> {
  const [row] = await db
    .insert(canvasDocVersions)
    .values({
      docKind: "canvas",
      docId,
      takenAt,
      reason: "hourly",
      state: Buffer.from([0, 0]),
      byteSize: 2,
    })
    .returning({ id: canvasDocVersions.id });
  return row!.id;
}

beforeEach(async () => {
  db = await createTestDb();
  await seedUser(db, "owner");
});

describe("sweepCanvases", () => {
  it("purges canvases deleted past the window, with their docs and versions", async () => {
    const expired = await seedCanvas("Old.canvas", daysAgo(SOFT_DELETE_DAYS + 1));
    const recent = await seedCanvas("Recent.canvas", daysAgo(SOFT_DELETE_DAYS - 1));
    const live = await seedCanvas("Live.canvas");
    await seedVersion(expired, daysAgo(40));

    const result = await sweepCanvases(db, now);
    expect(result.canvasesPurged).toBe(1);

    const left = await db.select({ id: canvases.id }).from(canvases);
    expect(left.map((r) => r.id).sort()).toEqual([recent, live].sort());
    expect(await db.select().from(canvasDocs).where(eq(canvasDocs.canvasId, expired))).toHaveLength(
      0,
    );
    expect(
      await db.select().from(canvasDocVersions).where(eq(canvasDocVersions.docId, expired)),
    ).toHaveLength(0);
  });

  it("prunes old versions but keeps each document's newest", async () => {
    const a = await seedCanvas("A.canvas");
    const b = await seedCanvas("B.canvas");
    await seedVersion(a, daysAgo(VERSION_RETENTION_DAYS + 10));
    await seedVersion(a, daysAgo(VERSION_RETENTION_DAYS + 5));
    const aRecent = await seedVersion(a, daysAgo(1));
    const bOnly = await seedVersion(b, daysAgo(VERSION_RETENTION_DAYS + 20));

    const result = await sweepCanvases(db, now);
    expect(result.versionsPruned).toBe(2);
    const left = await db.select({ id: canvasDocVersions.id }).from(canvasDocVersions);
    expect(new Set(left.map((r) => r.id))).toEqual(new Set([aRecent, bOnly]));
  });
});
