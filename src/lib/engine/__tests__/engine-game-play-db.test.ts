import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { db as mockedDb } from "@/db";
import {
  engineProjects,
  engineReleaseChannels,
  engineReleaseJamLinks,
  engineReleases,
  itchJams,
  projects,
  teams,
} from "@/db/schema";
import { seedUser, type TestDb } from "@/test/db";

import { forgetProjectReleases } from "../frame-route";
import { verifyFrameToken } from "../frame-token";
import { resolvePlay, type PlayDeps } from "../game-play";
import { readGameSettings } from "../game-settings";
import type { Viewer } from "../release-access";
import { promote } from "../release-channels";
import { ReleaseError } from "../release-errors";
import { memoryReleaseStore } from "../release-storage";
import {
  beginRelease,
  commitRelease,
  putReleaseFile,
  type Actor,
  type ReleaseDeps,
  type ReleaseTxDb,
} from "../release-upload";
import { viewerOf } from "../viewer";
import { plannedRelease, type PlannedRelease } from "./release-fixture";

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return { db: await createTestDb() } as unknown as typeof import("@/db");
});

const db = mockedDb as unknown as TestDb;

const PROJECT = "play-fixture";
const GAME = "fixture-game";
const NOW = new Date("2026-11-12T15:00:00Z");
const PLAY_ORIGIN = "https://play.jams.test";
const SECRET = "frame-secret-for-play-tests-0123456789";

const creator: Actor = { kind: "user", userId: "creator" };

const viewer = (userId: string | null, extra: Partial<Viewer> = {}): Viewer => ({
  userId,
  staff: false,
  teamRole: null,
  isCreator: false,
  ...extra,
});
const anonymous = viewer(null);
const outsider = viewer("outsider");
const publisher = viewer("creator", { isCreator: true });
const teammate = viewer("teammate", { teamRole: "member" });
const staff = viewer("staff", { staff: true });

let store = memoryReleaseStore();
let v1: PlannedRelease;
let v2: PlannedRelease;

const uploadDeps = (): ReleaseDeps => ({
  db: db as unknown as ReleaseTxDb,
  store,
  now: () => NOW,
  rateLimit: async () => true,
  scan: async () => {},
});

const playDeps: PlayDeps = { now: () => NOW, playOrigin: PLAY_ORIGIN };

async function publish(planned: PlannedRelease) {
  const begun = await beginRelease(uploadDeps(), {
    projectId: PROJECT,
    manifest: planned.text,
    actor: creator,
  });
  for (const file of begun.missing)
    await putReleaseFile(uploadDeps(), {
      uploadId: begun.uploadId,
      sha256: file.sha256,
      body: planned.files.get(file.path)!,
      actor: creator,
    });
  return commitRelease(uploadDeps(), { uploadId: begun.uploadId, actor: creator });
}

async function setProject(values: Partial<typeof engineProjects.$inferInsert>) {
  await db.update(engineProjects).set(values).where(eq(engineProjects.projectId, PROJECT));
  forgetProjectReleases(PROJECT);
}

const play = (version: string, who: Viewer) =>
  resolvePlay({ projectId: PROJECT, version, viewer: who }, playDeps);

beforeAll(async () => {
  vi.stubEnv("ENGINE_FRAME_SECRET", SECRET);
  await seedUser(db, "staff", { guildRoles: ["Staff"] });
  await seedUser(db, "creator");
  await seedUser(db, "teammate");
  await seedUser(db, "outsider");
  v1 = await plannedRelease({ projectId: PROJECT, gameId: GAME, engineVersion: "0.14.1" });
  v2 = await plannedRelease({
    projectId: PROJECT,
    gameId: GAME,
    engineVersion: "0.14.1",
    hallVariant: 2,
  });
});

afterAll(() => {
  vi.unstubAllEnvs();
});

/** v1 is live (production) and v2 is only on preview, in a public personal project. */
beforeEach(async () => {
  store = memoryReleaseStore();
  forgetProjectReleases(PROJECT);
  await db.delete(engineReleaseJamLinks);
  await db.delete(engineProjects);
  await db.delete(projects);
  await db.delete(teams);
  await db.insert(engineProjects).values({
    projectId: PROJECT,
    name: "Play Fixture",
    game: GAME,
    createdById: "creator",
    visibility: "public",
    saveMode: "site",
    connectOrigins: ["https://api.example.org"],
    online: true,
  });
  await publish(v1);
  await promote(
    { projectId: PROJECT, version: 1, channel: "production", actor: creator },
    { db: db as unknown as ReleaseTxDb, now: () => NOW },
  );
  await publish(v2);
});

describe("resolvePlay: versions", () => {
  it("resolves latest to production's pointer with the release summary", async () => {
    const resolved = await play("latest", anonymous);
    expect(resolved).toEqual({
      ok: true,
      play: {
        projectId: PROJECT,
        title: "Play Fixture",
        version: 1,
        channel: "production",
        release: {
          id: v1.releaseId,
          gameId: GAME,
          engineVersion: "0.14.1",
          createdAt: expect.any(String),
        },
        frameUrl: `${PLAY_ORIGIN}/frames/${v1.releaseId}/index.html?host=jams`,
        visibility: "public",
        saveMode: "site",
        connectOrigins: ["https://api.example.org"],
        online: true,
        viewer: { signedIn: false },
      },
    });
  });

  it("resolves preview to preview's pointer for the people who make the game", async () => {
    for (const who of [publisher, staff]) {
      const resolved = await play("preview", who);
      expect(resolved).toMatchObject({
        ok: true,
        play: { version: 2, channel: "preview", release: { id: v2.releaseId } },
      });
    }
  });

  it("hides the preview channel from players, even when it names a live release", async () => {
    expect(await play("preview", anonymous)).toEqual({ ok: false, reason: "not-found" });
    expect(await play("preview", outsider)).toEqual({ ok: false, reason: "not-found" });
    await db
      .update(engineReleaseChannels)
      .set({ releaseId: v1.releaseId })
      .where(eq(engineReleaseChannels.channel, "preview"));
    expect(await play("preview", outsider)).toEqual({ ok: false, reason: "not-found" });
  });

  it("resolves a number to that version and names the channel that points at it", async () => {
    expect(await play("1", outsider)).toMatchObject({
      ok: true,
      play: { version: 1, channel: "production", viewer: { signedIn: true } },
    });
    expect(await play("2", publisher)).toMatchObject({
      ok: true,
      play: { version: 2, channel: "preview" },
    });
  });

  it("answers not-found for an unknown version, project or channel with no release", async () => {
    expect(await play("9", publisher)).toEqual({ ok: false, reason: "not-found" });
    expect(await play("v1", publisher)).toEqual({ ok: false, reason: "not-found" });
    expect(
      await resolvePlay({ projectId: "no-such-game", version: "latest", viewer: staff }, playDeps),
    ).toEqual({ ok: false, reason: "not-found" });
    await db.delete(engineReleaseChannels).where(eq(engineReleaseChannels.channel, "production"));
    expect(await play("latest", publisher)).toEqual({ ok: false, reason: "not-found" });
  });

  it("takes the title from the linked showcase project", async () => {
    await db.insert(projects).values({
      id: "showcase-play",
      slug: "play-showcase",
      title: "The Showcase Title",
      createdBy: "creator",
    });
    await setProject({ showcaseProjectId: "showcase-play" });
    expect(await play("latest", anonymous)).toMatchObject({
      ok: true,
      play: { title: "The Showcase Title" },
    });
  });
});

describe("resolvePlay: audiences", () => {
  it("gives a preview-only version to its makers and tells players it doesn't exist", async () => {
    expect(await play("2", anonymous)).toEqual({ ok: false, reason: "not-found" });
    expect(await play("2", outsider)).toEqual({ ok: false, reason: "not-found" });
    expect(await play("2", publisher)).toMatchObject({ ok: true });
    expect(await play("2", staff)).toMatchObject({ ok: true });
  });

  it("plays a jam-pinned preview version under its visibility", async () => {
    await db
      .insert(itchJams)
      .values({ jamId: 9001, slug: "play-jam", title: "Play Jam", status: "running" })
      .onConflictDoNothing();
    await db
      .insert(engineReleaseJamLinks)
      .values({ projectId: PROJECT, jamId: 9001, releaseId: v2.releaseId });
    await setProject({ visibility: "unlisted" });
    expect(await play("2", anonymous)).toMatchObject({
      ok: true,
      play: {
        version: 2,
        visibility: "unlisted",
        frameUrl: `${PLAY_ORIGIN}/frames/${v2.releaseId}/index.html?host=jams`,
      },
    });
  });

  it("plays unlisted for anyone on the public prefix", async () => {
    await setProject({ visibility: "unlisted" });
    expect(await play("latest", anonymous)).toMatchObject({
      ok: true,
      play: { frameUrl: `${PLAY_ORIGIN}/frames/${v1.releaseId}/index.html?host=jams` },
    });
  });

  it("gives private to publishers and staff, through /frames-private/ with a token", async () => {
    await setProject({ visibility: "private" });
    expect(await play("latest", anonymous)).toEqual({ ok: false, reason: "forbidden" });
    expect(await play("latest", outsider)).toEqual({ ok: false, reason: "forbidden" });

    for (const who of [publisher, staff]) {
      const resolved = await play("latest", who);
      if (!resolved.ok) throw new Error(`refused: ${resolved.reason}`);
      const match = resolved.play.frameUrl.match(
        /^https:\/\/play\.jams\.test\/frames-private\/([0-9a-f]{64})\/([^/]+)\/index\.html\?host=jams$/,
      );
      expect(match?.[1]).toBe(v1.releaseId);
      const claims = await verifyFrameToken(match?.[2], v1.releaseId, NOW);
      expect(claims).toMatchObject({ r: v1.releaseId, u: who.userId });
      expect(await verifyFrameToken(match?.[2], v2.releaseId, NOW)).toBeNull();
    }
  });

  it("gives team to the team and staff, through /frames-private/", async () => {
    const [team] = await db
      .insert(teams)
      .values({
        slug: `team-${crypto.randomUUID().slice(0, 8)}`,
        name: "Team",
        createdBy: "creator",
      })
      .returning({ id: teams.id });
    await setProject({ visibility: "team", teamId: team!.id });
    expect(await play("latest", outsider)).toEqual({ ok: false, reason: "forbidden" });
    expect(await play("latest", anonymous)).toEqual({ ok: false, reason: "forbidden" });
    const resolved = await play("latest", teammate);
    expect(resolved).toMatchObject({
      ok: true,
      play: { frameUrl: expect.stringContaining(`/frames-private/${v1.releaseId}/`) },
    });
    expect(await play("latest", staff)).toMatchObject({ ok: true });
  });

  it("refuses rather than opening a private release when no frame secret is set", async () => {
    await setProject({ visibility: "private" });
    vi.stubEnv("ENGINE_FRAME_SECRET", "");
    try {
      await expect(play("latest", publisher)).rejects.toThrow(/ENGINE_FRAME_SECRET/);
    } finally {
      vi.stubEnv("ENGINE_FRAME_SECRET", SECRET);
    }
  });
});

describe("resolvePlay: unavailable releases", () => {
  it("gives a hidden release's reason to everyone, never a URL", async () => {
    await db
      .update(engineReleases)
      .set({ hiddenAt: NOW, hiddenReason: "Under review." })
      .where(eq(engineReleases.id, v1.releaseId));
    forgetProjectReleases(PROJECT);
    for (const who of [anonymous, publisher, staff])
      expect(await play("latest", who)).toEqual({ ok: false, reason: "hidden" });
    expect(await play("2", publisher)).toMatchObject({ ok: true });
  });

  it("gives hidden for every version of a hidden project", async () => {
    await setProject({ hiddenAt: NOW, hiddenReason: "Reported." });
    expect(await play("latest", anonymous)).toEqual({ ok: false, reason: "hidden" });
    expect(await play("preview", publisher)).toEqual({ ok: false, reason: "hidden" });
  });

  it("gives collected for a removed version", async () => {
    await db
      .update(engineReleases)
      .set({ collectedAt: NOW, manifest: null })
      .where(eq(engineReleases.id, v1.releaseId));
    forgetProjectReleases(PROJECT);
    expect(await play("1", anonymous)).toEqual({ ok: false, reason: "collected" });
  });

  it("answers not-found for a deleted project", async () => {
    await setProject({ deletedAt: NOW });
    expect(await play("latest", staff)).toEqual({ ok: false, reason: "not-found" });
  });
});

describe("viewerOf", () => {
  it("names the creator, staff, an outsider and a signed-out caller", async () => {
    expect(await viewerOf(null, PROJECT)).toEqual(anonymous);
    expect(await viewerOf("creator", PROJECT)).toEqual(publisher);
    expect(await viewerOf("outsider", PROJECT)).toEqual(outsider);
    expect(await viewerOf("staff", PROJECT)).toEqual(staff);
  });

  it("is no maker of a project that doesn't exist", async () => {
    expect(await viewerOf("creator", "no-such-project")).toEqual(viewer("creator"));
  });
});

describe("readGameSettings", () => {
  it("answers the settings, with a public review still pending", async () => {
    await setProject({ publicReviewRequestedAt: NOW });
    expect(await readGameSettings({ projectId: PROJECT, actor: creator })).toEqual({
      visibility: "public",
      reviewPending: true,
      saveMode: "site",
      connectOrigins: ["https://api.example.org"],
      online: true,
      team: null,
    });
    await setProject({ publicApprovedAt: NOW });
    expect(
      await readGameSettings({ projectId: PROJECT, actor: { kind: "staff", userId: "staff" } }),
    ).toMatchObject({ reviewPending: false });
  });

  it("refuses someone who isn't a publisher, and a project that doesn't exist", async () => {
    await expect(
      readGameSettings({ projectId: PROJECT, actor: { kind: "user", userId: "outsider" } }),
    ).rejects.toMatchObject({ body: { code: "release-forbidden" } });
    const missing = readGameSettings({ projectId: "no-such-project", actor: creator });
    await expect(missing).rejects.toBeInstanceOf(ReleaseError);
    await expect(missing).rejects.toMatchObject({ status: 404 });
  });
});
