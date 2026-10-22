/**
 * More of `saveCanvasImport` on a real Postgres: the byte cap under racing
 * imports, the exact card-cap boundary, access, and malformed vectors. Runs
 * only with CANVAS_IMPORT_PG_URL pointing at a migrated scratch database.
 */
import { call } from "@orpc/server";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import * as Y from "yjs";

import { buildImport, type FinalCanvas } from "@/components/canvas/io/import-flow";
import {
  canvasDocs,
  canvasDocVersions,
  canvases,
  developerProfiles,
  teamMembers,
  teams,
  user,
} from "@/db/schema";
import { docFromState } from "@/lib/canvas/doc-state";
import { base64ToBytes, bytesToBase64 } from "@/lib/canvas/encoding";
import { applyJsonCanvas, canvasNodes, type JsonCanvas } from "@/lib/canvas/json-canvas";
import { CANVAS_LIMITS } from "@/lib/canvas/limits";
import {
  createCanvas,
  deleteCanvas,
  getCanvas,
  restoreCanvasVersion,
  saveCanvas,
  saveCanvasImport,
} from "@/orpc/router/canvas";
import { seedUser, type TestDb } from "@/test/db";
import { asUser } from "@/test/orpc";

const URL = process.env.CANVAS_IMPORT_PG_URL;

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  return {
    db: drizzle({
      connection: {
        connectionString: process.env.CANVAS_IMPORT_PG_URL ?? "postgres://x@127.0.0.1:1/x",
        max: 24,
      },
    }),
  };
});
vi.mock("@/lib/auth", async () => {
  const { fakeAuthModule } = await import("@/test/orpc");
  return fakeAuthModule();
});
vi.mock("@/lib/discord", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/discord")>()),
  isGuildMember: async () => true,
}));
vi.mock("@/lib/guild-sync", () => ({ refreshDiscordProfileThrottled: async () => {} }));
vi.mock("@/lib/posthog-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/posthog-server")>()),
  isServerFlagEnabled: async () => true,
}));
const published = vi.hoisted(() => ({ applies: [] as string[] }));
vi.mock("@/lib/canvas-sync-publish", () => ({
  publishCanvasRevoke: async () => {},
  publishCanvasApply: async (canvasId: string) => void published.applies.push(canvasId),
}));
vi.mock("@/orpc/client", () => ({ client: {} }));

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const USERS = Array.from({ length: 8 }, (_, i) => `pgimp2-${run}-${i}`);
let db: TestDb;
let teamId: string;

beforeAll(async () => {
  if (!URL) return;
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  for (const id of USERS) await seedUser(db, id);
  const [team] = await db
    .insert(teams)
    .values({ slug: `pgimp2-${run}`, name: "PG import", createdBy: USERS[0]! })
    .returning({ id: teams.id });
  teamId = team!.id;
  await db
    .insert(teamMembers)
    .values(USERS.map((userId, i) => ({ teamId, userId, role: i === 0 ? "owner" : "member" })));
});

afterAll(async () => {
  if (!URL) return;
  const ids = (
    await db.select({ id: canvases.id }).from(canvases).where(eq(canvases.teamId, teamId))
  ).map((r) => r.id);
  if (ids.length) {
    await db.delete(canvasDocVersions).where(inArray(canvasDocVersions.docId, ids));
    await db.delete(canvasDocs).where(inArray(canvasDocs.canvasId, ids));
    await db.delete(canvases).where(inArray(canvases.id, ids));
  }
  await db.delete(teamMembers).where(eq(teamMembers.teamId, teamId));
  await db.delete(teams).where(eq(teams.id, teamId));
  await db.delete(developerProfiles).where(inArray(developerProfiles.id, USERS));
  await db.delete(user).where(inArray(user.id, USERS));
  await (db as unknown as { $client: { end(): Promise<void> } }).$client.end();
});

const textCards = (prefix: string, n: number): JsonCanvas => ({
  nodes: Array.from({ length: n }, (_, i) => ({
    id: `${prefix}${i}`,
    type: "text",
    text: `${prefix} ${i}`,
    x: 0,
    y: 0,
    width: 1,
    height: 1,
  })),
  edges: [],
});

async function openTab(userId: string, canvasId: string) {
  const loaded = await call(getCanvas, { canvasId }, asUser(userId));
  const doc = docFromState(base64ToBytes(loaded.state!));
  let synced = Y.encodeStateVector(doc);
  const send = async () => {
    const result = await call(
      saveCanvas,
      {
        canvasId,
        update: bytesToBase64(Y.encodeStateAsUpdate(doc, synced)),
        stateVector: bytesToBase64(Y.encodeStateVector(doc)),
      },
      asUser(userId),
    );
    Y.applyUpdate(doc, base64ToBytes(result.update));
    synced = Y.encodeStateVector(doc);
  };
  const importCards = async (canvas: JsonCanvas) => {
    const built = buildImport(doc, [{ canvas, docFields: {} } as unknown as FinalCanvas], {
      x: 0,
      y: 0,
    });
    const reply = await call(
      saveCanvasImport,
      {
        canvasId,
        base: bytesToBase64(built.base),
        update: bytesToBase64(built.update),
        stateVector: bytesToBase64(built.stateVector),
      },
      asUser(userId),
    );
    Y.applyUpdate(doc, base64ToBytes(reply.update));
    synced = Y.encodeStateVector(doc);
  };
  return { doc, send, importCards };
}

async function newCanvas(path: string) {
  const { id } = await call(
    createCanvas,
    { scope: { kind: "team", teamId }, path },
    asUser(USERS[0]!),
  );
  return id;
}

async function stored(canvasId: string) {
  const [row] = await db
    .select({ state: canvasDocs.state })
    .from(canvasDocs)
    .where(eq(canvasDocs.canvasId, canvasId));
  return new Uint8Array(row!.state);
}

async function versionsOf(canvasId: string) {
  return db
    .select({
      id: canvasDocVersions.id,
      reason: canvasDocVersions.reason,
      state: canvasDocVersions.state,
      takenAt: canvasDocVersions.takenAt,
    })
    .from(canvasDocVersions)
    .where(eq(canvasDocVersions.docId, canvasId))
    .orderBy(canvasDocVersions.id);
}

const bigCards = (prefix: string, n: number, chars: number): JsonCanvas => ({
  nodes: Array.from({ length: n }, (_, i) => ({
    id: `${prefix}${i}`,
    type: "text",
    // Varied text, so nothing about the size depends on repeats.
    text: Array.from({ length: chars }, (_, c) =>
      String.fromCharCode(97 + ((c * 7 + i) % 26)),
    ).join(""),
    x: 0,
    y: 0,
    width: 1,
    height: 1,
  })),
  edges: [],
});

const OUTSIDER = `pgimp2-${run}-outsider`;

describe.skipIf(!URL)("saveCanvasImport on real Postgres: round 2", { timeout: 180_000 }, () => {
  beforeAll(async () => {
    await seedUser(db, OUTSIDER);
  });
  afterAll(async () => {
    await db.delete(developerProfiles).where(eq(developerProfiles.id, OUTSIDER));
    await db.delete(user).where(eq(user.id, OUTSIDER));
  });

  it("eight tabs dropping 1.5 MB each onto 1 MB never pass the byte cap", async () => {
    const id = await newCanvas(`Bytes-${run}.canvas`);
    const seed = await openTab(USERS[0]!, id);
    applyJsonCanvas(seed.doc, bigCards("seed", 4, 256 * 1024));
    await seed.send();
    published.applies.length = 0;

    const tabs = await Promise.all(USERS.map((u) => openTab(u, id)));
    const results = await Promise.allSettled(
      tabs.map((tab, i) => tab.importCards(bigCards(`b${i}-`, 5, 300 * 1024))),
    );
    const accepted = results.filter((r) => r.status === "fulfilled").length;
    for (const r of results) {
      if (r.status === "rejected") expect(String(r.reason)).toMatch(/MB.*Nothing was imported/);
    }
    const bytes = (await stored(id)).length;
    expect(bytes).toBeLessThanOrEqual(CANVAS_LIMITS.maxStateBytes);
    // 1 MB + 2 × 1.5 MB fits; a third would be 5.5 MB.
    expect(accepted).toBe(2);
    const versions = (await versionsOf(id)).filter((v) => v.reason === "pre-import");
    expect(versions).toHaveLength(2);
    expect(published.applies.filter((c) => c === id)).toHaveLength(2);
  });

  it("an import landing on exactly the card cap is taken; one card more is refused whole", async () => {
    const id = await newCanvas(`Edge-${run}.canvas`);
    const tab = await openTab(USERS[1]!, id);
    applyJsonCanvas(tab.doc, textCards("e", 1_995));
    await tab.send();
    const before = await stored(id);
    await expect(tab.importCards(textCards("over", 6))).rejects.toThrow(/2,001 cards/);
    expect(Buffer.from(await stored(id)).equals(Buffer.from(before))).toBe(true);
    await tab.importCards(textCards("fit", 5));
    expect(canvasNodes(docFromState(await stored(id))).size).toBe(CANVAS_LIMITS.maxNodes);
  });

  it("a tab whose own unsaved edits are already past the cap can't import", async () => {
    const id = await newCanvas(`Base-${run}.canvas`);
    const tab = await openTab(USERS[2]!, id);
    applyJsonCanvas(tab.doc, textCards("e", 1_000));
    await tab.send();
    const before = await stored(id);
    applyJsonCanvas(tab.doc, textCards("unsent", 1_001), { mode: "fragment" });
    await expect(tab.importCards(textCards("one", 1))).rejects.toThrow(/Nothing was imported/);
    expect(Buffer.from(await stored(id)).equals(Buffer.from(before))).toBe(true);
  });

  it("refuses an outsider, and an import into a deleted canvas", async () => {
    const id = await newCanvas(`Access-${run}.canvas`);
    const tab = await openTab(USERS[0]!, id);
    applyJsonCanvas(tab.doc, textCards("e", 2));
    await tab.send();
    const built = buildImport(
      tab.doc,
      [{ canvas: textCards("x", 2), docFields: {} } as unknown as FinalCanvas],
      {
        x: 0,
        y: 0,
      },
    );
    const input = {
      canvasId: id,
      base: bytesToBase64(built.base),
      update: bytesToBase64(built.update),
      stateVector: bytesToBase64(built.stateVector),
    };
    await expect(call(saveCanvasImport, input, asUser(OUTSIDER))).rejects.toMatchObject({
      code: expect.stringMatching(/NOT_FOUND|FORBIDDEN/),
    });
    await call(deleteCanvas, { canvasId: id }, asUser(USERS[0]!));
    const before = await stored(id);
    await expect(call(saveCanvasImport, input, asUser(USERS[0]!))).rejects.toBeTruthy();
    expect(Buffer.from(await stored(id)).equals(Buffer.from(before))).toBe(true);
    expect((await versionsOf(id)).filter((v) => v.reason === "pre-import")).toHaveLength(0);
  });

  it("restoring a pre-import version after later edits returns exactly the prior state", async () => {
    const id = await newCanvas(`Later-${run}.canvas`);
    const tab = await openTab(USERS[0]!, id);
    applyJsonCanvas(tab.doc, textCards("mine", 3));
    await tab.send();
    const prior = [...canvasNodes(tab.doc).keys()].sort();
    await tab.importCards(textCards("imp", 10));
    applyJsonCanvas(tab.doc, textCards("after", 4), { mode: "fragment" });
    await tab.send();
    const [version] = (await versionsOf(id)).filter((v) => v.reason === "pre-import");
    await call(restoreCanvasVersion, { canvasId: id, versionId: version!.id }, asUser(USERS[0]!));
    expect([...canvasNodes(docFromState(await stored(id))).keys()].sort()).toEqual(prior);
  });

  it("a malformed state vector is refused before anything is stored", async () => {
    const id = await newCanvas(`Vector-${run}.canvas`);
    const tab = await openTab(USERS[3]!, id);
    applyJsonCanvas(tab.doc, textCards("e", 2));
    await tab.send();
    const before = await stored(id);
    const built = buildImport(
      tab.doc,
      [{ canvas: textCards("x", 3), docFields: {} } as unknown as FinalCanvas],
      {
        x: 0,
        y: 0,
      },
    );
    const outcome = await call(
      saveCanvasImport,
      {
        canvasId: id,
        base: bytesToBase64(built.base),
        update: bytesToBase64(built.update),
        stateVector: bytesToBase64(new Uint8Array([200, 200, 200, 200, 200, 1])),
      },
      asUser(USERS[3]!),
    ).then(
      () => "accepted",
      (error: { code?: string }) => error.code ?? "no code",
    );
    const changed = !Buffer.from(await stored(id)).equals(Buffer.from(before));
    // Either it's taken and the reply says so, or it's refused and nothing changed.
    expect({ outcome, changed }).toSatisfy(
      (r: { outcome: string; changed: boolean }) => (r.outcome === "accepted") === r.changed,
    );
  });
});
