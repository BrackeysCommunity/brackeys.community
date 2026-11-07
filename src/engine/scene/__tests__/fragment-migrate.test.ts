import { describe, expect, it, vi } from "vite-plus/test";

import { pasteFragment } from "../../editor/clipboard";
import { parseFragment } from "../fragment";
import { fake } from "./fixtures/fake-game";

// Pretend the format is at v2, where a door's v1 `rate` became `speed`, to
// show a fragment from an older version goes through the scene migrations.
vi.mock("../types", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../types")>()),
  SCENE_FORMAT_VERSION: 2,
}));
vi.mock("../migrate", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../migrate")>();
  const steps = {
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

describe("a fragment with a stale v", () => {
  it("is lifted by the scene migrations", () => {
    expect(parseFragment(JSON.stringify(stale), fake)).toEqual({
      ok: true,
      fragment: {
        kind: "scene-fragment",
        v: 2,
        game: "fake",
        entities: [{ id: "door", type: "door", shape: ["box", 0, 0, 10, 40], speed: 60 }],
      },
      migratedFrom: 1,
      issues: [],
    });
  });

  it("pastes as the current format", () => {
    const def = {
      v: 2,
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
