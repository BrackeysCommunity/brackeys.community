import { ORPCError } from "@orpc/client";
import { call } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { db as mockedDb } from "@/db";
import {
  engineProjects,
  engineReleaseChannels,
  engineReleaseJamLinks,
  engineReleases,
  engineSceneChannels,
  engineSceneVersions,
  itchJams,
  teamMembers,
  teams,
} from "@/db/schema";
import { forgetProjectReleases } from "@/lib/engine/frame-route";
import {
  channelOfPlayVersion,
  forgetLiveSnapshots,
  playVersionOf,
  resolvePlay,
  type PlayDeps,
} from "@/lib/engine/game-play";
import { engineLive } from "@/lib/engine/live-events";
import { moveScenePointer } from "@/lib/engine/live-pointers";
import type { Viewer } from "@/lib/engine/release-access";
import type { ReleaseDb } from "@/lib/engine/release-audit";
import { promote } from "@/lib/engine/release-channels";
import { memoryReleaseStore } from "@/lib/engine/release-storage";
import type { Actor } from "@/lib/engine/release-upload";
import { PUBLIC_PROCEDURE_NAMES } from "@/orpc/public-procedures";
import { getGameLive } from "@/orpc/router/engine-game";
import { seedUser, type TestDb } from "@/test/db";
import { asUser } from "@/test/orpc";

import {
  editedVersion,
  type FixtureVersion,
} from "../../../lib/engine/__tests__/fixtures/live/scene-versions";
import { plannedRelease, type PlannedRelease } from "../../../lib/engine/__tests__/release-fixture";
import {
  liveRev,
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

const PROJECT = "live-play";
const GAME = "fixture-game";
const TEAM = "00000000-0000-4000-8000-0000000000bb";
const NOW = new Date("2026-11-12T15:00:00Z");
const PLAY_ORIGIN = "https://play.jams.test";

const publisherActor: Actor = { kind: "user", userId: "pub" };

const viewer = (userId: string | null, extra: Partial<Viewer> = {}): Viewer => ({
  userId,
  staff: false,
  teamRole: null,
  isCreator: false,
  ...extra,
});
const anonymous = viewer(null);
const outsider = viewer("outsider");
const editor = viewer("editor", { teamRole: "member" });
const publisher = viewer("pub", { isCreator: true });

let store = memoryReleaseStore();
let release: PlannedRelease;
let hall: FixtureVersion;
let yard: FixtureVersion;

const deps = () => uploadDeps(store, { now: () => NOW });

const playDeps = (over: Partial<PlayDeps> = {}): PlayDeps => ({
  now: () => NOW,
  playOrigin: PLAY_ORIGIN,
  ...over,
});

const play = (version: string, who: Viewer, over?: Partial<PlayDeps>) =>
  resolvePlay({ projectId: PROJECT, version, viewer: who }, playDeps(over));

const liveOf = async (version: string, who: Viewer) => {
  const resolved = await play(version, who);
  if (!resolved.ok) throw new Error(`refused: ${resolved.reason}`);
  return resolved.play.live;
};

/** Publishes `v` to preview, which points preview's pointer at it. */
const publishScene = (v: FixtureVersion) =>
  uploadSceneVersion(deps(), v, { channel: "preview", actor: publisherActor });

const toProduction = (scene: string) =>
  moveScenePointer(deps(), {
    projectId: PROJECT,
    scene,
    channel: "production",
    to: { number: 1 },
    timing: "now",
    action: "scene-promote",
    actor: publisherActor,
  });

const sinceOf = async (channel: "preview" | "production", scene: string) =>
  (
    await db
      .select({ at: engineSceneChannels.updatedAt })
      .from(engineSceneChannels)
      .where(and(eq(engineSceneChannels.channel, channel), eq(engineSceneChannels.sceneId, scene)))
  )[0]!.at.toISOString();

async function setVersion(id: string, values: Partial<typeof engineSceneVersions.$inferInsert>) {
  await db.update(engineSceneVersions).set(values).where(eq(engineSceneVersions.id, id));
  forgetLiveSnapshots();
}

/** The site's db with every table a select reads from recorded. */
function countingDb(tables: unknown[]): ReleaseDb {
  type Query = { from: (table: unknown) => unknown };
  const real = db as unknown as { select: (...args: unknown[]) => Query };
  const select = (...args: unknown[]) => {
    const query = real.select(...args);
    const from = query.from.bind(query);
    query.from = (table) => {
      tables.push(table);
      return from(table);
    };
    return query;
  };
  return { ...(db as unknown as ReleaseDb), select } as unknown as ReleaseDb;
}

/**
 * The site's db, where each channel pointer read answers what it read and
 * then promotes the next of `moves` to production, as a promote landing
 * between the play's pointer read and its live read would.
 */
function movingDb(moves: number[]): ReleaseDb {
  type Query = { from: (table: unknown) => Query; then: PromiseLike<unknown>["then"] };
  const real = db as unknown as { select: (fields?: Record<string, unknown>) => Query };
  const select = (fields?: Record<string, unknown>) => {
    const query = real.select(fields);
    const from = query.from.bind(query);
    query.from = (table) => {
      const built = from(table);
      const pointerRead =
        table === engineReleaseChannels && Object.keys(fields ?? {}).join() === "releaseId,rev";
      const version = pointerRead ? moves.shift() : undefined;
      if (version === undefined) return built;
      const then = built.then.bind(built);
      built.then = (ok, fail) =>
        then(async (rows) => {
          await promote(
            { projectId: PROJECT, version, channel: "production", actor: publisherActor },
            { db: deps().db, now: () => NOW },
          );
          return rows;
        }).then(ok, fail);
      return built;
    };
    return query;
  };
  return { ...(db as unknown as ReleaseDb), select } as unknown as ReleaseDb;
}

beforeAll(async () => {
  for (const id of ["pub", "editor", "outsider"]) await seedUser(db, id);
  await seedUser(db, "staff", { guildRoles: ["Staff"] });
  await db.insert(teams).values({ id: TEAM, slug: "live-team", name: "Team", createdBy: "pub" });
  await db.insert(teamMembers).values({ teamId: TEAM, userId: "editor", role: "member" });
  release = await plannedRelease({ projectId: PROJECT, gameId: GAME, engineVersion: "0.14.1" });
  hall = await editedVersion(release, "hall", 4);
  yard = await editedVersion(release, "yard", 5);
});

let announced: ReturnType<typeof vi.spyOn>;

/** v1 on both channels; hall@1 and yard@1 on preview, hall@1 also on production. */
beforeEach(async () => {
  store = memoryReleaseStore();
  announced = vi.spyOn(engineLive, "announce").mockResolvedValue(undefined);
  forgetLiveSnapshots();
  forgetProjectReleases(PROJECT);
  await db.delete(engineReleaseJamLinks);
  await db.delete(engineProjects);
  await db.insert(engineProjects).values({
    projectId: PROJECT,
    name: "Live Play",
    game: GAME,
    teamId: TEAM,
    createdById: "pub",
    visibility: "public",
  });
  await uploadRelease(deps(), release, { actor: publisherActor, promoteTo: "production" });
  await publishScene(hall);
  await publishScene(yard);
  await toProduction("hall");
});

afterEach(() => {
  announced.mockRestore();
});

describe("the play payload's live state", () => {
  it("gives a numbered play no live scenes, even the version production plays", async () => {
    for (const who of [anonymous, outsider, editor, publisher]) {
      const resolved = await play("1", who);
      expect(resolved).toMatchObject({ ok: true, play: { version: 1, channel: "production" } });
      expect(resolved.ok && resolved.play.live).toBeNull();
    }
  });

  it("gives a jam version no live scenes", async () => {
    await db
      .insert(itchJams)
      .values({ jamId: 9101, slug: "live-jam", title: "Live Jam", status: "running" })
      .onConflictDoNothing();
    await db
      .insert(engineReleaseJamLinks)
      .values({ projectId: PROJECT, jamId: 9101, releaseId: release.releaseId });
    expect(await liveOf("1", anonymous)).toBeNull();
  });

  it("gives latest production's snapshot, to anyone who may play it", async () => {
    const expected = {
      channel: "production",
      rev: await liveRev(PROJECT, "production"),
      release: release.releaseId,
      scenes: [
        {
          scene: "hall",
          version: hall.id,
          number: 1,
          timing: "now",
          since: await sinceOf("production", "hall"),
        },
      ],
      removed: [],
    };
    for (const who of [anonymous, outsider, publisher])
      expect(await liveOf("latest", who)).toEqual(expected);
  });

  it("gives preview its own pointers, and only to the people who make the game", async () => {
    expect(await play("preview", anonymous)).toEqual({ ok: false, reason: "not-found" });
    expect(await play("preview", outsider)).toEqual({ ok: false, reason: "not-found" });
    for (const who of [editor, publisher]) {
      const live = await liveOf("preview", who);
      expect(live).toMatchObject({
        channel: "preview",
        rev: await liveRev(PROJECT, "preview"),
        release: release.releaseId,
      });
      expect(live!.scenes.map((s) => [s.scene, s.version])).toEqual([
        ["hall", hall.id],
        ["yard", yard.id],
      ]);
    }
  });

  it("leaves out a blocked, a hidden and an incompatible pointer, and lists the hidden one as removed", async () => {
    await setVersion(yard.id, { blockedAt: NOW, blockedBy: "system", blockReason: "failing" });
    expect((await liveOf("preview", editor))!.scenes.map((s) => s.scene)).toEqual(["hall"]);

    await setVersion(hall.id, { hiddenAt: NOW, hiddenReason: "reported" });
    const hidden = await liveOf("preview", editor);
    expect(hidden!.scenes).toEqual([]);
    expect(hidden!.removed).toEqual([hall.id]);

    await setVersion(hall.id, { hiddenAt: null, hiddenReason: null });
    await setVersion(yard.id, { blockedAt: null, blockedBy: null, blockReason: null });
    expect((await liveOf("preview", editor))!.scenes).toHaveLength(2);

    await db
      .update(engineReleases)
      .set({ liveCompatKey: "f".repeat(64) })
      .where(eq(engineReleases.id, release.releaseId));
    forgetLiveSnapshots();
    forgetProjectReleases(PROJECT);
    expect((await liveOf("latest", anonymous))!.scenes).toEqual([]);
    expect((await liveOf("preview", editor))!.scenes).toEqual([]);
  });

  it("serves a burst of plays from one pointer query, and a move from a fresh one", async () => {
    const tables: unknown[] = [];
    const counted = countingDb(tables);
    const pointerQueries = () => tables.filter((t) => t === engineSceneChannels).length;

    const burst = await Promise.all(
      Array.from({ length: 12 }, () => play("latest", anonymous, { db: counted })),
    );
    expect(new Set(burst.map((r) => JSON.stringify(r.ok && r.play.live))).size).toBe(1);
    expect(pointerQueries()).toBe(1);

    await play("latest", outsider, { db: counted });
    expect(pointerQueries()).toBe(1);

    await toProduction("yard");
    const moved = await play("latest", anonymous, { db: counted });
    expect(pointerQueries()).toBe(2);
    expect(moved.ok && moved.play.live!.scenes.map((s) => s.scene)).toEqual(["hall", "yard"]);
  });

  it("loads again once the entry is five seconds old", async () => {
    const tables: unknown[] = [];
    const counted = countingDb(tables);
    const pointerQueries = () => tables.filter((t) => t === engineSceneChannels).length;
    await play("latest", anonymous, { db: counted });
    await play("latest", anonymous, { db: counted, now: () => new Date(NOW.getTime() + 4_999) });
    expect(pointerQueries()).toBe(1);
    await play("latest", anonymous, { db: counted, now: () => new Date(NOW.getTime() + 5_000) });
    expect(pointerQueries()).toBe(2);
  });
});

describe("a channel that moves while the play resolves", () => {
  let second: PlannedRelease;
  beforeAll(async () => {
    second = await plannedRelease({
      projectId: PROJECT,
      gameId: GAME,
      engineVersion: "0.14.1",
      hallVariant: 2,
    });
  });

  it("names the channel's moving versions both ways", () => {
    expect(playVersionOf("production")).toBe("latest");
    expect(playVersionOf("preview")).toBe("preview");
    expect(channelOfPlayVersion("latest")).toBe("production");
    expect(channelOfPlayVersion("preview")).toBe("preview");
    expect(channelOfPlayVersion("1")).toBeNull();
    expect(channelOfPlayVersion("production")).toBeNull();
  });

  it("resolves once more, so the payload and its live state name the same release", async () => {
    const shipped = await uploadRelease(deps(), second, { actor: publisherActor });
    const resolved = await play("latest", anonymous, { db: movingDb([shipped.version]) });
    if (!resolved.ok) throw new Error(`refused: ${resolved.reason}`);
    expect(resolved.play.release.id).toBe(shipped.releaseId);
    expect(resolved.play.live).toMatchObject({
      channel: "production",
      release: shipped.releaseId,
      rev: await liveRev(PROJECT, "production"),
    });
  });

  it("gives an empty state at rev 0 over the payload's release when it moves again", async () => {
    const shipped = await uploadRelease(deps(), second, { actor: publisherActor });
    const resolved = await play("latest", anonymous, { db: movingDb([shipped.version, 1]) });
    if (!resolved.ok) throw new Error(`refused: ${resolved.reason}`);
    expect(resolved.play.release.id).toBe(shipped.releaseId);
    expect(resolved.play.live).toEqual({
      channel: "production",
      rev: 0,
      release: shipped.releaseId,
      scenes: [],
      removed: [],
    });
  });
});

describe("getGameLive", () => {
  it("answers the channel's snapshot through the play gate", async () => {
    const live = await call(
      getGameLive,
      { projectId: PROJECT, channel: "production" },
      asUser("staff"),
    );
    expect(live).toMatchObject({
      channel: "production",
      release: release.releaseId,
      scenes: [{ scene: "hall", version: hall.id }],
    });
    expect(
      await call(getGameLive, { projectId: PROJECT, channel: "preview" }, asUser("staff")),
    ).toMatchObject({ channel: "preview", scenes: [{ scene: "hall" }, { scene: "yard" }] });
  });

  it("reads as not found to a caller the gate refuses and for an unknown project", async () => {
    for (const who of [null, "outsider", "editor"]) {
      await expect(
        call(getGameLive, { projectId: PROJECT, channel: "production" }, asUser(who)),
      ).rejects.toSatisfy((e) => e instanceof ORPCError && e.code === "NOT_FOUND");
    }
    await expect(
      call(getGameLive, { projectId: "no-such-game", channel: "production" }, asUser("staff")),
    ).rejects.toSatisfy((e) => e instanceof ORPCError && e.code === "NOT_FOUND");
  });

  it("stays off the cached public tier", () => {
    expect(PUBLIC_PROCEDURE_NAMES).not.toContain("getGameLive");
  });
});
