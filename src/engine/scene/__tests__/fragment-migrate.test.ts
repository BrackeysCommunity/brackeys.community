import { describe, expect, it, vi } from "vite-plus/test";

import { pasteFragment } from "../../editor/clipboard";
import { parseFragment } from "../fragment";
import { SCENE_FORMAT_VERSION } from "../types";
import { fake } from "./fixtures/fake-game";

// Pretend v2 renamed a door's v1 `rate` to `speed`, to show a fragment from
// an older version goes through every scene migration up to the current one.
vi.mock("../migrate", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../migrate")>();
  const steps = {
    ...orig.MIGRATIONS,
    1: (raw: unknown) => {
      const doc = raw as { entities?: Record<string, unknown>[] };
      const entities = doc.entities?.map(({ rate, ...e }) =>
        e.type === "door" ? { ...e, speed: rate } : e,
      );
      return { ...doc, v: 2, ...(entities ? { entities } : {}) };
    },
  };
  return {
    ...orig,
    MIGRATIONS: steps,
    migrate: (raw: unknown, migrations = steps, target?: number) =>
      orig.migrate(raw, migrations, target),
  };
});

const stale = {
  kind: "scene-fragment",
  v: 1,
  game: "fake",
  entities: [{ id: "door", type: "door", shape: ["box", 0, 0, 10, 40], rate: 60 }],
};

const lifted = {
  kind: "scene-fragment",
  v: SCENE_FORMAT_VERSION,
  game: "fake",
  entities: [{ id: "door", type: "door", shape: ["box", 0, 0, 10, 40], speed: 60 }],
};

describe("a fragment with a stale v", () => {
  it("is lifted by the scene migrations", () => {
    expect(SCENE_FORMAT_VERSION).toBe(3);
    expect(parseFragment(JSON.stringify(stale), fake)).toEqual({
      ok: true,
      fragment: lifted,
      migratedFrom: 1,
      issues: [],
    });
  });

  it("is lifted from v2 with only its v changed", () => {
    const v2 = { ...lifted, v: 2 };
    expect(parseFragment(JSON.stringify(v2), fake)).toEqual({
      ok: true,
      fragment: lifted,
      migratedFrom: 2,
      issues: [],
    });
    expect(parseFragment(JSON.stringify(lifted), fake)).toEqual({
      ok: true,
      fragment: lifted,
      issues: [],
    });
  });

  it("pastes as the current format", () => {
    const def = {
      v: SCENE_FORMAT_VERSION,
      game: "fake",
      name: "m",
      bounds: [0, 0, 100, 100] as [number, number, number, number],
    };
    const r = pasteFragment(JSON.stringify(stale), { def, registry: fake });
    expect(r.ok && r.batch.ops).toEqual([
      { op: "add", entity: { id: "door", type: "door", shape: ["box", 0, 0, 10, 40], speed: 60 } },
    ]);
  });
});
