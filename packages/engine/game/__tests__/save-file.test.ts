// @vitest-environment node
import { readFileSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { AGENT_SURFACE_KEYWORD, AGENT_SURFACE_VERSION } from "../../scene/agent-surface";
import { toJsonSchema, undescribedProperties } from "../../scene/json-schema";
import {
  DEFAULT_SAVE_LIMITS,
  effectiveSaveLimits,
  formatSaveFile,
  MAX_BROWSER_SAVE_LIMITS,
  parseSaveFile,
  SAVE_SCHEMA_ID,
  SAVE_VERSION,
  saveFileBytes,
  saveFileSchema,
  SLOT_MAX_LENGTH,
  SLOT_PATTERN,
  SLOT_RULE,
  type SaveFile,
  type SaveGameData,
} from "../save-file";

const SCHEMA_FILE = new URL("../../project/save.schema.json", import.meta.url);

function saveJsonSchema(): Record<string, unknown> {
  const { $schema, ...rest } = toJsonSchema(saveFileSchema);
  return {
    $schema,
    $id: SAVE_SCHEMA_ID,
    [AGENT_SURFACE_KEYWORD]: AGENT_SURFACE_VERSION,
    title: `jams engine save file, format v${SAVE_VERSION}`,
    ...rest,
  };
}

const HASH = "9f2c".padEnd(64, "0");

function worldSave(over: Partial<SaveFile> = {}): SaveFile {
  return {
    $schema: "../../engine/project/save.schema.json",
    kind: "save",
    v: 1,
    game: "tactics",
    gameVersion: 1,
    engine: "0.13.0",
    release: null,
    project: { id: "tactics", snapshot: HASH },
    slot: "slot-1",
    meta: { title: "Bridge, turn 4", scene: "level-2", savedAt: 1762531200000, playTicks: 5400 },
    depth: "world",
    persist: { cleared: ["level-1"], roster: ["knight", "archer"] },
    scene: {
      id: "level-2",
      runHash: "a90e44d1c2b3f507",
      sublevels: [{ label: "cellar", scene: "cellar", at: [12, 4.5] }],
    },
    data: { turn: 4, side: "blue", phase: "orders", units: {}, result: null },
    world: {
      tick: 812,
      counters: { unit: 4 },
      random: [123456789, 362436069, 521288629, 88675123],
      timers: [{ id: 3, due: 840, emit: "reinforce", data: { wave: 2 } }],
      enabled: { "archer-2": false },
      destroyed: ["knight-3"],
      spawned: [{ id: "unit#4", input: { type: "unit", at: [7.5, 4.5], side: "red" } }],
      poses: { "knight-1": [6.75, 3.75, 0], "unit#4": [8.25, 4.5, 0] },
      systems: { "unit#4": { follower: { path: [] } }, "@random": { ai: [1, 2, 3, 4] } },
      seats: [{ player: 0, devices: ["keyboard", "pointer"] }],
    },
    ...over,
  };
}

function progressSave(over: Partial<SaveFile> = {}): SaveFile {
  const { world: _world, ...rest } = worldSave();
  return { ...rest, depth: "progress", ...over };
}

const codes = (r: ReturnType<typeof parseSaveFile>) => (r.ok ? [] : r.issues.map((i) => i.code));

describe("save.schema.json", () => {
  it("matches the committed file (UPDATE_SCHEMAS=1 regenerates)", () => {
    const schema = saveJsonSchema();
    if (process.env.UPDATE_SCHEMAS)
      writeFileSync(SCHEMA_FILE, `${JSON.stringify(schema, null, 2)}\n`);
    expect(JSON.parse(readFileSync(SCHEMA_FILE, "utf8"))).toEqual(schema);
  });

  it("has its URN, draft 2020-12, the agent surface and describes every property", () => {
    const schema = saveJsonSchema();
    expect(SAVE_SCHEMA_ID).toBe("urn:jams-engine:save:v1");
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(JSON.stringify(schema)).not.toMatch(/brackeys\.(community|dev)|jams\.team/);
    expect(undescribedProperties(schema)).toEqual([]);
  });
});

describe("formatSaveFile and parseSaveFile", () => {
  it("round-trips byte-identical at both depths", () => {
    for (const file of [worldSave(), progressSave()]) {
      const text = formatSaveFile(file);
      expect(text.endsWith("}\n")).toBe(true);
      const parsed = parseSaveFile(text);
      expect(parsed.ok && parsed.file).toEqual(file);
      if (parsed.ok) expect(formatSaveFile(parsed.file)).toBe(text);
    }
  });

  it("writes the same text whatever order keys were set in, the envelope first", () => {
    const file = worldSave();
    const shuffled = Object.fromEntries(Object.entries(file).reverse()) as SaveFile;
    const text = formatSaveFile(shuffled);
    expect(text).toBe(formatSaveFile(file));
    expect(text.split("\n").slice(1, 8)).toEqual([
      '  "$schema": "../../engine/project/save.schema.json",',
      '  "kind": "save",',
      '  "v": 1,',
      '  "game": "tactics",',
      '  "gameVersion": 1,',
      '  "engine": "0.13.0",',
      '  "release": null,',
    ]);
    expect(text).toContain(
      '      { "data": { "wave": 2 }, "due": 840, "emit": "reinforce", "id": 3 }',
    );
  });

  it("is strict: an unknown key, a wrong kind, a newer format, a depth without its world", () => {
    const text = (v: unknown) => JSON.stringify(v);
    expect(codes(parseSaveFile(text({ ...worldSave(), extra: 1 })))).toEqual(["unknown-key"]);
    expect(codes(parseSaveFile(text({ ...worldSave(), kind: "scene" })))).toEqual(["schema"]);
    expect(codes(parseSaveFile(text({ ...worldSave(), v: 2 })))).toEqual(["version-newer"]);
    expect(codes(parseSaveFile("{"))).toEqual(["schema"]);
    expect(codes(parseSaveFile(text({ ...worldSave(), world: undefined })))).toEqual(["schema"]);
    expect(codes(parseSaveFile(text({ ...progressSave(), world: worldSave().world })))).toEqual([
      "schema",
    ]);
    const badSeat = worldSave();
    badSeat.world = { ...badSeat.world!, seats: [{ player: 0, devices: ["mouse" as "pointer"] }] };
    expect(codes(parseSaveFile(text(badSeat)))).toEqual(["schema"]);
  });

  it("takes the tree's parents, and refuses a bad one", () => {
    const text = (v: unknown) => JSON.stringify(v);
    const withParents = (parents: unknown) => {
      const file = worldSave();
      return { ...file, world: { ...file.world!, parents } };
    };
    const linked = withParents({ "knight-1": "unit#4", "unit#4": null }) as SaveFile;
    const formatted = formatSaveFile(linked);
    expect(formatted).toContain('"parents": {');
    const parsed = parseSaveFile(formatted);
    expect(parsed.ok && parsed.file.world?.parents).toEqual({
      "knight-1": "unit#4",
      "unit#4": null,
    });
    if (parsed.ok) expect(formatSaveFile(parsed.file)).toBe(formatted);
    expect(formatSaveFile(worldSave())).not.toContain('"parents"');

    for (const bad of [{ "knight-1": 3 }, { "knight-1": "" }, ["knight-1"], "knight-1"]) {
      expect(codes(parseSaveFile(text(withParents(bad))))).toEqual(["schema"]);
    }
    const own = parseSaveFile(text(withParents({ "knight-1": "knight-1" })));
    expect(own.ok).toBe(false);
    if (!own.ok)
      expect(own.issues[0]).toMatchObject({ code: "schema", path: "/world/parents/knight-1" });
  });

  it("takes a spawn and an instance made under a parent", () => {
    const file = worldSave();
    const spawned = [
      { id: "unit#5", input: { type: "unit", at: [1, 0], parent: "unit#4", local: true } },
      {
        id: "lamp#1",
        input: { type: "lamp", at: [0, 0] },
        instance: { prefab: "lamp", parent: "knight-1", local: false },
      },
    ];
    const parsed = parseSaveFile(JSON.stringify({ ...file, world: { ...file.world!, spawned } }));
    expect(parsed.ok && parsed.file.world?.spawned).toEqual(spawned);
  });

  it("refuses a save another game wrote", () => {
    const r = parseSaveFile(formatSaveFile(worldSave()), {
      id: "platformer",
      saves: { version: 1 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]).toMatchObject({ code: "schema", path: "/game" });
  });
});

describe("migrations", () => {
  it("run in order from the save's game version up, and say where they started", () => {
    const seen: number[] = [];
    const step =
      (from: number) =>
      ({ persist, game }: SaveGameData): SaveGameData => {
        seen.push(from);
        return { persist: { ...(persist as object), [`v${from + 1}`]: true }, game: [game, from] };
      };
    const r = parseSaveFile(formatSaveFile(progressSave({ persist: {}, data: "d" })), {
      id: "tactics",
      saves: { version: 4, migrations: { 3: step(3), 1: step(1), 2: step(2) } },
    });
    expect(seen).toEqual([1, 2, 3]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.migratedFrom).toBe(1);
    expect(r.file.gameVersion).toBe(4);
    expect(r.file.persist).toEqual({ v2: true, v3: true, v4: true });
    expect(r.file.data).toEqual([[["d", 1], 2], 3]);
  });

  it("leave a current save alone, with no migratedFrom", () => {
    const r = parseSaveFile(formatSaveFile(worldSave({ gameVersion: 2 })), {
      id: "tactics",
      saves: { version: 2, migrations: { 1: () => ({ persist: null, game: null }) } },
    });
    expect(r).toEqual({ ok: true, file: worldSave({ gameVersion: 2 }) });
  });

  it("refuse a newer game version as save-version-newer", () => {
    const r = parseSaveFile(formatSaveFile(worldSave({ gameVersion: 3 })), {
      id: "tactics",
      saves: { version: 2 },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({
      code: "save-version-newer",
      severity: "error",
      message: "this save is game version 3; this build reads up to 2",
    });
  });

  it("judge a minimal envelope, with no project, release or title", () => {
    const minimal = {
      kind: "save",
      v: 1,
      game: "fake",
      gameVersion: 2,
      engine: "0.13.0",
      release: null,
      project: null,
      slot: "slot-1",
      meta: { scene: "t", savedAt: 0, playTicks: 0 },
      depth: "progress",
      persist: null,
      scene: { id: "t", runHash: "", sublevels: [] },
      data: null,
    };
    expect(parseSaveFile(JSON.stringify(minimal)).ok).toBe(true);
    expect(
      codes(parseSaveFile(JSON.stringify(minimal), { id: "fake", saves: { version: 1 } })),
    ).toEqual(["save-version-newer"]);
  });

  it("report a missing step under the same code", () => {
    const r = parseSaveFile(formatSaveFile(worldSave()), {
      id: "tactics",
      saves: { version: 3, migrations: { 1: (d) => d } },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues[0]).toMatchObject({
      code: "save-version-newer",
      message: "no migration from 2 to 3",
    });
  });

  it("report a migration that throws or returns something that isn't JSON", () => {
    const thrown = parseSaveFile(formatSaveFile(worldSave()), {
      id: "tactics",
      saves: {
        version: 2,
        migrations: {
          1: () => {
            throw new Error("boom");
          },
        },
      },
    });
    expect(!thrown.ok && thrown.issues[0]?.message).toBe(
      "the game's save migration from 1 to 2 failed: boom",
    );
    const notJson = parseSaveFile(formatSaveFile(worldSave()), {
      id: "tactics",
      saves: { version: 2, migrations: { 1: () => ({ persist: undefined as never, game: 1 }) } },
    });
    expect(codes(notJson)).toEqual(["schema"]);
  });
});

describe("size", () => {
  it("is the UTF-8 length of the canonical text, not of the value's own JSON", () => {
    const file = worldSave({ meta: { ...worldSave().meta, title: "Brücke, Zug 4 — 橋" } });
    const text = formatSaveFile(file);
    expect(saveFileBytes(file)).toBe(Buffer.byteLength(text, "utf8"));
    expect(saveFileBytes(file)).toBeGreaterThan(text.length);
    expect(saveFileBytes(file)).not.toBe(Buffer.byteLength(JSON.stringify(file), "utf8"));
  });
});

describe("slot names", () => {
  it("are what SLOT_RULE says: lowercase letters, digits and dashes, 1–32 characters, not starting with a dash", () => {
    expect(SLOT_MAX_LENGTH).toBe(32);
    expect(SLOT_RULE).toBe(
      "lowercase letters, digits and dashes, 1–32 characters, starting with a letter or digit",
    );
    for (const ok of ["a", "slot-1", "0", "auto", "a".repeat(SLOT_MAX_LENGTH)])
      expect(SLOT_PATTERN.test(ok)).toBe(true);
    for (const bad of [
      "",
      "-a",
      "Slot",
      "slot_1",
      "a b",
      "a".repeat(SLOT_MAX_LENGTH + 1),
      "slot:1",
    ])
      expect(SLOT_PATTERN.test(bad)).toBe(false);
  });

  it("are checked by the envelope", () => {
    const r = parseSaveFile(JSON.stringify({ ...worldSave(), slot: "Slot 1" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]).toMatchObject({ code: "schema", path: "/slot" });
  });
});

describe("effectiveSaveLimits", () => {
  it("takes the game's limits, else the defaults", () => {
    expect(effectiveSaveLimits(null)).toEqual(DEFAULT_SAVE_LIMITS);
    expect(effectiveSaveLimits({ saves: { version: 1, limits: { maxSlots: 3 } } })).toEqual({
      maxBytes: DEFAULT_SAVE_LIMITS.maxBytes,
      maxSlots: 3,
    });
  });

  it("caps a browser store at MAX_BROWSER_SAVE_LIMITS, and never another kind", () => {
    const game = { saves: { version: 1, limits: { maxBytes: 4_000_000, maxSlots: 100 } } };
    expect(effectiveSaveLimits(game, { kind: "browser" })).toEqual(MAX_BROWSER_SAVE_LIMITS);
    expect(effectiveSaveLimits(game, { kind: "game" })).toEqual({
      maxBytes: 4_000_000,
      maxSlots: 100,
    });
  });

  it("lets a store be stricter, never looser", () => {
    expect(
      effectiveSaveLimits(null, { kind: "host", limits: { maxBytes: 1024, maxSlots: 99 } }),
    ).toEqual({ maxBytes: 1024, maxSlots: DEFAULT_SAVE_LIMITS.maxSlots });
  });
});
