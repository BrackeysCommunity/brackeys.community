/**
 * `saveCanvasImport` against a real Postgres (pglite runs one statement at
 * a time, so it can't show two transactions racing for the row lock). Runs
 * only with CANVAS_IMPORT_PG_URL pointing at a migrated scratch database.
 */
import { appendFileSync } from "node:fs";

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
  getCanvas,
  restoreCanvasVersion,
  saveCanvas,
  saveCanvasImport,
} from "@/orpc/router/canvas";
import { seedUser, type TestDb } from "@/test/db";
import { asUser } from "@/test/orpc";

const URL = process.env.CANVAS_IMPORT_PG_URL;
const report = (line: string) =>
  process.env.CANVAS_IMPORT_PG_REPORT &&
  appendFileSync(process.env.CANVAS_IMPORT_PG_REPORT, `${line}\n`);

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
const USERS = Array.from({ length: 8 }, (_, i) => `pgimp-${run}-${i}`);
let db: TestDb;
let teamId: string;

beforeAll(async () => {
  if (!URL) return;
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  for (const id of USERS) await seedUser(db, id);
  const [team] = await db
    .insert(teams)
    .values({ slug: `pgimp-${run}`, name: "PG import", createdBy: USERS[0]! })
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

describe.skipIf(!URL)("saveCanvasImport on real Postgres", { timeout: 120_000 }, () => {
  it("eight tabs dropping 300 cards at once onto 1,000 never pass 2,000", async () => {
    const id = await newCanvas(`Race-${run}.canvas`);
    const seed = await openTab(USERS[0]!, id);
    applyJsonCanvas(seed.doc, textCards("e", 1_000));
    await seed.send();
    published.applies.length = 0;

    const tabs = await Promise.all(USERS.map((u) => openTab(u, id)));
    const results = await Promise.allSettled(
      tabs.map((tab, i) => tab.importCards(textCards(`t${i}-`, 300))),
    );
    const accepted = results.filter((r) => r.status === "fulfilled").length;
    const refused = results.filter((r) => r.status === "rejected");
    expect(accepted).toBe(3);
    for (const r of refused) {
      expect(String((r as PromiseRejectedResult).reason)).toMatch(/Nothing was imported/);
    }
    const nodes = canvasNodes(docFromState(await stored(id))).size;
    expect(nodes).toBe(1_900);
    expect(nodes).toBeLessThanOrEqual(CANVAS_LIMITS.maxNodes);
    const row = (await call(getCanvas, { canvasId: id }, asUser(USERS[0]!))).nodeCount;
    expect(row).toBe(1_900);

    // One pre-import version per accepted import, each the state just before it,
    // and `takenAt` (taken under the lock) sorts them in commit order.
    const versions = (await versionsOf(id)).filter((v) => v.reason === "pre-import");
    expect(versions).toHaveLength(3);
    expect(versions.map((v) => canvasNodes(docFromState(new Uint8Array(v.state))).size)).toEqual([
      1_000, 1_300, 1_600,
    ]);
    const byTakenAt = [...versions].sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime());
    expect(byTakenAt.map((v) => v.id)).toEqual(versions.map((v) => v.id));
    expect(published.applies.filter((c) => c === id)).toHaveLength(3);
  });

  it("imports racing ordinary saves still hold the cap, and saves past it are refused", async () => {
    const id = await newCanvas(`Mixed-${run}.canvas`);
    const seed = await openTab(USERS[0]!, id);
    applyJsonCanvas(seed.doc, textCards("e", 1_400));
    await seed.send();

    const importers = await Promise.all(USERS.slice(0, 4).map((u) => openTab(u, id)));
    const savers = await Promise.all(USERS.slice(4).map((u) => openTab(u, id)));
    savers.forEach((tab, i) =>
      applyJsonCanvas(tab.doc, textCards(`s${i}-`, 150), { mode: "fragment" }),
    );
    await Promise.allSettled([
      ...importers.map((tab, i) => tab.importCards(textCards(`i${i}-`, 200))),
      ...savers.map((tab) => tab.send()),
    ]);
    expect(canvasNodes(docFromState(await stored(id))).size).toBeLessThanOrEqual(
      CANVAS_LIMITS.maxNodes,
    );
  });

  it("restoring a pre-import version takes the canvas back to just before that import", async () => {
    const id = await newCanvas(`Restore-${run}.canvas`);
    const tab = await openTab(USERS[1]!, id);
    applyJsonCanvas(tab.doc, textCards("mine", 4));
    await tab.send();
    applyJsonCanvas(tab.doc, textCards("unsent", 2), { mode: "fragment" });
    await tab.importCards(textCards("imp", 50));
    const [version] = (await versionsOf(id)).filter((v) => v.reason === "pre-import");
    // Restoring is the owner's (or staff's); the importer here is a teammate.
    await call(restoreCanvasVersion, { canvasId: id, versionId: version!.id }, asUser(USERS[0]!));
    const doc = docFromState(await stored(id));
    expect([...canvasNodes(doc).keys()].sort()).toEqual(
      [...canvasNodes(docFromState(new Uint8Array(version!.state))).keys()].sort(),
    );
    expect(canvasNodes(doc).size).toBe(6);
  });

  it("a refused import leaves the row, versions and channel untouched", async () => {
    const id = await newCanvas(`Refuse-${run}.canvas`);
    const tab = await openTab(USERS[2]!, id);
    applyJsonCanvas(tab.doc, textCards("e", 1_990));
    await tab.send();
    const before = await stored(id);
    const versions = (await versionsOf(id)).length;
    published.applies.length = 0;
    await expect(tab.importCards(textCards("x", 11))).rejects.toThrow(/2,001 cards/);
    expect(Buffer.from(await stored(id)).equals(Buffer.from(before))).toBe(true);
    expect((await versionsOf(id)).length).toBe(versions);
    expect(published.applies).toEqual([]);
  });

  it("garbage update bytes are refused without touching the row", async () => {
    const id = await newCanvas(`Garbage-${run}.canvas`);
    const tab = await openTab(USERS[3]!, id);
    applyJsonCanvas(tab.doc, textCards("e", 3));
    await tab.send();
    const before = await stored(id);
    const garbage = new Uint8Array(64).map((_, i) => (i * 37 + 11) % 256);
    const outcome = await call(
      saveCanvasImport,
      {
        canvasId: id,
        base: bytesToBase64(Y.encodeStateAsUpdate(tab.doc)),
        update: bytesToBase64(garbage),
        stateVector: bytesToBase64(Y.encodeStateVector(tab.doc)),
      },
      asUser(USERS[3]!),
    ).then(
      () => "accepted",
      (error: { code?: string; message?: string }) =>
        `${error.code ?? "no code"}: ${error.message}`,
    );
    const after = await stored(id);
    expect(outcome).toMatch(/^BAD_REQUEST/);
    expect(Buffer.from(after).equals(Buffer.from(before))).toBe(true);
    report(
      `garbage update outcome: ${outcome}; row changed: ${!Buffer.from(after).equals(Buffer.from(before))}`,
    );
  });

  it("an import that changes nothing writes no version and publishes nothing", async () => {
    const id = await newCanvas(`Empty-${run}.canvas`);
    const tab = await openTab(USERS[4]!, id);
    applyJsonCanvas(tab.doc, textCards("e", 3));
    await tab.send();
    const before = (await versionsOf(id)).length;
    published.applies.length = 0;
    for (let i = 0; i < 5; i++) {
      await call(
        saveCanvasImport,
        {
          canvasId: id,
          base: bytesToBase64(new Uint8Array([0, 0])),
          update: bytesToBase64(new Uint8Array([0, 0])),
          stateVector: bytesToBase64(Y.encodeStateVector(tab.doc)),
        },
        asUser(USERS[4]!),
      );
    }
    const added = (await versionsOf(id)).length - before;
    report(`no-op imports wrote ${added} versions`);
    expect(added).toBe(0);
    expect(published.applies).toEqual([]);
  });
});
