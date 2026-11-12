import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  engineProjects,
  engineReleaseAudit,
  engineReleaseChannels,
  engineReleaseReports,
  engineReleases,
  projects,
} from "@/db/schema";
import { createTestDb, seedUser, type TestDb } from "@/test/db";

import type { Viewer } from "../release-access";
import { ReleaseError } from "../release-errors";
import {
  approvePublic,
  hideRelease,
  moderationQueue,
  reportGame,
  resolveReport,
  unhideRelease,
  type ModerationDeps,
} from "../release-moderation";

const PROJECT = "kitchen";
const V1 = "1".repeat(64);
const V2 = "2".repeat(64);
const staff = { kind: "staff", userId: "staff" } as const;

let db: TestDb;
let forgotten: string[];
let purged: string[];
let counts: Map<string, number>;

const viewer = async (userId: string): Promise<Viewer> => ({
  userId,
  staff: userId === "staff",
  teamRole: null,
  isCreator: userId === "owner",
});

const deps = (over: Partial<ModerationDeps> = {}): ModerationDeps => ({
  db: db as unknown as ModerationDeps["db"],
  viewer,
  forget: {
    release: (id) => forgotten.push(`release ${id}`),
    project: (id) => forgotten.push(`project ${id}`),
  },
  purge: async (releaseId) => {
    purged.push(releaseId);
    return { purged: true, urls: 5 };
  },
  rateLimit: async (bucket, key, limit) => {
    const id = `${bucket}:${key}`;
    const count = (counts.get(id) ?? 0) + 1;
    counts.set(id, count);
    return count <= limit;
  },
  ...over,
});

async function seedRelease(id: string, version: number) {
  await db.insert(engineReleases).values({
    id,
    projectId: PROJECT,
    version,
    manifest: "{}",
    manifestBytes: 2,
    totalBytes: 10,
    fileCount: 1,
    engineVersion: "0.14.1",
    gameId: "tactics",
    snapshot: "a".repeat(64),
    buildHash: "b".repeat(64),
    target: "web",
  });
}

beforeEach(async () => {
  db = await createTestDb();
  forgotten = [];
  purged = [];
  counts = new Map();
  for (const id of ["owner", "staff", "reporter", "other"]) await seedUser(db, id);
  await db.insert(engineProjects).values({
    projectId: PROJECT,
    name: "Kitchen",
    createdById: "owner",
    visibility: "unlisted",
  });
  await seedRelease(V1, 1);
  await seedRelease(V2, 2);
  await db
    .insert(engineReleaseChannels)
    .values({ projectId: PROJECT, channel: "production", releaseId: V1 });
});

const audit = async () =>
  (await db.select().from(engineReleaseAudit).orderBy(asc(engineReleaseAudit.id))).map((r) => [
    r.action,
    r.actorKind,
    r.releaseId,
  ]);

const release = async (id: string) =>
  (await db.select().from(engineReleases).where(eq(engineReleases.id, id)))[0];

const project = async () =>
  (await db.select().from(engineProjects).where(eq(engineProjects.projectId, PROJECT)))[0];

const refusal = async (run: Promise<unknown>) => {
  const error = await run.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ReleaseError);
  return (error as ReleaseError).body;
};

describe("reportGame", () => {
  it("writes a report with a title snapshot, on the version production plays", async () => {
    const { id } = await reportGame(
      {
        projectId: PROJECT,
        reason: "  Hateful text on the title screen. ",
        reporterId: "reporter",
      },
      deps(),
    );
    const [row] = await db
      .select()
      .from(engineReleaseReports)
      .where(eq(engineReleaseReports.id, id));
    expect(row).toMatchObject({
      projectId: PROJECT,
      releaseId: V1,
      version: 1,
      title: "Kitchen",
      reporterId: "reporter",
      reason: "Hateful text on the title screen.",
      resolvedAt: null,
    });
  });

  it("names a version when asked, and takes the showcase's title when one is linked", async () => {
    await db.insert(projects).values({
      id: "showcase-1",
      slug: "kitchen-game",
      title: "The Kitchen Game",
      createdBy: "owner",
    });
    await db
      .update(engineProjects)
      .set({ showcaseProjectId: "showcase-1" })
      .where(eq(engineProjects.projectId, PROJECT));
    const { id } = await reportGame(
      { projectId: PROJECT, version: 2, reason: "Spam", reporterId: "reporter" },
      deps(),
    );
    const [row] = await db
      .select()
      .from(engineReleaseReports)
      .where(eq(engineReleaseReports.id, id));
    expect(row).toMatchObject({ releaseId: V2, version: 2, title: "The Kitchen Game" });
  });

  it("allows ten reports a day per reporter", async () => {
    const d = deps();
    for (let i = 0; i < 10; i++) {
      await reportGame({ projectId: PROJECT, reason: `r${i}`, reporterId: "reporter" }, d);
    }
    const body = await refusal(
      reportGame({ projectId: PROJECT, reason: "one more", reporterId: "reporter" }, d),
    );
    expect(body).toMatchObject({ code: "release-rate-limited" });
    expect(body.message).toContain("10 reports today");
    // Another reporter has their own budget.
    await reportGame({ projectId: PROJECT, reason: "mine", reporterId: "other" }, d);
    expect(await db.select().from(engineReleaseReports)).toHaveLength(11);
    expect(counts.get("engine-report:reporter")).toBe(11);
  });

  it("calls a game the reporter can't see not found, before spending their budget", async () => {
    await db
      .update(engineProjects)
      .set({ visibility: "private" })
      .where(eq(engineProjects.projectId, PROJECT));
    const body = await refusal(
      reportGame({ projectId: PROJECT, reason: "x", reporterId: "reporter" }, deps()),
    );
    expect(body.code).toBe("not-found");
    expect(counts.size).toBe(0);
    expect(
      (
        await refusal(
          reportGame({ projectId: "nope", reason: "x", reporterId: "reporter" }, deps()),
        )
      ).code,
    ).toBe("not-found");
  });
});

describe("resolveReport", () => {
  it("hides the reported release with a reason, purges its shell, and audits both", async () => {
    const { id } = await reportGame(
      { projectId: PROJECT, reason: "Bad", reporterId: "reporter" },
      deps(),
    );
    const result = await resolveReport(
      { reportId: id, action: "hide-release", reason: "Breaks the content rules.", actor: staff },
      deps(),
    );
    expect(result).toEqual({
      resolved: true,
      resolution: "hidden-release",
      edge: { purged: true, note: null },
    });

    expect(await release(V1)).toMatchObject({
      hiddenById: "staff",
      hiddenReason: "Breaks the content rules.",
    });
    expect((await release(V1))?.hiddenAt).toBeInstanceOf(Date);
    expect((await release(V2))?.hiddenAt).toBeNull();
    expect(forgotten).toEqual([`release ${V1}`]);
    expect(purged).toEqual([V1]);
    const [report] = await db
      .select()
      .from(engineReleaseReports)
      .where(eq(engineReleaseReports.id, id));
    expect(report).toMatchObject({ resolvedById: "staff", resolution: "hidden-release" });
    expect(await audit()).toEqual([
      ["hide", "staff", V1],
      ["report-resolved", "staff", null],
    ]);

    // A second resolution of the same report changes nothing.
    const again = await resolveReport({ reportId: id, action: "dismiss", actor: staff }, deps());
    expect(again.resolved).toBe(false);
    expect(await audit()).toHaveLength(2);
  });

  it("hides the whole project, purging every kept release's shell", async () => {
    const { id } = await reportGame(
      { projectId: PROJECT, reason: "Bad", reporterId: "reporter" },
      deps(),
    );
    await resolveReport(
      { reportId: id, action: "hide-project", reason: "Impersonates another team.", actor: staff },
      deps(),
    );
    expect(await project()).toMatchObject({
      hiddenById: "staff",
      hiddenReason: "Impersonates another team.",
    });
    expect(forgotten).toEqual([`project ${PROJECT}`]);
    expect(purged.sort()).toEqual([V1, V2]);
  });

  it("dismisses without hiding", async () => {
    const { id } = await reportGame(
      { projectId: PROJECT, reason: "Meh", reporterId: "reporter" },
      deps(),
    );
    const result = await resolveReport({ reportId: id, action: "dismiss", actor: staff }, deps());
    expect(result).toMatchObject({ resolved: true, resolution: "dismissed" });
    expect((await release(V1))?.hiddenAt).toBeNull();
    expect(purged).toEqual([]);
    expect(await audit()).toEqual([["report-resolved", "staff", null]]);
  });

  it("refuses a hide without a reason, and anyone but staff", async () => {
    const { id } = await reportGame(
      { projectId: PROJECT, reason: "Bad", reporterId: "reporter" },
      deps(),
    );
    expect(
      (await refusal(resolveReport({ reportId: id, action: "hide-release", actor: staff }, deps())))
        .code,
    ).toBe("invalid-input");
    expect(
      (
        await refusal(
          resolveReport(
            {
              reportId: id,
              action: "dismiss",
              actor: { kind: "user", userId: "owner" },
            },
            deps(),
          ),
        )
      ).code,
    ).toBe("release-forbidden");
  });
});

describe("hides", () => {
  it("are staff only, by the role table", async () => {
    for (const actor of [
      { kind: "user", userId: "owner" },
      { kind: "agent", userId: "owner", agentTokenId: "t" },
    ] as const) {
      const body = await refusal(
        hideRelease({ projectId: PROJECT, version: 1, reason: "x", actor }, deps()),
      );
      expect(body.code).toBe("release-forbidden");
    }
    // A signed-in staff member acting as a person passes through `canDo`.
    await hideRelease(
      { projectId: PROJECT, version: 1, reason: "x", actor: { kind: "user", userId: "staff" } },
      deps(),
    );
    expect((await release(V1))?.hiddenReason).toBe("x");
  });

  it("say when edge copies may persist", async () => {
    const result = await hideRelease(
      { projectId: PROJECT, version: 2, reason: "Spam", actor: staff },
      deps({ purge: async () => ({ purged: false, reason: "Edge purge isn't configured." }) }),
    );
    expect(result).toEqual({
      releaseIds: [V2],
      edge: { purged: false, note: "Edge purge isn't configured." },
    });
  });

  it("unhide a release or the project, audited and forgotten", async () => {
    await hideRelease({ projectId: PROJECT, version: 1, reason: "a", actor: staff }, deps());
    await hideRelease({ projectId: PROJECT, reason: "b", actor: staff }, deps());
    forgotten = [];

    await unhideRelease({ projectId: PROJECT, actor: staff }, deps());
    expect((await project())?.hiddenAt).toBeNull();
    // Versions hidden one by one stay hidden.
    expect((await release(V1))?.hiddenReason).toBe("a");

    await unhideRelease({ projectId: PROJECT, version: 1, actor: staff }, deps());
    expect((await release(V1))?.hiddenAt).toBeNull();
    expect(forgotten).toEqual([`project ${PROJECT}`, `release ${V1}`]);
    expect((await audit()).map((r) => r[0])).toEqual(["hide", "hide", "unhide", "unhide"]);

    // Unhiding what isn't hidden writes nothing.
    await unhideRelease({ projectId: PROJECT, version: 1, actor: staff }, deps());
    expect(await audit()).toHaveLength(4);
  });
});

describe("approvePublic", () => {
  it("makes the project public once, audited", async () => {
    await db
      .update(engineProjects)
      .set({ publicReviewRequestedAt: new Date() })
      .where(eq(engineProjects.projectId, PROJECT));
    const queued = await moderationQueue({ actor: staff }, deps());
    expect(queued.reviews.map((r) => r.projectId)).toEqual([PROJECT]);

    const first = await approvePublic({ projectId: PROJECT, actor: staff }, deps());
    expect(first.alreadyApproved).toBe(false);
    expect(await project()).toMatchObject({ visibility: "public", publicApprovedById: "staff" });
    expect(forgotten).toEqual([`project ${PROJECT}`]);

    const second = await approvePublic({ projectId: PROJECT, actor: staff }, deps());
    expect(second.alreadyApproved).toBe(true);
    expect((await audit()).map((r) => r[0])).toEqual(["approve-public"]);
    expect((await moderationQueue({ actor: staff }, deps())).reviews).toEqual([]);
  });

  it("is refused to a publisher", async () => {
    const body = await refusal(
      approvePublic({ projectId: PROJECT, actor: { kind: "user", userId: "owner" } }, deps()),
    );
    expect(body.code).toBe("release-forbidden");
  });
});

describe("moderationQueue", () => {
  it("lists open reports with their reporter and what's hidden, resolved ones on request", async () => {
    const d = deps();
    const open = await reportGame({ projectId: PROJECT, reason: "a", reporterId: "reporter" }, d);
    const done = await reportGame({ projectId: PROJECT, reason: "b", reporterId: "other" }, d);
    await resolveReport(
      { reportId: done.id, action: "hide-release", reason: "Hidden.", actor: staff },
      d,
    );

    const queue = await moderationQueue({ actor: staff }, d);
    expect(queue.reports.map((r) => r.id)).toEqual([open.id]);
    expect(queue.reports[0]).toMatchObject({
      projectId: PROJECT,
      version: 1,
      title: "Kitchen",
      reporter: { id: "reporter", displayName: "reporter" },
      releaseHiddenAt: expect.any(Date),
      projectHiddenAt: null,
    });
    expect(queue.hidden).toMatchObject([
      { projectId: PROJECT, version: 1, reason: "Hidden.", byImageScan: false },
    ]);

    const all = await moderationQueue({ actor: staff, includeResolved: true }, d);
    expect(all.reports.map((r) => [r.id, r.resolution])).toEqual([
      [open.id, null],
      [done.id, "hidden-release"],
    ]);

    expect(
      (await refusal(moderationQueue({ actor: { kind: "user", userId: "owner" } }, d))).code,
    ).toBe("release-forbidden");
  });
});
