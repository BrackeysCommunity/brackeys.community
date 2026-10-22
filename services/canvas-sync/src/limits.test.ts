import { describe, expect, it } from "bun:test";

import * as encoding from "lib0/encoding";

import { CANVAS_LIMITS, SYNC_LIMITS } from "../../../src/lib/canvas/limits.ts";
import { SYNC_CLOSE, syncCloseCode } from "../../../src/lib/canvas/sync-channels.ts";
import {
  ConnectionCaps,
  createMessageLimiter,
  DocumentGrowth,
  isSyncStep2,
  localLedger,
  RESERVATION_TTL_MS,
  SyncRefusal,
  TokenBucket,
  type UserConnectionLedger,
} from "./limits.ts";

function refusalOf(fn: () => unknown): SyncRefusal | null {
  try {
    fn();
    return null;
  } catch (error) {
    return error as SyncRefusal;
  }
}

describe("TokenBucket", () => {
  it("allows the burst, then the sustained rate", () => {
    const bucket = new TokenBucket(60, 200, 0);
    let allowed = 0;
    for (let i = 0; i < 250; i++) if (bucket.take(0)) allowed++;
    expect(allowed).toBe(200);
    expect(bucket.take(10)).toBe(false);
    expect(bucket.take(1000)).toBe(true);
    let more = 1;
    while (bucket.take(1000)) more++;
    expect(more).toBe(60);
  });
});

/** A raw Hocuspocus message: document name, message type, then a sync step and its payload. */
function message(type: number, step: number | null, payloadBytes: number): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarString(encoder, "canvas:c1");
  encoding.writeVarUint(encoder, type);
  if (step !== null) encoding.writeVarUint(encoder, step);
  encoding.writeVarUint8Array(encoder, new Uint8Array(payloadBytes));
  return encoding.toUint8Array(encoder);
}

const UPDATE = (bytes: number) => message(0, 2, bytes);

describe("message limiter", () => {
  it("refuses an oversize update with 4413", () => {
    const limit = createMessageLimiter(() => 0);
    const refusal = refusalOf(() => limit({}, UPDATE(CANVAS_LIMITS.maxMessageBytes)));
    expect(refusal?.code).toBe(SYNC_CLOSE.tooLarge);
    expect(refusal?.metric).toBe("size");
    expect(syncCloseCode({ code: 1000, reason: refusal!.reason })).toBe(SYNC_CLOSE.tooLarge);
    expect(refusalOf(() => limit({}, UPDATE(CANVAS_LIMITS.maxMessageBytes - 64)))).toBeNull();
  });

  it("lets a sync step 2 carry up to a whole canvas, and no more", () => {
    const limit = createMessageLimiter(() => 0);
    for (const type of [0, 4]) {
      expect(refusalOf(() => limit({}, message(type, 1, 3 * 1024 * 1024)))).toBeNull();
      expect(refusalOf(() => limit({}, message(type, 1, CANVAS_LIMITS.maxStateBytes)))?.code).toBe(
        SYNC_CLOSE.tooLarge,
      );
    }
    // Sync step 1 and awareness keep the message cap.
    expect(refusalOf(() => limit({}, message(0, 0, 2 * 1024 * 1024)))?.code).toBe(
      SYNC_CLOSE.tooLarge,
    );
    expect(refusalOf(() => limit({}, message(1, null, 2 * 1024 * 1024)))?.code).toBe(
      SYNC_CLOSE.tooLarge,
    );
  });

  it("gives the whole-canvas cap to a connection's first sync step 2 only", () => {
    const limit = createMessageLimiter(() => 0);
    const connection = {};
    expect(refusalOf(() => limit(connection, message(0, 1, 10)))).toBeNull();
    expect(refusalOf(() => limit(connection, message(0, 1, 2 * 1024 * 1024)))?.code).toBe(
      SYNC_CLOSE.tooLarge,
    );
    expect(refusalOf(() => limit(connection, message(0, 1, 1024)))).toBeNull();
    const fresh = {};
    expect(refusalOf(() => limit(fresh, message(4, 1, 3 * 1024 * 1024)))).toBeNull();
    expect(refusalOf(() => limit(fresh, message(4, 1, 3 * 1024 * 1024)))?.code).toBe(
      SYNC_CLOSE.tooLarge,
    );
  });

  it("classifies messages without trusting their bytes", () => {
    expect(isSyncStep2(message(0, 1, 10))).toBe(true);
    expect(isSyncStep2(message(4, 1, 10))).toBe(true);
    expect(isSyncStep2(message(0, 2, 10))).toBe(false);
    expect(isSyncStep2(message(1, 1, 10))).toBe(false);
    expect(isSyncStep2(new Uint8Array())).toBe(false);
    expect(isSyncStep2(new Uint8Array([0xff, 0xff, 0xff]))).toBe(false);
    expect(isSyncStep2(new Uint8Array([200, 1]))).toBe(false);
  });

  it("refuses a flood with 4429, per connection", () => {
    const limit = createMessageLimiter(() => 0);
    const flooder = {};
    let refusal: SyncRefusal | null = null;
    for (let i = 0; i <= SYNC_LIMITS.messageBurst && !refusal; i++)
      refusal = refusalOf(() => limit(flooder, UPDATE(10)));
    expect(refusal?.code).toBe(SYNC_CLOSE.rateLimited);
    expect(refusalOf(() => limit({}, UPDATE(10)))).toBeNull();
  });
});

describe("ConnectionCaps", () => {
  function setup(live = { doc: 0, user: 0 }, ledger: UserConnectionLedger = localLedger) {
    let clock = 0;
    const caps = new ConnectionCaps(
      { forDocument: () => live.doc, forUser: () => live.user },
      ledger,
      () => clock,
      { perCanvas: 3, perUser: 2 },
    );
    return { caps, tick: (ms: number) => (clock += ms), live };
  }

  it("counts reservations against the canvas cap", async () => {
    const { caps } = setup({ doc: 2, user: 0 });
    await caps.admit("s1", "canvas:a", "u1");
    await expect(caps.admit("s2", "canvas:a", "u2")).rejects.toMatchObject({
      code: SYNC_CLOSE.rateLimited,
      metric: "caps",
    });
  });

  it("adds other instances' counts to the user cap", async () => {
    const ledger: UserConnectionLedger = { ...localLedger, othersCount: async () => 1 };
    const { caps } = setup({ doc: 0, user: 0 }, ledger);
    await caps.admit("s1", "canvas:a", "u1");
    await expect(caps.admit("s2", "canvas:b", "u1")).rejects.toMatchObject({
      code: SYNC_CLOSE.rateLimited,
    });
  });

  it("frees a seat once its reservation expires without connecting", async () => {
    const { caps, tick } = setup({ doc: 2, user: 0 });
    await caps.admit("s1", "canvas:a", "u1");
    expect(caps.pendingCount()).toBe(1);
    tick(RESERVATION_TTL_MS - 1);
    await expect(caps.admit("s2", "canvas:a", "u2")).rejects.toBeInstanceOf(SyncRefusal);
    tick(1);
    expect(caps.pendingCount()).toBe(0);
    await caps.admit("s2", "canvas:a", "u2");
  });

  it("rewrites the ledger when a reservation expires", async () => {
    const recorded: [string, number][] = [];
    const ledger: UserConnectionLedger = {
      ...localLedger,
      record: async (u, n) => void recorded.push([u, n]),
    };
    const { caps, tick } = setup({ doc: 0, user: 0 }, ledger);
    await caps.admit("s1", "canvas:a", "u1");
    await caps.admit("s2", "canvas:b", "u1");
    expect(recorded.at(-1)).toEqual(["u1", 2]);
    tick(RESERVATION_TTL_MS);
    expect(caps.pendingCount()).toBe(0);
    expect(recorded.at(-1)).toEqual(["u1", 0]);
  });

  it("frees the seat of a connection whose document failed to load", async () => {
    const recorded: [string, number][] = [];
    const ledger: UserConnectionLedger = {
      ...localLedger,
      record: async (u, n) => void recorded.push([u, n]),
    };
    const { caps } = setup({ doc: 0, user: 0 }, ledger);
    await caps.admit("s1", "canvas:a", "u1");
    await caps.admit("s2", "canvas:a", "u1");
    caps.loadFailed({ seat: "s1", userId: "u1" });
    caps.loadFailed(undefined);
    expect(caps.pendingCount()).toBe(1);
    expect(recorded.at(-1)).toEqual(["u1", 1]);
  });

  it("holds a seat while its document loads, then gives it a fresh TTL", async () => {
    const { caps, tick } = setup({ doc: 2, user: 0 });
    await caps.admit("s1", "canvas:a", "u1");
    caps.loadStarted({ seat: "s1" });
    tick(RESERVATION_TTL_MS * 10);
    expect(caps.pendingCount()).toBe(1);
    await expect(caps.admit("s2", "canvas:a", "u2")).rejects.toBeInstanceOf(SyncRefusal);
    caps.loaded({ seat: "s1" });
    tick(RESERVATION_TTL_MS - 1);
    expect(caps.pendingCount()).toBe(1);
    tick(1);
    expect(caps.pendingCount()).toBe(0);
  });

  it("frees a loading seat when its load fails or its socket closes", async () => {
    const { caps, tick } = setup({ doc: 0, user: 0 });
    const socket = {};
    await caps.admit("s1", "canvas:a", "u1");
    await caps.admit("s2", "canvas:a", "u2", socket);
    caps.loadStarted({ seat: "s1" });
    caps.loadStarted({ seat: "s2" });
    tick(RESERVATION_TTL_MS);
    caps.loadFailed({ seat: "s1", userId: "u1" });
    caps.socketClosed(socket);
    expect(caps.pendingCount()).toBe(0);
    caps.loaded({ seat: "s1" });
    expect(caps.pendingCount()).toBe(0);
  });

  it("drops the reservation when the connection is confirmed and records the count", async () => {
    const recorded: [string, number][] = [];
    const ledger: UserConnectionLedger = {
      ...localLedger,
      record: async (u, n) => void recorded.push([u, n]),
    };
    const { caps, live } = setup({ doc: 0, user: 0 }, ledger);
    await caps.admit("s1", "canvas:a", "u1");
    live.user = 1;
    caps.confirm("s1", "u1");
    expect(caps.pendingCount()).toBe(0);
    live.user = 0;
    caps.released("u1");
    expect(recorded).toEqual([
      ["u1", 1],
      ["u1", 1],
      ["u1", 0],
    ]);
  });

  it("writes this instance's count, reservation included, before reading the others'", async () => {
    const calls: string[] = [];
    const ledger: UserConnectionLedger = {
      ...localLedger,
      record: async (_u, n) => void calls.push(`record ${n}`),
      othersCount: async () => {
        calls.push("read");
        return 2;
      },
    };
    const { caps } = setup({ doc: 0, user: 0 }, ledger);
    await expect(caps.admit("s1", "canvas:a", "u1")).rejects.toBeInstanceOf(SyncRefusal);
    expect(calls).toEqual(["record 1", "read", "record 0"]);
    expect(caps.pendingCount()).toBe(0);
  });

  it("frees a closed socket's seats and reserves nothing more for it", async () => {
    const { caps } = setup({ doc: 0, user: 0 });
    const socket = {};
    const other = {};
    await caps.admit("s1", "canvas:a", "u1", socket);
    await caps.admit("s2", "canvas:b", "u1", socket);
    await caps.admit("s3", "canvas:a", "u2", other);
    caps.socketClosed(socket);
    expect(caps.pendingCount()).toBe(1);
    await caps.admit("s4", "canvas:a", "u1", socket);
    expect(caps.pendingCount()).toBe(1);
  });

  it("frees a seat whose socket closes while the ledger is being read", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const ledger: UserConnectionLedger = {
      ...localLedger,
      othersCount: async () => {
        await gate;
        return 0;
      },
    };
    const { caps } = setup({ doc: 0, user: 0 }, ledger);
    const socket = {};
    const attempt = caps.admit("s1", "canvas:a", "u1", socket);
    caps.socketClosed(socket);
    release();
    await attempt;
    expect(caps.pendingCount()).toBe(0);
  });

  it("holds the canvas cap for a burst that all waits on the ledger together", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const ledger: UserConnectionLedger = {
      ...localLedger,
      othersCount: async () => {
        await gate;
        return 0;
      },
    };
    const { caps } = setup({ doc: 0, user: 0 }, ledger);
    const attempts = Array.from({ length: 6 }, (_, i) => caps.admit(`s${i}`, "canvas:a", `u${i}`));
    release();
    const results = await Promise.allSettled(attempts);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(caps.pendingCount()).toBe(3);
  });

  it("holds the user cap for a burst once the ledger answers", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const ledger: UserConnectionLedger = {
      ...localLedger,
      othersCount: async () => {
        await gate;
        return 1;
      },
    };
    const { caps } = setup({ doc: 0, user: 0 }, ledger);
    const attempts = [caps.admit("s1", "canvas:a", "u1"), caps.admit("s2", "canvas:b", "u1")];
    release();
    const results = await Promise.allSettled(attempts);
    // One elsewhere leaves room for one here; the other is refused and lets go of its seat.
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(caps.pendingCount()).toBe(1);
  });

  it("drops the reservation when the ledger throws", async () => {
    const ledger: UserConnectionLedger = {
      ...localLedger,
      othersCount: async () => {
        throw new Error("ledger down");
      },
    };
    const { caps } = setup({ doc: 0, user: 0 }, ledger);
    await expect(caps.admit("s1", "canvas:a", "u1")).rejects.toThrow("ledger down");
    expect(caps.pendingCount()).toBe(0);
  });

  it("gives every seat its own reservation, even on one document", async () => {
    const { caps } = setup({ doc: 0, user: 0 });
    await caps.admit("seat-a", "canvas:a", "u1");
    await caps.admit("seat-b", "canvas:a", "u2");
    expect(caps.pendingCount()).toBe(2);
    await expect(caps.admit("seat-c", "canvas:a", "u3")).resolves.toBeUndefined();
    await expect(caps.admit("seat-d", "canvas:a", "u4")).rejects.toBeInstanceOf(SyncRefusal);
  });
});

describe("DocumentGrowth", () => {
  it("measures a doc only once each cap's worth of incoming bytes", () => {
    const growth = new DocumentGrowth(100);
    let measured = 0;
    let size = 0;
    const measure = () => {
      measured++;
      return size;
    };
    for (let i = 0; i < 10; i++) expect(growth.exceeds("d", 10, measure)).toBe(false);
    expect(measured).toBe(0);
    size = 60;
    expect(growth.exceeds("d", 10, measure)).toBe(false);
    expect(measured).toBe(1);
    for (let i = 0; i < 9; i++) growth.exceeds("d", 10, measure);
    expect(measured).toBe(1);
    size = 101;
    expect(growth.exceeds("d", 10, measure)).toBe(true);
    expect(measured).toBe(2);
  });

  it("counts from zero after a store, per document", () => {
    const growth = new DocumentGrowth(100);
    const tooBig = () => 1000;
    expect(growth.exceeds("a", 90, tooBig)).toBe(false);
    expect(growth.exceeds("b", 90, tooBig)).toBe(false);
    growth.stored("a");
    expect(growth.exceeds("a", 20, tooBig)).toBe(false);
    expect(growth.exceeds("b", 20, tooBig)).toBe(true);
    growth.forget("b");
    expect(growth.exceeds("b", 20, tooBig)).toBe(false);
  });
});
