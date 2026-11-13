import { describe, expect, test } from "vite-plus/test";

import { effectiveLive, liveSnapshotSchema, type LivePointerRow } from "../live-state";

const hex = (c: string) => c.repeat(64);
const COMPAT = hex("c");
const release = { id: hex("a"), liveCompatKey: COMPAT, scenes: ["level-1", "level-2", "level-3"] };
const since = new Date("2026-11-01T12:00:00.000Z");
const at = new Date("2026-11-02T00:00:00.000Z");

function pointer(
  scene: string,
  version: string,
  over: Partial<LivePointerRow> = {},
): LivePointerRow {
  return {
    scene,
    versionId: hex(version),
    number: 1,
    timing: "boundary",
    since,
    compatKey: COMPAT,
    collectedAt: null,
    hiddenAt: null,
    blockedAt: null,
    ...over,
  };
}

describe("effectiveLive", () => {
  test("keeps applying pointers, sorted by scene, with the snapshot's fields", () => {
    const live = effectiveLive(
      release,
      [pointer("level-2", "2", { number: 4, timing: "now" }), pointer("level-1", "1")],
      7,
      "production",
    );
    expect(live).toEqual({
      channel: "production",
      rev: 7,
      release: hex("a"),
      scenes: [
        {
          scene: "level-1",
          version: hex("1"),
          number: 1,
          timing: "boundary",
          since: since.toISOString(),
        },
        {
          scene: "level-2",
          version: hex("2"),
          number: 4,
          timing: "now",
          since: since.toISOString(),
        },
      ],
      removed: [],
    });
    expect(liveSnapshotSchema.parse(live)).toEqual(live);
  });

  test("drops incompatible, unlisted, collected, hidden and blocked pointers", () => {
    const live = effectiveLive(
      release,
      [
        pointer("level-1", "1", { compatKey: hex("d") }),
        pointer("level-9", "2"),
        pointer("level-2", "3", { collectedAt: at }),
        pointer("level-3", "4", { hiddenAt: at }),
        pointer("level-3", "5", { blockedAt: at }),
      ],
      3,
      "preview",
    );
    expect(live.scenes).toEqual([]);
    expect(live.removed).toEqual([hex("4")]);
    expect(live.blocked).toEqual([hex("5")]);
    expect(liveSnapshotSchema.parse(live)).toEqual(live);
  });

  test("lists every blocked version once, sorted, so frames running one go back at the next load", () => {
    const live = effectiveLive(
      release,
      [
        pointer("level-2", "9", { blockedAt: at }),
        pointer("level-1", "8", { blockedAt: at, compatKey: hex("d") }),
        pointer("level-3", "9", { blockedAt: at }),
        pointer("level-3", "6", { blockedAt: at, hiddenAt: at }),
        pointer("level-1", "7"),
      ],
      1,
      "production",
    );
    expect(live.scenes.map((s) => s.version)).toEqual([hex("7")]);
    expect(live.blocked).toEqual([hex("8"), hex("9")]);
    expect(live.removed).toEqual([hex("6")]);
    expect(liveSnapshotSchema.parse(live)).toEqual(live);
  });

  test("lists every hidden version once, sorted, even when it wouldn't apply anyway", () => {
    const live = effectiveLive(
      release,
      [
        pointer("level-2", "9", { hiddenAt: at }),
        pointer("level-1", "8", { hiddenAt: at, compatKey: hex("d") }),
        pointer("level-3", "9", { hiddenAt: at }),
        pointer("level-1", "7"),
      ],
      1,
      "preview",
    );
    expect(live.scenes.map((s) => s.version)).toEqual([hex("7")]);
    expect(live.removed).toEqual([hex("8"), hex("9")]);
  });

  test("a release that can't take live scenes applies none", () => {
    const live = effectiveLive(
      { ...release, liveCompatKey: "" },
      [pointer("level-1", "1", { compatKey: "" })],
      0,
      "production",
    );
    expect(live.scenes).toEqual([]);
    expect(liveSnapshotSchema.parse(live)).toEqual(live);
  });
});
