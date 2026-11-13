import { and, eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

import { db as mockedDb } from "@/db";
import {
  engineProjects,
  engineReleaseJamLinks,
  engineReleases,
  engineSceneChannels,
  engineSceneVersions,
  itchJams,
  projectContributors,
  projectTeams,
  projects,
  teamMembers,
  teams,
} from "@/db/schema";
import { seedUser, type TestDb } from "@/test/db";

import { forgetProjectReleases } from "../frame-route";
import { verifyFrameToken } from "../frame-token";
import { gamePage, removalNotice, type GamePageDeps } from "../game-page";
import { engineLive } from "../live-events";
import { moveScenePointer } from "../live-pointers";
import { beginSceneVersion, commitSceneVersion } from "../live-upload";
import type { Viewer } from "../release-access";
import { promote } from "../release-channels";
import { memoryReleaseStore } from "../release-storage";
import {
  beginRelease,
  commitRelease,
  putReleaseFile,
  type Actor,
  type ReleaseDeps,
  type ReleaseTxDb,
} from "../release-upload";
import { fixtureVersion, type FixtureVersion } from "./fixtures/live/scene-versions";
import { plannedRelease, type PlannedRelease } from "./release-fixture";

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return { db: await createTestDb() } as unknown as typeof import("@/db");
});

const db = mockedDb as unknown as TestDb;

const PROJECT = "page-fixture";
const GAME = "fixture-game";
const NOW = new Date("2026-11-12T15:00:00Z");
const PLAY_ORIGIN = "https://play.jams.test";
const SECRET = "frame-secret-for-page-tests-0123456789";

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
const teamOwner = viewer("owner", { teamRole: "owner" });
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

const pageDeps: GamePageDeps = {
  db: db as unknown as ReleaseTxDb,
  now: () => NOW,
  playOrigin: PLAY_ORIGIN,
};

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

const page = (who: Viewer) => gamePage({ projectId: PROJECT, viewer: who }, pageDeps);

const versionsOf = async (who: Viewer) => (await page(who))?.versions.map((v) => v.version);

async function makeTeam(): Promise<string> {
  const [team] = await db
    .insert(teams)
    .values({
      slug: `team-${crypto.randomUUID().slice(0, 8)}`,
      name: "Page Team",
      createdBy: "owner",
    })
    .returning({ id: teams.id });
  await db.insert(teamMembers).values([
    { teamId: team!.id, userId: "owner", role: "owner" },
    { teamId: team!.id, userId: "teammate", role: "member" },
  ]);
  return team!.id;
}

const hex = (n: number) => n.toString(16).padStart(64, "0");

/** Once-live releases v3 onwards, so v3 falls outside the kept set and is the only unpinned one there. */
async function addKeptReleases(count: number) {
  await db.insert(engineReleases).values(
    Array.from({ length: count }, (_, i) => ({
      id: hex(1000 + i),
      projectId: PROJECT,
      version: 3 + i,
      manifest: null,
      manifestBytes: 10,
      totalBytes: 1_000,
      fileCount: 1,
      engineVersion: "0.14.1",
      gameId: GAME,
      snapshot: hex(1),
      buildHash: hex(2),
      target: "web",
      createdAt: new Date("2026-11-01T00:00:00Z"),
      firstPromotedAt: new Date("2026-11-01T00:00:00Z"),
    })),
  );
}

beforeAll(async () => {
  vi.stubEnv("ENGINE_FRAME_SECRET", SECRET);
  await seedUser(db, "staff", { guildRoles: ["Staff"] });
  await seedUser(db, "creator");
  await seedUser(db, "teammate");
  await seedUser(db, "owner");
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
    name: "Page Fixture",
    game: GAME,
    createdById: "creator",
    visibility: "public",
    publicApprovedAt: NOW,
    saveMode: "own",
    connectOrigins: ["https://api.example.org"],
  });
  await publish(v1);
  await promote(
    { projectId: PROJECT, version: 1, channel: "production", actor: creator },
    { db: db as unknown as ReleaseTxDb, now: () => NOW },
  );
  await publish(v2);
});

describe("gamePage: identity", () => {
  it("uses the engine project's name when no showcase project is linked", async () => {
    expect(await page(anonymous)).toMatchObject({
      projectId: PROJECT,
      title: "Page Fixture",
      description: null,
      showcaseProjectId: null,
      cover: { imageKey: null, url: null },
      contributors: [],
      teams: [],
      visibility: "public",
      saveMode: "own",
      connectOrigins: ["https://api.example.org"],
      noindex: false,
      viewer: { signedIn: false },
    });
  });

  it("takes the title, description, cover, contributors and teams from the showcase project", async () => {
    const teamId = await makeTeam();
    await db.insert(projects).values({
      id: "showcase-page",
      slug: "page-showcase",
      title: "The Showcase Title",
      description: "A short game.",
      imageUrl: "https://img.example.org/cover.png",
      createdBy: "creator",
    });
    await db.insert(projectContributors).values([
      { projectId: "showcase-page", displayName: "Ada", role: "Code", sortOrder: 0 },
      { projectId: "showcase-page", displayName: "Grace", role: "Art", sortOrder: 1 },
    ]);
    await db.insert(projectTeams).values({ projectId: "showcase-page", teamId });
    await setProject({ showcaseProjectId: "showcase-page" });

    expect(await page(anonymous)).toMatchObject({
      title: "The Showcase Title",
      description: "A short game.",
      showcaseProjectId: "showcase-page",
      showcaseSlug: "page-showcase",
      cover: { imageKey: null, url: "https://img.example.org/cover.png" },
      contributors: [
        { displayName: "Ada", role: "Code", profileId: null },
        { displayName: "Grace", role: "Art", profileId: null },
      ],
      teams: [{ id: teamId, name: "Page Team" }],
    });
  });

  it("answers null for a project that doesn't exist or was deleted", async () => {
    expect(await gamePage({ projectId: "no-such-game", viewer: staff }, pageDeps)).toBeNull();
    await setProject({ deletedAt: NOW });
    expect(await page(staff)).toBeNull();
  });
});

describe("gamePage: versions per viewer", () => {
  it("lists the live version to players and adds the preview-only one for publishers", async () => {
    expect(await versionsOf(anonymous)).toEqual([1]);
    expect(await versionsOf(outsider)).toEqual([1]);
    expect(await versionsOf(publisher)).toEqual([2, 1]);
    expect(await versionsOf(staff)).toEqual([2, 1]);

    const shown = await page(publisher);
    expect(shown?.versions).toEqual([
      {
        id: v2.releaseId,
        version: 2,
        createdAt: NOW.toISOString(),
        bytes: expect.any(Number),
        engineVersion: "0.14.1",
        badges: ["preview"],
        jams: [],
        playUrl: expect.stringMatching(/\/games\/page-fixture\/play\/2$/),
        previewOnly: true,
        hidden: null,
        removalAt: null,
        removalNotice: null,
        actions: ["promote", "jam-link", "download-zip"],
      },
      {
        id: v1.releaseId,
        version: 1,
        createdAt: NOW.toISOString(),
        bytes: expect.any(Number),
        engineVersion: "0.14.1",
        badges: ["live"],
        jams: [],
        playUrl: expect.stringMatching(/\/games\/page-fixture\/play\/1$/),
        previewOnly: false,
        hidden: null,
        removalAt: null,
        removalNotice: null,
        actions: ["jam-link", "download-zip"],
      },
    ]);
    expect(shown?.versions[0]?.bytes).toBeGreaterThan(0);
    expect(shown?.live).toMatchObject({ version: 1 });
  });

  it("gives players no menu and the people who make the game the menu their role allows", async () => {
    expect((await page(anonymous))?.versions[0]?.actions).toEqual([]);
    expect((await page(anonymous))?.versions[0]?.id).toBeUndefined();
    expect(await page(anonymous)).toMatchObject({ publisher: false, role: "player" });

    const teamId = await makeTeam();
    await setProject({ teamId });
    const asEditor = await page(teammate);
    expect(asEditor).toMatchObject({ publisher: false, role: "editor" });
    expect(asEditor?.versions.map((v) => [v.version, v.actions])).toEqual([
      [2, ["download-zip"]],
      [1, ["download-zip"]],
    ]);
    expect(await page(teamOwner)).toMatchObject({ publisher: true, role: "publisher" });
  });

  it("offers a rollback on versions older than production", async () => {
    await promote(
      { projectId: PROJECT, version: 2, channel: "production", actor: creator },
      { db: db as unknown as ReleaseTxDb, now: () => NOW },
    );
    const shown = await page(publisher);
    expect(shown?.versions.map((v) => [v.version, v.badges, v.actions])).toEqual([
      [2, ["live", "preview"], ["jam-link", "download-zip"]],
      [1, [], ["rollback", "jam-link", "download-zip"]],
    ]);
    expect(await versionsOf(anonymous)).toEqual([2, 1]);
  });

  it("badges a jam version with its jam and lists it to players", async () => {
    await db
      .insert(itchJams)
      .values({ jamId: 9101, slug: "page-jam", title: "Page Jam", status: "running" })
      .onConflictDoNothing();
    await db
      .insert(engineReleaseJamLinks)
      .values({ projectId: PROJECT, jamId: 9101, releaseId: v2.releaseId });
    const shown = await page(anonymous);
    expect(shown?.versions.map((v) => [v.version, v.badges, v.jams])).toEqual([
      [2, ["preview", "jam"], [{ jamId: 9101, title: "Page Jam" }]],
      [1, ["live"], []],
    ]);
  });

  it("follows the visibility's audience: team for members, private for publishers", async () => {
    const teamId = await makeTeam();
    await setProject({ teamId, visibility: "team" });
    expect(await page(anonymous)).toBeNull();
    expect(await page(outsider)).toBeNull();
    expect(await versionsOf(teammate)).toEqual([2, 1]);
    expect(await page(teammate)).toMatchObject({ noindex: true });

    await setProject({ visibility: "private" });
    expect(await page(outsider)).toBeNull();
    expect(await versionsOf(publisher)).toEqual([2, 1]);
    expect(await versionsOf(staff)).toEqual([2, 1]);
    // A team member plays the preview-only version, not the private live one.
    expect(await versionsOf(teammate)).toEqual([2]);
  });

  it("sends noindex for unlisted and keeps the embed for unlisted and public", async () => {
    expect(await page(anonymous)).toMatchObject({ noindex: false, embeddable: true });
    await setProject({ visibility: "unlisted" });
    expect(await page(anonymous)).toMatchObject({ noindex: true, embeddable: true });
    await setProject({ visibility: "private" });
    expect(await page(publisher)).toMatchObject({ noindex: true, embeddable: false });
  });

  it("shows a hidden version only to publishers, with its reason, and never as playable", async () => {
    await db
      .update(engineReleases)
      .set({ hiddenAt: NOW, hiddenReason: "Under review." })
      .where(eq(engineReleases.id, v1.releaseId));
    expect(await versionsOf(anonymous)).toEqual([]);
    expect(await page(anonymous)).toMatchObject({ live: null, embeddable: false });
    const shown = await page(publisher);
    expect(shown?.versions.find((v) => v.version === 1)).toMatchObject({
      hidden: { reason: "Under review." },
      actions: ["download-zip"],
    });
    expect(shown?.live).toBeNull();
  });

  it("shows a hidden game only to its publishers", async () => {
    await setProject({ hiddenAt: NOW, hiddenReason: "Reported." });
    expect(await page(anonymous)).toBeNull();
    expect(await page(publisher)).toMatchObject({
      hidden: { reason: "Reported." },
      noindex: true,
      live: null,
    });
  });

  it("drops collected versions", async () => {
    await db
      .update(engineReleases)
      .set({ collectedAt: NOW, manifest: null })
      .where(eq(engineReleases.id, v2.releaseId));
    expect(await versionsOf(publisher)).toEqual([1]);
  });

  it("tells publishers when the cleanup removes a version, in UTC", async () => {
    await addKeptReleases(11);
    const shown = await page(publisher);
    const due = shown?.versions.filter((v) => v.removalAt !== null) ?? [];
    expect(due).toEqual([
      expect.objectContaining({
        version: 3,
        removalAt: "2026-11-15T03:30:00.000Z",
        removalNotice: "Removed on 15 Nov unless pinned",
      }),
    ]);
    expect(removalNotice(new Date("2026-11-26T03:30:00Z"))).toBe("Removed on 26 Nov unless pinned");
    // Midnight UTC is still the 26th however the server's zone runs.
    expect(removalNotice(new Date("2026-11-26T00:00:00Z"))).toBe("Removed on 26 Nov unless pinned");
    const asPlayer = await page(anonymous);
    expect(asPlayer?.versions.every((v) => v.removalAt === null && v.removalNotice === null)).toBe(
      true,
    );
  });
});

describe("gamePage: saves, review and credits", () => {
  it("links the live release's credits and counts missing licences for publishers only", async () => {
    const asPlayer = await page(anonymous);
    expect(asPlayer?.credits).toEqual({
      url: `${PLAY_ORIGIN}/frames/${v1.releaseId}/credits.html`,
      version: 1,
    });
    expect(asPlayer?.creditsMissing).toBe(0);
    const asPublisher = await page(publisher);
    expect(asPublisher?.creditsMissing).toBe(v1.manifest.credits.missing.length);
  });

  it("links a private game's credits through a frame token for the viewer", async () => {
    await setProject({ visibility: "private" });
    const shown = await page(publisher);
    const match = shown?.credits?.url.match(
      /^https:\/\/play\.jams\.test\/frames-private\/([0-9a-f]{64})\/([^/]+)\/credits\.html$/,
    );
    expect(match?.[1]).toBe(v1.releaseId);
    expect(await verifyFrameToken(match?.[2], v1.releaseId, NOW)).toMatchObject({
      u: "creator",
    });
  });

  it("tells publishers a first public is waiting for review", async () => {
    await setProject({
      visibility: "unlisted",
      publicApprovedAt: null,
      publicReviewRequestedAt: NOW,
    });
    expect(await page(publisher)).toMatchObject({ reviewPending: true, noindex: true });
    expect(await page(anonymous)).toMatchObject({ reviewPending: false });
  });
});

describe("gamePage: live levels", () => {
  let hall: FixtureVersion;
  let yard: FixtureVersion;
  let announced: ReturnType<typeof vi.spyOn>;

  const marker =
    (x: number) =>
    (scene: Record<string, unknown>): void => {
      (scene.entities as { at: number[] }[])[0]!.at = [x, 1];
    };

  /** Publishes `v` to preview, which points preview's pointer at it. */
  async function publishScene(v: FixtureVersion) {
    const begun = await beginSceneVersion(uploadDeps(), {
      projectId: PROJECT,
      version: v.text,
      channel: "preview",
      actor: creator,
    });
    for (const { sha256 } of begun.missing)
      await putReleaseFile(uploadDeps(), {
        uploadId: begun.uploadId,
        sha256,
        body: new TextEncoder().encode(v.texts.get(sha256)!),
        actor: creator,
      });
    await commitSceneVersion(uploadDeps(), { uploadId: begun.uploadId, actor: creator });
  }

  const toProduction = (scene: string) =>
    moveScenePointer(uploadDeps(), {
      projectId: PROJECT,
      scene,
      channel: "production",
      to: { number: 1 },
      timing: "now",
      action: "scene-promote",
      actor: creator,
    });

  const sinceOf = async (scene: string) =>
    (
      await db
        .select({ at: engineSceneChannels.updatedAt })
        .from(engineSceneChannels)
        .where(
          and(
            eq(engineSceneChannels.channel, "production"),
            eq(engineSceneChannels.sceneId, scene),
          ),
        )
    )[0]!.at.toISOString();

  const setVersion = (id: string, values: Partial<typeof engineSceneVersions.$inferInsert>) =>
    db.update(engineSceneVersions).set(values).where(eq(engineSceneVersions.id, id));

  beforeAll(async () => {
    hall = await fixtureVersion(v1, { scene: "hall", edit: marker(4) });
    yard = await fixtureVersion(v1, { scene: "yard", edit: marker(5) });
  });

  /** v1 on both channels, with hall@1 and yard@1 published to preview. */
  beforeEach(async () => {
    announced = vi.spyOn(engineLive, "announce").mockResolvedValue(undefined);
    await promote(
      { projectId: PROJECT, version: 1, channel: "preview", actor: creator },
      { db: db as unknown as ReleaseTxDb, now: () => NOW },
    );
    await publishScene(hall);
    await publishScene(yard);
  });

  afterEach(() => {
    announced.mockRestore();
  });

  it("names no updated levels while only preview points at live versions", async () => {
    expect((await page(anonymous))?.live).toEqual({
      version: 1,
      playUrl: expect.stringMatching(/\/games\/page-fixture\/play\/1$/),
      scenes: [],
    });
    expect((await page(publisher))?.blockedScenes).toEqual([]);
  });

  it("gives the live version the levels production plays, titled by the scene list", async () => {
    await toProduction("hall");
    await toProduction("yard");
    const expected = [
      { scene: "hall", title: "hall", number: 1, since: await sinceOf("hall") },
      { scene: "yard", title: "Yard", number: 1, since: await sinceOf("yard") },
    ];
    for (const who of [anonymous, outsider, publisher])
      expect((await page(who))?.live?.scenes).toEqual(expected);
  });

  it("drops a blocked version from the row and tells only publishers why", async () => {
    await toProduction("hall");
    const reason = "5 of 12 players' games failed after this update";
    await setVersion(hall.id, { blockedAt: NOW, blockedBy: "system", blockReason: reason });

    for (const who of [anonymous, outsider]) {
      const shown = await page(who);
      expect(shown?.live?.scenes).toEqual([]);
      expect(shown?.blockedScenes).toEqual([]);
    }
    // Preview and production both point at hall@1: one line, on production.
    for (const who of [publisher, staff])
      expect((await page(who))?.blockedScenes).toEqual([
        { scene: "hall", title: "hall", number: 1, channel: "production", reason },
      ]);
  });

  it("names a blocked version only preview points at, and none staff hid", async () => {
    await setVersion(yard.id, { blockedAt: NOW, blockedBy: "user", blockedById: "creator" });
    expect((await page(publisher))?.blockedScenes).toEqual([
      { scene: "yard", title: "Yard", number: 1, channel: "preview", reason: null },
    ]);
    await setVersion(yard.id, { hiddenAt: NOW, hiddenReason: "Spam" });
    expect((await page(publisher))?.blockedScenes).toEqual([]);
  });

  it("names no updated levels once production moves to another release", async () => {
    await toProduction("hall");
    await promote(
      { projectId: PROJECT, version: 2, channel: "production", actor: creator },
      { db: db as unknown as ReleaseTxDb, now: () => NOW },
    );
    const shown = await page(anonymous);
    expect(shown?.live).toMatchObject({ version: 2, scenes: [] });
  });
});
