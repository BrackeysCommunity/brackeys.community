import { and, asc, eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { db as mockedDb } from "@/db";
import {
  engineAgentTokens,
  engineProjects,
  engineReleaseAudit,
  engineReleases,
  engineSceneChannels,
  engineSceneVersions,
  teamMembers,
  teams,
} from "@/db/schema";
import { seedUser, type TestDb } from "@/test/db";

import { PROJECT_QUOTA } from "../limits";
import { engineLive } from "../live-events";
import {
  moveScenePointer,
  resetScenePointers,
  restoreScenePointers,
  type ScenePointerMove,
} from "../live-pointers";
import { memoryReleaseStore } from "../release-storage";
import type { Actor } from "../release-upload";
import { fixtureVersion, type FixtureVersion } from "./fixtures/live/scene-versions";
import { plannedRelease, type PlannedRelease } from "./release-fixture";
import { liveRev, refusal, uploadDeps, uploadRelease, uploadSceneVersion } from "./upload-rig";

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return { db: await createTestDb() } as unknown as typeof import("@/db");
});

const db = mockedDb as unknown as TestDb;

const PROJECT = "fixture";
const GAME = "fixture-game";
const TEAM = "00000000-0000-4000-8000-0000000000aa";
const TOKEN = "00000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-11-12T15:00:00Z");

const publisher: Actor = { kind: "user", userId: "pub" };
const editor: Actor = { kind: "user", userId: "editor" };
const agent: Actor = { kind: "agent", userId: "editor", agentTokenId: TOKEN };

let store = memoryReleaseStore();
let release: PlannedRelease;

const deps = () => uploadDeps(store, { now: () => NOW });

const moved =
  (x: number) =>
  (scene: Record<string, unknown>): void => {
    const [start] = scene.entities as { at: [number, number] }[];
    start!.at = [x, 1];
  };

const edited = (scene: "hall" | "yard", x = 4) =>
  fixtureVersion(release, { scene, edit: moved(x) });

/** Publishes `v` on no channel, so only the moves under test touch the pointers. */
const publish = async (v: FixtureVersion): Promise<number> =>
  (await uploadSceneVersion(deps(), v, { channel: "none", actor: publisher })).committed.number;

type Move = Omit<ScenePointerMove, "projectId" | "to" | "actor" | "action" | "timing"> & {
  to: ScenePointerMove["to"] | "previous";
  actor?: Actor;
  action?: ScenePointerMove["action"];
  timing?: ScenePointerMove["timing"];
};

const move = (m: Move) =>
  moveScenePointer(deps(), {
    projectId: PROJECT,
    actor: m.actor ?? publisher,
    action: m.action ?? "scene-promote",
    timing: m.timing ?? "next-load",
    ...m,
  });

const pointers = () =>
  db
    .select({
      channel: engineSceneChannels.channel,
      scene: engineSceneChannels.sceneId,
      versionId: engineSceneChannels.versionId,
      timing: engineSceneChannels.timing,
      extraBytes: engineSceneChannels.extraBytes,
    })
    .from(engineSceneChannels)
    .orderBy(asc(engineSceneChannels.channel), asc(engineSceneChannels.sceneId));

const sceneMoves = async () =>
  (await db.select().from(engineReleaseAudit).orderBy(asc(engineReleaseAudit.id))).filter((a) =>
    ["scene-promote", "scene-rollback", "scene-clear"].includes(a.action),
  );

const versionId = async (scene: string, number: number) =>
  (
    await db
      .select({ id: engineSceneVersions.id })
      .from(engineSceneVersions)
      .where(and(eq(engineSceneVersions.sceneId, scene), eq(engineSceneVersions.number, number)))
  )[0]!.id;

beforeAll(async () => {
  for (const id of ["pub", "editor"]) await seedUser(db, id);
  await db.insert(teams).values({ id: TEAM, slug: "team-1", name: "Team", createdBy: "pub" });
  await db.insert(teamMembers).values({ teamId: TEAM, userId: "editor", role: "member" });
  release = await plannedRelease({ projectId: PROJECT, gameId: GAME, engineVersion: "0.14.1" });
});

let announced: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  store = memoryReleaseStore();
  announced = vi.spyOn(engineLive, "announce").mockResolvedValue(undefined);
  await db.delete(engineProjects);
  await db.insert(engineProjects).values({
    projectId: PROJECT,
    name: "Fixture",
    game: GAME,
    teamId: TEAM,
    createdById: "pub",
  });
  await db.insert(engineAgentTokens).values({
    id: TOKEN,
    projectId: PROJECT,
    createdById: "editor",
    access: "write",
    label: "ci",
    tokenSha256: "f".repeat(64),
    expiresAt: new Date(NOW.getTime() + 86_400_000),
  });
  await uploadRelease(deps(), release, { actor: publisher, promoteTo: "production" });
});

afterEach(() => {
  announced.mockRestore();
});

describe("moveScenePointer", () => {
  it("changes one pointer, writes one audit row with the timing, sets live_rev and announces", async () => {
    const v = await edited("hall");
    expect(await publish(v)).toBe(1);
    const before = await sceneMoves();
    const previewRev = await liveRev(PROJECT, "preview");

    expect(
      await move({ scene: "hall", channel: "production", to: { number: 1 }, timing: "now" }),
    ).toEqual({ from: null, to: 1 });

    const [pointer, ...others] = await pointers();
    expect(others).toEqual([]);
    expect(pointer).toMatchObject({
      channel: "production",
      scene: "hall",
      versionId: v.id,
      timing: "now",
    });
    // The version file and the changed scene text: the release lists neither.
    const hallBytes = v.version.assets.hall!.bytes;
    expect(pointer!.extraBytes).toBe(new TextEncoder().encode(v.text).byteLength + hallBytes);

    const after = await sceneMoves();
    expect(after).toHaveLength(before.length + 1);
    const row = after.at(-1)!;
    expect(row).toMatchObject({
      action: "scene-promote",
      channel: "production",
      sceneId: "hall",
      sceneVersionId: v.id,
      actorKind: "user",
      actorId: "pub",
      detail: { from: null, to: 1, timing: "now" },
    });
    expect(await liveRev(PROJECT, "production")).toBe(row.id);
    expect(await liveRev(PROJECT, "preview")).toBe(previewRev);
    expect(announced).toHaveBeenCalledWith({
      projectId: PROJECT,
      channel: "production",
      rev: row.id,
    });
  });

  it("leaves a pointer already on that version with that timing alone", async () => {
    await publish(await edited("hall"));
    await move({ scene: "hall", channel: "preview", to: { number: 1 } });
    const rows = (await sceneMoves()).length;
    announced.mockClear();
    expect(await move({ scene: "hall", channel: "preview", to: { number: 1 } })).toEqual({
      from: 1,
      to: 1,
    });
    expect(await sceneMoves()).toHaveLength(rows);
    expect(announced).not.toHaveBeenCalled();
  });

  it("clears a pointer back to the release's scene", async () => {
    await publish(await edited("hall"));
    await move({ scene: "hall", channel: "preview", to: { number: 1 } });
    expect(
      await move({ scene: "hall", channel: "preview", to: null, action: "scene-clear" }),
    ).toEqual({ from: 1, to: null });
    expect(await pointers()).toEqual([]);
    expect((await sceneMoves()).at(-1)).toMatchObject({
      action: "scene-clear",
      detail: { from: 1, to: null, timing: "next-load" },
    });
  });

  it("rolls back without `to` to the previous version, then to none", async () => {
    await publish(await edited("hall", 4));
    await publish(await edited("hall", 5));
    await move({ scene: "hall", channel: "preview", to: { number: 1 } });
    await move({ scene: "hall", channel: "preview", to: { number: 2 } });

    const rollback = () =>
      move({ scene: "hall", channel: "preview", to: "previous", action: "scene-rollback" });
    expect(await rollback()).toEqual({ from: 2, to: 1 });
    expect((await pointers())[0]?.versionId).toBe(await versionId("hall", 1));
    // Rolling back twice returns to where it started.
    expect(await rollback()).toEqual({ from: 1, to: 2 });

    await publish(await edited("yard"));
    await move({ scene: "yard", channel: "production", to: { number: 1 } });
    expect(
      await move({
        scene: "yard",
        channel: "production",
        to: "previous",
        action: "scene-rollback",
      }),
    ).toEqual({ from: 1, to: null });
    expect((await pointers()).filter((p) => p.channel === "production")).toEqual([]);
    expect((await sceneMoves()).at(-1)).toMatchObject({
      action: "scene-rollback",
      channel: "production",
      detail: { from: 1, to: null },
    });
  });

  it("rolls back to the version a release move cleared, not the one before it", async () => {
    await publish(await edited("hall", 4));
    await publish(await edited("hall", 5));
    await move({ scene: "hall", channel: "preview", to: { number: 1 } });
    await move({ scene: "hall", channel: "preview", to: { number: 2 } });
    const next = await plannedRelease({
      projectId: PROJECT,
      gameId: GAME,
      engineVersion: "0.14.1",
      hallVariant: 1,
    });
    await uploadRelease(deps(), next, { actor: publisher, channel: "preview" });
    expect(await pointers()).toEqual([]);

    expect(
      await move({ scene: "hall", channel: "preview", to: "previous", action: "scene-rollback" }),
    ).toEqual({ from: null, to: 2 });
  });

  it("keeps a pointer's time when only its timing changes, for the breaker's window", async () => {
    await publish(await edited("hall", 4));
    await publish(await edited("hall", 5));
    await move({ scene: "hall", channel: "preview", to: { number: 1 } });
    const later = (minutes: number, number: number) =>
      moveScenePointer(
        uploadDeps(store, { now: () => new Date(NOW.getTime() + minutes * 60_000) }),
        {
          projectId: PROJECT,
          scene: "hall",
          channel: "preview",
          to: { number },
          timing: "boundary",
          actor: editor,
          action: "scene-promote",
        },
      );
    const stamped = async () =>
      (
        await db
          .select({
            at: engineSceneChannels.updatedAt,
            by: engineSceneChannels.updatedById,
            timing: engineSceneChannels.timing,
          })
          .from(engineSceneChannels)
      )[0];

    await later(10, 1);
    expect(await stamped()).toEqual({ at: NOW, by: "pub", timing: "boundary" });
    await later(30, 2);
    expect(await stamped()).toEqual({
      at: new Date(NOW.getTime() + 30 * 60_000),
      by: "editor",
      timing: "boundary",
    });
  });

  it("refuses a rollback with nothing to go back to", async () => {
    expect(
      await refusal(() =>
        move({ scene: "hall", channel: "preview", to: "previous", action: "scene-rollback" }),
      ),
    ).toMatchObject({ code: "not-found", status: 404 });
  });

  it("refuses an agent on production with release-forbidden, sending it to the game's page", async () => {
    await publish(await edited("hall"));
    const refused = await refusal(() =>
      move({ scene: "hall", channel: "production", to: { number: 1 }, actor: agent }),
    );
    expect(refused).toMatchObject({ code: "release-forbidden", status: 403 });
    expect(refused.hint).toMatch(/\/games\/fixture$/);
    expect(
      await move({ scene: "hall", channel: "preview", to: { number: 1 }, actor: agent }),
    ).toEqual({ from: null, to: 1 });
  });

  it("lets an editor move preview but not production", async () => {
    await publish(await edited("hall"));
    expect(
      await refusal(() =>
        move({ scene: "hall", channel: "production", to: { number: 1 }, actor: editor }),
      ),
    ).toMatchObject({
      code: "release-forbidden",
      message: "Only the game's publishers can do this.",
    });
    expect(
      await move({ scene: "hall", channel: "preview", to: { number: 1 }, actor: editor }),
    ).toEqual({ from: null, to: 1 });
    expect((await pointers()).map((p) => p.channel)).toEqual(["preview"]);
  });

  it("refuses to promote a blocked version", async () => {
    await publish(await edited("hall"));
    await db
      .update(engineSceneVersions)
      .set({ blockedAt: NOW, blockedBy: "user", blockedById: "pub", blockReason: "Softlocks" });
    expect(
      await refusal(() => move({ scene: "hall", channel: "production", to: { number: 1 } })),
    ).toMatchObject({ code: "live-blocked", message: "hall@1 is blocked: Softlocks", status: 409 });
    expect(await pointers()).toEqual([]);
  });

  it("refuses a pointer that would take the channel past 100 MiB", async () => {
    const v = await edited("hall");
    await publish(v);
    const extra = new TextEncoder().encode(v.text).byteLength + v.version.assets.hall!.bytes;
    const fit = async (totalBytes: number) =>
      db.update(engineReleases).set({ totalBytes }).where(eq(engineReleases.projectId, PROJECT));

    await fit(PROJECT_QUOTA.releaseBytes - extra + 1);
    expect(
      await refusal(() => move({ scene: "hall", channel: "preview", to: { number: 1 } })),
    ).toMatchObject({
      code: "quota-exceeded",
      limit: "releaseBytes",
      used: PROJECT_QUOTA.releaseBytes + 1,
      max: PROJECT_QUOTA.releaseBytes,
      status: 413,
    });
    expect(await pointers()).toEqual([]);

    await fit(PROJECT_QUOTA.releaseBytes - extra);
    expect(await move({ scene: "hall", channel: "preview", to: { number: 1 } })).toEqual({
      from: null,
      to: 1,
    });
  });

  it("counts every other pointer on the channel toward its size", async () => {
    const hall = await edited("hall");
    const yard = await edited("yard");
    await publish(hall);
    await publish(yard);
    await move({ scene: "hall", channel: "preview", to: { number: 1 } });
    const [hallPointer] = await pointers();
    const yardExtra =
      new TextEncoder().encode(yard.text).byteLength + yard.version.assets.yard!.bytes;
    await db
      .update(engineReleases)
      .set({ totalBytes: PROJECT_QUOTA.releaseBytes - yardExtra - hallPointer!.extraBytes + 1 })
      .where(eq(engineReleases.projectId, PROJECT));
    expect(
      await refusal(() => move({ scene: "yard", channel: "preview", to: { number: 1 } })),
    ).toMatchObject({ code: "quota-exceeded" });
    // The same move on production, which points at nothing else, fits.
    expect(await move({ scene: "yard", channel: "production", to: { number: 1 } })).toEqual({
      from: null,
      to: 1,
    });
  });
});

describe("resetScenePointers and restoreScenePointers", () => {
  it("clear a channel's pointers but the kept ones, and put back those that still fit", async () => {
    await publish(await edited("hall"));
    await publish(await edited("yard"));
    await move({ scene: "hall", channel: "preview", to: { number: 1 } });
    await move({ scene: "yard", channel: "preview", to: { number: 1 } });
    const hall = await versionId("hall", 1);
    const yard = await versionId("yard", 1);
    const [releaseRow] = await db.select({ id: engineReleases.id }).from(engineReleases);

    const cleared = await db.transaction((tx) =>
      resetScenePointers(tx, {
        projectId: PROJECT,
        channel: "preview",
        release: releaseRow!.id,
        keep: ["yard"],
      }),
    );
    expect(cleared).toEqual({ hall });
    expect((await pointers()).map((p) => p.scene)).toEqual(["yard"]);

    await db
      .update(engineSceneVersions)
      .set({ collectedAt: new Date("2026-12-02T10:00:00Z"), descriptor: null })
      .where(eq(engineSceneVersions.id, yard));
    await db.delete(engineSceneChannels);
    const back = await db.transaction((tx) =>
      restoreScenePointers(tx, {
        projectId: PROJECT,
        channel: "preview",
        release: releaseRow!.id,
        scenes: { hall, yard },
        actor: publisher,
        at: NOW,
      }),
    );
    expect(back).toEqual({
      restored: ["hall"],
      skipped: [{ scene: "yard", reason: "yard@1 wasn't restored: it was removed on 2 Dec 2026" }],
    });
    expect(await pointers()).toMatchObject([
      { channel: "preview", scene: "hall", versionId: hall, timing: "next-load" },
    ]);
  });
});
