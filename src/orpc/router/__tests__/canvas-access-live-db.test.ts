import { call } from "@orpc/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import * as Y from "yjs";

import {
  canvasAttachments,
  canvases,
  canvasReports,
  developerProfiles,
  imageScans,
  moderationActions,
  notifications,
  teamMembers,
  teams,
  user,
} from "@/db/schema";
import { type CanvasEvent, onCanvasEvent } from "@/lib/canvas-events";
import { bytesToBase64 } from "@/lib/canvas/encoding";
import { applyJsonCanvas } from "@/lib/canvas/json-canvas";
import { revokesFor } from "@/lib/canvas/revokes";
import { applyChannel, revokeChannel, syncEnvPrefix } from "@/lib/canvas/sync-channels";
import {
  addCanvasMember,
  createCanvas,
  moveCanvasToTeam,
  removeCanvasMember,
  setCanvasHidden,
  setCanvasVisibility,
  updateCanvasMember,
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
vi.mock("@/lib/discord", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/discord")>()),
  isGuildMember: async () => true,
}));
vi.mock("@/lib/guild-sync", () => ({
  refreshDiscordProfileThrottled: async () => {},
}));
vi.mock("@/lib/queue", () => ({
  getNotificationsQueue: async () => ({ add: async () => ({}) }),
}));
vi.mock("@/lib/posthog-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/posthog-server")>()),
  isServerFlagEnabled: async () => true,
}));

/** Only the Redis client is fake: these pin what canvas-sync receives, in order. */
const redis = vi.hoisted(() => ({ published: [] as { channel: string; message: unknown }[] }));
vi.mock("@/lib/redis", () => ({
  createRedisClient: async () => ({
    status: "ready",
    once() {},
    publish: async (channel: string, raw: string) => {
      redis.published.push({ channel, message: JSON.parse(raw) });
      return 1;
    },
    set: async () => "OK",
  }),
}));

const PREFIX = syncEnvPrefix(undefined);
const REVOKE = revokeChannel(PREFIX);
const APPLY = applyChannel(PREFIX);

/** What canvas-sync hears, in publish order, as `revoke`/`apply` pairs. */
const syncMessages = () =>
  redis.published
    .filter((p) => p.channel === REVOKE || p.channel === APPLY)
    .map((p) => [p.channel === REVOKE ? "revoke" : "apply", p.message]);

let db: TestDb;
let teamId: string;
let events: CanvasEvent[];
let stopListening: () => void = () => {};

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  process.env.REDIS_URL = "redis://fake.test:6379";
  delete process.env.RAILWAY_ENVIRONMENT_NAME;
  await db.delete(canvasReports);
  await db.delete(notifications);
  await db.delete(moderationActions);
  await db.delete(imageScans);
  await db.delete(canvasAttachments);
  await db.delete(canvases);
  await db.delete(teams);
  await db.delete(developerProfiles);
  await db.delete(user);
  for (const id of ["alice", "bob", "carol"]) await seedUser(db, id);
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
  events = [];
  stopListening = onCanvasEvent((event) => events.push(event));
});
afterEach(() => stopListening());

async function personalCanvas(path = "Plan.canvas", initialState?: string) {
  const { id } = await call(
    createCanvas,
    { scope: { kind: "personal" }, path, initialState },
    asUser("alice"),
  );
  return id;
}

async function teamCanvas(path = "Board.canvas") {
  const { id } = await call(
    createCanvas,
    { scope: { kind: "team", teamId }, path },
    asUser("alice"),
  );
  return id;
}

function reset() {
  redis.published.length = 0;
  events.length = 0;
}

/** Every published revoke is exactly what `revokesFor` says the emitted events mean. */
function expectRevokesMatchEvents() {
  const fromEvents = events.flatMap(revokesFor);
  const published = syncMessages()
    .filter(([kind]) => kind === "revoke")
    .map(([, message]) => message);
  expect(published).toEqual(fromEvents);
}

describe("every access change reaches canvas-sync", () => {
  it("hide: everyone on the canvas; unhide: nothing", async () => {
    const id = await personalCanvas();
    reset();
    await call(setCanvasHidden, { canvasId: id, hidden: true, reason: "spam" }, asUser("staff"));
    expect(syncMessages()).toEqual([["revoke", { canvasId: id }]]);
    expectRevokesMatchEvents();

    reset();
    await call(setCanvasHidden, { canvasId: id, hidden: false }, asUser("staff"));
    expect(syncMessages()).toEqual([]);
  });

  it("narrowing by a team editor closes everyone's socket; widening by the owner closes none", async () => {
    const id = await teamCanvas();
    reset();
    await call(setCanvasVisibility, { canvasId: id, visibility: "public" }, asUser("alice"));
    expect(syncMessages()).toEqual([]);

    await call(setCanvasVisibility, { canvasId: id, visibility: "unlisted" }, asUser("bob"));
    await call(setCanvasVisibility, { canvasId: id, visibility: "team" }, asUser("bob"));
    expect(syncMessages()).toEqual([
      ["revoke", { canvasId: id }],
      ["revoke", { canvasId: id }],
    ]);
    expectRevokesMatchEvents();

    // A refused widening publishes nothing.
    reset();
    await expect(
      call(setCanvasVisibility, { canvasId: id, visibility: "public" }, asUser("bob")),
    ).rejects.toThrow(/team's owners/);
    expect(syncMessages()).toEqual([]);
  });

  it("member removal and leaving: that member only", async () => {
    const id = await personalCanvas();
    await call(addCanvasMember, { canvasId: id, userId: "bob", role: "editor" }, asUser("alice"));
    await call(addCanvasMember, { canvasId: id, userId: "carol", role: "viewer" }, asUser("alice"));
    reset();

    await call(removeCanvasMember, { canvasId: id, userId: "bob" }, asUser("alice"));
    await call(removeCanvasMember, { canvasId: id }, asUser("carol"));
    expect(syncMessages()).toEqual([
      ["revoke", { canvasId: id, userId: "bob" }],
      ["revoke", { canvasId: id, userId: "carol" }],
    ]);
    expectRevokesMatchEvents();
  });

  it("role downgrade to viewer: that member, so they reconnect read-only; an upgrade: nothing", async () => {
    const id = await personalCanvas();
    await call(addCanvasMember, { canvasId: id, userId: "bob", role: "editor" }, asUser("alice"));
    reset();

    await call(
      updateCanvasMember,
      { canvasId: id, userId: "bob", role: "viewer" },
      asUser("alice"),
    );
    expect(syncMessages()).toEqual([["revoke", { canvasId: id, userId: "bob" }]]);
    reset();
    await call(
      updateCanvasMember,
      { canvasId: id, userId: "bob", role: "editor" },
      asUser("alice"),
    );
    expect(syncMessages()).toEqual([]);
  });

  it("move to a team: the image copies are applied to the live doc, then everyone is closed", async () => {
    const doc = new Y.Doc();
    applyJsonCanvas(doc, {
      nodes: [
        {
          id: "card",
          type: "file",
          file: "attachments/img.png",
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          jamsTeam: { type: "image", attachmentId: "img" },
        },
      ],
    });
    const id = await personalCanvas("Pics.canvas", bytesToBase64(Y.encodeStateAsUpdate(doc)));
    await db.insert(canvasAttachments).values({
      id: "img",
      ownerId: "alice",
      path: "attachments/img.png",
      imageKey: "canvas-images/alice/img.png",
      sha256: "sha-img",
      byteSize: 10,
    });
    await call(addCanvasMember, { canvasId: id, userId: "carol", role: "editor" }, asUser("alice"));
    reset();

    await call(moveCanvasToTeam, { canvasId: id, teamId }, asUser("alice"));
    expect(syncMessages()).toEqual([
      ["apply", { canvasId: id }],
      ["revoke", { canvasId: id }],
      ["revoke", { canvasId: id, userId: "carol" }],
    ]);
    expectRevokesMatchEvents();
  });

  it("move without images: no apply, just the revokes", async () => {
    const id = await personalCanvas();
    reset();
    await call(moveCanvasToTeam, { canvasId: id, teamId }, asUser("alice"));
    expect(syncMessages()).toEqual([["revoke", { canvasId: id }]]);
  });
});
