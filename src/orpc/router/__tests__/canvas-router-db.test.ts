import { call } from "@orpc/server";
import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import * as Y from "yjs";

import {
  canvasAttachments,
  canvasDocVersions,
  canvases,
  itchJams,
  teamMembers,
  teams,
  user,
} from "@/db/schema";
import { docFromState } from "@/lib/canvas/doc-state";
import { base64ToBytes, bytesToBase64 } from "@/lib/canvas/encoding";
import { applyJsonCanvas, canvasNodes, docToJsonCanvas } from "@/lib/canvas/json-canvas";
import { CANVAS_LIMITS } from "@/lib/canvas/limits";
import {
  createCanvas,
  deleteCanvas,
  getCanvas,
  getCanvasEntities,
  getCanvasVersion,
  listCanvases,
  listCanvasVersions,
  listRecentCanvases,
  moveCanvas,
  openJamPlanCanvas,
  restoreCanvas,
  restoreCanvasVersion,
  saveCanvas,
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
vi.mock("@/lib/guild-sync", () => ({
  refreshGuildRolesThrottled: async () => {},
}));
let canvasesEnabled = true;
vi.mock("@/lib/posthog-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/posthog-server")>()),
  isServerFlagEnabled: async () => canvasesEnabled,
}));

let db: TestDb;
let teamId: string;
const personal = { kind: "personal" } as const;

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  const { developerProfiles } = await import("@/db/schema");
  canvasesEnabled = true;
  nonMembers.clear();
  await db.delete(canvasDocVersions);
  await db.delete(canvases);
  await db.delete(teams);
  await db.delete(developerProfiles);
  await db.delete(user);
  for (const id of ["alice", "bob", "carol", "stranger"]) await seedUser(db, id);
  await seedUser(db, "staff", { guildRoles: ["Staff"] });

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

const teamScope = () => ({ kind: "team" as const, teamId });

type Scope = typeof personal | { kind: "team"; teamId: string };

async function create(userId: string, path: string, scope: Scope = personal) {
  return call(createCanvas, { scope, path }, asUser(userId));
}

/** A tab: a doc hydrated from `getCanvas`, saving diffs against what it last synced. */
async function openTab(userId: string, canvasId: string) {
  const loaded = await call(getCanvas, { canvasId }, asUser(userId));
  const doc = docFromState(base64ToBytes(loaded.state!));
  let synced = Y.encodeStateVector(doc);
  return {
    doc,
    add(text: string) {
      applyJsonCanvas(doc, {
        nodes: [{ id: "n", type: "text", text, x: 0, y: 0, width: 100, height: 50 }],
      });
    },
    async save() {
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
      return result;
    },
    texts() {
      return docToJsonCanvas(doc)
        .nodes.map((n) => n.text)
        .sort((a, b) => a!.localeCompare(b!));
    },
  };
}

describe("the flag", () => {
  it("hides every procedure while off", async () => {
    canvasesEnabled = false;
    await expect(create("alice", "Plan.canvas")).rejects.toThrow(/Not found/);
    await expect(call(getCanvas, { canvasId: "x" }, asUser(null))).rejects.toThrow(/Not found/);
  });
});

describe("createCanvas", () => {
  it("creates a personal canvas with an empty snapshot", async () => {
    const { id, path } = await create("alice", "Jam 42/Plan.canvas");
    expect(path).toBe("Jam 42/Plan.canvas");
    const canvas = await call(getCanvas, { canvasId: id }, asUser("alice"));
    expect(canvas).toMatchObject({
      title: "Plan",
      access: "owner",
      visibility: "private",
      scope: personal,
      snapshot: { nodes: [], edges: [] },
    });
  });

  it("refuses bad paths and the wrong kind", async () => {
    await expect(create("alice", "Plan?.canvas")).rejects.toThrow(/can't contain/);
    await expect(create("alice", "Plan.md")).rejects.toThrow(/file type/);
  });

  it("treats paths differing only in case or Unicode form as the same file", async () => {
    await create("alice", "Jam/Café.canvas");
    await expect(create("alice", "jam/CAFÉ.canvas")).rejects.toThrow(/already there/);
    // Another member's personal scope is separate.
    await expect(create("bob", "Jam/Café.canvas")).resolves.toBeDefined();
  });

  it("lets team members create in the team, and nobody else", async () => {
    await expect(create("bob", "Plan.canvas", teamScope())).resolves.toBeDefined();
    await expect(create("stranger", "Other.canvas", teamScope())).rejects.toThrow(/not found/i);
    const [row] = await db.select().from(canvases).where(eq(canvases.teamId, teamId));
    expect(row!.visibility).toBe("team");
  });

  it("refuses a member outside the guild, and an archived team", async () => {
    nonMembers.add("discord-alice");
    await expect(create("alice", "Plan.canvas")).rejects.toThrow(/member of the Brackeys Discord/);
    nonMembers.clear();

    await db.update(teams).set({ status: "archived" }).where(eq(teams.id, teamId));
    await expect(create("bob", "Plan.canvas", teamScope())).rejects.toThrow(/read-only/);
  });

  it("starts from an initial state, snapshotted by the server", async () => {
    const doc = new Y.Doc();
    applyJsonCanvas(doc, {
      nodes: [{ id: "a", type: "text", text: "seed", x: 1.4, y: 0, width: 100, height: 50 }],
    });
    const { id } = await call(
      createCanvas,
      {
        scope: personal,
        path: "Seeded.canvas",
        initialState: bytesToBase64(Y.encodeStateAsUpdate(doc)),
      },
      asUser("alice"),
    );
    const canvas = await call(getCanvas, { canvasId: id }, asUser("alice"));
    expect(canvas.nodeCount).toBe(1);
    expect(canvas.snapshot.nodes).toEqual([expect.objectContaining({ text: "seed", x: 1 })]);
  });
});

describe("saveCanvas", () => {
  it("merges two tabs so neither loses work", async () => {
    const { id } = await create("alice", "Plan.canvas");
    const tab1 = await openTab("alice", id);
    const tab2 = await openTab("alice", id);

    tab1.add("from tab 1");
    await tab1.save();
    tab2.add("from tab 2");
    await tab2.save();
    // Tab 1 picks up tab 2's work from its next save's reply.
    await tab1.save();

    expect(tab1.texts()).toEqual(["from tab 1", "from tab 2"]);
    expect(tab2.texts()).toEqual(["from tab 1", "from tab 2"]);
    const canvas = await call(getCanvas, { canvasId: id }, asUser("alice"));
    expect(canvas.nodeCount).toBe(2);
  });

  it("lets team members save and refuses readers", async () => {
    const { id } = await create("alice", "Plan.canvas", teamScope());
    const bobTab = await openTab("bob", id);
    bobTab.add("bob was here");
    await bobTab.save();
    await expect(openTab("stranger", id)).rejects.toThrow(/not found/i);

    nonMembers.add("discord-bob");
    const readOnly = await call(getCanvas, { canvasId: id }, asUser("bob"));
    expect(readOnly).toMatchObject({ access: "read", state: null });
    await expect(bobTab.save()).rejects.toThrow(/only view/);
  });

  it("sanitises whatever the doc holds before readers see it", async () => {
    const { id } = await create("alice", "Plan.canvas");
    const tab = await openTab("alice", id);
    const nodes = canvasNodes(tab.doc) as unknown as Y.Map<unknown>;
    const evil = new Y.Map<unknown>();
    evil.set("type", "iframe");
    nodes.set("evil", evil);
    tab.add("fine");
    await tab.save();
    const canvas = await call(getCanvas, { canvasId: id }, asUser("alice"));
    expect(canvas.snapshot.nodes).toHaveLength(1);
  });

  it("refuses a canvas over the card cap", async () => {
    const { id } = await create("alice", "Big.canvas");
    const tab = await openTab("alice", id);
    applyJsonCanvas(tab.doc, {
      nodes: Array.from({ length: CANVAS_LIMITS.maxNodes + 1 }, (_, i) => ({
        id: `n${i}`,
        type: "text",
        text: "",
        x: 0,
        y: 0,
        width: 1,
        height: 1,
      })),
    });
    await expect(tab.save()).rejects.toThrow(/too many cards/);
  });
});

describe("reading", () => {
  it("gives readers the snapshot only, and hides private canvases entirely", async () => {
    const { id } = await create("alice", "Plan.canvas");
    await expect(call(getCanvas, { canvasId: id }, asUser(null))).rejects.toThrow(/not found/i);

    await db.update(canvases).set({ visibility: "unlisted" }).where(eq(canvases.id, id));
    const anon = await call(getCanvas, { canvasId: id }, asUser(null));
    expect(anon).toMatchObject({ access: "read", state: null });
  });

  it("records opens for the Recent list", async () => {
    const { id: a } = await create("alice", "A.canvas");
    const { id: b } = await create("alice", "B.canvas", teamScope());
    await call(getCanvas, { canvasId: a }, asUser("alice"));
    await call(getCanvas, { canvasId: b }, asUser("alice"));
    await vi.waitFor(async () => {
      const recent = await call(listRecentCanvases, {}, asUser("alice"));
      expect(recent.map((r) => r.id).sort()).toEqual([a, b].sort());
    });
    const teamOnly = await call(listRecentCanvases, { scope: teamScope() }, asUser("alice"));
    expect(teamOnly.map((r) => r.id)).toEqual([b]);
  });

  it("lists a scope's canvases in path order", async () => {
    await create("bob", "b.canvas", teamScope());
    await create("alice", "Art/A.canvas", teamScope());
    const listed = await call(listCanvases, { scope: teamScope() }, asUser("bob"));
    expect(listed.map((c) => c.path)).toEqual(["Art/A.canvas", "b.canvas"]);
    await expect(call(listCanvases, { scope: teamScope() }, asUser("stranger"))).rejects.toThrow(
      /not found/i,
    );
  });
});

describe("moving and deleting", () => {
  it("renames within the scope, refusing a taken path", async () => {
    const { id } = await create("alice", "Plan.canvas");
    await create("alice", "Other.canvas");
    await call(moveCanvas, { canvasId: id, path: "Jam/Plan v2.canvas" }, asUser("alice"));
    await expect(
      call(moveCanvas, { canvasId: id, path: "other.canvas" }, asUser("alice")),
    ).rejects.toThrow(/already there/);
  });

  it("lets any teammate delete and restore a team canvas, but only the owner a personal one", async () => {
    const { id: teamCanvas } = await create("alice", "Plan.canvas", teamScope());
    await call(deleteCanvas, { canvasId: teamCanvas }, asUser("bob"));
    const deleted = await call(listCanvases, { scope: teamScope(), deleted: true }, asUser("bob"));
    expect(deleted.map((c) => c.id)).toEqual([teamCanvas]);
    await expect(openTab("bob", teamCanvas)).rejects.toThrow();
    await call(restoreCanvas, { canvasId: teamCanvas }, asUser("bob"));

    const { id: mine } = await create("alice", "Mine.canvas");
    await expect(call(deleteCanvas, { canvasId: mine }, asUser("bob"))).rejects.toThrow(
      /not found/i,
    );
  });

  it("frees the path on delete and renames on restore if it was reused", async () => {
    const { id } = await create("alice", "Plan.canvas");
    await call(deleteCanvas, { canvasId: id }, asUser("alice"));
    await create("alice", "plan.canvas");
    const restored = await call(restoreCanvas, { canvasId: id }, asUser("alice"));
    expect(restored.path).toBe("Plan 2.canvas");
  });
});

describe("versions", () => {
  it("takes one before an hour of edits, and restores it as a new change", async () => {
    const { id } = await create("alice", "Plan.canvas");
    const tab = await openTab("alice", id);
    tab.add("first");
    await tab.save();
    // The stored state is empty until the first save, so nothing to keep yet.
    expect(
      (await call(listCanvasVersions, { canvasId: id }, asUser("alice"))).versions,
    ).toHaveLength(0);

    tab.add("second");
    await tab.save();
    tab.add("third");
    await tab.save();
    const { versions, canRestore } = await call(
      listCanvasVersions,
      { canvasId: id },
      asUser("alice"),
    );
    expect(versions).toHaveLength(1);
    expect(canRestore).toBe(true);

    const preview = await call(
      getCanvasVersion,
      { canvasId: id, versionId: versions[0]!.id },
      asUser("alice"),
    );
    expect(preview.snapshot.nodes.map((n) => n.text)).toEqual(["first"]);

    // Another tab that was open the whole time receives the restore as an edit.
    const other = await openTab("alice", id);
    const restored = await call(
      restoreCanvasVersion,
      {
        canvasId: id,
        versionId: versions[0]!.id,
        stateVector: bytesToBase64(Y.encodeStateVector(tab.doc)),
      },
      asUser("alice"),
    );
    Y.applyUpdate(tab.doc, base64ToBytes(restored.update!));
    expect(tab.texts()).toEqual(["first"]);
    await other.save();
    expect(other.texts()).toEqual(["first"]);

    const reasons = await db
      .select({ reason: canvasDocVersions.reason })
      .from(canvasDocVersions)
      .where(and(eq(canvasDocVersions.docId, id)));
    expect(reasons.map((r) => r.reason).sort()).toEqual(["hourly", "pre-restore"]);
  });

  it("takes another version once the newest is over an hour old", async () => {
    const { id } = await create("alice", "Plan.canvas");
    const tab = await openTab("alice", id);
    for (const text of ["a", "b"]) {
      tab.add(text);
      await tab.save();
    }
    await db
      .update(canvasDocVersions)
      .set({ takenAt: sql`now() - interval '2 hours'` })
      .where(eq(canvasDocVersions.docId, id));
    tab.add("c");
    await tab.save();
    const { versions } = await call(listCanvasVersions, { canvasId: id }, asUser("alice"));
    expect(versions).toHaveLength(2);
  });

  it("lets a team member see history but only a team owner restore", async () => {
    const { id } = await create("alice", "Plan.canvas", teamScope());
    const tab = await openTab("bob", id);
    for (const text of ["a", "b"]) {
      tab.add(text);
      await tab.save();
    }
    const { versions, canRestore } = await call(
      listCanvasVersions,
      { canvasId: id },
      asUser("bob"),
    );
    expect(canRestore).toBe(false);
    await expect(
      call(restoreCanvasVersion, { canvasId: id, versionId: versions[0]!.id }, asUser("bob")),
    ).rejects.toThrow(/owner/);
    await expect(
      call(restoreCanvasVersion, { canvasId: id, versionId: versions[0]!.id }, asUser("alice")),
    ).resolves.toBeDefined();
  });

  it("lets staff restore any canvas they can see, marking the kept version", async () => {
    const { id } = await create("alice", "Plan.canvas");
    const tab = await openTab("alice", id);
    for (const text of ["kept", "vandalised"]) {
      tab.add(text);
      await tab.save();
    }

    const staffView = await call(getCanvas, { canvasId: id }, asUser("staff"));
    expect(staffView.access).toBe("read");
    expect(staffView.canModerate).toBe(true);
    expect((await call(getCanvas, { canvasId: id }, asUser("alice"))).canModerate).toBe(false);

    const { versions, canRestore } = await call(
      listCanvasVersions,
      { canvasId: id },
      asUser("staff"),
    );
    expect(canRestore).toBe(true);
    await call(restoreCanvasVersion, { canvasId: id, versionId: versions[0]!.id }, asUser("staff"));

    const reopened = await openTab("alice", id);
    expect(reopened.texts()).toEqual(["kept"]);
    const reasons = await db
      .select({ reason: canvasDocVersions.reason })
      .from(canvasDocVersions)
      .where(eq(canvasDocVersions.docId, id));
    expect(reasons.map((r) => r.reason).sort()).toEqual(["hourly", "staff"]);

    await expect(call(listCanvasVersions, { canvasId: id }, asUser("carol"))).rejects.toThrow(
      /not found/i,
    );
  });
});

describe("entity cards and images", () => {
  it("resolves live cards, leaving out what the viewer couldn't open", async () => {
    await db
      .insert(itchJams)
      .values({ jamId: 42, slug: "brackeys-14", title: "Brackeys 14", status: "upcoming" });
    await db.insert(teams).values({
      id: "hidden",
      slug: "hidden",
      name: "Hidden",
      createdBy: "alice",
      hiddenAt: new Date(),
    });
    const cards = await call(
      getCanvasEntities,
      {
        refs: [
          { kind: "jam", id: "42" },
          { kind: "team", id: teamId },
          { kind: "team", id: "hidden" },
          { kind: "profile", id: "bob" },
          { kind: "forum-post", id: "999" },
        ],
      },
      asUser("alice"),
    );
    expect(cards.map((c) => c?.title ?? null)).toEqual(["Brackeys 14", "Crew", null, "bob", null]);
    expect(cards[0]).toMatchObject({ href: "/jams/brackeys-14" });
  });

  it("returns image cards' attachments from the canvas's own scope only", async () => {
    await db.insert(canvasAttachments).values([
      {
        id: "mine",
        ownerId: "alice",
        path: "attachments/a.png",
        imageKey: "canvas-images/mine/a.png",
        sha256: "x",
        byteSize: 1,
      },
      {
        id: "bobs",
        ownerId: "bob",
        path: "attachments/b.png",
        imageKey: "canvas-images/bobs/b.png",
        sha256: "x",
        byteSize: 1,
      },
    ]);
    const doc = new Y.Doc();
    applyJsonCanvas(doc, {
      nodes: ["mine", "bobs"].map((id) => ({
        id,
        type: "file",
        file: `attachments/${id}.png`,
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        brackeys: { type: "image", attachmentId: id },
      })),
    });
    const { id } = await call(
      createCanvas,
      {
        scope: personal,
        path: "Images.canvas",
        initialState: bytesToBase64(Y.encodeStateAsUpdate(doc)),
      },
      asUser("alice"),
    );
    const canvas = await call(getCanvas, { canvasId: id }, asUser("alice"));
    expect(Object.keys(canvas.attachments)).toEqual(["mine"]);
  });
});

describe("openJamPlanCanvas", () => {
  it("creates the plan once, seeded with the jam's card, then reopens it", async () => {
    await db
      .insert(itchJams)
      .values({ jamId: 7, slug: "gmtk", title: "GMTK / 2026", status: "upcoming" });
    const first = await call(openJamPlanCanvas, { jamId: 7, scope: teamScope() }, asUser("bob"));
    expect(first.created).toBe(true);
    const canvas = await call(getCanvas, { canvasId: first.id }, asUser("bob"));
    expect(canvas.path).toBe("GMTK - 2026/Plan.canvas");
    expect(canvas.snapshot.nodes[0]).toMatchObject({
      type: "link",
      brackeys: { type: "entity", entity: { kind: "jam", id: "7" } },
    });

    const again = await call(openJamPlanCanvas, { jamId: 7, scope: teamScope() }, asUser("alice"));
    expect(again).toEqual({ id: first.id, created: false });
  });
});

describe("listCanvases thumbnails", () => {
  it("adds thumbnails on request", async () => {
    const doc = new Y.Doc();
    applyJsonCanvas(doc, {
      nodes: [
        { id: "a", type: "text", text: "", x: 10, y: 20, width: 100, height: 50, color: "1" },
      ],
    });
    await call(
      createCanvas,
      {
        scope: personal,
        path: "T.canvas",
        initialState: bytesToBase64(Y.encodeStateAsUpdate(doc)),
      },
      asUser("alice"),
    );
    const [row] = await call(listCanvases, { scope: personal, thumbnails: true }, asUser("alice"));
    expect(row!.thumbnail).toEqual({
      box: { x: 10, y: 20, w: 100, h: 50 },
      rects: [[10, 20, 100, 50, "1", 0]],
    });
  });
});
