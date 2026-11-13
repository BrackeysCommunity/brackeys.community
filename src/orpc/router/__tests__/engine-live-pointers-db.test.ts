import { call } from "@orpc/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { db as mockedDb } from "@/db";
import { engineAgentTokens, engineProjects, teamMembers, teams } from "@/db/schema";
import { beginSceneVersion, commitSceneVersion } from "@/lib/engine/live-upload";
import {
  getSceneVersion as getVersion,
  listSceneVersions as listVersions,
  liveBase,
  promoteScene,
} from "@/lib/engine/live-versions";
import type { Actor } from "@/lib/engine/release-audit";
import { promote } from "@/lib/engine/release-channels";
import { ReleaseError } from "@/lib/engine/release-errors";
import {
  beginRelease,
  commitRelease,
  putReleaseFile,
  type ReleaseDeps,
  type ReleaseTxDb,
} from "@/lib/engine/release-upload";
import {
  clearSceneVersion,
  getLiveBase,
  getSceneVersion,
  listSceneVersions,
  promoteSceneVersion,
  rollbackSceneVersion,
} from "@/orpc/router/engine-live";
import { seedUser, type TestDb } from "@/test/db";
import { asUser } from "@/test/orpc";

import {
  fixtureVersion,
  type FixtureVersion,
} from "../../../lib/engine/__tests__/fixtures/live/scene-versions";
import { plannedRelease, type PlannedRelease } from "../../../lib/engine/__tests__/release-fixture";

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
}));
vi.mock("@/lib/engine/release-storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/engine/release-storage")>();
  shared.store = actual.memoryReleaseStore();
  return { ...actual, minioReleaseStore: shared.store };
});

const games = vi.hoisted(() => ({
  env: "staging" as "production" | "staging" | "development",
  flag: true,
}));
vi.mock("@/lib/deploy-env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/deploy-env")>()),
  deployEnv: () => games.env,
}));
vi.mock("@/lib/posthog-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/posthog-server")>()),
  isServerFlagEnabled: async (flag: string) => flag !== "engine-games-enabled" || games.flag,
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => true }));

const db = mockedDb as unknown as TestDb;
const PROJECT = "fixture";
const TEAM = "team-1";
const TOKEN = "00000000-0000-4000-8000-000000000001";

const staff: Actor = { kind: "staff", userId: "staff" };
const publisher: Actor = { kind: "user", userId: "pub" };
const editor: Actor = { kind: "user", userId: "editor" };
const player: Actor = { kind: "user", userId: "outsider" };
const agent: Actor = { kind: "agent", userId: "editor", agentTokenId: TOKEN };

let release: PlannedRelease;
let hall: FixtureVersion;
const deps = (): ReleaseDeps => ({
  db: db as unknown as ReleaseTxDb,
  store: shared.store!,
  scan: async () => {},
});

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/** The release's own text of `id`, as its `data/` file ships it. */
function releaseText(id: string): [string, string] {
  const asset = release.manifest.assets[id]!;
  return [asset.sha256, decode(release.files.get(asset.file)!)];
}

beforeAll(async () => {
  for (const id of ["pub", "owner", "editor", "outsider", "member"]) await seedUser(db, id);
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
  });
  await db.insert(engineAgentTokens).values({
    id: TOKEN,
    projectId: PROJECT,
    createdById: "editor",
    tokenSha256: "f".repeat(64),
    label: "ci",
    access: "write",
    expiresAt: new Date(Date.now() + 3_600_000),
  });

  release = await plannedRelease({ projectId: PROJECT });
  const shipped = await beginRelease(deps(), {
    projectId: PROJECT,
    manifest: release.text,
    actor: staff,
  });
  for (const file of shipped.missing)
    await putReleaseFile(deps(), {
      uploadId: shipped.uploadId,
      sha256: file.sha256,
      body: release.files.get(file.path)!,
      actor: staff,
    });
  await commitRelease(deps(), { uploadId: shipped.uploadId, actor: staff });
  await promote({ projectId: PROJECT, version: 1, channel: "production", actor: staff });

  hall = await fixtureVersion(release, {
    scene: "hall",
    edit: (scene) => {
      (scene.entities as { at: number[] }[])[0]!.at = [4, 2];
    },
  });
  const begun = await beginSceneVersion(deps(), {
    projectId: PROJECT,
    version: hall.text,
    channel: "preview",
    note: "Moved the start",
    actor: staff,
  });
  for (const file of begun.missing)
    await putReleaseFile(deps(), {
      uploadId: begun.uploadId,
      sha256: file.sha256,
      body: new TextEncoder().encode(hall.texts.get(file.sha256)!),
      actor: staff,
    });
  await commitSceneVersion(deps(), { uploadId: begun.uploadId, actor: staff });
});

beforeEach(() => {
  games.env = "staging";
  games.flag = true;
});

/** The oRPC error's code and its release API body, or null when the call went through. */
async function refusal(run: () => Promise<unknown>) {
  try {
    await run();
    return null;
  } catch (error) {
    const e = error as { code?: string; data?: { code?: string; message?: string } };
    return { code: e.code, data: e.data };
  }
}

/** The lib's refusal body, or null when the call went through. */
async function libRefusal(run: () => Promise<unknown>) {
  try {
    await run();
    return null;
  } catch (error) {
    if (error instanceof ReleaseError) return error.body;
    throw error;
  }
}

const hallSha = () => hall.version.assets.hall!.sha256;

/** One call of each pointer procedure, as `user`. */
const everyProcedure = (user: string | null) => [
  () => call(listSceneVersions, { projectId: PROJECT }, asUser(user)),
  () => call(getSceneVersion, { projectId: PROJECT, scene: "hall", number: 1 }, asUser(user)),
  () => call(getLiveBase, { projectId: PROJECT, scene: "hall", channel: "preview" }, asUser(user)),
  () =>
    call(
      promoteSceneVersion,
      { projectId: PROJECT, scene: "hall", number: 1, channel: "preview" },
      asUser(user),
    ),
  () =>
    call(
      rollbackSceneVersion,
      { projectId: PROJECT, scene: "hall", channel: "preview" },
      asUser(user),
    ),
  () =>
    call(
      clearSceneVersion,
      { projectId: PROJECT, scene: "hall", channel: "preview" },
      asUser(user),
    ),
];

describe("the live pointer procedures", () => {
  it("list a scene's versions newest first, with the pointer commit put on preview", async () => {
    const versions = await call(listSceneVersions, { projectId: PROJECT }, asUser("staff"));
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({
      scene: "hall",
      number: 1,
      id: hall.id,
      note: "Moved the start",
      blocked: null,
      hidden: null,
      collectedAt: null,
      removalAt: null,
      reports: { ok: 0, failed: 0 },
      pointers: [{ channel: "preview", timing: "next-load" }],
    });
    expect(
      await call(listSceneVersions, { projectId: PROJECT, scene: "yard" }, asUser("staff")),
    ).toEqual([]);
  });

  it("get a version's files, outcomes and whether it fits each kept release", async () => {
    const detail = await call(
      getSceneVersion,
      { projectId: PROJECT, scene: "hall", number: 1 },
      asUser("staff"),
    );
    expect(detail.sceneHash).toBe(hallSha());
    expect(detail.files.map((f) => f.sha256)).toContain(hallSha());
    expect(detail.outcomes).toEqual({ applied: 0, refused: 0, failed: 0, crashed: 0 });
    expect(detail.compat).toEqual([
      { version: 1, releaseId: release.releaseId, fits: true, issue: null },
    ]);
    expect(
      await refusal(() =>
        call(getSceneVersion, { projectId: PROJECT, scene: "hall", number: 9 }, asUser("staff")),
      ),
    ).toMatchObject({ code: "NOT_FOUND", data: { code: "not-found" } });
  });

  it("give base the release's own texts where no pointer applies, and the pointed version's where one does", async () => {
    const production = await call(
      getLiveBase,
      { projectId: PROJECT, scene: "hall", channel: "production" },
      asUser("staff"),
    );
    expect(production).toEqual({
      channel: "production",
      release: { id: release.releaseId, version: 1, manifest: release.text },
      live: null,
      texts: Object.fromEntries([releaseText("hall")]),
      latest: 1,
    });

    const preview = await call(
      getLiveBase,
      { projectId: PROJECT, scene: "hall", channel: "preview" },
      asUser("staff"),
    );
    expect(preview.live).toMatchObject({ number: 1, versionId: hall.id, timing: "next-load" });
    expect(preview.live?.descriptor).toBe(hall.text);
    expect(preview.texts).toEqual({ [hallSha()]: hall.texts.get(hallSha()) });
    expect(preview.texts).not.toEqual(production.texts);

    const yard = await call(
      getLiveBase,
      { projectId: PROJECT, scene: "yard", channel: "preview" },
      asUser("staff"),
    );
    expect(yard).toMatchObject({ live: null, latest: null });
    expect(yard.texts).toEqual(Object.fromEntries([releaseText("yard")]));
  });

  it("promote, roll back and stop a scene for staff, the timing defaulting to the next load", async () => {
    expect(
      await call(
        promoteSceneVersion,
        { projectId: PROJECT, scene: "hall", number: 1, channel: "production" },
        asUser("staff"),
      ),
    ).toEqual({ from: null, to: 1, timing: "next-load" });
    const based = await call(
      getLiveBase,
      { projectId: PROJECT, scene: "hall", channel: "production" },
      asUser("staff"),
    );
    expect(based.live?.number).toBe(1);
    expect(based.texts).toEqual({ [hallSha()]: hall.texts.get(hallSha()) });

    expect(
      await call(
        rollbackSceneVersion,
        { projectId: PROJECT, scene: "hall", channel: "production" },
        asUser("staff"),
      ),
    ).toEqual({ from: 1, to: null });
    expect(
      await call(
        promoteSceneVersion,
        { projectId: PROJECT, scene: "hall", number: 1, channel: "production", timing: "now" },
        asUser("staff"),
      ),
    ).toEqual({ from: null, to: 1, timing: "now" });
    expect(
      await call(
        clearSceneVersion,
        { projectId: PROJECT, scene: "hall", channel: "production" },
        asUser("staff"),
      ),
    ).toEqual({ from: 1 });
    expect(
      await refusal(() =>
        call(
          clearSceneVersion,
          { projectId: PROJECT, scene: "hall", channel: "production" },
          asUser("staff"),
        ),
      ),
    ).toMatchObject({ code: "NOT_FOUND", data: { code: "not-found" } });
  });

  it("refuse a caller who isn't staff, and a signed-out one", async () => {
    for (const run of everyProcedure("member"))
      expect(await refusal(run)).toMatchObject({ code: "FORBIDDEN" });
    for (const run of everyProcedure(null))
      expect(await refusal(run)).toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("read as not found on production and while engine-games-enabled is off", async () => {
    for (const setting of [{ env: "production" as const }, { flag: false }]) {
      Object.assign(games, { env: "staging", flag: true }, setting);
      for (const run of everyProcedure("staff"))
        expect(await refusal(run)).toMatchObject({ code: "NOT_FOUND" });
    }
  });
});

describe("the calls under the procedures, per role", () => {
  const reads = (actor: Actor) => [
    () => listVersions({ projectId: PROJECT, actor }),
    () => getVersion({ projectId: PROJECT, scene: "hall", number: 1, actor }),
    () => liveBase({ projectId: PROJECT, scene: "hall", channel: "preview", actor }, deps()),
  ];
  const promoteAs = (actor: Actor, channel: "preview" | "production") =>
    promoteScene(deps(), { projectId: PROJECT, scene: "hall", number: 1, channel, actor });

  it("let the game's makers and its agents read, and refuse its players", async () => {
    for (const actor of [staff, publisher, editor, agent])
      for (const run of reads(actor)) expect(await libRefusal(run)).toBeNull();
    for (const run of reads(player))
      expect(await libRefusal(run)).toMatchObject({ code: "release-forbidden" });
  });

  it("move preview for editors and agents, and production for publishers only", async () => {
    for (const actor of [editor, agent, publisher])
      expect(await libRefusal(() => promoteAs(actor, "preview"))).toBeNull();
    expect(await libRefusal(() => promoteAs(publisher, "production"))).toBeNull();
    expect(await libRefusal(() => promoteAs(editor, "production"))).toMatchObject({
      code: "release-forbidden",
      message: "Only the game's publishers can do this.",
    });
    expect(await libRefusal(() => promoteAs(agent, "production"))).toMatchObject({
      code: "release-forbidden",
      message: "Production releases are moved by a person on the game's page.",
    });
    expect(await libRefusal(() => promoteAs(player, "preview"))).toMatchObject({
      code: "release-forbidden",
    });
  });
});
