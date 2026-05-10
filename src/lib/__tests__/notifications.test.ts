import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

// vi.mock is hoisted above imports, so any references inside the factory must
// come from vi.hoisted (which runs before mocks) — not from top-level lets.
const mocks = vi.hoisted(() => ({
  insertReturning: vi.fn(async () => [{ id: 42 }]),
  updateWhere: vi.fn(async () => undefined),
  selectLimit: vi.fn(async () => [] as { id: number }[]),
  queueAdd: vi.fn(async () => ({ id: "job-1" })),
}));

vi.mock("@/db", () => ({
  db: {
    insert: () => ({ values: () => ({ returning: mocks.insertReturning }) }),
    update: () => ({ set: () => ({ where: mocks.updateWhere }) }),
    select: () => ({ from: () => ({ where: () => ({ limit: mocks.selectLimit }) }) }),
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ _: "and", args }),
  eq: (...args: unknown[]) => ({ _: "eq", args }),
  gte: (...args: unknown[]) => ({ _: "gte", args }),
}));

vi.mock("@/db/schema", () => ({
  notifications: {
    id: "id",
    userId: "userId",
    type: "type",
    actorId: "actorId",
    entityId: "entityId",
    createdAt: "createdAt",
  },
}));

vi.mock("@/lib/queue", () => ({
  notificationsQueue: { add: mocks.queueAdd },
}));

import { notify } from "../notifications";

beforeEach(() => {
  mocks.insertReturning.mockClear();
  mocks.updateWhere.mockClear();
  mocks.selectLimit.mockClear();
  mocks.queueAdd.mockClear();
  mocks.insertReturning.mockResolvedValue([{ id: 42 }]);
  mocks.selectLimit.mockResolvedValue([]);
  mocks.queueAdd.mockResolvedValue({ id: "job-1" });
  delete process.env.DISABLE_NOTIFICATIONS;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("notify()", () => {
  it("skips when actor and recipient are the same user", async () => {
    await notify({ userId: "u1", type: "collab_response_received", actorId: "u1" });
    expect(mocks.insertReturning).not.toHaveBeenCalled();
    expect(mocks.queueAdd).not.toHaveBeenCalled();
  });

  it("skips both insert and enqueue when DISABLE_NOTIFICATIONS=1", async () => {
    process.env.DISABLE_NOTIFICATIONS = "1";
    await notify({ userId: "u1", type: "collab_response_received", actorId: "u2" });
    expect(mocks.insertReturning).not.toHaveBeenCalled();
    expect(mocks.queueAdd).not.toHaveBeenCalled();
  });

  it("inserts and enqueues a side-effects job on the happy path", async () => {
    await notify({
      userId: "u1",
      type: "collab_response_received",
      actorId: "u2",
      entityType: "collab_post",
      entityId: "10",
      data: { postId: 10 },
    });
    expect(mocks.insertReturning).toHaveBeenCalledTimes(1);
    expect(mocks.queueAdd).toHaveBeenCalledTimes(1);
    expect(mocks.queueAdd).toHaveBeenCalledWith(
      "side_effects",
      { notificationId: 42 },
      expect.objectContaining({ attempts: 3 }),
    );
  });

  it("dedupes when a matching row exists in the window: bumps row, no enqueue", async () => {
    mocks.selectLimit.mockResolvedValue([{ id: 99 }]);
    await notify({
      userId: "u1",
      type: "collab_response_received",
      actorId: "u2",
      entityId: "10",
      dedupeWithin: { ms: 5 * 60_000 },
    });
    expect(mocks.updateWhere).toHaveBeenCalledTimes(1);
    expect(mocks.insertReturning).not.toHaveBeenCalled();
    expect(mocks.queueAdd).not.toHaveBeenCalled();
  });

  it("inserts when no matching row exists in the dedupe window", async () => {
    mocks.selectLimit.mockResolvedValue([]);
    await notify({
      userId: "u1",
      type: "collab_response_received",
      actorId: "u2",
      entityId: "10",
      dedupeWithin: { ms: 5 * 60_000 },
    });
    expect(mocks.insertReturning).toHaveBeenCalledTimes(1);
    expect(mocks.queueAdd).toHaveBeenCalledTimes(1);
  });

  it("swallows enqueue failures so the caller never throws", async () => {
    mocks.queueAdd.mockRejectedValueOnce(new Error("redis down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      notify({ userId: "u1", type: "collab_response_received", actorId: "u2" }),
    ).resolves.toBeUndefined();
    expect(mocks.insertReturning).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
  });
});
