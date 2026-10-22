import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";

import { eq } from "drizzle-orm";
import * as Y from "yjs";

import { canvasDocs } from "../../../src/db/schema.ts";
import { type CanvasEvent, revokesFor } from "../../../src/lib/canvas/revokes.ts";
import {
  documentName,
  REVOKE_CLOCK_SKEW_MS,
  SYNC_CLOSE,
} from "../../../src/lib/canvas/sync-channels.ts";
import { signCanvasToken } from "../../../src/lib/canvas/token.ts";
import type { ServiceDb } from "../src/db.ts";
import { startServer, type SyncServer } from "../src/index.ts";
import {
  addCard,
  connect,
  SECRET,
  seedCanvas,
  sleep,
  storedNodeIds,
  storedState,
  synced,
  TEST_DATABASE_URL,
  testDb,
  type TestClient,
  until,
  warnSkipped,
} from "./harness.ts";

setDefaultTimeout(30_000);

if (!TEST_DATABASE_URL) warnSkipped("access changes", "CANVAS_SYNC_TEST_DATABASE_URL");

/**
 * The web app's side of each access change, as canvas-sync receives it:
 * the event's `revokesFor` messages (what `emitCanvasEvent` publishes) and,
 * for a move, the apply that precedes them.
 */
describe.skipIf(!TEST_DATABASE_URL)("every access change closes or updates live sockets", () => {
  let db: ServiceDb;
  let end: () => Promise<void>;
  let server: SyncServer;
  const clients: TestClient[] = [];

  beforeAll(async () => {
    ({ db, end } = testDb());
    server = await startServer({
      port: 0,
      secret: SECRET,
      db,
      instanceId: "access-changes",
      telemetry: { captureException() {}, capture() {}, async shutdown() {} },
      debounceMs: 200,
      maxDebounceMs: 1000,
    });
  });

  afterAll(async () => {
    for (const client of clients) client.destroy();
    await server.stop(5000);
    await end();
  });

  const scope = { kind: "personal", ownerId: "alice" } as const;

  /** The owner and a member editing, and a stranger reading, all synced. */
  async function liveCanvas() {
    const canvasId = await seedCanvas(db);
    const alice = connect(server.port, canvasId, "alice");
    const bob = connect(server.port, canvasId, "bob");
    const rita = connect(server.port, canvasId, "rita", { access: "read" });
    clients.push(alice, bob, rita);
    for (const client of [alice, bob, rita]) expect(await synced(client)).toBe(true);
    return { canvasId, alice, bob, rita };
  }

  function deliver(event: CanvasEvent): number {
    let closed = 0;
    for (const message of revokesFor(event)) closed += server.handleRevoke(message);
    return closed;
  }

  const revoked = (client: TestClient) =>
    until(() => client.closes.includes(SYNC_CLOSE.revoked), 3000);

  async function stillOpen(...open: TestClient[]) {
    await sleep(300);
    for (const client of open) {
      expect(client.closes).toEqual([]);
      expect(client.provider.isSynced).toBe(true);
    }
  }

  it("hide closes everyone on the canvas", async () => {
    const { canvasId, alice, bob, rita } = await liveCanvas();
    expect(deliver({ type: "hidden", canvasId, scope })).toBe(3);
    for (const client of [alice, bob, rita]) expect(await revoked(client)).toBe(true);
  });

  it("narrowing closes everyone; widening closes nobody", async () => {
    const { canvasId, alice, bob, rita } = await liveCanvas();
    expect(
      deliver({ type: "visibility_changed", canvasId, scope, from: "team", to: "public" }),
    ).toBe(0);
    await stillOpen(alice, bob, rita);

    expect(
      deliver({ type: "visibility_changed", canvasId, scope, from: "public", to: "unlisted" }),
    ).toBe(3);
    for (const client of [alice, bob, rita]) expect(await revoked(client)).toBe(true);
  });

  it("member removal closes that member only", async () => {
    const { canvasId, alice, bob, rita } = await liveCanvas();
    expect(deliver({ type: "member_removed", canvasId, scope, userId: "bob" })).toBe(1);
    expect(await revoked(bob)).toBe(true);
    await stillOpen(alice, rita);
    addCard(alice, "after");
    expect(await until(() => rita.nodes.has("after"))).toBe(true);
  });

  it("a downgrade to viewer closes that member, who comes back read-only; an upgrade closes nobody", async () => {
    const { canvasId, alice, bob } = await liveCanvas();
    expect(
      deliver({ type: "member_role_changed", canvasId, scope, userId: "bob", role: "editor" }),
    ).toBe(0);
    await stillOpen(alice, bob);

    expect(
      deliver({ type: "member_role_changed", canvasId, scope, userId: "bob", role: "viewer" }),
    ).toBe(1);
    expect(await revoked(bob)).toBe(true);
    bob.destroy();

    // The token the site mints next, after the revoke's skew window.
    const token = await signCanvasToken(
      { c: documentName("canvas", canvasId), u: "bob", a: "read" },
      SECRET,
      Date.now() + REVOKE_CLOCK_SKEW_MS + 500,
    );
    const reader = connect(server.port, canvasId, "bob", {
      access: "read",
      token: async () => token,
    });
    clients.push(reader);
    expect(await synced(reader)).toBe(true);
    addCard(reader, "from-bob");
    addCard(alice, "from-alice");
    expect(await until(() => reader.nodes.has("from-alice"))).toBe(true);
    await sleep(600);
    expect(alice.nodes.has("from-bob")).toBe(false);
    expect(await storedNodeIds(db, canvasId)).toEqual(["from-alice"]);
    expect(alice.closes).toEqual([]);
  });

  /** What the move's image rehome does: an edit on top of the stored state, written directly. */
  async function rehomeInDb(canvasId: string, cardId: string) {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, (await storedState(db, canvasId))!);
    (doc.getMap("nodes").get(cardId) as Y.Map<unknown>).set("attachmentId", "team-copy");
    await db
      .update(canvasDocs)
      .set({ state: Buffer.from(Y.encodeStateAsUpdate(doc)) })
      .where(eq(canvasDocs.canvasId, canvasId));
  }

  async function storedAttachment(canvasId: string, cardId: string) {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, (await storedState(db, canvasId))!);
    return (doc.getMap("nodes").get(cardId) as Y.Map<unknown> | undefined)?.get("attachmentId");
  }

  async function moveScenario(applyFirst: boolean) {
    const { canvasId, alice, bob, rita } = await liveCanvas();
    addCard(alice, "img");
    expect(await until(async () => (await storedNodeIds(db, canvasId)).includes("img"))).toBe(true);
    await sleep(300);

    await rehomeInDb(canvasId, "img");
    const moved: CanvasEvent[] = [
      {
        type: "moved_to_team",
        canvasId,
        scope: { kind: "team", teamId: "t1" },
        fromOwnerId: "alice",
      },
      { type: "member_removed", canvasId, scope: { kind: "team", teamId: "t1" }, userId: "bob" },
    ];
    if (applyFirst) {
      expect(await server.handleApply({ canvasId })).toBe(true);
      const card = alice.nodes.get("img") as Y.Map<unknown>;
      expect(await until(() => card.get("attachmentId") === "team-copy")).toBe(true);
    } else {
      void server.handleApply({ canvasId });
    }
    for (const event of moved) deliver(event);
    for (const client of [alice, bob, rita]) expect(await revoked(client)).toBe(true);

    // Unloading stores the live doc merged over what's stored: the rehome survives.
    expect(
      await until(() => !server.hocuspocus.documents.has(documentName("canvas", canvasId)), 5000),
    ).toBe(true);
    expect(await storedAttachment(canvasId, "img")).toBe("team-copy");
    // And whoever opens it next, with a fresh token, gets the team copy.
    const token = await signCanvasToken(
      { c: documentName("canvas", canvasId), u: "alice", a: "write" },
      SECRET,
      Date.now() + REVOKE_CLOCK_SKEW_MS + 500,
    );
    const next = connect(server.port, canvasId, "alice", { token: async () => token });
    clients.push(next);
    expect(await synced(next)).toBe(true);
    expect((next.nodes.get("img") as Y.Map<unknown>).get("attachmentId")).toBe("team-copy");
  }

  it("a move applies the image copies to the live doc, then closes everyone", async () => {
    await moveScenario(true);
  });

  it("a move whose revoke overtakes its apply still keeps the image copies", async () => {
    await moveScenario(false);
  });
});
