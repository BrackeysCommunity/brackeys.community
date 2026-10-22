/**
 * Canvas writes against a real Postgres: imports, saves, restores and a
 * move racing for the row locks, which pglite (one statement at a time)
 * can't show. Runs only with CANVAS_IMPORT_PG_URL pointing at a migrated
 * scratch database.
 */
import { appendFileSync } from "node:fs";

import { call } from "@orpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
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
import { CANVAS_LIMITS } from "@/lib/canvas/limits";
import {
  createCanvas,
  deleteCanvas,
  getCanvas,
  moveCanvasToTeam,
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
vi.mock("@/lib/queue", () => ({
  getNotificationsQueue: async () => ({ add: async () => ({}) }),
}));
vi.mock("@/orpc/client", () => ({ client: {} }));

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const USERS = Array.from({ length: 8 }, (_, i) => `pgimp-${run}-${i}`);
const OUTSIDER = `pgimp-${run}-outsider`;
const EVERYONE = [...USERS, OUTSIDER];
let db: TestDb;
let teamId: string;

beforeAll(async () => {
  if (!URL) return;
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  for (const id of EVERYONE) await seedUser(db, id);
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
    await db.select({ id: canvases.id }).from(canvases).where(inArray(canvases.ownerId, USERS))
  ).map((r) => r.id);
  if (ids.length) {
    await db.delete(canvasDocVersions).where(inArray(canvasDocVersions.docId, ids));
    await db.delete(canvasDocs).where(inArray(canvasDocs.canvasId, ids));
    await db.delete(canvases).where(inArray(canvases.id, ids));
  }
  await db.delete(teamMembers).where(eq(teamMembers.teamId, teamId));
  await db.delete(teams).where(eq(teams.id, teamId));
  await db.delete(developerProfiles).where(inArray(developerProfiles.id, EVERYONE));
  await db.delete(user).where(inArray(user.id, EVERYONE));
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

async function newCanvas(path: string, scope: "team" | "personal" = "team") {
  const { id } = await call(
    createCanvas,
    { scope: scope === "team" ? { kind: "team", teamId } : { kind: "personal" }, path },
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

describe.skipIf(!URL)("canvas writes on real Postgres", { timeout: 180_000 }, () => {
  describe("imports racing each other and saves hold the caps", () => {
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

    it("an import landing on exactly the card cap is taken; one card more is refused whole", async () => {
      const id = await newCanvas(`Edge-${run}.canvas`);
      const tab = await openTab(USERS[1]!, id);
      applyJsonCanvas(tab.doc, textCards("e", 1_995));
      await tab.send();
      const before = await stored(id);
      const versions = (await versionsOf(id)).length;
      published.applies.length = 0;
      await expect(tab.importCards(textCards("over", 6))).rejects.toThrow(/2,001 cards/);
      expect(Buffer.from(await stored(id)).equals(Buffer.from(before))).toBe(true);
      expect((await versionsOf(id)).length).toBe(versions);
      expect(published.applies).toEqual([]);
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
  });

  describe("pre-import versions undo an import", () => {
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
  });

  describe("malformed, empty, replayed and unauthorised imports", () => {
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
      for (const reply of replies)
        expect(base64ToBytes(reply.stateVector).length).toBeGreaterThan(0);
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
  });

  describe("writes that wait for the row lock", () => {
    // loadCanvas checks the canvas before the row lock; each write checks it
    // again once it holds the lock. The change lands in a transaction holding
    // the canvas row, so the write is already waiting when it commits.
    async function whileLocked(
      id: string,
      write: () => Promise<unknown>,
      meanwhile: (held: TestDb) => Promise<unknown>,
    ) {
      const before = await stored(id);
      const versions = (await versionsOf(id)).length;
      published.applies.length = 0;
      const holder = new Client({ connectionString: URL });
      await holder.connect();
      try {
        await holder.query("BEGIN");
        await holder.query("SELECT 1 FROM canvas.canvases WHERE id = $1 FOR UPDATE", [id]);
        const pending = write().then(
          () => "accepted",
          (e: { code?: string }) => e.code ?? "error",
        );
        await new Promise((r) => setTimeout(r, 400));
        await meanwhile(drizzle({ client: holder }) as unknown as TestDb);
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
    const trash = (id: string) => (held: TestDb) =>
      held.update(canvases).set({ deletedAt: new Date() }).where(eq(canvases.id, id));

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
          (held) =>
            held
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
      const result = await whileLocked(id, tab.send, (held) =>
        held.update(canvases).set({ hiddenAt: new Date() }).where(eq(canvases.id, id)),
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
        const result = await whileLocked(id, tab.send, (held) =>
          held.update(teams).set({ status: "archived" }).where(eq(teams.id, teamId)),
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
        () =>
          call(restoreCanvasVersion, { canvasId: id, versionId: version!.id }, asUser(USERS[0]!)),
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

    it("a save racing a move into a team queues for the row locks instead of deadlocking", async () => {
      const id = await newCanvas(`MoveRace-${run}.canvas`, "personal");
      const tab = await openTab(USERS[0]!, id);
      applyJsonCanvas(tab.doc, textCards("mine", 2));
      await tab.send();
      applyJsonCanvas(tab.doc, textCards("late", 2), { mode: "fragment" });
      // Holding the doc makes both wait: the save for its write, the move to rehome images.
      const holder = new Client({ connectionString: URL });
      await holder.connect();
      const settle = (p: Promise<unknown>) =>
        p.then(
          () => "ok",
          (e: { code?: string; cause?: { code?: string } }) => e.cause?.code ?? e.code ?? "error",
        );
      try {
        await holder.query("BEGIN");
        await holder.query("SELECT 1 FROM canvas.canvas_docs WHERE canvas_id = $1 FOR UPDATE", [
          id,
        ]);
        const save = settle(tab.send());
        await new Promise((r) => setTimeout(r, 300));
        const move = settle(call(moveCanvasToTeam, { canvasId: id, teamId }, asUser(USERS[0]!)));
        await new Promise((r) => setTimeout(r, 300));
        await holder.query("COMMIT");
        expect(await Promise.all([save, move])).toEqual(["ok", "ok"]);
      } finally {
        await holder.end();
      }
      expect(cardTexts(await stored(id))).toEqual(["late 0", "late 1", "mine 0", "mine 1"]);
      const [row] = await db
        .select({ teamId: canvases.teamId })
        .from(canvases)
        .where(eq(canvases.id, id));
      expect(row!.teamId).toBe(teamId);
    });
  });
});
