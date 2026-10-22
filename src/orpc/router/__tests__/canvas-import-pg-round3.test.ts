/**
 * `saveCanvasImport` on a real Postgres, round 3: replayed requests, odd but
 * readable state vectors, an owner's restore racing a stale tab's import, and
 * a canvas deleted while an import waits for the row lock. Runs only with
 * CANVAS_IMPORT_PG_URL pointing at a migrated scratch database.
 */
import { call } from "@orpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { Client } from "pg";
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
const USERS = Array.from({ length: 8 }, (_, i) => `pgimp3-${run}-${i}`);
let db: TestDb;
let teamId: string;

beforeAll(async () => {
  if (!URL) return;
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  for (const id of USERS) await seedUser(db, id);
  const [team] = await db
    .insert(teams)
    .values({ slug: `pgimp3-${run}`, name: "PG import r3", createdBy: USERS[0]! })
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

function importInput(doc: Y.Doc, canvasId: string, canvas: JsonCanvas) {
  const built = buildImport(doc, [{ canvas, docFields: {} } as unknown as FinalCanvas], {
    x: 0,
    y: 0,
  });
  return {
    built,
    input: {
      canvasId,
      base: bytesToBase64(built.base),
      update: bytesToBase64(built.update),
      stateVector: bytesToBase64(built.stateVector),
    },
  };
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));
const cardTexts = (state: Uint8Array) =>
  [...canvasNodes(docFromState(state)).values()]
    .map((n) => String((n as Y.Map<unknown>).get("text")))
    .sort();

describe.skipIf(!URL)("saveCanvasImport on real Postgres: round 3", { timeout: 180_000 }, () => {
  it("a replayed import (once, then four at once) is stored once", async () => {
    const id = await newCanvas(`Replay-${run}.canvas`);
    const tab = await openTab(USERS[0]!, id);
    applyJsonCanvas(tab.doc, textCards("mine", 3));
    await tab.send();
    published.applies.length = 0;
    const { input } = importInput(tab.doc, id, textCards("imp", 5));

    await call(saveCanvasImport, input, asUser(USERS[0]!));
    const after = await stored(id);
    const versions = (await versionsOf(id)).length;
    const replies = await Promise.all(
      Array.from({ length: 4 }, () => call(saveCanvasImport, input, asUser(USERS[0]!))),
    );

    expect(sameBytes(await stored(id), after)).toBe(true);
    expect(canvasNodes(docFromState(after)).size).toBe(8);
    expect((await versionsOf(id)).length).toBe(versions);
    expect(published.applies.filter((c) => c === id)).toHaveLength(1);
    // The replies still tell the tab where the canvas stands.
    for (const reply of replies) expect(base64ToBytes(reply.stateVector).length).toBeGreaterThan(0);
  });

  it("odd but readable state vectors are answered, never a 500", async () => {
    const id = await newCanvas(`OddVector-${run}.canvas`);
    const tab = await openTab(USERS[1]!, id);
    applyJsonCanvas(tab.doc, textCards("mine", 2));
    await tab.send();
    const varuint = (v: number) => {
      const out: number[] = [];
      while (v > 127) {
        out.push((v % 128) | 128);
        v = Math.floor(v / 128);
      }
      out.push(v);
      return out;
    };
    const vectors = [
      [0],
      [1, ...varuint(123_456), ...varuint(999_999_999)],
      [1, ...varuint(2 ** 40), ...varuint(5)],
      [2, ...varuint(tab.doc.clientID), ...varuint(2 ** 31), ...varuint(7), 0],
    ];
    for (const [i, vector] of vectors.entries()) {
      const { input, built } = importInput(tab.doc, id, textCards(`v${i}-`, 1));
      const reply = await call(
        saveCanvasImport,
        { ...input, stateVector: bytesToBase64(Uint8Array.from(vector)) },
        asUser(USERS[1]!),
      );
      // Whatever the tab claimed to hold, the reply plus the import catch it up.
      const copy = docFromState(built.base);
      Y.applyUpdate(copy, built.update);
      Y.applyUpdate(copy, base64ToBytes(reply.update));
      Y.applyUpdate(tab.doc, built.update);
      expect(cardTexts(Y.encodeStateAsUpdate(copy))).toEqual(cardTexts(await stored(id)));
    }
    expect(canvasNodes(docFromState(await stored(id))).size).toBe(2 + vectors.length);
  });

  it("an owner's restore racing a stale tab's import: the pre-import version is the restored canvas", async () => {
    const id = await newCanvas(`RestoreRace-${run}.canvas`);
    const owner = await openTab(USERS[0]!, id);
    applyJsonCanvas(owner.doc, textCards("old", 2));
    await owner.send();
    applyJsonCanvas(owner.doc, textCards("new", 3), { mode: "fragment" });
    // A version holding only "old": an import keeps one of the canvas first.
    await owner.importCards(textCards("marker", 1));
    const [marker] = (await versionsOf(id)).filter((v) => v.reason === "pre-import");

    const stale = await openTab(USERS[2]!, id);
    await call(restoreCanvasVersion, { canvasId: id, versionId: marker!.id }, asUser(USERS[0]!));
    const restored = await stored(id);
    expect(cardTexts(restored)).toEqual(cardTexts(marker!.state));

    // The stale tab still holds "new" and "marker" and imports on top.
    const { input } = importInput(stale.doc, id, textCards("late", 2));
    await call(saveCanvasImport, input, asUser(USERS[2]!));
    const after = await stored(id);
    expect(cardTexts(after)).toEqual([...cardTexts(restored), "late 0", "late 1"].sort());

    const pre = (await versionsOf(id)).filter((v) => v.reason === "pre-import").at(-1)!;
    expect(cardTexts(pre.state)).toEqual(cardTexts(restored));
    await call(restoreCanvasVersion, { canvasId: id, versionId: pre.id }, asUser(USERS[0]!));
    expect(cardTexts(await stored(id))).toEqual(cardTexts(restored));
  });

  // loadCanvas checks the canvas before the row lock; each write checks it
  // again once it holds the lock.
  async function whileLocked(
    id: string,
    write: () => Promise<unknown>,
    meanwhile: () => Promise<unknown>,
  ) {
    const before = await stored(id);
    const versions = (await versionsOf(id)).length;
    published.applies.length = 0;
    const holder = new Client({ connectionString: URL });
    await holder.connect();
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT 1 FROM canvas.canvas_docs WHERE canvas_id = $1 FOR UPDATE", [id]);
      const pending = write().then(
        () => "accepted",
        (e: { code?: string }) => e.code ?? "error",
      );
      await new Promise((r) => setTimeout(r, 400));
      await meanwhile();
      await holder.query("COMMIT");
      return {
        outcome: await pending,
        changed: !sameBytes(await stored(id), before),
        versioned: (await versionsOf(id)).length !== versions,
        published: published.applies.includes(id),
      };
    } finally {
      await holder.end();
    }
  }
  const refused = (outcome: string) => ({
    outcome,
    changed: false,
    versioned: false,
    published: false,
  });
  const trash = (id: string) => () =>
    db.update(canvases).set({ deletedAt: new Date() }).where(eq(canvases.id, id));

  it("a canvas deleted while the import waits for the row lock gets nothing", async () => {
    const id = await newCanvas(`DeletedWait-${run}.canvas`);
    const tab = await openTab(USERS[0]!, id);
    applyJsonCanvas(tab.doc, textCards("mine", 2));
    await tab.send();
    const { input } = importInput(tab.doc, id, textCards("imp", 3));
    const result = await whileLocked(
      id,
      () => call(saveCanvasImport, input, asUser(USERS[0]!)),
      trash(id),
    );
    expect(result).toEqual(refused("BAD_REQUEST"));
  });

  it("an importer removed from the team while waiting for the row lock gets nothing", async () => {
    const id = await newCanvas(`RemovedWait-${run}.canvas`);
    const tab = await openTab(USERS[3]!, id);
    applyJsonCanvas(tab.doc, textCards("mine", 2));
    await tab.send();
    const { input } = importInput(tab.doc, id, textCards("imp", 3));
    try {
      const result = await whileLocked(
        id,
        () => call(saveCanvasImport, input, asUser(USERS[3]!)),
        () =>
          db
            .delete(teamMembers)
            .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, USERS[3]!))),
      );
      expect(result).toEqual(refused("NOT_FOUND"));
    } finally {
      await db.insert(teamMembers).values({ teamId, userId: USERS[3]!, role: "member" });
    }
  });

  it("a canvas deleted while a save waits for the row lock gets nothing", async () => {
    const id = await newCanvas(`DeletedSave-${run}.canvas`);
    const tab = await openTab(USERS[0]!, id);
    applyJsonCanvas(tab.doc, textCards("mine", 2));
    await tab.send();
    applyJsonCanvas(tab.doc, textCards("late", 2), { mode: "fragment" });
    const result = await whileLocked(id, tab.send, trash(id));
    expect(result).toEqual(refused("BAD_REQUEST"));
  });

  it("a canvas hidden while a save waits for the row lock gets nothing", async () => {
    const id = await newCanvas(`HiddenSave-${run}.canvas`);
    const tab = await openTab(USERS[4]!, id);
    applyJsonCanvas(tab.doc, textCards("mine", 2));
    await tab.send();
    applyJsonCanvas(tab.doc, textCards("late", 2), { mode: "fragment" });
    const result = await whileLocked(id, tab.send, () =>
      db.update(canvases).set({ hiddenAt: new Date() }).where(eq(canvases.id, id)),
    );
    expect(result).toEqual(refused("NOT_FOUND"));
  });

  it("a team archived while a save waits for the row lock gets nothing", async () => {
    const id = await newCanvas(`ArchivedSave-${run}.canvas`);
    const tab = await openTab(USERS[0]!, id);
    applyJsonCanvas(tab.doc, textCards("mine", 2));
    await tab.send();
    applyJsonCanvas(tab.doc, textCards("late", 2), { mode: "fragment" });
    try {
      const result = await whileLocked(id, tab.send, () =>
        db.update(teams).set({ status: "archived" }).where(eq(teams.id, teamId)),
      );
      expect(result).toEqual(refused("FORBIDDEN"));
    } finally {
      await db.update(teams).set({ status: "active" }).where(eq(teams.id, teamId));
    }
  });

  it("a canvas deleted while a restore waits for the row lock gets nothing", async () => {
    const id = await newCanvas(`DeletedRestore-${run}.canvas`);
    const tab = await openTab(USERS[0]!, id);
    applyJsonCanvas(tab.doc, textCards("old", 2));
    await tab.send();
    await tab.importCards(textCards("imp", 1));
    const [version] = (await versionsOf(id)).filter((v) => v.reason === "pre-import");
    const result = await whileLocked(
      id,
      () => call(restoreCanvasVersion, { canvasId: id, versionId: version!.id }, asUser(USERS[0]!)),
      trash(id),
    );
    expect(result).toEqual(refused("BAD_REQUEST"));
  });

  it("a write that waited on a lock nothing changed under still lands", async () => {
    const id = await newCanvas(`QuietWait-${run}.canvas`);
    const tab = await openTab(USERS[0]!, id);
    applyJsonCanvas(tab.doc, textCards("mine", 2));
    await tab.send();
    const { input } = importInput(tab.doc, id, textCards("imp", 3));
    const result = await whileLocked(
      id,
      () => call(saveCanvasImport, input, asUser(USERS[0]!)),
      async () => {},
    );
    expect(result).toEqual({
      outcome: "accepted",
      changed: true,
      versioned: true,
      published: true,
    });
  });
});
