import { describe, expect, it } from "bun:test";

import { canvasIdOf, SnapshotSchedule } from "./persistence.ts";

describe("SnapshotSchedule", () => {
  it("is due first, then every interval, and always when final", () => {
    const schedule = new SnapshotSchedule(30_000);
    expect(schedule.due("c", 0, false)).toBe(true);
    schedule.written("c", 0);
    expect(schedule.due("c", 29_999, false)).toBe(false);
    expect(schedule.due("c", 29_999, true)).toBe(true);
    expect(schedule.due("c", 30_000, false)).toBe(true);
  });

  it("tracks a stale snapshot until written or forgotten", () => {
    const schedule = new SnapshotSchedule(30_000);
    schedule.markStale("c");
    expect(schedule.isStale("c")).toBe(true);
    schedule.written("c", 5);
    expect(schedule.isStale("c")).toBe(false);
    schedule.markStale("c");
    schedule.forget("c");
    expect(schedule.isStale("c")).toBe(false);
    expect(schedule.due("c", 6, false)).toBe(true);
  });
});

describe("canvasIdOf", () => {
  it("reads canvas documents only", () => {
    expect(canvasIdOf("canvas:abc")).toBe("abc");
    expect(canvasIdOf("note:abc")).toBeNull();
    expect(canvasIdOf("abc")).toBeNull();
  });
});
