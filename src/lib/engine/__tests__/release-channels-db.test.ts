import { asc, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { db as mockedDb } from "@/db";
import {
  engineAgentTokens,
  engineProjects,
  engineReleaseAudit,
  engineReleaseChannels,
  engineReleaseJamLinks,
  engineReleases,
  itchJams,
  teamMembers,
  teams,
} from "@/db/schema";
import { seedUser, type TestDb } from "@/test/db";

import type { Actor } from "../release-audit";
import {
  getRelease,
  listReleases,
  promote,
  rollback,
  type ChannelDeps,
  type ReleaseChannel,
} from "../release-channels";
import { ReleaseError } from "../release-errors";
import type { ReleaseTxDb } from "../release-upload";
import { plannedRelease, type PlannedRelease } from "./release-fixture";

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return { db: await createTestDb() } as unknown as typeof import("@/db");
});

const db = mockedDb as unknown as TestDb;

const PROJECT = "fixture";
const TEAM = "team-1";
const NOW = new Date("2026-11-12T15:00:00Z");
const DAY = 86_400_000;
const TOKEN = "00000000-0000-4000-8000-000000000001";

const publisher: Actor = { kind: "user", userId: "pub" };
const owner: Actor = { kind: "user", userId: "owner" };
const editor: Actor = { kind: "user", userId: "editor" };
const outsider: Actor = { kind: "user", userId: "outsider" };
const staff: Actor = { kind: "user", userId: "staff" };
const agent: Actor = { kind: "agent", userId: "editor", agentTokenId: TOKEN };

const deps: ChannelDeps = { db: db as unknown as ReleaseTxDb, now: () => NOW };

const hex = (n: number) => n.toString(16).padStart(64, "0");

let planned: PlannedRelease;

async function insertRelease(version: number, opts: { id?: string; manifest?: string } = {}) {
  await db.insert(engineReleases).values({
    id: opts.id ?? hex(version),
    projectId: PROJECT,
    version,
    manifest: opts.manifest ?? "{}",
    manifestBytes: 2,
    totalBytes: 1_000 * version,
    fileCount: 3,
    engineVersion: "0.14.1",
    gameId: "fixture-game",
    snapshot: "a".repeat(64),
    buildHash: "b".repeat(64),
    target: "web",
    createdById: "editor",
    createdAt: new Date(NOW.getTime() - (20 - version) * DAY),
  });
}

/** The refusal's API body and status, or a failure when the call went through. */
async function refusal(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    if (error instanceof ReleaseError) return { ...error.body, status: error.status };
    throw error;
  }
  throw new Error("the call wasn't refused");
}

const pointer = async (channel: ReleaseChannel) =>
  (
    await db
      .select({ releaseId: engineReleaseChannels.releaseId })
      .from(engineReleaseChannels)
      .where(eq(engineReleaseChannels.channel, channel))
  )[0]?.releaseId ?? null;

const audit = () => db.select().from(engineReleaseAudit).orderBy(asc(engineReleaseAudit.id));

/** Every release row without the once-live stamp, which only production moves set. */
const releaseRows = async () =>
  (await db.select().from(engineReleases).orderBy(asc(engineReleases.version))).map(
    ({ firstPromotedAt: _stamp, ...rest }) => rest,
  );

const move = (
  kind: "promote" | "rollback",
  channel: ReleaseChannel,
  actor: Actor,
  version?: number,
) =>
  kind === "promote"
    ? promote({ projectId: PROJECT, version: version!, channel, actor }, deps)
    : rollback(
        { projectId: PROJECT, channel, actor, ...(version !== undefined ? { to: version } : {}) },
        deps,
      );

beforeAll(async () => {
  for (const id of ["pub", "owner", "editor", "outsider"]) await seedUser(db, id);
  await seedUser(db, "staff", { guildRoles: ["Staff"] });
  await db.insert(teams).values({ id: TEAM, slug: "team-1", name: "Team", createdBy: "pub" });
  await db.insert(teamMembers).values([
    { teamId: TEAM, userId: "owner", role: "owner" },
    { teamId: TEAM, userId: "editor", role: "member" },
  ]);
  planned = await plannedRelease({
    projectId: PROJECT,
    gameId: "fixture-game",
    engineVersion: "0.14.1",
  });
});

beforeEach(async () => {
  await db.delete(engineProjects);
  await db.delete(itchJams);
  await db.insert(engineProjects).values({
    projectId: PROJECT,
    name: "Fixture",
    game: "fixture-game",
    teamId: TEAM,
    createdById: "pub",
    visibility: "unlisted",
  });
  await db.insert(engineAgentTokens).values({
    id: TOKEN,
    projectId: PROJECT,
    createdById: "editor",
    access: "write",
    label: "ci",
    tokenSha256: "f".repeat(64),
    expiresAt: new Date(NOW.getTime() + DAY),
  });
  for (const version of [1, 2, 3]) await insertRelease(version);
});

describe("promote", () => {
  it("moves only the pointer, one audit row per move, and stamps production's first time", async () => {
    const before = await releaseRows();
    expect(await move("promote", "preview", editor, 1)).toEqual({ from: null, to: 1 });
    expect(await move("promote", "preview", agent, 2)).toEqual({ from: 1, to: 2 });
    expect(await move("promote", "production", publisher, 2)).toEqual({ from: null, to: 2 });
    expect(await move("promote", "production", owner, 3)).toEqual({ from: 2, to: 3 });

    expect(await releaseRows()).toEqual(before);
    expect(await pointer("preview")).toBe(hex(2));
    expect(await pointer("production")).toBe(hex(3));
    const rows = await audit();
    expect(
      rows.map((r) => [r.action, r.actorKind, r.actorId, r.channel, r.fromRelease, r.toRelease]),
    ).toEqual([
      ["promote", "user", "editor", "preview", null, hex(1)],
      ["promote", "agent", "editor", "preview", hex(1), hex(2)],
      ["promote", "user", "pub", "production", null, hex(2)],
      ["promote", "user", "owner", "production", hex(2), hex(3)],
    ]);
    expect(rows[1]?.agentTokenId).toBe(TOKEN);

    const stamps = await db
      .select({ version: engineReleases.version, at: engineReleases.firstPromotedAt })
      .from(engineReleases)
      .orderBy(asc(engineReleases.version));
    expect(stamps.map((s) => s.at?.getTime() ?? null)).toEqual([
      null,
      NOW.getTime(),
      NOW.getTime(),
    ]);
    // Every move is stamped with the caller's clock, not the database's.
    expect(rows.every((r) => r.at.getTime() === NOW.getTime())).toBe(true);
    const pointers = await db.select().from(engineReleaseChannels);
    expect(pointers.every((p) => p.updatedAt.getTime() === NOW.getTime())).toBe(true);
  });

  it("changes nothing when the channel already names the release", async () => {
    await move("promote", "production", publisher, 1);
    expect(await move("promote", "production", publisher, 1)).toEqual({ from: 1, to: 1 });
    expect(await audit()).toHaveLength(1);
  });

  it("refuses an agent on production with release-forbidden, pointing at the game's page", async () => {
    const refused = await refusal(() => move("promote", "production", agent, 1));
    expect(refused).toMatchObject({ code: "release-forbidden", status: 403 });
    expect(refused.hint).toMatch(new RegExp(`/games/${PROJECT}$`));
    expect(await refusal(() => move("rollback", "production", agent))).toMatchObject({
      code: "release-forbidden",
    });
    expect(await pointer("production")).toBeNull();
    expect(await audit()).toEqual([]);
  });

  it("lets an editor move preview but not production", async () => {
    await move("promote", "preview", editor, 1);
    await move("promote", "production", publisher, 1);
    await move("promote", "production", publisher, 2);
    for (const run of [
      () => move("promote", "production", editor, 3),
      () => move("rollback", "production", editor),
      () => move("rollback", "production", editor, 1),
    ]) {
      expect(await refusal(run)).toMatchObject({
        code: "release-forbidden",
        message: "Only the game's publishers can do this.",
      });
    }
    expect(await pointer("production")).toBe(hex(2));
    expect(await refusal(() => move("promote", "preview", outsider, 2))).toMatchObject({
      code: "release-forbidden",
    });
    expect(await move("promote", "production", staff, 3)).toEqual({ from: 2, to: 3 });
  });

  it("refuses a collected release as release-immutable, with its UTC date", async () => {
    await db
      .update(engineReleases)
      .set({ collectedAt: new Date("2026-12-03T23:30:00Z"), manifest: null })
      .where(eq(engineReleases.version, 2));
    expect(await refusal(() => move("promote", "production", publisher, 2))).toMatchObject({
      code: "release-immutable",
      status: 409,
      message: "v2 was removed on 3 Dec 2026; its files are gone.",
    });
    expect(await audit()).toEqual([]);
  });

  it("refuses a hidden release as release-forbidden, with staff's reason", async () => {
    await db
      .update(engineReleases)
      .set({ hiddenAt: NOW, hiddenReason: "An image is waiting for review." })
      .where(eq(engineReleases.version, 3));
    expect(await refusal(() => move("promote", "preview", editor, 3))).toMatchObject({
      code: "release-forbidden",
      message: "v3 is hidden: An image is waiting for review.",
    });
  });

  it("answers not found for an unknown version or project", async () => {
    expect(await refusal(() => move("promote", "preview", editor, 9))).toMatchObject({
      code: "not-found",
      status: 404,
    });
    expect(
      await refusal(() =>
        promote({ projectId: "nope", version: 1, channel: "preview", actor: staff }, deps),
      ),
    ).toMatchObject({ code: "not-found" });
  });
});

describe("rollback", () => {
  it("without `to`, returns to the release the channel named before its last move", async () => {
    await move("promote", "production", publisher, 1);
    await move("promote", "production", publisher, 2);
    const before = await releaseRows();
    expect(await move("rollback", "production", publisher)).toEqual({ from: 2, to: 1 });
    expect(await pointer("production")).toBe(hex(1));
    expect(await releaseRows()).toEqual(before);

    const rows = await audit();
    expect(rows).toHaveLength(3);
    expect(rows[2]).toMatchObject({
      action: "rollback",
      channel: "production",
      fromRelease: hex(2),
      toRelease: hex(1),
      actorId: "pub",
    });
    // Rolling back the rollback goes forward again.
    expect(await move("rollback", "production", publisher)).toEqual({ from: 1, to: 2 });
  });

  it("with `to`, moves to any kept version, and refuses a collected one", async () => {
    await move("promote", "preview", agent, 3);
    expect(await move("rollback", "preview", agent, 1)).toEqual({ from: 3, to: 1 });
    expect(await pointer("preview")).toBe(hex(1));

    await db
      .update(engineReleases)
      .set({ collectedAt: new Date("2026-12-03T10:00:00Z") })
      .where(eq(engineReleases.version, 2));
    expect(await refusal(() => move("rollback", "preview", agent, 2))).toMatchObject({
      code: "release-immutable",
      message: "v2 was removed on 3 Dec 2026; its files are gone.",
    });
    expect(await audit()).toHaveLength(2);
  });

  it("refuses a channel with nothing to go back to", async () => {
    expect(await refusal(() => move("rollback", "production", publisher))).toMatchObject({
      code: "not-found",
      message: "production doesn't name a release yet.",
    });
    await move("promote", "production", publisher, 1);
    expect(await refusal(() => move("rollback", "production", publisher))).toMatchObject({
      code: "not-found",
      message: "production has no earlier release to go back to.",
    });
    expect(await audit()).toHaveLength(1);
  });

  it("reads only its own channel's moves from the audit log", async () => {
    await move("promote", "production", publisher, 1);
    await move("promote", "preview", editor, 2);
    await move("promote", "production", publisher, 3);
    await move("promote", "preview", editor, 1);
    expect(await move("rollback", "production", publisher)).toEqual({ from: 3, to: 1 });
    expect(await pointer("preview")).toBe(hex(1));
  });
});

describe("listReleases", () => {
  async function seedTwelve() {
    await db.delete(engineReleases);
    for (let version = 1; version <= 12; version++) await insertRelease(version);
    await db
      .update(engineReleases)
      .set({ createdAt: new Date(NOW.getTime() - 5 * DAY) })
      .where(eq(engineReleases.version, 1));
    await db.insert(itchJams).values({ jamId: 7, slug: "jam-7", title: "Jam 7", status: "over" });
    await db
      .insert(engineReleaseJamLinks)
      .values({ projectId: PROJECT, jamId: 7, releaseId: hex(2) });
    await move("promote", "production", publisher, 11);
    await move("promote", "preview", editor, 12);
    await db
      .update(engineReleases)
      .set({ hiddenAt: NOW, hiddenReason: "Reported." })
      .where(eq(engineReleases.version, 10));
  }

  it("lists newest first with pins, audience and the collector's forecast", async () => {
    await seedTwelve();
    const list = await listReleases({ projectId: PROJECT, actor: editor }, deps);
    expect(list.map((r) => r.version)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);

    const by = new Map(list.map((r) => [r.version, r]));
    expect(by.get(12)).toMatchObject({ channels: ["preview"], audience: "team", removalAt: null });
    expect(by.get(11)).toMatchObject({ channels: ["production"], audience: "unlisted" });
    expect(by.get(11)?.firstPromotedAt).toBeInstanceOf(Date);
    expect(by.get(10)).toMatchObject({
      hidden: { at: NOW, reason: "Reported." },
      audience: "none",
    });
    expect(by.get(2)).toMatchObject({
      jams: [{ jamId: 7, title: "Jam 7" }],
      audience: "unlisted",
      removalAt: null,
    });
    // Outside the ten newest and unpinned: removed at the first run after its 14-day grace.
    expect(by.get(1)?.removalAt).toEqual(new Date("2026-11-22T03:30:00Z"));
    expect(by.get(1)?.playUrl).toMatch(new RegExp(`/games/${PROJECT}/play/1$`));
    expect(by.get(1)).toMatchObject({ id: hex(1), totalBytes: 1_000, fileCount: 3 });
  });

  it("names publishers as the audience of a personal private project", async () => {
    await seedTwelve();
    await db
      .update(engineProjects)
      .set({ teamId: null, visibility: "private" })
      .where(eq(engineProjects.projectId, PROJECT));
    const list = await listReleases({ projectId: PROJECT, actor: publisher }, deps);
    const by = new Map(list.map((r) => [r.version, r]));
    expect(by.get(12)?.audience).toBe("publishers");
    expect(by.get(11)?.audience).toBe("publishers");
  });

  it("is for the game's team and its agents, not other people", async () => {
    expect(await listReleases({ projectId: PROJECT, actor: agent }, deps)).toHaveLength(3);
    expect(
      await refusal(() => listReleases({ projectId: PROJECT, actor: outsider }, deps)),
    ).toMatchObject({ code: "release-forbidden" });
  });
});

describe("getRelease", () => {
  it("summarises the manifest: scenes and physics, the budget, the credits gaps", async () => {
    await insertRelease(4, { id: planned.releaseId, manifest: planned.text });
    const detail = await getRelease({ projectId: PROJECT, version: 4, actor: editor }, deps);
    const { manifest } = planned;
    expect(detail).toMatchObject({ version: 4, id: planned.releaseId, start: manifest.flow.start });
    expect(detail.scenes.map((s) => [s.id, s.physics])).toEqual(
      manifest.flow.scenes.map((s) => [s.id, s.physics]),
    );
    expect(detail.scenes.length).toBeGreaterThan(0);
    expect(detail.budget).toEqual(manifest.budget);
    expect(detail.creditsMissing).toBe(manifest.credits.missing.length);
  });

  it("keeps a collected release's record with an empty manifest summary", async () => {
    await db
      .update(engineReleases)
      .set({ collectedAt: NOW, manifest: null })
      .where(eq(engineReleases.version, 1));
    expect(await getRelease({ projectId: PROJECT, version: 1, actor: editor }, deps)).toMatchObject(
      { version: 1, collectedAt: NOW, audience: "none", scenes: [], budget: null },
    );
    expect(
      await refusal(() => getRelease({ projectId: PROJECT, version: 9, actor: editor }, deps)),
    ).toMatchObject({ code: "not-found" });
  });
});
