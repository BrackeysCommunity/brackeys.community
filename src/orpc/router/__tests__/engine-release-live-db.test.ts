import { call } from "@orpc/server";
import { and, asc, eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { db as mockedDb } from "@/db";
import {
  engineProjects,
  engineReleaseAudit,
  engineSceneChannels,
  engineSceneVersions,
  teamMembers,
  teams,
} from "@/db/schema";
import { engineLive, type EngineLiveEvent } from "@/lib/engine/live-events";
import { promote, rollback, type ReleaseChannel } from "@/lib/engine/release-channels";
import { memoryReleaseStore } from "@/lib/engine/release-storage";
import type { Actor } from "@/lib/engine/release-upload";
import { promoteRelease, rollbackRelease } from "@/orpc/router/engine-release";
import { seedUser, type TestDb } from "@/test/db";
import { asUser } from "@/test/orpc";

import {
  editedVersion,
  type FixtureVersion,
} from "../../../lib/engine/__tests__/fixtures/live/scene-versions";
import { plannedRelease, type PlannedRelease } from "../../../lib/engine/__tests__/release-fixture";
import {
  liveRev,
  refusal,
  uploadDeps,
  uploadRelease,
  uploadSceneVersion,
} from "../../../lib/engine/__tests__/upload-rig";

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return { db: await createTestDb() } as unknown as typeof import("@/db");
});
vi.mock("@/lib/auth", async () => {
  const { fakeAuthModule } = await import("@/test/orpc");
  return fakeAuthModule();
});
vi.mock("@/lib/guild-sync", () => ({
  refreshDiscordProfileThrottled: async () => {},
}));
vi.mock("@/lib/media-scan", () => ({ requestUploadScan: async () => {} }));
vi.mock("@/lib/deploy-env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/deploy-env")>()),
  deployEnv: () => "staging",
}));
vi.mock("@/lib/posthog-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/posthog-server")>()),
  isServerFlagEnabled: async () => true,
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => true }));

const db = mockedDb as unknown as TestDb;

const PROJECT = "fixture";
const GAME = "fixture-game";
const TEAM = "team-1";
const NOW = new Date("2026-11-12T15:00:00Z");

const staff: Actor = { kind: "user", userId: "staff" };
const publisher: Actor = { kind: "user", userId: "pub" };
const editor: Actor = { kind: "user", userId: "editor" };

let store = memoryReleaseStore();
/** v1, built from the repository's scenes. */
let first: PlannedRelease;
/** v2, a later build of the same game with the hall moved. */
let second: PlannedRelease;

const deps = () => uploadDeps(store, { now: () => NOW });

const hex = (n: number) => n.toString(16).padStart(64, "0");

/** A version of `scene` with its first marker moved, published to preview. */
async function publishScene(scene: "hall" | "yard"): Promise<FixtureVersion> {
  const v = await editedVersion(first, scene);
  await uploadSceneVersion(deps(), v, { channel: "preview", actor: staff });
  return v;
}

const pointers = async (channel: ReleaseChannel) =>
  Object.fromEntries(
    (
      await db
        .select({ scene: engineSceneChannels.sceneId, version: engineSceneChannels.versionId })
        .from(engineSceneChannels)
        .where(
          and(eq(engineSceneChannels.projectId, PROJECT), eq(engineSceneChannels.channel, channel)),
        )
    ).map((p) => [p.scene, p.version]),
  );

const releaseMoves = async () =>
  (await db.select().from(engineReleaseAudit).orderBy(asc(engineReleaseAudit.id))).filter(
    (a) => a.action === "promote" || a.action === "rollback",
  );

const promoteSecond = (keepScenes?: string[]) =>
  call(
    promoteRelease,
    { projectId: PROJECT, version: 2, channel: "preview", ...(keepScenes ? { keepScenes } : {}) },
    asUser("staff"),
  );

let heard: EngineLiveEvent[] = [];
let unlisten: () => void = () => {};

beforeAll(async () => {
  await seedUser(db, "staff", { guildRoles: ["Staff"] });
  for (const id of ["pub", "editor"]) await seedUser(db, id);
  await db.insert(teams).values({ id: TEAM, slug: "team-1", name: "Team", createdBy: "pub" });
  await db.insert(teamMembers).values({ teamId: TEAM, userId: "editor", role: "member" });
  first = await plannedRelease({ projectId: PROJECT, gameId: GAME, engineVersion: "0.14.1" });
  second = await plannedRelease({
    projectId: PROJECT,
    gameId: GAME,
    engineVersion: "0.14.1",
    hallVariant: 1,
  });
});

let hall: FixtureVersion;
let yard: FixtureVersion;

beforeEach(async () => {
  store = memoryReleaseStore();
  await db.delete(engineProjects);
  await db.insert(engineProjects).values({
    projectId: PROJECT,
    name: "Fixture",
    game: GAME,
    teamId: TEAM,
    createdById: "pub",
  });
  await uploadRelease(deps(), first, { actor: staff, channel: "preview" });
  await uploadRelease(deps(), second, { actor: staff, channel: "none" });
  hall = await publishScene("hall");
  yard = await publishScene("yard");
  heard = [];
  unlisten = await engineLive.listen((event) => heard.push(event));
});

afterEach(() => unlisten());

describe("promoting a release", () => {
  it("clears the channel's scene pointers, records them in the audit and moves live_rev", async () => {
    expect(await pointers("preview")).toEqual({ hall: hall.id, yard: yard.id });

    expect(await promoteSecond()).toEqual({ from: 1, to: 2 });

    expect(await pointers("preview")).toEqual({});
    const move = (await releaseMoves()).at(-1)!;
    expect(move).toMatchObject({ action: "promote", channel: "preview" });
    expect(move.detail).toMatchObject({ scenes: { hall: hall.id, yard: yard.id } });
    expect(move.detail).not.toHaveProperty("kept");
    expect(await liveRev(PROJECT, "preview")).toBe(move.id);
    expect(heard).toEqual([{ projectId: PROJECT, channel: "preview", rev: move.id }]);
  });

  it("keeps a scene that fits the new release, and clears the rest", async () => {
    await promoteSecond(["hall"]);

    expect(await pointers("preview")).toEqual({ hall: hall.id });
    const move = (await releaseMoves()).at(-1)!;
    expect(move.detail).toMatchObject({ scenes: { yard: yard.id }, kept: { hall: hall.id } });
    expect(await liveRev(PROJECT, "preview")).toBe(move.id);
  });

  it("refuses to keep a scene the new release can't take, and changes nothing", async () => {
    const [stored] = await db
      .select({ descriptor: engineSceneVersions.descriptor })
      .from(engineSceneVersions)
      .where(eq(engineSceneVersions.id, yard.id));
    const descriptor = JSON.parse(stored!.descriptor!) as { compat: { build: unknown } };
    descriptor.compat.build = { scene: hex(1) };
    await db
      .update(engineSceneVersions)
      .set({ descriptor: JSON.stringify(descriptor), compatKey: hex(1) })
      .where(eq(engineSceneVersions.id, yard.id));
    const before = await releaseMoves();
    const rev = await liveRev(PROJECT, "preview");

    expect(await refusal(() => promoteSecond(["hall", "yard"]))).toMatchObject({
      code: "live-incompatible",
    });

    expect(await pointers("preview")).toEqual({ hall: hall.id, yard: yard.id });
    expect(await releaseMoves()).toEqual(before);
    expect(await liveRev(PROJECT, "preview")).toBe(rev);
    expect(heard).toEqual([]);
  });

  it("lets only a publisher keep live scenes", async () => {
    expect(
      await refusal(() =>
        promote({
          projectId: PROJECT,
          version: 2,
          channel: "preview",
          keepScenes: ["hall"],
          actor: editor,
        }),
      ),
    ).toMatchObject({
      code: "release-forbidden",
      message: "Only the game's publishers can do this.",
    });
    expect(await pointers("preview")).toEqual({ hall: hall.id, yard: yard.id });

    expect(
      await promote({
        projectId: PROJECT,
        version: 2,
        channel: "preview",
        keepScenes: ["hall"],
        actor: publisher,
      }),
    ).toEqual({ from: 1, to: 2 });
    expect(await pointers("preview")).toEqual({ hall: hall.id });
  });
});

describe("rolling a release back", () => {
  it("restores the scene pointers the undone promote cleared, and reports a collected one as skipped", async () => {
    await promoteSecond();
    await db
      .update(engineSceneVersions)
      .set({ collectedAt: new Date("2026-12-02T09:00:00Z"), descriptor: null })
      .where(eq(engineSceneVersions.id, yard.id));
    heard = [];

    const answer = await call(
      rollbackRelease,
      { projectId: PROJECT, channel: "preview" },
      asUser("staff"),
    );

    expect(answer).toMatchObject({ from: 2, to: 1, restored: ["hall"] });
    expect(answer.skipped).toEqual([{ scene: "yard", reason: expect.stringContaining("yard") }]);
    expect(answer.skipped[0]!.reason).toMatch(/wasn't restored/);
    expect(await pointers("preview")).toEqual({ hall: hall.id });
    const move = (await releaseMoves()).at(-1)!;
    expect(move).toMatchObject({ action: "rollback", channel: "preview" });
    expect(await liveRev(PROJECT, "preview")).toBe(move.id);
    expect(heard).toEqual([{ projectId: PROJECT, channel: "preview", rev: move.id }]);
  });

  it("puts back what the channel had before the promote, kept scenes included", async () => {
    await promoteSecond(["hall"]);
    const answer = await rollback({ projectId: PROJECT, channel: "preview", actor: publisher });
    expect({ ...answer, restored: [...answer.restored].sort() }).toEqual({
      from: 2,
      to: 1,
      restored: ["hall", "yard"],
      skipped: [],
    });
    expect(await pointers("preview")).toEqual({ hall: hall.id, yard: yard.id });

    // Undoing the rollback returns to v2 with what it had there: the kept hall.
    const again = await rollback({ projectId: PROJECT, channel: "preview", actor: publisher });
    expect(again).toEqual({ from: 1, to: 2, restored: ["hall"], skipped: [] });
    expect(await pointers("preview")).toEqual({ hall: hall.id });
  });
});
