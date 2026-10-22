import { call } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  canvases,
  canvasReports,
  moderationActions,
  notifications,
  teamMembers,
  teams,
  user,
} from "@/db/schema";
import { type CanvasEvent, onCanvasEvent, revokesFor } from "@/lib/canvas-events";
import { reopenReport } from "@/orpc/router/admin";
import {
  addCanvasMember,
  createCanvas,
  deleteCanvas,
  getCanvas,
  getPublicCanvas,
  listCanvasReports,
  listPublicCanvases,
  reportCanvas,
  resolveCanvasReport,
  saveCanvas,
  setCanvasHidden,
  setCanvasVisibility,
} from "@/orpc/router/canvas";
import { reportTeam } from "@/orpc/router/team";
import { seedUser, type TestDb } from "@/test/db";
import { asUser } from "@/test/orpc";

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return { db: await createTestDb() } as unknown as typeof import("@/db");
});
vi.mock("@/lib/auth", async () => {
  const { fakeAuthModule } = await import("@/test/orpc");
  return fakeAuthModule();
});
vi.mock("@/lib/discord", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/discord")>()),
  isGuildMember: async () => true,
}));
vi.mock("@/lib/guild-sync", () => ({
  refreshDiscordProfileThrottled: async () => {},
}));
vi.mock("@/lib/queue", () => ({
  getNotificationsQueue: async () => ({ add: async () => ({}) }),
}));
vi.mock("@/lib/posthog-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/posthog-server")>()),
  isServerFlagEnabled: async () => true,
}));
const rate = vi.hoisted(() => ({ counters: new Map<string, number>() }));
vi.mock("@/lib/rate-limit", async () => {
  const { ORPCError } = await import("@orpc/client");
  return {
    checkRateLimit: async () => true,
    assertRateLimit: async (bucket: string, userId: string, limit: number, message: string) => {
      const key = `${bucket}:${userId}`;
      const next = (rate.counters.get(key) ?? 0) + 1;
      rate.counters.set(key, next);
      if (next > limit) throw new ORPCError("TOO_MANY_REQUESTS", { message });
    },
  };
});

let db: TestDb;
let teamId: string;
let events: CanvasEvent[] = [];
let stopListening: () => void = () => {};

beforeEach(async () => {
  ({ db } = (await import("@/db")) as unknown as { db: TestDb });
  const { developerProfiles } = await import("@/db/schema");
  rate.counters.clear();
  await db.delete(canvasReports);
  await db.delete(moderationActions);
  await db.delete(notifications);
  await db.delete(canvases);
  await db.delete(teams);
  await db.delete(developerProfiles);
  await db.delete(user);
  for (const id of ["alice", "bob", "carol", "dave", "stranger"]) await seedUser(db, id);
  await seedUser(db, "staff", { guildRoles: ["Staff"] });
  const [team] = await db
    .insert(teams)
    .values({ slug: "crew", name: "Crew", createdBy: "alice" })
    .returning({ id: teams.id });
  teamId = team!.id;
  await db.insert(teamMembers).values([
    { teamId, userId: "alice", role: "owner" },
    { teamId, userId: "bob", role: "member" },
  ]);
  events = [];
  stopListening = onCanvasEvent((event) => events.push(event));
});
afterEach(() => stopListening());

const snapshotNodes = [
  { id: "a", type: "text", text: "Level   ideas\nfor the jam", x: 0, y: 0, width: 200, height: 80 },
  { id: "b", type: "text", text: "Boss fight", x: 240, y: 0, width: 200, height: 80 },
];

async function publicCanvas(
  visibility: "public" | "unlisted" = "public",
  path = "Plan.canvas",
  owner = "alice",
) {
  const { id } = await call(createCanvas, { scope: { kind: "personal" }, path }, asUser(owner));
  await db
    .update(canvases)
    .set({ snapshot: { nodes: snapshotNodes, edges: [] }, nodeCount: snapshotNodes.length })
    .where(eq(canvases.id, id));
  await call(setCanvasVisibility, { canvasId: id, visibility }, asUser(owner));
  events = [];
  return id;
}

async function publicTeamCanvas() {
  const { id } = await call(
    createCanvas,
    { scope: { kind: "team", teamId }, path: "Board.canvas" },
    asUser("alice"),
  );
  await call(setCanvasVisibility, { canvasId: id, visibility: "public" }, asUser("alice"));
  events = [];
  return id;
}

const report = (canvasId: string, by: string, reason = "spam") =>
  call(reportCanvas, { canvasId, reason }, asUser(by));

const hide = (canvasId: string, hidden: boolean, reason?: string, by = "staff") =>
  call(setCanvasHidden, { canvasId, hidden, reason }, asUser(by));

const byJson = (a: unknown, b: unknown) => JSON.stringify(a).localeCompare(JSON.stringify(b));

async function noticesOf(type: string) {
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.type, type as never));
}

describe("E6 reportCanvas", () => {
  it("a signed-in reader of a public or unlisted canvas can report it, with a title snapshot", async () => {
    const pub = await publicCanvas("public", "Pub.canvas");
    const unl = await publicCanvas("unlisted", "Unl.canvas");
    await report(pub, "stranger");
    await report(unl, "stranger");
    const rows = await db.select().from(canvasReports);
    expect(rows.map((r) => [r.canvasId, r.canvasTitle, r.reporterId]).sort(byJson)).toEqual(
      [
        [pub, "Pub", "stranger"],
        [unl, "Unl", "stranger"],
      ].sort(byJson),
    );
  });

  it("private, team, hidden, deleted and unknown canvases are all NOT_FOUND", async () => {
    const { id: priv } = await call(
      createCanvas,
      { scope: { kind: "personal" }, path: "Priv.canvas" },
      asUser("alice"),
    );
    const hidden = await publicCanvas("public", "Hidden.canvas");
    await hide(hidden, true, "abuse");
    const deleted = await publicCanvas("public", "Deleted.canvas");
    await call(deleteCanvas, { canvasId: deleted }, asUser("alice"));
    const teamPub = await publicTeamCanvas();
    await db.update(teams).set({ hiddenAt: new Date() }).where(eq(teams.id, teamId));

    for (const id of [priv, hidden, deleted, teamPub, "00000000-0000-0000-0000-000000000000"]) {
      await expect(report(id, "stranger")).rejects.toMatchObject({
        code: expect.stringMatching(/NOT_FOUND|BAD_REQUEST/),
      });
    }
    // A private canvas: even its own owner can't file one.
    await expect(report(priv, "alice")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await db.select().from(canvasReports)).toEqual([]);
  });

  it("needs a session and a reason of 1..1000 characters", async () => {
    const id = await publicCanvas();
    await expect(report(id, null as unknown as string)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(report(id, "stranger", "   ")).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(report(id, "stranger", "x".repeat(1001))).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await report(id, "stranger", "x".repeat(1000));
  });

  it("a banned member can't report; canReport is off for the owner, members and the roster", async () => {
    const id = await publicCanvas();
    await db.update(user).set({ bannedAt: new Date() }).where(eq(user.id, "dave"));
    await expect(report(id, "dave")).rejects.toMatchObject({
      code: expect.stringMatching(/UNAUTHORIZED|FORBIDDEN/),
    });
    expect((await call(getCanvas, { canvasId: id }, asUser("alice"))).canReport).toBe(false);
    expect((await call(getCanvas, { canvasId: id }, asUser(null))).canReport).toBe(false);
    const teamPub = await publicTeamCanvas();
    expect((await call(getCanvas, { canvasId: teamPub }, asUser("bob"))).canReport).toBe(false);
    expect((await call(getCanvas, { canvasId: teamPub }, asUser("stranger"))).canReport).toBe(true);
  });

  it("refuses a second open report from the same person, but allows one after resolution", async () => {
    const id = await publicCanvas();
    const { id: first } = await report(id, "stranger");
    await expect(report(id, "stranger", "again")).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await call(resolveCanvasReport, { reportId: first, action: "dismiss" }, asUser("stranger"))
      .then(() => {
        throw new Error("a non-staff resolve should fail");
      })
      .catch((error: { code?: string }) => expect(error.code).toBe("FORBIDDEN"));
    await call(resolveCanvasReport, { reportId: first, action: "dismiss" }, asUser("staff"));
    await report(id, "stranger", "it's back");
    expect(await db.select().from(canvasReports)).toHaveLength(2);
  });

  it("shares the 10-an-hour report bucket with team reports", async () => {
    for (let i = 0; i < 5; i++) {
      const [t] = await db
        .insert(teams)
        .values({ slug: `t${i}`, name: `Team ${i}`, createdBy: "carol" })
        .returning({ id: teams.id });
      await db.insert(teamMembers).values({ teamId: t!.id, userId: "carol", role: "owner" });
      await call(reportTeam, { teamId: t!.id, reason: "spam" }, asUser("stranger"));
    }
    for (let i = 0; i < 5; i++)
      await report(await publicCanvas("public", `C${i}.canvas`), "stranger");
    const eleventh = await publicCanvas("public", "Eleventh.canvas");
    await expect(report(eleventh, "stranger")).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
    expect(rate.counters.get("report:stranger")).toBe(11);
    expect(
      await db.select().from(canvasReports).where(eq(canvasReports.canvasId, eleventh)),
    ).toEqual([]);
  });

  it("shows in the admin queue with a thumbnail, a censored excerpt, live state and the reporter", async () => {
    const id = await publicCanvas();
    await report(id, "stranger", "bad stuff");
    const [row] = await call(listCanvasReports, {}, asUser("staff"));
    expect(row).toMatchObject({
      canvasId: id,
      canvasTitle: "Plan",
      liveTitle: "Plan",
      liveVisibility: "public",
      liveHiddenAt: null,
      liveDeletedAt: null,
      reason: "bad stuff",
      reporter: { id: "stranger" },
      excerpt: "Level ideas for the jam · Boss fight",
    });
    expect(row!.thumbnail?.rects).toHaveLength(2);
    await expect(call(listCanvasReports, {}, asUser("alice"))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("caps the queue excerpt and survives a snapshot with no text", async () => {
    const id = await publicCanvas();
    const long = Array.from({ length: 20 }, (_, i) => ({
      id: `n${i}`,
      type: "text",
      text: "word ".repeat(40),
      x: i * 10,
      y: 0,
      width: 10,
      height: 10,
    }));
    await db
      .update(canvases)
      .set({ snapshot: { nodes: long, edges: [] } })
      .where(eq(canvases.id, id));
    await report(id, "stranger");
    const empty = await publicCanvas("public", "Empty.canvas");
    await db
      .update(canvases)
      .set({ snapshot: { nodes: [], edges: [] } })
      .where(eq(canvases.id, empty));
    await report(empty, "stranger");
    const rows = await call(listCanvasReports, {}, asUser("staff"));
    const byId = new Map(rows.map((r) => [r.canvasId, r]));
    expect(byId.get(id)!.excerpt!.length).toBeLessThanOrEqual(280);
    expect(byId.get(empty)!.excerpt).toBe("");
  });
});

describe("E6 reportCanvas refuses people on the canvas", () => {
  it("the owner, an invited member and the team roster can't report; a stranger can", async () => {
    const id = await publicCanvas();
    await call(addCanvasMember, { canvasId: id, userId: "carol", role: "viewer" }, asUser("alice"));
    const team = await publicTeamCanvas();
    for (const [canvasId, who] of [
      [id, "alice"],
      [id, "carol"],
      [team, "alice"],
      [team, "bob"],
    ] as const) {
      await expect(report(canvasId, who)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect(await db.select().from(canvasReports)).toEqual([]);
    await expect(report(team, "stranger")).resolves.toMatchObject({ id: expect.any(Number) });
  });
});

describe("E7 resolveCanvasReport", () => {
  it("hide_canvas needs a reason: none or blank is refused and nothing changes", async () => {
    const id = await publicCanvas();
    const { id: r1 } = await report(id, "stranger");
    for (const reason of [undefined, "", "   "]) {
      await expect(
        call(resolveCanvasReport, { reportId: r1, action: "hide_canvas", reason }, asUser("staff")),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    const [row] = await db.select().from(canvases).where(eq(canvases.id, id));
    expect(row!.hiddenAt).toBeNull();
    expect(events).toEqual([]);
    expect((await call(listCanvasReports, {}, asUser("staff"))).map((r) => r.id)).toEqual([r1]);
    expect(await noticesOf("canvas_hidden_by_staff")).toEqual([]);

    await call(
      resolveCanvasReport,
      { reportId: r1, action: "hide_canvas", reason: "  spam links  " },
      asUser("staff"),
    );
    const [hidden] = await db.select().from(canvases).where(eq(canvases.id, id));
    expect(hidden!.hiddenReason).toBe("spam links");
  });

  it("hide_canvas resolves every open report, logs one row per report, notifies each reporter once", async () => {
    const id = await publicCanvas();
    const { id: r1 } = await report(id, "stranger");
    const { id: r2 } = await report(id, "carol");
    const { id: r3 } = await report(id, "dave");
    // An unrelated open report on another canvas stays open.
    const other = await publicCanvas("public", "Other.canvas");
    const { id: rOther } = await report(other, "stranger");

    await call(
      resolveCanvasReport,
      { reportId: r2, action: "hide_canvas", reason: "abuse" },
      asUser("staff"),
    );

    const open = await call(listCanvasReports, {}, asUser("staff"));
    expect(open.map((r) => r.id)).toEqual([rOther]);
    const logged = await db.select().from(moderationActions);
    // The hide itself on the canvas, plus one row for each sibling report.
    expect(logged.map((r) => [r.action, r.targetType, r.targetId]).sort(byJson)).toEqual(
      [
        ["canvas_hidden", "canvas", id],
        ["canvas_hidden", "canvas_report", String(r1)],
        ["canvas_hidden", "canvas_report", String(r3)],
      ].sort(byJson),
    );
    const resolved = await noticesOf("report_resolved");
    expect(resolved.map((n) => n.userId).sort()).toEqual(["carol", "dave", "stranger"]);
    for (const n of resolved) {
      expect(n.data).toMatchObject({ outcome: "actioned", subjectUrl: null, subjectTitle: "Plan" });
    }
    const ownerNotice = await noticesOf("canvas_hidden_by_staff");
    expect(ownerNotice.map((n) => [n.userId, (n.data as { reason?: string }).reason])).toEqual([
      ["alice", "abuse"],
    ]);
    expect(events.map((e) => e.type)).toEqual(["hidden"]);
  });

  it("dismiss resolves siblings, logs one dismissal per report, links back while still visible", async () => {
    const id = await publicCanvas();
    const { id: r1 } = await report(id, "stranger");
    const { id: r2 } = await report(id, "carol");
    await call(resolveCanvasReport, { reportId: r1, action: "dismiss" }, asUser("staff"));

    expect(await call(listCanvasReports, {}, asUser("staff"))).toEqual([]);
    const logged = await db.select().from(moderationActions);
    expect(logged.map((r) => [r.action, r.targetType, r.targetId]).sort(byJson)).toEqual(
      [
        ["canvas_report_dismissed", "canvas_report", String(r1)],
        ["canvas_report_dismissed", "canvas_report", String(r2)],
      ].sort(byJson),
    );
    const resolved = await noticesOf("report_resolved");
    expect(resolved).toHaveLength(2);
    for (const n of resolved) {
      expect(n.data).toMatchObject({ outcome: "no_action", subjectUrl: `/canvases/${id}` });
    }
    // Dismissing never hides or announces anything.
    expect(events).toEqual([]);
    expect((await call(getPublicCanvas, { canvasId: id }, asUser(null))).id).toBe(id);
  });

  it("one reporter with several resolved rows hears once", async () => {
    const id = await publicCanvas();
    const { id: first } = await report(id, "stranger");
    await call(resolveCanvasReport, { reportId: first, action: "dismiss" }, asUser("staff"));
    await db.delete(notifications);
    const { id: second } = await report(id, "stranger", "again");
    await call(reopenReport, { reportId: first, kind: "canvas" }, asUser("staff"));
    const open = await call(listCanvasReports, {}, asUser("staff"));
    // The reopen is refused while a newer open report from the same person exists.
    expect(open.map((r) => r.id)).toEqual([second]);
    await call(resolveCanvasReport, { reportId: second, action: "dismiss" }, asUser("staff"));
    expect(await noticesOf("report_resolved")).toHaveLength(1);
  });

  it("dismissing a report on a canvas no longer visible gives no link", async () => {
    const id = await publicCanvas();
    const { id: r1 } = await report(id, "stranger");
    await call(setCanvasVisibility, { canvasId: id, visibility: "private" }, asUser("alice"));
    await call(resolveCanvasReport, { reportId: r1, action: "dismiss" }, asUser("staff"));
    const [notice] = await noticesOf("report_resolved");
    expect(notice!.data).toMatchObject({ subjectUrl: null });
  });

  it("resolving twice is a no-op; an unknown report is NOT_FOUND; non-staff are FORBIDDEN", async () => {
    const id = await publicCanvas();
    const { id: r1 } = await report(id, "stranger");
    await call(resolveCanvasReport, { reportId: r1, action: "dismiss" }, asUser("staff"));
    await call(resolveCanvasReport, { reportId: r1, action: "hide_canvas" }, asUser("staff"));
    expect((await db.select().from(canvases).where(eq(canvases.id, id)))[0]!.hiddenAt).toBeNull();
    expect(await db.select().from(moderationActions)).toHaveLength(1);
    await expect(
      call(resolveCanvasReport, { reportId: 999_999, action: "dismiss" }, asUser("staff")),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      call(resolveCanvasReport, { reportId: r1, action: "dismiss" }, asUser("alice")),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      call(resolveCanvasReport, { reportId: r1, action: "delete" as "dismiss" }, asUser("staff")),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("hide_canvas on an already-hidden canvas resolves the reports without a second hide", async () => {
    const id = await publicCanvas();
    const { id: r1 } = await report(id, "stranger");
    await hide(id, true, "first");
    events = [];
    await call(
      resolveCanvasReport,
      { reportId: r1, action: "hide_canvas", reason: "second" },
      asUser("staff"),
    );
    const [row] = await db.select().from(canvases).where(eq(canvases.id, id));
    expect(row!.hiddenReason).toBe("first");
    expect(events).toEqual([]);
    expect(await noticesOf("canvas_hidden_by_staff")).toHaveLength(1);
    expect(await call(listCanvasReports, {}, asUser("staff"))).toEqual([]);
  });

  it("reopenReport works for canvas reports and refuses an open one", async () => {
    const id = await publicCanvas();
    const { id: r1 } = await report(id, "stranger");
    expect(
      await call(reopenReport, { reportId: r1, kind: "canvas" }, asUser("staff")),
    ).toMatchObject({ reopened: false });
    await call(resolveCanvasReport, { reportId: r1, action: "dismiss" }, asUser("staff"));
    expect(
      await call(reopenReport, { reportId: r1, kind: "canvas" }, asUser("staff")),
    ).toMatchObject({ success: true });
    const [row] = await db.select().from(canvasReports).where(eq(canvasReports.id, r1));
    expect(row!.resolvedAt).toBeNull();
    await expect(
      call(reopenReport, { reportId: 424_242, kind: "canvas" }, asUser("staff")),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("a report outlives its canvas: null canvas id, title kept; dismiss works, hide refuses", async () => {
    const id = await publicCanvas();
    const { id: r1 } = await report(id, "stranger");
    const { id: r2 } = await report(id, "carol");
    await db.delete(canvases).where(eq(canvases.id, id));
    const rows = await call(listCanvasReports, {}, asUser("staff"));
    expect(rows.map((r) => [r.canvasId, r.canvasTitle, r.liveTitle, r.thumbnail])).toEqual([
      [null, "Plan", null, null],
      [null, "Plan", null, null],
    ]);
    await expect(
      call(resolveCanvasReport, { reportId: r1, action: "hide_canvas" }, asUser("staff")),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await call(resolveCanvasReport, { reportId: r1, action: "dismiss" }, asUser("staff"));
    // Without a canvas id there are no siblings to find: r2 stays open.
    expect((await call(listCanvasReports, {}, asUser("staff"))).map((r) => r.id)).toEqual([r2]);
    const [notice] = await noticesOf("report_resolved");
    expect(notice!.data).toMatchObject({ subjectTitle: "Plan", subjectUrl: null });
  });
});

describe("E8 staff hide", () => {
  it("staff only, and a reason is required to hide (not to unhide)", async () => {
    const id = await publicCanvas();
    await expect(hide(id, true, "x", "alice")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(hide(id, true, "x", null as unknown as string)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(hide(id, true)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(hide(id, true, "   ")).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(hide(id, true, "x".repeat(501))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(hide("00000000-0000-0000-0000-000000000000", true, "x")).rejects.toMatchObject({
      code: expect.stringMatching(/NOT_FOUND|BAD_REQUEST/),
    });
    expect(events).toEqual([]);
  });

  it("the owner keeps read with the reason; members, strangers and anon get NOT_FOUND", async () => {
    const id = await publicCanvas();
    const { addCanvasMember } = await import("@/orpc/router/canvas");
    await call(addCanvasMember, { canvasId: id, userId: "bob", role: "editor" }, asUser("alice"));
    const old = new Date("2026-01-01T00:00:00Z");
    await db.update(canvases).set({ updatedAt: old }).where(eq(canvases.id, id));

    expect(await hide(id, true, "breaks the rules")).toEqual({ success: true, changed: true });

    const owner = await call(getCanvas, { canvasId: id }, asUser("alice"));
    expect(owner).toMatchObject({
      access: "read",
      hidden: true,
      hiddenReason: "breaks the rules",
      canShare: false,
      canReport: false,
    });
    for (const who of ["bob", "stranger", null]) {
      await expect(call(getCanvas, { canvasId: id }, asUser(who))).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    }
    const staffView = await call(getCanvas, { canvasId: id }, asUser("staff"));
    expect(staffView).toMatchObject({ access: "read", canModerate: true });

    const [row] = await db.select().from(canvases).where(eq(canvases.id, id));
    expect(row!.updatedAt.getTime()).toBeGreaterThan(old.getTime());
    expect(row!.hiddenById).toBe("staff");
  });

  it("an editor member can no longer save a hidden canvas", async () => {
    const id = await publicCanvas();
    const { addCanvasMember } = await import("@/orpc/router/canvas");
    await call(addCanvasMember, { canvasId: id, userId: "bob", role: "editor" }, asUser("alice"));
    await hide(id, true, "x");
    // Access is checked before the payload is read, so any valid base64 will do.
    const payload = { canvasId: id, update: "AA==", stateVector: "AA==" };
    await expect(call(saveCanvas, payload, asUser("bob"))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(call(saveCanvas, payload, asUser("alice"))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("double hide is a no-op: one log row, one notice, one event, the first reason kept", async () => {
    const id = await publicCanvas();
    await hide(id, true, "first");
    expect(await hide(id, true, "second")).toEqual({ success: true, changed: false });
    expect(await db.select().from(moderationActions)).toHaveLength(1);
    expect(await noticesOf("canvas_hidden_by_staff")).toHaveLength(1);
    expect(events.map((e) => e.type)).toEqual(["hidden"]);
    const [row] = await db.select().from(canvases).where(eq(canvases.id, id));
    expect(row!.hiddenReason).toBe("first");
  });

  it("concurrent hides by two staff land once", async () => {
    await seedUser(db, "staff2", { guildRoles: ["Staff"] });
    const id = await publicCanvas();
    const results = await Promise.all([hide(id, true, "a"), hide(id, true, "b", "staff2")]);
    expect(results.filter((r) => r.changed)).toHaveLength(1);
    expect(await db.select().from(moderationActions)).toHaveLength(1);
    expect(events.map((e) => e.type)).toEqual(["hidden"]);
  });

  it("unhiding an unhidden canvas is a no-op", async () => {
    const id = await publicCanvas();
    expect(await hide(id, false)).toEqual({ success: true, changed: false });
    expect(events).toEqual([]);
    expect(await db.select().from(moderationActions)).toEqual([]);
  });

  it("a hidden canvas leaves getPublicCanvas and listPublicCanvases; unhide brings both back and tells the owner", async () => {
    const id = await publicCanvas();
    const unl = await publicCanvas("unlisted", "Unl.canvas");
    await hide(id, true, "x");
    await hide(unl, true, "x");
    await expect(call(getPublicCanvas, { canvasId: id }, asUser(null))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(call(getPublicCanvas, { canvasId: unl }, asUser(null))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await call(listPublicCanvases, { ownerId: "alice" }, asUser(null))).toEqual([]);

    await hide(id, false);
    await hide(unl, false);
    expect((await call(getPublicCanvas, { canvasId: id }, asUser(null))).id).toBe(id);
    expect((await call(getPublicCanvas, { canvasId: unl }, asUser(null))).id).toBe(unl);
    expect(
      (await call(listPublicCanvases, { ownerId: "alice" }, asUser(null))).map((c) => c.id),
    ).toEqual([id]);
    const owner = await call(getCanvas, { canvasId: id }, asUser("alice"));
    expect(owner).toMatchObject({
      access: "owner",
      hidden: false,
      hiddenReason: null,
      canShare: true,
    });
    expect((await noticesOf("canvas_unhidden_by_staff")).map((n) => n.userId)).toEqual([
      "alice",
      "alice",
    ]);
    const actions = (await db.select().from(moderationActions)).map((r) => r.action).sort();
    expect(actions).toEqual([
      "canvas_hidden",
      "canvas_hidden",
      "canvas_unhidden",
      "canvas_unhidden",
    ]);
    expect(events.map((e) => e.type)).toEqual(["hidden", "hidden", "unhidden", "unhidden"]);
  });

  it("a team canvas's hide tells the creator while on the team, otherwise the team's owners", async () => {
    const id = await publicTeamCanvas();
    // bob created nothing; alice created it and owns the team.
    await hide(id, true, "x");
    expect((await noticesOf("canvas_hidden_by_staff")).map((n) => n.userId)).toEqual(["alice"]);
    expect(events[0]).toMatchObject({ type: "hidden", scope: { kind: "team", teamId } });

    const { id: bobs } = await call(
      createCanvas,
      { scope: { kind: "team", teamId }, path: "Bobs.canvas" },
      asUser("bob"),
    );
    await db
      .delete(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, "bob")));
    await db.delete(notifications);
    await hide(bobs, true, "x");
    expect((await noticesOf("canvas_hidden_by_staff")).map((n) => n.userId)).toEqual(["alice"]);
  });

  it("staff hiding their own canvas get no notice about it", async () => {
    const id = await publicCanvas("public", "Mine.canvas", "staff");
    await hide(id, true, "testing");
    expect(await noticesOf("canvas_hidden_by_staff")).toEqual([]);
    expect(await db.select().from(moderationActions)).toHaveLength(1);
  });
});

describe("exit scenario", () => {
  it("create, publish, anon read, report, hide: the hide reaches every read and the seam", async () => {
    const { id } = await call(
      createCanvas,
      { scope: { kind: "personal" }, path: "Showcase.canvas" },
      asUser("alice"),
    );
    await call(setCanvasVisibility, { canvasId: id, visibility: "public" }, asUser("alice"));
    expect((await call(getPublicCanvas, { canvasId: id }, asUser(null))).title).toBe("Showcase");
    expect(
      (await call(listPublicCanvases, { ownerId: "alice" }, asUser(null))).map((c) => c.id),
    ).toEqual([id]);

    expect((await call(getCanvas, { canvasId: id }, asUser("stranger"))).canReport).toBe(true);
    const { id: reportId } = await report(id, "stranger", "not okay");
    const [queued] = await call(listCanvasReports, {}, asUser("staff"));
    expect(queued).toMatchObject({ id: reportId, canvasId: id });

    events = [];
    await call(
      resolveCanvasReport,
      { reportId, action: "hide_canvas", reason: "against the rules" },
      asUser("staff"),
    );

    await expect(call(getPublicCanvas, { canvasId: id }, asUser(null))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await call(listPublicCanvases, { ownerId: "alice" }, asUser(null))).toEqual([]);
    const owner = await call(getCanvas, { canvasId: id }, asUser("alice"));
    expect(owner).toMatchObject({ access: "read", hiddenReason: "against the rules" });
    expect(events).toEqual([
      { type: "hidden", canvasId: id, scope: { kind: "personal", ownerId: "alice" } },
    ]);
    expect(revokesFor(events[0]!)).toEqual([{ canvasId: id }]);
  });
});
