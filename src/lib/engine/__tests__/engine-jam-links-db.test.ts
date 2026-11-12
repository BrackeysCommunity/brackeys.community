import { asc, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { db as mockedDb } from "@/db";
import {
  engineProjects,
  engineReleaseAudit,
  engineReleaseJamLinks,
  engineReleases,
  itchJams,
  projectJamLinks,
  projects,
  teamMembers,
  teams,
} from "@/db/schema";
import { seedUser, type TestDb } from "@/test/db";

import { PROJECT_QUOTA } from "../limits";
import type { Actor } from "../release-audit";
import { ReleaseError } from "../release-errors";
import { linkJam, unlinkJam, type JamLinkDeps } from "../release-jam-links";
import { playUrlOf, type ReleaseTxDb } from "../release-upload";

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return { db: await createTestDb() } as unknown as typeof import("@/db");
});

const db = mockedDb as unknown as TestDb;

const PROJECT = "fixture";
const TEAM = "team-1";
const SHOWCASE = "showcase-1";
const NOW = new Date("2026-11-12T15:00:00Z");
const DAY = 86_400_000;
const JAM = 100;
const ENDED_JAM = 200;

const publisher: Actor = { kind: "user", userId: "pub" };
const editor: Actor = { kind: "user", userId: "editor" };
const staff: Actor = { kind: "user", userId: "staff" };
const agent: Actor = { kind: "agent", userId: "pub", agentTokenId: "token" };

let now = NOW;
const deps: JamLinkDeps = { db: db as unknown as ReleaseTxDb, now: () => now };

const hex = (n: number) => n.toString(16).padStart(64, "0");

async function insertRelease(version: number) {
  await db.insert(engineReleases).values({
    id: hex(version),
    projectId: PROJECT,
    version,
    manifest: "{}",
    manifestBytes: 2,
    totalBytes: 1_000,
    fileCount: 3,
    engineVersion: "0.14.1",
    gameId: "fixture-game",
    snapshot: "a".repeat(64),
    buildHash: "b".repeat(64),
    target: "web",
    createdById: "pub",
    createdAt: new Date(NOW.getTime() - (20 - version) * DAY),
  });
}

async function insertJam(jamId: number, endsAt: Date | null) {
  await db.insert(itchJams).values({
    jamId,
    slug: `jam-${jamId}`,
    title: `Jam ${jamId}`,
    status: endsAt && endsAt <= NOW ? "over" : "running",
    startsAt: new Date(NOW.getTime() - 7 * DAY),
    endsAt,
  });
}

async function refusal(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    if (error instanceof ReleaseError) return { ...error.body, status: error.status };
    throw error;
  }
  throw new Error("the call wasn't refused");
}

const link = (version: number, actor: Actor = publisher, jamId = JAM) =>
  linkJam({ projectId: PROJECT, version, jamId, actor }, deps);

const links = async () =>
  (
    await db
      .select({ jamId: engineReleaseJamLinks.jamId, releaseId: engineReleaseJamLinks.releaseId })
      .from(engineReleaseJamLinks)
      .orderBy(asc(engineReleaseJamLinks.jamId))
  ).map((r) => [r.jamId, r.releaseId]);

const audit = async () =>
  (await db.select().from(engineReleaseAudit).orderBy(asc(engineReleaseAudit.id))).map((r) => [
    r.action,
    r.actorId,
    r.fromRelease,
    r.toRelease,
    r.detail,
  ]);

beforeAll(async () => {
  for (const id of ["pub", "editor", "outsider"]) await seedUser(db, id);
  await seedUser(db, "staff", { guildRoles: ["Staff"] });
  await db.insert(teams).values({ id: TEAM, slug: "team-1", name: "Team", createdBy: "pub" });
  await db.insert(teamMembers).values({ teamId: TEAM, userId: "editor", role: "member" });
});

beforeEach(async () => {
  now = NOW;
  await db.delete(engineProjects);
  await db.delete(projects);
  await db.delete(itchJams);
  await db.insert(engineProjects).values({
    projectId: PROJECT,
    name: "Fixture",
    game: "fixture-game",
    teamId: TEAM,
    createdById: "pub",
    visibility: "unlisted",
  });
  for (const version of [1, 2, 3]) await insertRelease(version);
  await insertJam(JAM, new Date(NOW.getTime() + 2 * DAY));
  await insertJam(ENDED_JAM, new Date(NOW.getTime() - DAY));
});

describe("linkJam", () => {
  it("keeps one version per jam: linking again moves the pin, with one audit row per change", async () => {
    expect(await link(1)).toEqual({ jamId: JAM, from: null, to: 1, moved: true });
    expect(await link(2)).toEqual({ jamId: JAM, from: 1, to: 2, moved: true });
    expect(await link(2)).toEqual({ jamId: JAM, from: 2, to: 2, moved: false });

    expect(await links()).toEqual([[JAM, hex(2)]]);
    expect(await audit()).toEqual([
      ["jam-link", "pub", null, hex(1), { jamId: JAM }],
      ["jam-link", "pub", hex(1), hex(2), { jamId: JAM }],
    ]);
  });

  it("refuses a ninth jam, while moving one of the eight still works", async () => {
    const jams = Array.from({ length: PROJECT_QUOTA.jamPins + 1 }, (_, i) => 1_000 + i);
    for (const jamId of jams) await insertJam(jamId, new Date(NOW.getTime() + DAY));
    for (const jamId of jams.slice(0, PROJECT_QUOTA.jamPins)) await link(1, publisher, jamId);

    expect(await refusal(() => link(1, publisher, jams.at(-1)))).toMatchObject({
      code: "quota-exceeded",
      limit: "jamPins",
      used: PROJECT_QUOTA.jamPins,
      max: PROJECT_QUOTA.jamPins,
      message: `This project already pins ${PROJECT_QUOTA.jamPins} jam versions, the most it can.`,
      status: 413,
    });
    expect(await link(2, publisher, jams[0])).toMatchObject({ from: 1, to: 2 });
    expect(await links()).toHaveLength(PROJECT_QUOTA.jamPins);
  });

  it("freezes the jam version at the jam's end, except for staff", async () => {
    await link(1);
    now = new Date(NOW.getTime() + 2 * DAY);
    expect(await refusal(() => link(2))).toMatchObject({
      code: "release-forbidden",
      message: "Jam 100 ended on 14 Nov 2026, so its jam version can't change.",
      status: 403,
    });
    expect(
      await refusal(() => unlinkJam({ projectId: PROJECT, jamId: JAM, actor: publisher }, deps)),
    ).toMatchObject({ code: "release-forbidden" });
    expect(await refusal(() => link(1, publisher, ENDED_JAM))).toMatchObject({
      code: "release-forbidden",
    });

    expect(await link(2, staff)).toMatchObject({ from: 1, to: 2 });
    expect(await link(3, { kind: "staff", userId: "staff" }, ENDED_JAM)).toMatchObject({
      from: null,
      to: 3,
    });
    expect(await links()).toEqual([
      [JAM, hex(2)],
      [ENDED_JAM, hex(3)],
    ]);
  });

  it("refuses a game that isn't public or unlisted, and a hidden or removed release", async () => {
    await db.update(engineProjects).set({ visibility: "private" });
    expect(await refusal(() => link(1))).toMatchObject({
      code: "release-forbidden",
      message: "Only a public or unlisted game can link a version to a jam.",
    });
    await db.update(engineProjects).set({ visibility: "team" });
    expect(await refusal(() => link(1))).toMatchObject({ code: "release-forbidden" });

    await db.update(engineProjects).set({ visibility: "public" });
    await db
      .update(engineReleases)
      .set({ hiddenAt: NOW, hiddenReason: "Spam" })
      .where(eq(engineReleases.version, 1));
    expect(await refusal(() => link(1))).toMatchObject({
      code: "release-forbidden",
      message: "v1 is hidden: Spam",
    });
    await db.update(engineReleases).set({ collectedAt: NOW }).where(eq(engineReleases.version, 2));
    expect(await refusal(() => link(2))).toMatchObject({ code: "release-immutable" });
    await db.update(engineProjects).set({ hiddenAt: NOW });
    expect(await refusal(() => link(3))).toMatchObject({ code: "release-forbidden" });

    expect(await links()).toEqual([]);
    expect(await audit()).toEqual([]);
  });

  it("is for publishers and staff: editors, agent tokens and outsiders are refused", async () => {
    for (const actor of [editor, agent, { kind: "user", userId: "outsider" } as Actor]) {
      expect(await refusal(() => link(1, actor))).toMatchObject({
        code: "release-forbidden",
        message: "Only the game's publishers can do this.",
      });
    }
    expect(await refusal(() => link(9))).toMatchObject({ code: "not-found", status: 404 });
    expect(await refusal(() => link(1, publisher, 999))).toMatchObject({ code: "not-found" });
  });

  it("writes the showcase project's jam link with the version's play URL, and moves it with the pin", async () => {
    await db.insert(projects).values({ id: SHOWCASE, slug: "showcase", title: "Showcase" });
    await db.update(engineProjects).set({ showcaseProjectId: SHOWCASE });

    await link(1);
    const rows = () =>
      db
        .select({
          jamId: projectJamLinks.jamId,
          submissionUrl: projectJamLinks.submissionUrl,
          participatedAt: projectJamLinks.participatedAt,
        })
        .from(projectJamLinks)
        .where(eq(projectJamLinks.projectId, SHOWCASE));
    expect(await rows()).toEqual([
      {
        jamId: JAM,
        submissionUrl: playUrlOf(PROJECT, 1),
        participatedAt: new Date(NOW.getTime() - 7 * DAY),
      },
    ]);
    expect(playUrlOf(PROJECT, 1)).toMatch(/^https?:\/\/.+\/games\/fixture\/play\/1$/);

    await link(3);
    expect((await rows()).map((r) => r.submissionUrl)).toEqual([playUrlOf(PROJECT, 3)]);

    expect(await unlinkJam({ projectId: PROJECT, jamId: JAM, actor: publisher }, deps)).toEqual({
      jamId: JAM,
      version: 3,
    });
    expect(await rows()).toEqual([expect.objectContaining({ jamId: JAM, submissionUrl: null })]);
  });

  it("updates a jam row the showcase project already had instead of adding a second", async () => {
    await db.insert(projects).values({ id: SHOWCASE, slug: "showcase", title: "Showcase" });
    await db.update(engineProjects).set({ showcaseProjectId: SHOWCASE });
    await db.insert(projectJamLinks).values({
      projectId: SHOWCASE,
      jamId: JAM,
      submissionUrl: "https://example.itch.io/fixture",
      result: "Overall: #3 of 40",
    });

    await link(2);
    const rows = await db
      .select({ submissionUrl: projectJamLinks.submissionUrl, result: projectJamLinks.result })
      .from(projectJamLinks)
      .where(eq(projectJamLinks.projectId, SHOWCASE));
    expect(rows).toEqual([{ submissionUrl: playUrlOf(PROJECT, 2), result: "Overall: #3 of 40" }]);
  });
});

describe("unlinkJam", () => {
  it("removes the pin with a jam-unlink audit row, and refuses a jam with none", async () => {
    await link(2);
    await unlinkJam({ projectId: PROJECT, jamId: JAM, actor: publisher }, deps);
    expect(await links()).toEqual([]);
    expect((await audit()).at(-1)).toEqual(["jam-unlink", "pub", hex(2), null, { jamId: JAM }]);
    expect(
      await refusal(() => unlinkJam({ projectId: PROJECT, jamId: JAM, actor: publisher }, deps)),
    ).toMatchObject({ code: "not-found", status: 404 });
  });
});
