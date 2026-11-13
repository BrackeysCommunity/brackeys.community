import { call } from "@orpc/server";
import { and, desc, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { db as mockedDb } from "@/db";
import {
  engineLiveReports,
  engineProjects,
  engineReleaseAudit,
  engineSceneVersionFiles,
  engineSceneVersions,
  teamMembers,
  teams,
} from "@/db/schema";
import { seedUser, type TestDb } from "@/test/db";
import { asUser } from "@/test/orpc";

import { fixtureVersion } from "../../../lib/engine/__tests__/fixtures/live/scene-versions";
import { plannedRelease, type PlannedRelease } from "../../../lib/engine/__tests__/release-fixture";
import {
  liveRev,
  refusal,
  uploadDeps,
  uploadRelease,
  uploadSceneVersion,
} from "../../../lib/engine/__tests__/upload-rig";
import { createFrameRoute } from "../../../lib/engine/frame-route";
import { engineLive } from "../../../lib/engine/live-events";
import {
  blockSceneVersion as blockLib,
  hideSceneVersion as hideLib,
  liveReportKey,
  reportLiveOutcome,
  sceneVersionQueue,
  unblockSceneVersion as unblockLib,
  type LiveOutcome,
} from "../../../lib/engine/live-moderation";
import { channelLive, promoteScene } from "../../../lib/engine/live-versions";
import type { Actor } from "../../../lib/engine/release-audit";
import type { ReleaseTxDb } from "../../../lib/engine/release-upload";
import {
  blockSceneVersion,
  hideSceneVersion,
  listSceneVersionQueue,
  reportLiveState,
  unblockSceneVersion,
  unhideSceneVersion,
} from "../engine-live";

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
const shared = vi.hoisted(() => ({
  store: null as null | import("@/lib/engine/release-storage").ReleaseObjectStore,
  hits: new Map<string, number>(),
}));
vi.mock("@/lib/engine/release-storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/engine/release-storage")>();
  shared.store = actual.memoryReleaseStore();
  return { ...actual, minioReleaseStore: shared.store };
});
vi.mock("@/lib/deploy-env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/deploy-env")>()),
  deployEnv: () => "staging",
}));
vi.mock("@/lib/posthog-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/posthog-server")>()),
  isServerFlagEnabled: async () => true,
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: async (bucket: string, key: string, limit: number) => {
    const id = `${bucket}:${key}`;
    const count = (shared.hits.get(id) ?? 0) + 1;
    shared.hits.set(id, count);
    return count <= limit;
  },
}));

const db = mockedDb as unknown as TestDb;
const PROJECT = "fixture";
const TEAM = "team-1";
const PLAY = "http://play.localhost:3000";
const PLAYERS = Array.from({ length: 16 }, (_, i) => `player-${i + 1}`);

const staff: Actor = { kind: "staff", userId: "staff" };
const publisher: Actor = { kind: "user", userId: "pub" };
const editor: Actor = { kind: "user", userId: "editor" };

let release: PlannedRelease;
let clock = new Date();
const tick = (ms = 1000) => (clock = new Date(clock.getTime() + ms));
const deps = () => uploadDeps(shared.store!, { now: () => clock });
const libDeps = () => ({ db: db as unknown as ReleaseTxDb, now: () => clock });

let edits = 0;

/** Publishes a fresh version of `hall` and points both channels at it. */
async function liveVersion(): Promise<{ id: string; number: number }> {
  const at = ++edits;
  const built = await fixtureVersion(release, {
    scene: "hall",
    edit: (scene) => {
      (scene.entities as { at: number[] }[])[0]!.at = [at, 2];
    },
  });
  const { committed } = await uploadSceneVersion(deps(), built, {
    channel: "preview",
    actor: staff,
  });
  const number = committed.number;
  await promoteScene(deps(), {
    projectId: PROJECT,
    scene: "hall",
    channel: "production",
    number,
    actor: staff,
  });
  tick();
  return { id: built.id, number };
}

const report = (
  versionId: string,
  userId: string | null,
  outcome: LiveOutcome,
  more: { channel?: "preview" | "production"; anonId?: string } = {},
) =>
  reportLiveOutcome(
    {
      projectId: PROJECT,
      versionId,
      channel: more.channel ?? "production",
      outcome,
      userId,
      ...(more.anonId !== undefined ? { anonId: more.anonId } : {}),
    },
    libDeps(),
  );

async function versionRow(id: string) {
  const [row] = await db.select().from(engineSceneVersions).where(eq(engineSceneVersions.id, id));
  return row!;
}

async function reportRows(versionId: string) {
  return db.select().from(engineLiveReports).where(eq(engineLiveReports.versionId, versionId));
}

async function lastAudit(versionId: string) {
  const [row] = await db
    .select()
    .from(engineReleaseAudit)
    .where(eq(engineReleaseAudit.sceneVersionId, versionId))
    .orderBy(desc(engineReleaseAudit.id))
    .limit(1);
  return row!;
}

beforeAll(async () => {
  for (const id of ["pub", "owner", "editor", ...PLAYERS]) await seedUser(db, id);
  await seedUser(db, "staff", { guildRoles: ["Staff"] });
  await db.insert(teams).values({ id: TEAM, slug: "team-1", name: "Team", createdBy: "pub" });
  await db.insert(teamMembers).values([
    { teamId: TEAM, userId: "owner", role: "owner" },
    { teamId: TEAM, userId: "editor", role: "member" },
  ]);
  await db.insert(engineProjects).values({
    projectId: PROJECT,
    name: "Fixture",
    teamId: TEAM,
    createdById: "pub",
    visibility: "public",
  });

  release = await plannedRelease({ projectId: PROJECT });
  await uploadRelease(deps(), release, { actor: staff, promoteTo: "production" });
});

let announced: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  shared.hits.clear();
  announced = vi.spyOn(engineLive, "announce").mockResolvedValue(undefined);
});

describe("reports", () => {
  it("keeps one row per player and version, the last report's channel winning", async () => {
    const v = await liveVersion();
    await report(v.id, "editor", "applied", { channel: "preview" });
    tick();
    await report(v.id, "editor", "failed");
    const rows = await reportRows(v.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: "editor", channel: "production", outcome: "failed" });
    // The counters count the player once, by their latest outcome.
    expect(await versionRow(v.id)).toMatchObject({ reportsOk: 0, reportsFailed: 1 });

    await call(
      reportLiveState,
      { projectId: PROJECT, versionId: v.id, channel: "production", outcome: "applied" },
      asUser("staff"),
    );
    expect((await reportRows(v.id)).map((r) => r.userId).sort()).toEqual(["editor", "staff"]);

    const refused = { projectId: PROJECT, versionId: v.id, channel: "production" };
    expect(
      await refusal(() =>
        call(
          reportLiveState,
          { ...refused, outcome: "failed", issueCode: "Not A Code" } as never,
          asUser("staff"),
        ),
      ),
    ).toMatchObject({ code: "BAD_REQUEST" });
  });

  it("leaves the counters alone when a player repeats a report", async () => {
    const v = await liveVersion();
    for (let i = 0; i < 5; i++) await report(v.id, "player-3", "failed");
    await report(v.id, "player-4", "applied");
    await report(v.id, "player-4", "applied");
    expect(await versionRow(v.id)).toMatchObject({ reportsOk: 1, reportsFailed: 1 });

    await report(v.id, "player-3", "applied");
    expect(await versionRow(v.id)).toMatchObject({ reportsOk: 2, reportsFailed: 0 });
  });

  it("ignores a report on a version no pointer on the channel names", async () => {
    const old = await liveVersion();
    await liveVersion();
    expect(await report(old.id, "player-5", "failed")).toBeNull();
    expect(await versionRow(old.id)).toMatchObject({ reportsOk: 0, reportsFailed: 0 });
    expect(await reportRows(old.id)).toEqual([]);
  });

  it("refuses a player's report on preview, which only the game's makers play", async () => {
    const v = await liveVersion();
    expect(
      await refusal(() => report(v.id, "player-1", "failed", { channel: "preview" })),
    ).toMatchObject({ code: "not-found" });
    expect(await versionRow(v.id)).toMatchObject({ reportsOk: 0, reportsFailed: 0 });
  });

  it("drops the 31st report in an hour without a word", async () => {
    const v = await liveVersion();
    const anonId = "00000000-0000-4000-8000-0000000000aa";
    for (let i = 0; i < 31; i++) expect(await report(v.id, null, "applied", { anonId })).toBeNull();
    expect((await versionRow(v.id)).reportsOk).toBe(30);

    shared.hits.clear();
    for (let i = 0; i < 30; i++) await report(v.id, "player-2", "applied");
    expect(await report(v.id, "player-2", "failed")).toBeNull();
    expect(await reportRows(v.id)).toEqual([expect.objectContaining({ outcome: "applied" })]);
  });

  it("counts anonymous reports only in the counters, and never blocks on them", async () => {
    const v = await liveVersion();
    for (let i = 0; i < 8; i++)
      await report(v.id, null, "failed", { anonId: `00000000-0000-4000-8000-00000000000${i}` });
    await report(v.id, null, "applied");
    expect(await versionRow(v.id)).toMatchObject({
      reportsOk: 1,
      reportsFailed: 8,
      blockedAt: null,
    });
    expect(await reportRows(v.id)).toEqual([]);
  });

  it("keys a signed-out report by the browser's anonymous id", () => {
    expect(liveReportKey("player-1")).toBe("player-1");
    expect(liveReportKey(null, "ABCDEF00-0000-4000-8000-000000000001")).toBe(
      "anon:abcdef00-0000-4000-8000-000000000001",
    );
    expect(liveReportKey(null, "not-a-uuid")).toBe("anon");
    expect(liveReportKey(null)).toBe("anon");
  });

  it("refuses a version the project doesn't have", async () => {
    expect(await refusal(() => report("e".repeat(64), "player-1", "failed"))).toMatchObject({
      code: "not-found",
    });
  });

  it("answers a caller the play gate refuses as not found", async () => {
    const v = await liveVersion();
    const input = { projectId: PROJECT, versionId: v.id, channel: "production", outcome: "failed" };
    expect(await refusal(() => call(reportLiveState, input as never, asUser("player-1")))).toEqual({
      code: "NOT_FOUND",
    });
    expect(await refusal(() => call(reportLiveState, input as never, asUser(null)))).toEqual({
      code: "NOT_FOUND",
    });
  });
});

describe("the breaker", () => {
  it("blocks at 5 failing players of 12, audits scene-block by system, bumps live_rev and announces", async () => {
    const v = await liveVersion();
    announced.mockClear();
    for (const p of PLAYERS.slice(0, 7)) await report(v.id, p, "applied");
    for (const p of PLAYERS.slice(7, 11)) await report(v.id, p, "failed");
    expect((await versionRow(v.id)).blockedAt).toBeNull();
    expect(announced).not.toHaveBeenCalled();

    await report(v.id, PLAYERS[11]!, "crashed");
    const row = await versionRow(v.id);
    expect(row).toMatchObject({
      blockedBy: "system",
      blockReason: "5 of 12 players' games failed after this update",
    });
    expect(row.blockedAt).not.toBeNull();

    const audit = await lastAudit(v.id);
    expect(audit).toMatchObject({
      action: "scene-block",
      actorKind: "system",
      actorId: null,
      channel: "production",
      sceneId: "hall",
    });
    expect(await liveRev(PROJECT, "production")).toBe(audit.id);
    expect(await liveRev(PROJECT, "preview")).toBe(audit.id);
    expect(announced).toHaveBeenCalledWith({
      projectId: PROJECT,
      channel: "production",
      rev: audit.id,
    });

    const live = await channelLive(db as never, PROJECT, "production");
    expect(live!.snapshot.scenes.map((s) => s.version)).not.toContain(v.id);
  });

  it("starts counting again from an unblock", async () => {
    const v = await liveVersion();
    for (const p of PLAYERS.slice(0, 5)) await report(v.id, p, "failed");
    expect((await versionRow(v.id)).blockedBy).toBe("system");

    tick();
    await unblockLib(
      { projectId: PROJECT, scene: "hall", number: v.number, actor: staff },
      libDeps(),
    );
    const unblocked = await lastAudit(v.id);
    expect(unblocked).toMatchObject({ action: "scene-unblock", actorKind: "staff" });
    expect(await versionRow(v.id)).toMatchObject({ blockedAt: null, blockedBy: null });

    tick();
    for (const p of PLAYERS.slice(5, 9)) await report(v.id, p, "failed");
    expect((await versionRow(v.id)).blockedAt).toBeNull();
    await report(v.id, PLAYERS[9]!, "failed");
    expect((await versionRow(v.id)).blockedBy).toBe("system");
  });

  it("lets staff block and unblock by hand, audited", async () => {
    const v = await liveVersion();
    await call(
      blockSceneVersion,
      { projectId: PROJECT, scene: "hall", number: v.number, reason: "Softlocks at the door" },
      asUser("staff"),
    );
    expect(await versionRow(v.id)).toMatchObject({
      blockedBy: "user",
      blockedById: "staff",
      blockReason: "Softlocks at the door",
    });
    const blocked = await lastAudit(v.id);
    expect(blocked).toMatchObject({ action: "scene-block", actorKind: "staff" });
    expect(await liveRev(PROJECT, "production")).toBe(blocked.id);

    await call(
      unblockSceneVersion,
      { projectId: PROJECT, scene: "hall", number: v.number },
      asUser("staff"),
    );
    expect((await versionRow(v.id)).blockedAt).toBeNull();
    expect((await lastAudit(v.id)).action).toBe("scene-unblock");
  });

  it("needs a publisher to block a version production plays", async () => {
    const v = await liveVersion();
    const at = { projectId: PROJECT, scene: "hall", number: v.number };
    expect(await refusal(() => blockLib({ ...at, actor: editor }, libDeps()))).toMatchObject({
      code: "release-forbidden",
    });
    await blockLib({ ...at, actor: publisher }, libDeps());
    expect(await versionRow(v.id)).toMatchObject({ blockedBy: "user", blockedById: "pub" });
  });
});

describe("staff's hide", () => {
  const route = () =>
    createFrameRoute({
      store: shared.store!,
      db,
      allowed: () => true,
      playHostOrigin: null,
      playOrigin: () => PLAY,
      siteOrigin: () => "http://localhost:3000",
      syncOrigin: () => null,
    });

  it("makes the version's files 410, lists it in removed, audits and announces", async () => {
    const v = await liveVersion();
    const [scene] = await db
      .select()
      .from(engineSceneVersionFiles)
      .where(
        and(eq(engineSceneVersionFiles.versionId, v.id), eq(engineSceneVersionFiles.role, "scene")),
      );
    const live = await channelLive(db as never, PROJECT, "production");
    const url = `${PLAY}/frames/${live!.release.id}/live/${scene!.sha256}${scene!.ext}`;
    expect((await route()(new Request(url))).status).toBe(200);

    await call(
      hideSceneVersion,
      { projectId: PROJECT, scene: "hall", number: v.number, reason: "Reported for slurs" },
      asUser("staff"),
    );
    expect((await route()(new Request(url))).status).toBe(410);
    const hidden = await channelLive(db as never, PROJECT, "production");
    expect(hidden!.snapshot.removed).toContain(v.id);
    expect(hidden!.snapshot.scenes.map((s) => s.version)).not.toContain(v.id);
    const audit = await lastAudit(v.id);
    expect(audit).toMatchObject({
      action: "scene-hide",
      actorKind: "staff",
      detail: { reason: "Reported for slurs", number: v.number },
    });
    expect(hidden!.snapshot.rev).toBe(audit.id);
    expect(announced).toHaveBeenCalledWith({
      projectId: PROJECT,
      channel: "production",
      rev: audit.id,
    });

    await call(
      unhideSceneVersion,
      { projectId: PROJECT, scene: "hall", number: v.number, reason: "Reviewed: a false report" },
      asUser("staff"),
    );
    expect((await lastAudit(v.id)).action).toBe("scene-unhide");
    expect((await route()(new Request(url))).status).toBe(200);
    expect((await channelLive(db as never, PROJECT, "production"))!.snapshot.removed).toEqual([]);
  });

  it("refuses a hide from anyone but staff, and one without a reason", async () => {
    const v = await liveVersion();
    const at = { projectId: PROJECT, scene: "hall", number: v.number, reason: "Spam" };
    expect(await refusal(() => call(hideSceneVersion, at, asUser("pub")))).toMatchObject({
      code: expect.stringMatching(/FORBIDDEN|UNAUTHORIZED/),
    });
    expect(await refusal(() => hideLib({ ...at, actor: publisher }, libDeps()))).toMatchObject({
      code: "release-forbidden",
    });
    expect(
      await refusal(() => hideLib({ ...at, reason: "  ", actor: staff }, libDeps())),
    ).toMatchObject({ code: "invalid-input" });
    expect((await versionRow(v.id)).hiddenAt).toBeNull();
  });
});

describe("staff's queue", () => {
  it("lists flagged versions first, with their project, pointers and reports, hidden ones on request", async () => {
    const quiet = await liveVersion();
    const failing = await liveVersion();
    await report(failing.id, "player-1", "failed");
    await hideLib(
      { projectId: PROJECT, scene: "hall", number: quiet.number, reason: "Spam", actor: staff },
      libDeps(),
    );

    const queue = await call(listSceneVersionQueue, {}, asUser("staff"));
    expect(queue.map((q) => q.id)).not.toContain(quiet.id);
    const first = queue.findIndex((q) => q.id === failing.id);
    expect(queue.slice(0, first).every((q) => q.blocked || q.hidden || q.reports.failed > 0)).toBe(
      true,
    );
    expect(queue[first]).toMatchObject({
      projectId: PROJECT,
      projectName: "Fixture",
      scene: "hall",
      number: failing.number,
      pointers: ["preview", "production"],
      reports: { ok: 0, failed: 1 },
      blocked: null,
      hidden: null,
    });

    const all = await call(listSceneVersionQueue, { includeHidden: true }, asUser("staff"));
    expect(all.find((q) => q.id === quiet.id)?.hidden?.reason).toBe("Spam");
    expect(
      await refusal(() => sceneVersionQueue({ includeHidden: false, actor: publisher }, libDeps())),
    ).toMatchObject({ code: "release-forbidden" });
  });
});
