// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import { testGame } from "../../__tests__/fixtures/test-game";
import { createRegistry } from "../../game/define";
import { formatSaveFile } from "../../game/save-file";
import { engineHomeRegistry } from "../../project/__tests__/fixtures/engine-home";
import {
  createKindRegistry,
  formatAssetDoc,
  parseAssetDoc,
  type DocKindDef,
  type DocLayout,
  type KindEnv,
} from "../../project/kinds";
import { ENGINE_ASSET_KINDS } from "../../project/kinds/index";
import { formatSidecar, parseSidecar, sidecarPathOf } from "../../project/sidecar";
import type { ProjectFile } from "../../project/types";
import type { Prefab, SceneDefinition } from "../../scene/types";
import { fileContentStore } from "../../vite/content-store";
import { createProjectFileAdapter, type FileProject } from "../../vite/project-files";
import { applyOpsToDoc } from "../apply";
import { docToScene, entitiesMap, gridRowKey, metaMap, sceneToDoc } from "../convert";
import { sequentialKeys } from "../keys";
import { KEYED_ITEM, KEYED_Z, contentMap, layoutFromDoc, layoutToDoc } from "../layout";
import { migrateDocLayout } from "../migrate-layout";
import { docToPrefab, prefabToDoc } from "../prefab-doc";
import { applyRegistryBatch, reinspectBlobs } from "../project-apply";
import { readProject } from "../project-doc";
import { LEGACY_Z_FIELD } from "../types";
import { deckGame, deckKind } from "./fixtures/deck-kind";

const lines = (...rows: string[]) => `${rows.join("\n")}\n`;

const env: KindEnv = { registry: createRegistry(deckGame), project: null };
const kinds = createKindRegistry(deckGame);

const FIXTURES: Record<string, string> = {
  material: lines(
    "{",
    '  "kind": "material",',
    '  "v": 2,',
    '  "description": "Ice.",',
    '  "physics": { "friction": 0, "restitution": 0 },',
    '  "render": { "blend": "add", "style": { "fill": "#ccf", "stroke": "#ffffff", "strokeWidth": 2 }, "tint": "#88ccff" }',
    "}",
  ),
  "game-settings": lines(
    "{",
    '  "kind": "game-settings",',
    '  "v": 2,',
    '  "engine": {},',
    '  "game": {',
    '    "avatarSpeed": 180',
    "  }",
    "}",
  ),
  "data-table": lines(
    "{",
    '  "$schema": "../../engine/project/data-table.schema.json",',
    '  "kind": "data-table",',
    '  "v": 2,',
    '  "table": "card",',
    '  "rows": [',
    '    { "id": "zap", "cost": 0, "damage": 1 },',
    '    { "id": "anchor", "cost": 4 },',
    '    { "id": "bolt", "cost": 1, "damage": 2 }',
    "  ]",
    "}",
  ),
  "input-script": lines(
    "{",
    '  "v": 2,',
    '  "scene": "yard",',
    '  "steps": [',
    '    { "for": 10, "hold": ["left"] },',
    '    { "hold": ["right", "push"], "until": { "past": 4 } },',
    '    { "forMs": 250, "hold": [] }',
    "  ]",
    "}",
  ),
  /** Frozen: a change to the input-map's layout or formatter that moves a byte of it is a format change. */
  "input-map": readFileSync(new URL("./fixtures/input-map.json", import.meta.url), "utf8"),
  /** Frozen: a change to the animation's layout or formatter that moves a byte of it is a format change. */
  animation: readFileSync(new URL("./fixtures/hero.animation.json", import.meta.url), "utf8"),
  /** Frozen: a change to the emitter's layout or formatter that moves a byte of it is a format change. */
  emitter: readFileSync(new URL("./fixtures/sparks.emitter.json", import.meta.url), "utf8"),
  /** Frozen: a change to the scene list's layout or formatter that moves a byte of it is a format change. */
  "scene-list": readFileSync(new URL("./fixtures/scene-list.json", import.meta.url), "utf8"),
  checks: lines(
    "{",
    '  "v": 3,',
    '  "checks": [',
    '    { "id": "valid", "kind": "valid" },',
    '    { "id": "props", "kind": "test-game/props", "atLeast": 1 },',
    '    { "id": "far", "kind": "reaches", "at": [5, 5], "result": "won", "script": "far.script.json" },',
    '    { "id": "joined", "kind": "connected", "blockedBy": ["solid"], "diagonals": true, "from": "post", "to": [[3, 4], "gate"] }',
    "  ]",
    "}",
  ),
  "test-game/deck": lines(
    "{",
    '  "v": 1,',
    '  "title": "Red deck",',
    '  "style": {',
    '    "fill": "#f00",',
    '    "line": [1, 2]',
    "  },",
    '  "tags": [',
    '    "fast",',
    '    "red"',
    "  ],",
    '  "cards": [',
    '    { "id": "zap", "note": "cheap", "cost": 0 },',
    '    { "id": "bolt" }',
    "  ]",
    "}",
  ),
};

const docKinds = kinds
  .list()
  .filter((k): k is DocKindDef => k.storage === "doc" && k.layout !== "custom");

/** Every keyed entry under `held`, at any depth. */
function keyedEntries(held: unknown): { key: string; entry: Y.Map<unknown> }[] {
  if (held instanceof Y.Array) return held.toArray().flatMap(keyedEntries);
  if (!(held instanceof Y.Map)) return [];
  return [...held.entries()].flatMap(([key, v]) =>
    v instanceof Y.Map && v.has(KEYED_ITEM)
      ? [{ key, entry: v as Y.Map<unknown> }, ...keyedEntries(v.get(KEYED_ITEM))]
      : keyedEntries(v),
  );
}

/** Through a seeded doc and a second client's copy of its state. */
function throughDocs(layout: DocLayout, value: unknown): Record<string, unknown>[] {
  const doc = layoutToDoc(
    new Y.Doc(),
    layout,
    value,
    { kind: "disk" },
    { key: sequentialKeys("s") },
  );
  const remote = new Y.Doc();
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
  return [layoutFromDoc(doc, layout), layoutFromDoc(remote, layout)];
}

describe("file → doc → file, per kind", () => {
  it("covers every declarative engine kind and the game's", () => {
    const engine = ENGINE_ASSET_KINDS.filter((k) => k.storage === "doc" && k.layout !== "custom");
    expect(docKinds.map((k) => k.kind)).toEqual([...engine.map((k) => k.kind), deckKind.kind]);
    expect(Object.keys(FIXTURES).sort()).toEqual(docKinds.map((k) => k.kind).sort());
  });

  for (const kind of docKinds) {
    const text = FIXTURES[kind.kind]!;
    it(`${kind.kind}: is byte-identical, also after the doc crosses the wire`, () => {
      const parsed = parseAssetDoc(kind, text, env);
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
      const value = parsed.value;
      expect(formatAssetDoc(kind, value)).toBe(text);
      for (const back of throughDocs(kind.layout as DocLayout, value))
        expect(formatAssetDoc(kind, back)).toBe(text);
    });

    it(`${kind.kind}: a layout-2 doc migrates byte-identical, every keyed item keeping its key`, () => {
      const parsed = parseAssetDoc(kind, text, env);
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
      const layout = kind.layout as DocLayout;
      const doc = layoutToDoc(new Y.Doc(), layout, parsed.value, "seed", {
        key: sequentialKeys("s"),
      });
      const entries = keyedEntries(contentMap(doc));
      const order = entries.map((e) => [e.key, e.entry.get(KEYED_Z)]);
      doc.transact(() => {
        metaMap(doc).set("kind", kind.kind);
        metaMap(doc).set("schemaVersion", kind.version);
        metaMap(doc).set("layout", 2);
        for (const { entry } of entries) {
          entry.set(LEGACY_Z_FIELD, entry.get(KEYED_Z));
          entry.delete(KEYED_Z);
        }
      });
      expect(migrateDocLayout(doc, layout)).toMatchObject({ migrated: true, from: 2 });
      expect(entries.map((e) => [e.key, e.entry.get(KEYED_Z)])).toEqual(order);
      expect(entries.every((e) => !e.entry.has(LEGACY_Z_FIELD))).toBe(true);
      expect(formatAssetDoc(kind, layoutFromDoc(doc, layout))).toBe(text);
    });

    it(`${kind.kind}: its empty value survives the doc`, () => {
      const empty = kind.empty(env, { id: "fresh" });
      const text = formatAssetDoc(kind, empty);
      for (const back of throughDocs(kind.layout as DocLayout, empty))
        expect(formatAssetDoc(kind, back)).toBe(text);
    });
  }

  it("checks: a connected check, every optional field set, is among the byte-identical fixtures", () => {
    const parsed = parseAssetDoc(kinds.get("checks") as DocKindDef, FIXTURES.checks!, env);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    const { checks } = parsed.value as { checks: Record<string, unknown>[] };
    expect(checks.find((c) => c.kind === "connected")).toEqual({
      id: "joined",
      kind: "connected",
      blockedBy: ["solid"],
      diagonals: true,
      from: "post",
      to: [[3, 4], "gate"],
    });
  });

  const WORLD_PREDICATES: Record<string, string> = {
    "input-script": lines(
      "{",
      '  "v": 2,',
      '  "scene": "yard",',
      '  "steps": [',
      '    { "hold": ["right"], "until": { "exists": "lamp#1" } },',
      '    { "hold": [], "until": { "count": { "enabled": false, "min": 1, "type": ["lamp", "plain"] }, "exists": { "enabled": false, "id": "lamp#2" } } },',
      '    { "hold": ["push"], "until": { "count": { "eq": 0, "tag": "spawned" } } }',
      "  ]",
      "}",
    ),
    checks: lines(
      "{",
      '  "v": 3,',
      '  "checks": [',
      '    { "id": "cleared", "kind": "reaches", "expect": { "count": { "max": 2, "type": "lamp" }, "exists": "lamp#3" }, "result": "script-end", "script": { "steps": [{ "hold": [], "until": { "exists": "lamp#1" } }], "v": 2 } }',
      "  ]",
      "}",
    ),
  };

  it("input-script: a v2 script with a track per seat is byte-identical, also after the doc crosses the wire", () => {
    const text = lines(
      "{",
      '  "v": 2,',
      '  "scene": "yard",',
      '  "players": 2,',
      '  "tracks": [',
      '    { "player": 0, "steps": [',
      '      { "for": 10, "hold": ["left"] },',
      '      { "hold": ["right", "push"], "until": { "past": 4 } }',
      "    ] },",
      '    { "player": 1, "steps": [',
      '      { "wait": 5 },',
      '      { "for": 20, "hold": ["push"] }',
      "    ] }",
      "  ]",
      "}",
    );
    const kind = kinds.get("input-script") as DocKindDef;
    const parsed = parseAssetDoc(kind, text, env);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    expect(formatAssetDoc(kind, parsed.value)).toBe(text);
    for (const back of throughDocs(kind.layout as DocLayout, parsed.value)) {
      expect(back).toEqual(parsed.value);
      expect(formatAssetDoc(kind, back)).toBe(text);
    }
  });

  it("input-map: the frozen fixture binds every device kind and holds two seats", () => {
    const parsed = parseAssetDoc(kinds.get("input-map") as DocKindDef, FIXTURES["input-map"]!, env);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    const { actions, players } = parsed.value as {
      actions: { bindings: { device: string }[] }[];
      players: { max: number };
    };
    expect(new Set(actions.flatMap((a) => a.bindings.map((b) => b.device)))).toEqual(
      new Set(["key", "pad", "pointer", "touch"]),
    );
    expect(players.max).toBe(2);
  });

  it("scene-list: the frozen fixture names a start, titles, an untitled entry and a sublevel, in order", () => {
    const parsed = parseAssetDoc(
      kinds.get("scene-list") as DocKindDef,
      FIXTURES["scene-list"]!,
      env,
    );
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    expect(parsed.issues).toEqual([]);
    const { start, scenes } = parsed.value as {
      start: string;
      scenes: { scene: string; title?: string; sublevel?: true }[];
    };
    expect(start).toBe("menu");
    expect(scenes.map((e) => e.scene)).toEqual(["menu", "ford", "result", "cellar"]);
    expect(scenes.find((e) => e.scene === "result")!.title).toBeUndefined();
    expect(scenes.filter((e) => e.sublevel).map((e) => e.scene)).toEqual(["cellar"]);
  });

  it("animation: the frozen fixture holds every loop mode, a tag override, events, shape sets and next", () => {
    const parsed = parseAssetDoc(kinds.get("animation") as DocKindDef, FIXTURES.animation!, env);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    expect(parsed.issues).toEqual([]);
    const { clips } = parsed.value as {
      clips: {
        name: string;
        tag?: string;
        loop?: string;
        next?: string;
        frames?: { events?: string[]; shapes?: Record<string, unknown[]> }[];
      }[];
    };
    expect(clips.map((c) => c.name)).toEqual(["idle", "blink", "strike", "sway", "pose"]);
    expect(new Set(clips.map((c) => c.loop ?? "loop"))).toEqual(
      new Set(["loop", "once", "pingpong", "hold"]),
    );
    expect(clips.find((c) => c.tag && c.frames)?.name).toBe("blink");
    expect(clips.filter((c) => c.next).map((c) => c.next)).toEqual(["idle", "idle"]);
    const frames = clips.flatMap((c) => c.frames ?? []);
    expect(frames.flatMap((f) => f.events ?? [])).toEqual(["blink", "swing", "step"]);
    expect(frames.flatMap((f) => Object.keys(f.shapes ?? {}))).toEqual(["hit", "hurt-high"]);
  });

  it("emitter: the frozen fixture sets every field, two bursts and every curve", () => {
    const parsed = parseAssetDoc(kinds.get("emitter") as DocKindDef, FIXTURES.emitter!, env);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    expect(parsed.issues).toEqual([]);
    const value = parsed.value as Record<string, unknown>;
    expect(Object.keys(value).sort()).toEqual(
      [
        "$schema",
        "kind",
        "v",
        "texture",
        "frame",
        "blend",
        "rate",
        "bursts",
        "lifeMs",
        "speed",
        "angle",
        "drift",
        "damping",
        "scale",
        "alpha",
        "tint",
        "shape",
        "space",
        "max",
        "durationMs",
      ].sort(),
    );
    expect(value.bursts).toHaveLength(2);
    expect((value.shape as { kind: string }).kind).toBe("circle");
  });

  for (const [name, text] of Object.entries(WORLD_PREDICATES)) {
    it(`${name}: a script with exists and count is byte-identical, also after the doc crosses the wire`, () => {
      const kind = kinds.get(name) as DocKindDef;
      const parsed = parseAssetDoc(kind, text, env);
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
      expect(formatAssetDoc(kind, parsed.value)).toBe(text);
      for (const back of throughDocs(kind.layout as DocLayout, parsed.value)) {
        expect(back).toEqual(parsed.value);
        expect(formatAssetDoc(kind, back)).toBe(text);
      }
    });
  }

  it("the game's deck keeps two items with one id through the doc, reported as dup-id", () => {
    const value = JSON.parse(FIXTURES[deckKind.kind]!) as { cards: { id: string }[] };
    value.cards.splice(1, 0, { id: "zap" });
    for (const back of throughDocs(deckKind.layout, value)) {
      expect((back.cards as { id: string }[]).map((c) => c.id)).toEqual(["zap", "zap", "bolt"]);
      const parsed = parseAssetDoc(deckKind as DocKindDef, back, env);
      expect(!parsed.ok && parsed.issues.map((i) => [i.code, i.path])).toEqual([
        ["dup-id", "/cards/1/id"],
      ]);
    }
  });

  const sceneFiles = ["../../scenes/kitchen-sink.json", "../../scenes/engine-yard.json"];
  const sceneKind = kinds.get("scene") as DocKindDef<SceneDefinition>;
  for (const path of sceneFiles) {
    it(`scene: the kind's parse and format round-trip ${path} through the scene codec`, () => {
      const text = readFileSync(new URL(path, import.meta.url), "utf8");
      const parsed = parseAssetDoc(sceneKind, text, {
        registry: engineHomeRegistry(),
        project: null,
      });
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
      const doc = sceneToDoc(parsed.value);
      const remote = new Y.Doc();
      Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
      expect(formatAssetDoc(sceneKind, docToScene(remote))).toBe(text);
    });
  }

  const PAINTED = lines(
    "{",
    '  "v": 4,',
    '  "game": "test-game",',
    '  "name": "paint-yard",',
    '  "bounds": [0, 0, 4096, 4096],',
    '  "settings": { "grid": { "cell": [16, 16], "kind": "square" } },',
    '  "entities": [',
    '    { "id": "lamp", "type": "lamp", "at": [1, 2] },',
    '    { "id": "floor", "type": "paint", "at": [0, 640], "cells": {',
    '      "-1,0": ["0*31,3"],',
    '      "0,0": ["1*32", "1*32", "0*4,2*24"],',
    '      "1,0": ["1*8"],',
    '      "0,1": ["", "", "3"]',
    "    } }",
    "  ]",
    "}",
  );
  const gameEnv: KindEnv = { registry: createRegistry(testGame), project: null };
  const paintedDoc = () => {
    const parsed = parseAssetDoc(sceneKind, PAINTED, gameEnv);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(sceneToDoc(parsed.value)));
    return remote;
  };
  const floorMap = (doc: Y.Doc) =>
    [...entitiesMap(doc).values()].find((m) => m.get("id") === "floor")!;

  it("scene: a grid field round-trips byte-identical, one doc key per non-empty row", () => {
    const doc = paintedDoc();
    expect(formatAssetDoc(sceneKind, docToScene(doc))).toBe(PAINTED);
    const floor = floorMap(doc);
    expect(floor.has("cells")).toBe(false);
    expect([...floor.keys()].filter((k) => k.startsWith("cells@")).sort()).toEqual(
      [
        gridRowKey("cells", "-1,0", 0),
        gridRowKey("cells", "0,0", 0),
        gridRowKey("cells", "0,0", 1),
        gridRowKey("cells", "0,0", 2),
        gridRowKey("cells", "1,0", 0),
        gridRowKey("cells", "0,1", 2),
      ].sort(),
    );
    expect(floor.get(gridRowKey("cells", "0,0", 2))).toBe("0*4,2*24");
  });

  it("scene: a paint writes one row key and changes only its chunk's line in the file", () => {
    const doc = paintedDoc();
    const changed: string[] = [];
    floorMap(doc).observe((e) => changed.push(...e.keysChanged));
    const r = applyOpsToDoc(
      doc,
      { ops: [{ op: "paintCells", ref: "floor", field: "cells", cells: [[40, 0, 2]] }] },
      { kind: "user", userId: "ada" },
      gameEnv.registry,
    );
    expect(r.ok || r.issue).toBe(true);
    expect(changed).toEqual([gridRowKey("cells", "1,0", 0)]);
    const before = PAINTED.split("\n");
    const after = formatAssetDoc(sceneKind, docToScene(doc)).split("\n");
    expect(after).toHaveLength(before.length);
    const diff = after.flatMap((line, i) => (line === before[i] ? [] : [[before[i], line]]));
    expect(diff).toEqual([['      "1,0": ["1*8"],', '      "1,0": ["1*8,2"],']]);
  });

  const prefabKind = kinds.get("prefab") as DocKindDef<Prefab>;
  for (const path of ["../../scenes/prefabs/post.json", "../../scenes/prefabs/gate.json"]) {
    it(`prefab: the kind's parse and format round-trip ${path} through the prefab codec`, () => {
      const text = readFileSync(new URL(path, import.meta.url), "utf8");
      const parsed = parseAssetDoc(prefabKind, text, {
        registry: engineHomeRegistry(),
        project: null,
      });
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
      const doc = prefabToDoc(parsed.value, { key: sequentialKeys("p") });
      const remote = new Y.Doc();
      Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
      expect(formatAssetDoc(prefabKind, docToPrefab(remote))).toBe(text);
    });
  }
});

// ─── Blob kinds: sidecar → registry → sidecar ────────────

const blobFixture = (name: string) =>
  readFile(
    new URL(
      name.startsWith("./") ? name : `../../project/__tests__/fixtures/${name}`,
      import.meta.url,
    ),
  );
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Each blob kind's file (by its kind, or a case naming `kind`), the files its import resolves beside it, the settings its sidecar sets and the meta it inspects to. */
const BLOBS: Record<
  string,
  {
    kind?: string;
    path: string;
    /** A fixture's path, or the bytes themselves. */
    file: string | Uint8Array;
    beside?: Record<string, string>;
    import?: object;
    meta?: object;
  }
> = {
  texture: {
    path: "art/crate.png",
    file: "texture.png",
    import: { filter: "linear", pivot: [0.5, 1] },
  },
  atlas: {
    path: "art/hero.atlas.json",
    file: "hero.json",
    beside: { "art/hero.png": "hero.png" },
    import: { pivotDefault: [0.5, 1] },
  },
  font: { path: "fonts/font.fnt", file: "font.fnt", beside: { "fonts/font_0.png": "font_0.png" } },
  audio: { path: "sfx/tone.wav", file: "tone.wav" },
  recording: {
    path: "runs/run.recording.json",
    file: "run.recording.json",
    meta: { scene: "kitchen-sink", ticks: 120, sceneHash: "3f1c9a2b", v: 1, players: 1 },
  },
  "recording v2": {
    kind: "recording",
    path: "runs/versus.recording.json",
    file: "./fixtures/run.v2.recording.json",
    meta: { scene: "yard", ticks: 60, sceneHash: "5a1d2c3e", v: 2, players: 2 },
  },
  save: {
    path: "saves/level-2.save.json",
    file: new TextEncoder().encode(
      formatSaveFile({
        kind: "save",
        v: 1,
        game: "test-game",
        gameVersion: 2,
        engine: "0.13.0",
        release: null,
        project: null,
        slot: "fixture",
        meta: { scene: "yard", savedAt: 0, playTicks: 90 },
        depth: "progress",
        persist: { cleared: ["yard"] },
        scene: { id: "yard", runHash: "5a1d2c3e", sublevels: [] },
        data: { turn: 3 },
      }),
    ),
    meta: { game: "test-game", gameVersion: 2, depth: "progress", scene: "yard" },
  },
};

describe("sidecar → registry → sidecar, per blob kind", () => {
  const blobKinds = kinds.list().filter((k) => k.storage === "blob");
  const projectFile: ProjectFile = {
    kind: "project",
    v: 1,
    id: "demo",
    name: "Demo",
    game: null,
    assets: ["**"],
  };

  it("covers every blob kind", () => {
    expect(blobKinds.map((k) => k.kind).sort()).toEqual(
      [...new Set(Object.entries(BLOBS).map(([name, b]) => b.kind ?? name))].sort(),
    );
  });

  for (const [name, spec] of Object.entries(BLOBS)) {
    const kind = spec.kind ?? name;
    it(`${name}: its sidecar crosses the wire and a move writes it back byte-identical`, async () => {
      const root = await mkdtemp(join(tmpdir(), "kinds-roundtrip-"));
      const dir = join(root, "demo");
      const put = async (path: string, data: string | Uint8Array) => {
        await mkdir(dirname(join(dir, path)), { recursive: true });
        await writeFile(join(dir, path), data);
      };
      const read = (path: string) => readFile(join(dir, path), "utf8");
      const project = (cache: string): FileProject => ({
        dir,
        file: projectFile,
        registry: env.registry,
        kinds,
        cacheDir: join(root, cache),
      });
      try {
        const bytes =
          typeof spec.file === "string" ? new Uint8Array(await blobFixture(spec.file)) : spec.file;
        await put("jams.project.json", `${JSON.stringify(projectFile)}\n`);
        await put(spec.path, bytes);
        for (const [path, file] of Object.entries(spec.beside ?? {}))
          await put(path, await blobFixture(file));
        const key = `k-${kind}`;
        await put(
          sidecarPathOf(spec.path),
          formatSidecar({
            kind: "asset-sidecar",
            v: 1,
            key,
            id: `my-${kind}`,
            name: "Shown name",
            licence: { spdx: "CC-BY-4.0", author: "Ana", attribution: "Art by Ana" },
            ...(spec.import ? { import: { ...spec.import } } : {}),
          }),
        );

        const writer = createProjectFileAdapter(project("cache-a"));
        const first = new Y.Doc();
        expect(await writer.loadProject(first)).toEqual([]);
        expect(await writer.storeProject(first)).toBe(true);
        const text = await read(sidecarPathOf(spec.path));
        const parsed = parseSidecar(text);
        if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
        expect(parsed.sidecar).toMatchObject({
          key,
          id: `my-${kind}`,
          name: "Shown name",
          sha256: sha(bytes),
          bytes: bytes.byteLength,
          licence: { attribution: "Art by Ana" },
          ...(spec.import ? { import: spec.import } : {}),
        });
        expect(parsed.sidecar.meta).toBeDefined();
        if (spec.meta) expect(parsed.sidecar.meta).toEqual(spec.meta);
        expect(formatSidecar(parsed.sidecar, { detectedKind: kind })).toBe(text);

        const host = createProjectFileAdapter(project("cache-b"));
        const doc = new Y.Doc();
        expect(await host.loadProject(doc)).toEqual([]);
        const entry = readProject(doc).assets[key]!;
        expect(entry).toEqual(readProject(first).assets[key]);
        const remote = new Y.Doc();
        Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
        expect(readProject(remote).assets[key]).toEqual(entry);

        if (kind === "recording") {
          const edited = new Uint8Array([...bytes, 0x0a]);
          const replaced = applyRegistryBatch(
            remote,
            {
              v: 1,
              ops: [
                {
                  op: "replaceContent",
                  id: `my-${kind}`,
                  sha256: sha(edited),
                  bytes: edited.byteLength,
                },
              ],
            },
            { kind: "user", userId: "ada" },
            { registry: env.registry, kinds },
          );
          expect(!replaced.ok && replaced.issue.code).toBe("asset-kind");
          expect(readProject(remote).assets[key]).toEqual(entry);
        }

        // What its import resolves beside it moves along, so its meta stays put.
        const near = new Set([spec.path, ...Object.keys(spec.beside ?? {})]);
        const together = Object.values(readProject(remote).assets)
          .filter((e) => near.has(e.path))
          .map((e) => e.id);
        const moved = applyRegistryBatch(
          remote,
          { v: 1, ops: [{ op: "moveAsset", ids: together, to: "moved/" }] },
          { kind: "user", userId: "ada" },
          { registry: env.registry, kinds },
        );
        expect(moved.ok).toBe(true);
        Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote, Y.encodeStateVector(doc)));
        // As the one writer stores: meta that names paths (a font's pages) follows the move.
        await reinspectBlobs(doc, { kinds, store: fileContentStore(join(root, "cache-b")) });
        expect(await host.storeProject(doc)).toBe(true);
        const to = `moved/${spec.path.split("/").pop()}`;
        const after = readProject(doc).assets[key]!;
        expect(after).toEqual({ ...entry, path: to, meta: after.meta });
        expect(await read(sidecarPathOf(to))).toBe(
          formatSidecar({ ...parsed.sidecar, meta: after.meta }, { detectedKind: kind }),
        );
        if (kind !== "font") expect(await read(sidecarPathOf(to))).toBe(text);
        expect(new Uint8Array(await readFile(join(dir, to)))).toEqual(bytes);
        expect(await host.storeProject(doc)).toBe(false);

        const rescan = await createProjectFileAdapter(project("cache-c")).scan();
        expect(rescan.problems).toEqual([]);
        expect(rescan.state.assets[key]).toEqual(after);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});
