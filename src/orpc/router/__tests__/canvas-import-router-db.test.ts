/**
 * Phase 7 on the server, against the real migrated schema: imported canvases
 * created from their initial state, imports into an open canvas, and matching an
 * import's images against a scope.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import * as Y from "yjs";

import {
  buildImport,
  type FinalCanvas,
  finalizeCanvases,
  resolveImages,
} from "@/components/canvas/io/import-flow";
import { importVault } from "@/components/canvas/io/vault-import";
import {
  canvasAttachments,
  canvasDocVersions,
  canvases,
  teamMembers,
  teams,
  user,
} from "@/db/schema";
import { docFromState } from "@/lib/canvas/doc-state";
import { base64ToBytes, bytesToBase64 } from "@/lib/canvas/encoding";
import { applyJsonCanvas, docToJsonCanvas, type JsonCanvas } from "@/lib/canvas/json-canvas";
import { CANVAS_LIMITS } from "@/lib/canvas/limits";
import {
  createCanvas,
  getCanvas,
  getCanvasVersion,
  listCanvasAttachmentMatches,
  restoreCanvasVersion,
  saveCanvas,
  saveCanvasImport,
} from "@/orpc/router/canvas";
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
const nonMembers = new Set<string>();
vi.mock("@/lib/discord", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/discord")>()),
  isGuildMember: async (discordId: string) => !nonMembers.has(discordId),
}));
vi.mock("@/lib/guild-sync", () => ({ refreshDiscordProfileThrottled: async () => {} }));
vi.mock("@/lib/posthog-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/posthog-server")>()),
  isServerFlagEnabled: async () => true,
}));
vi.mock("@/orpc/client", () => ({ client: {} }));

let db: TestDb;
let teamId: string;
const personal = { kind: "personal" } as const;

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  const { developerProfiles } = await import("@/db/schema");
  nonMembers.clear();
  await db.delete(canvasAttachments);
  await db.delete(canvasDocVersions);
  await db.delete(canvases);
  await db.delete(teams);
  await db.delete(developerProfiles);
  await db.delete(user);
  for (const id of ["alice", "bob", "carol"]) await seedUser(db, id);
  const [team] = await db
    .insert(teams)
    .values({ slug: "crew", name: "Crew", createdBy: "alice" })
    .returning({ id: teams.id });
  teamId = team!.id;
  await db.insert(teamMembers).values([
    { teamId, userId: "alice", role: "owner" },
    { teamId, userId: "bob", role: "member" },
  ]);
});

const FIXTURES = join(import.meta.dirname, "../../../lib/canvas/__tests__/fixtures");
const FIXTURE_NAMES = [
  "candy-db.canvas",
  "candy-network.canvas",
  "candy-stakeholder.canvas",
  "customframes.canvas",
  "dvdd-movies.canvas",
  "jcv-demo.canvas",
  "jsoncanvas-sample.canvas",
  "obsidiantools-crazywall.canvas",
  "quartz-test.canvas",
  "siyuan-deductive-logic.canvas",
  "siyuan-large-talk.canvas",
  "synthetic-brackeys.canvas",
  "synthetic-jams-team.canvas",
  "synthetic-spec-gaps.canvas",
  "zk-links.canvas",
];

function expectedJson(name: string): JsonCanvas {
  const parsed = JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as Record<string, unknown>;
  const rename = (o: Record<string, unknown>) => {
    if (!("brackeys" in o)) return o;
    const { brackeys, ...rest } = o;
    return { ...rest, jamsTeam: brackeys };
  };
  const { jamsTeam: _a, brackeys: _b, ...top } = parsed;
  return {
    ...top,
    nodes: ((parsed.nodes as Record<string, unknown>[]) ?? []).map(rename),
    edges: parsed.edges ?? [],
  } as JsonCanvas;
}

async function importAsNewCanvas(
  userId: string,
  path: string,
  files: { path: string; bytes: Uint8Array }[],
) {
  const result = importVault(files, { mode: "new" });
  const images = await resolveImages(result.canvases, [], {
    match: async () => ({ byId: {}, bySha: {} }),
    upload: async () => {
      throw new Error("no uploads here");
    },
  });
  const [final] = finalizeCanvases(result.canvases, [], images.resolved);
  return call(
    createCanvas,
    { scope: personal, path, initialState: bytesToBase64(final!.state), source: "obsidian_canvas" },
    asUser(userId),
  );
}

describe("exit 1 through the server: a fixture imported as a new canvas", () => {
  it.each(FIXTURE_NAMES)("%s exports the same JSON after createCanvas stores it", async (name) => {
    const bytes = readFileSync(join(FIXTURES, name));
    const { id } = await importAsNewCanvas("alice", name, [{ path: name, bytes }]);
    const loaded = await call(getCanvas, { canvasId: id }, asUser("alice"));
    const doc = docFromState(base64ToBytes(loaded.state!));
    expect(docToJsonCanvas(doc)).toEqual(expectedJson(name));
  });

  it("stores no note body in the snapshot a reader gets", async () => {
    const canvas = {
      nodes: [{ id: "f", type: "file", file: "n.md", x: 0, y: 0, width: 1, height: 1 }],
    };
    const { id } = await importAsNewCanvas("alice", "N.canvas", [
      { path: "N.canvas", bytes: new TextEncoder().encode(JSON.stringify(canvas)) },
      { path: "n.md", bytes: new TextEncoder().encode("SECRET BODY\r\n") },
    ]);
    const [row] = await db
      .select({ snapshot: canvases.snapshot })
      .from(canvases)
      .where(eq(canvases.id, id));
    expect(JSON.stringify(row!.snapshot)).not.toContain("SECRET BODY");
    const loaded = await call(getCanvas, { canvasId: id }, asUser("alice"));
    expect(JSON.stringify(loaded.snapshot)).not.toContain("SECRET BODY");
    // The body is in the doc itself.
    const doc = docFromState(base64ToBytes(loaded.state!));
    expect(Y.encodeStateAsUpdate(doc).length).toBeGreaterThan(0);
    expect(JSON.stringify(doc.getMap("nodes").toJSON())).toContain("SECRET BODY");
  });

  it("an import over the state cap creates no row", async () => {
    const doc = new Y.Doc();
    applyJsonCanvas(doc, {
      nodes: Array.from({ length: 300 }, (_, i) => ({
        id: `n${i}`,
        type: "text",
        text: "x".repeat(19_000),
        x: 0,
        y: 0,
        width: 1,
        height: 1,
      })),
    });
    const state = Y.encodeStateAsUpdate(doc);
    expect(state.length).toBeGreaterThan(CANVAS_LIMITS.maxStateBytes);
    await expect(
      call(
        createCanvas,
        {
          scope: personal,
          path: "Big.canvas",
          initialState: bytesToBase64(state),
          source: "obsidian_zip",
        },
        asUser("alice"),
      ),
    ).rejects.toThrow();
    expect(await db.select({ id: canvases.id }).from(canvases)).toEqual([]);
  });
});

/** An open tab, as the editor holds it. */
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
  /** An import as the editor sends it: built on a copy, applied here once stored. */
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
  const add = (id: string, text: string) =>
    applyJsonCanvas(doc, { nodes: [{ id, type: "text", text, x: 0, y: 0, width: 1, height: 1 }] });
  return { doc, send, add, importCards };
}

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

async function versionsOf(canvasId: string) {
  return db
    .select({ id: canvasDocVersions.id, reason: canvasDocVersions.reason })
    .from(canvasDocVersions)
    .where(eq(canvasDocVersions.docId, canvasId))
    .orderBy(canvasDocVersions.takenAt);
}

async function previewTexts(userId: string, canvasId: string, versionId: number) {
  const preview = await call(getCanvasVersion, { canvasId, versionId }, asUser(userId));
  return preview.snapshot.nodes.map((n) => n.text ?? "").sort((a, b) => a.localeCompare(b));
}

describe("saveCanvasImport: an import into an open canvas", { timeout: 30_000 }, () => {
  it("keeps exactly the state before the import, even right after an hourly version", async () => {
    const { id } = await call(createCanvas, { scope: personal, path: "P.canvas" }, asUser("alice"));
    const tab = await openTab("alice", id);
    tab.add("one", "first");
    await tab.send();
    tab.add("two", "second");
    await tab.send(); // an hourly version was taken by the first change; none now
    const before = (await versionsOf(id)).length;

    await tab.importCards(textCards("imp", 1));
    const versions = await versionsOf(id);
    expect(versions.length).toBe(before + 1);
    expect(versions.at(-1)!.reason).toBe("pre-import");
    expect(await previewTexts("alice", id, versions.at(-1)!.id)).toEqual(["first", "second"]);
    expect((await call(getCanvas, { canvasId: id }, asUser("alice"))).nodeCount).toBe(3);
  });

  it("holds the tab's edits the server hadn't stored yet in the version and the canvas", async () => {
    const { id } = await call(createCanvas, { scope: personal, path: "P.canvas" }, asUser("alice"));
    const tab = await openTab("alice", id);
    tab.add("one", "stored");
    await tab.send();
    tab.add("two", "only in the tab"); // live: still in canvas-sync's debounce

    await tab.importCards(textCards("imp", 2));
    const versions = await versionsOf(id);
    expect(await previewTexts("alice", id, versions.at(-1)!.id)).toEqual([
      "only in the tab",
      "stored",
    ]);
    expect((await call(getCanvas, { canvasId: id }, asUser("alice"))).nodeCount).toBe(4);
  });

  it("restores the pre-import version to the canvas as it was, an empty one included", async () => {
    const { id } = await call(createCanvas, { scope: personal, path: "P.canvas" }, asUser("alice"));
    const tab = await openTab("alice", id);
    await tab.importCards(textCards("imp", 3));
    const [version] = await versionsOf(id);
    expect(version!.reason).toBe("pre-import");

    await call(restoreCanvasVersion, { canvasId: id, versionId: version!.id }, asUser("alice"));
    expect((await call(getCanvas, { canvasId: id }, asUser("alice"))).nodeCount).toBe(0);
  });

  it("refuses an import over the card cap whole: nothing stored, no version", async () => {
    const { id } = await call(createCanvas, { scope: personal, path: "P.canvas" }, asUser("alice"));
    const tab = await openTab("alice", id);
    applyJsonCanvas(tab.doc, textCards("e", 1_500));
    await tab.send();
    const before = await versionsOf(id);

    await expect(tab.importCards(textCards("imp", 600))).rejects.toThrow(
      /2,100 cards; a canvas holds 2,000\. Nothing was imported\./,
    );
    expect(await versionsOf(id)).toEqual(before);
    expect((await call(getCanvas, { canvasId: id }, asUser("alice"))).nodeCount).toBe(1_500);
  });

  it("refuses an import over the state cap whole", async () => {
    const { id } = await call(createCanvas, { scope: personal, path: "P.canvas" }, asUser("alice"));
    const tab = await openTab("alice", id);
    const big = {
      nodes: Array.from({ length: 60 }, (_, i) => ({
        id: `b${i}`,
        type: "text",
        text: "x".repeat(19_000) + i,
        x: 0,
        y: 0,
        width: 1,
        height: 1,
      })),
      edges: [],
    };
    for (let round = 0; round < 4; round++) applyJsonCanvas(tab.doc, big, { mode: "fragment" });
    await tab.send();
    await expect(tab.importCards(big)).rejects.toThrow(/MB; a canvas holds 5\.0 MB/);
    expect((await call(getCanvas, { canvasId: id }, asUser("alice"))).nodeCount).toBe(240);
  }, 60_000);

  it("two tabs importing at once can't add up past the cap", async () => {
    const { id } = await call(
      createCanvas,
      { scope: { kind: "team", teamId }, path: "T.canvas" },
      asUser("alice"),
    );
    const alice = await openTab("alice", id);
    applyJsonCanvas(alice.doc, textCards("e", 1_000));
    await alice.send();
    const bob = await openTab("bob", id);

    const results = await Promise.allSettled([
      alice.importCards(textCards("a", 600)),
      bob.importCards(textCards("b", 600)),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect((await call(getCanvas, { canvasId: id }, asUser("alice"))).nodeCount).toBe(1_600);
    expect((await versionsOf(id)).filter((v) => v.reason === "pre-import")).toHaveLength(1);
  });

  it("a teammate who can write gets one too; a reader is refused", async () => {
    const { id } = await call(
      createCanvas,
      { scope: { kind: "team", teamId }, path: "T.canvas" },
      asUser("alice"),
    );
    const bob = await openTab("bob", id);
    bob.add("a", "a");
    await bob.send();
    await bob.importCards(textCards("b", 1));
    expect((await versionsOf(id)).map((v) => v.reason)).toContain("pre-import");

    nonMembers.add("discord-bob");
    await expect(bob.importCards(textCards("c", 1))).rejects.toThrow();
  });
});

describe("listCanvasAttachmentMatches", () => {
  const sha = (c: string) => c.repeat(64);
  const match = (
    userId: string,
    scope: typeof personal | { kind: "team"; teamId: string },
    ids: string[],
    shas: string[],
  ) =>
    call(listCanvasAttachmentMatches, { scope, attachmentIds: ids, sha256s: shas }, asUser(userId));

  beforeEach(async () => {
    await db.insert(canvasAttachments).values([
      {
        id: "mine",
        ownerId: "alice",
        path: "a/one.png",
        imageKey: "k1",
        sha256: sha("1"),
        byteSize: 1,
      },
      {
        id: "bobs",
        ownerId: "bob",
        path: "a/one.png",
        imageKey: "k2",
        sha256: sha("2"),
        byteSize: 1,
      },
      {
        id: "team",
        ownerId: "bob",
        teamId,
        path: "t.png",
        imageKey: "k3",
        sha256: sha("3"),
        byteSize: 1,
      },
    ]);
  });

  it("never matches another member's personal images, by id or by sha", async () => {
    const out = await match("alice", personal, ["bobs", "team"], [sha("2"), sha("3")]);
    expect(out).toEqual({ byId: {}, bySha: {} });
  });

  it("a personal attachment never matches into a team scope, and vice versa", async () => {
    expect(await match("alice", { kind: "team", teamId }, ["mine"], [sha("1")])).toEqual({
      byId: {},
      bySha: {},
    });
    expect((await match("alice", { kind: "team", teamId }, ["team"], [])).byId).toHaveProperty(
      "team",
    );
  });

  it("refuses a team the caller isn't in", async () => {
    await expect(match("carol", { kind: "team", teamId }, ["team"], [])).rejects.toThrow();
  });

  it("validates its input: sha256 format and the 2,000 cap", async () => {
    await expect(match("alice", personal, [], ["NOTHEX"])).rejects.toThrow();
    await expect(match("alice", personal, [], [sha("A")])).rejects.toThrow();
    const many = Array.from({ length: 2_001 }, (_, i) => `id-${i}`);
    await expect(match("alice", personal, many, [])).rejects.toThrow();
    const ok = await match("alice", personal, many.slice(0, 2_000), []);
    expect(ok).toEqual({ byId: {}, bySha: {} });
  });

  it("an empty request returns empty maps without querying", async () => {
    expect(await match("alice", personal, [], [])).toEqual({ byId: {}, bySha: {} });
  });

  it("a soft-deleted row stops matching once deleted", async () => {
    expect((await match("alice", personal, ["mine"], [])).byId).toHaveProperty("mine");
    await db
      .update(canvasAttachments)
      .set({ deletedAt: new Date() })
      .where(eq(canvasAttachments.id, "mine"));
    expect(await match("alice", personal, ["mine"], [sha("1")])).toEqual({ byId: {}, bySha: {} });
  });
});
