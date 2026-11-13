// @vitest-environment node
import { readFileSync, writeFileSync } from "node:fs";

import { beforeAll, describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../../game/define";
import { AGENT_SURFACE_KEYWORD, AGENT_SURFACE_VERSION } from "../../scene/agent-surface";
import { formatPrefab, formatScene } from "../../scene/format";
import { hashText } from "../../scene/hash";
import { undescribedProperties } from "../../scene/json-schema";
import {
  SCENE_FORMAT_VERSION,
  type Prefab,
  type SceneDefinition,
  type SceneIssue,
} from "../../scene/types";
import { ENGINE_VERSION } from "../../version";
import { memoryContentStore } from "../content-store";
import { sha256 } from "../hash";
import { createKindRegistry } from "../kinds";
import { ENGINE_FORMATS, type ReleaseAsset, type ReleaseManifest } from "../release";
import {
  checkSceneVersion,
  findSceneVersion,
  formatSceneVersion,
  liveCompat,
  liveCompatKey,
  parseSceneVersion,
  readSceneVersion,
  SCENE_VERSION_SCHEMA_ID,
  sceneVersionId,
  sceneVersionJsonSchema,
  sceneVersionSnapshot,
  type SceneVersion,
} from "../scene-version";
import { checkSnapshot, parseProjectSnapshot } from "../snapshot";
import type { AssetId, Sha256 } from "../types";

const SCHEMA_FILE = new URL("../scene-version.schema.json", import.meta.url);

const registry = createRegistry();

const LEVEL: SceneDefinition = {
  v: SCENE_FORMAT_VERSION,
  name: "level-1",
  bounds: [0, 0, 20, 12],
  entities: [
    {
      id: "start",
      type: "marker",
      at: [1, 1],
      tags: ["spawn"],
      behaviors: { sprite: { asset: "tiles", size: [1, 1] } },
    },
  ],
  instances: [{ id: "gate-1", prefab: "gate", at: [5, 5] }],
};

const GATE: Prefab = {
  kind: "prefab",
  v: SCENE_FORMAT_VERSION,
  id: "gate",
  entities: [{ id: "bar", type: "solid", shape: ["box", 0, -0.1, 0.6, 0.1] }],
};

type Fixture = {
  manifest: ReleaseManifest;
  version: SceneVersion;
  /** The carried canonical texts, by hash. */
  texts: Map<Sha256, string>;
};

const bytesOf = (text: string) => new TextEncoder().encode(text).length;

async function docAsset(key: string, kind: string, path: string, text: string) {
  const sha = await sha256(text);
  return {
    key,
    kind,
    path,
    sha256: sha,
    bytes: bytesOf(text),
    storage: "doc",
    file: `live/${sha}.json`,
  } satisfies ReleaseAsset;
}

async function blobAsset(key: string, path: string, content: string) {
  const sha = await sha256(content);
  return {
    key,
    kind: "texture",
    path,
    sha256: sha,
    bytes: bytesOf(content),
    storage: "blob",
    file: `live/${sha}.png`,
    meta: { format: "png", width: 16, height: 16 },
  } satisfies ReleaseAsset;
}

/** The release's own copy of an asset: its build file instead of the live one. */
const shipped = (a: ReleaseAsset): ReleaseAsset => ({
  ...a,
  file: a.storage === "doc" ? `data/${a.sha256}.json` : `assets/${a.sha256}.png`,
});

async function fixture(def: SceneDefinition = LEVEL): Promise<Fixture> {
  const sceneText = formatScene(def).text;
  const prefabText = formatPrefab(GATE);
  const level = await docAsset("k1", "scene", "scenes/level-1.json", sceneText);
  const gate = await docAsset("k2", "prefab", "prefabs/gate.json", prefabText);
  const tiles = await blobAsset("k3", "art/tiles.png", "tile pixels");
  const units = await blobAsset("k4", "art/units.png", "unit pixels");
  const released = await docAsset("k1", "scene", "scenes/level-1.json", '{ "old": true }\n');
  const build = { scene: await sha256("scene schema"), prefab: await sha256("prefab schema") };
  const manifest = {
    kind: "release",
    v: 1,
    engine: {
      version: ENGINE_VERSION,
      agentSurface: AGENT_SURFACE_VERSION,
      formats: { ...ENGINE_FORMATS },
    },
    game: { id: "fixture", configHash: null, saveVersion: null },
    project: {
      id: "fixture",
      name: "Fixture",
      snapshot: await sha256("snapshot"),
      snapshotEngine: ENGINE_VERSION,
      build,
    },
    build: {
      hash: await sha256("build"),
      target: "web",
      rapier: null,
      entry: "code/main.js",
      files: [],
    },
    time: { kind: "fixed", rate: 60, catchUp: null, wakeOnPointerMove: false },
    replay: { acrossPlatforms: true },
    flow: {
      start: "level-1",
      scenes: [
        {
          id: "level-1",
          title: "Ford",
          physics: "none",
          prefabs: ["gate"],
          bundle: { entries: ["tiles"], bytes: tiles.bytes },
        },
        {
          id: "level-2",
          sublevel: true,
          physics: "none",
          prefabs: [],
          bundle: { entries: [], bytes: 0 },
        },
      ],
    },
    projectBundle: { entries: [], bytes: 0 },
    assets: {
      gate: shipped(gate),
      "level-1": shipped(released),
      tiles: shipped(tiles),
      units: shipped(units),
    },
    credits: { assets: [], missing: [], code: [] },
    budget: {
      limits: { codeBytes: 1, firstLoadBytes: 1, totalBytes: 1, fileBytes: 1 },
      measured: {
        codeBytes: 0,
        wasmBytes: 0,
        firstLoadBytes: 0,
        assetBytes: 0,
        dataBytes: 0,
        totalBytes: 0,
        largestFile: { path: "", bytes: 0 },
      },
      over: [],
    },
    pwa: null,
  } satisfies ReleaseManifest;
  const version: SceneVersion = {
    $schema: "./scene-version.schema.json",
    kind: "scene-version",
    v: 1,
    project: "fixture",
    scene: "level-1",
    compat: liveCompat(manifest),
    engine: ENGINE_VERSION,
    base: await sha256("the release"),
    entry: {
      id: "level-1",
      title: "Ford",
      physics: "none",
      prefabs: ["gate"],
      bundle: { entries: ["tiles"], bytes: tiles.bytes },
    },
    sceneHash: hashText(sceneText),
    assets: { gate, "level-1": level, tiles },
  };
  const texts = new Map([
    [level.sha256, sceneText],
    [gate.sha256, prefabText],
  ]);
  return { manifest, version, texts };
}

type Mutable<T> = { -readonly [K in keyof T]: Mutable<T[K]> };

/** A deep copy of `v`, changed by `edit`. */
function edited<T>(v: T, edit: (m: Mutable<T>) => void): T {
  const copy = structuredClone(v) as Mutable<T>;
  edit(copy);
  return copy as T;
}

const where = (issues: readonly SceneIssue[]) =>
  issues.map((i) => [i.code, (i.detail as { rule?: string } | undefined)?.rule ?? null, i.path]);

let base: Fixture;
beforeAll(async () => {
  base = await fixture();
});

describe("urn:jams-engine:scene-version:v1", () => {
  it("matches the committed file (UPDATE_SCHEMAS=1 regenerates)", () => {
    const schema = sceneVersionJsonSchema();
    if (process.env.UPDATE_SCHEMAS)
      writeFileSync(SCHEMA_FILE, `${JSON.stringify(schema, null, 2)}\n`);
    expect(JSON.parse(readFileSync(SCHEMA_FILE, "utf8"))).toEqual(schema);
  });

  it("has its URN, draft 2020-12, the agent surface and every property described", () => {
    const schema = sceneVersionJsonSchema();
    expect(SCENE_VERSION_SCHEMA_ID).toBe("urn:jams-engine:scene-version:v1");
    expect(schema.$id).toBe(SCENE_VERSION_SCHEMA_ID);
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema[AGENT_SURFACE_KEYWORD]).toBe(AGENT_SURFACE_VERSION);
    expect(undescribedProperties(schema)).toEqual([]);
  });
});

describe("the canonical text", () => {
  it("round-trips byte-identical, with the type's key order, assets by id one per line", () => {
    const text = formatSceneVersion(base.version);
    const parsed = parseSceneVersion(text);
    expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.version).toEqual(base.version);
    expect(formatSceneVersion(parsed.version)).toBe(text);
    expect(text.endsWith("}\n")).toBe(true);
    const lines = text.split("\n");
    const top = lines.filter((l) => /^ {2}"/.test(l)).map((l) => /^ {2}"([^"]+)"/.exec(l)![1]);
    expect(top).toEqual([
      "$schema",
      "kind",
      "v",
      "project",
      "scene",
      "compat",
      "engine",
      "base",
      "entry",
      "sceneHash",
      "assets",
    ]);
    const assetRows = lines.filter((l) => /^ {4}"[^"]+": \{ "key"/.test(l));
    expect(assetRows.map((l) => /"([^"]+)"/.exec(l)![1])).toEqual(["gate", "level-1", "tiles"]);
  });

  it("refuses a shape the schema doesn't take, with lines", () => {
    const bad = formatSceneVersion(base.version).replace(
      '"kind": "scene"',
      '"kind": "scene", "x": 1',
    );
    const read = parseSceneVersion(bad);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.issues.map((i) => i.code)).toContain("unknown-key");
    expect(read.issues.every((i) => typeof i.line === "number")).toBe(true);
  });

  it("refuses a file outside live/ or not named by its hash", () => {
    for (const file of ["data/x.json", `live/${"0".repeat(64)}.json`]) {
      const v = edited(base.version, (m) => {
        m.assets["level-1"]!.file = file;
      });
      const read = parseSceneVersion(formatSceneVersion(v));
      expect(read.ok, file).toBe(false);
      if (!read.ok) expect(read.issues[0]?.path).toBe("/assets/level-1/file");
    }
  });

  it("refuses another kind, a newer v and bad JSON", () => {
    expect(parseSceneVersion("{").ok).toBe(false);
    expect(parseSceneVersion(JSON.stringify({ kind: "release", v: 1 })).ok).toBe(false);
    expect(parseSceneVersion(JSON.stringify({ kind: "scene-version", v: 2 })).ok).toBe(false);
  });
});

describe("sceneVersionId", () => {
  it("is stable across key order and changes with one character", async () => {
    const id = await sceneVersionId(base.version);
    const reordered = JSON.parse(
      JSON.stringify(base.version, Object.keys(base.version).reverse()),
    ) as SceneVersion;
    const shuffled: SceneVersion = {
      ...Object.fromEntries(Object.entries(base.version).reverse()),
      assets: Object.fromEntries(Object.entries(base.version.assets).reverse()),
      compat: {
        game: base.version.compat.game,
        build: base.version.compat.build,
        formats: base.version.compat.formats,
      },
    } as SceneVersion;
    expect(await sceneVersionId(shuffled)).toBe(id);
    expect(await sceneVersionId({ ...reordered, ...base.version })).toBe(id);
    const titled = edited(base.version, (m) => {
      m.entry.title = "Forc";
    });
    expect(await sceneVersionId(titled)).not.toBe(id);
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("liveCompat and liveCompatKey", () => {
  it("is equal for releases differing only in engine version", async () => {
    const newer = edited(base.manifest, (m) => {
      m.engine.version = "9.9.9";
      m.engine.agentSurface = 99;
    });
    expect(await liveCompatKey(liveCompat(newer))).toBe(
      await liveCompatKey(liveCompat(base.manifest)),
    );
  });

  it("differs for a changed project.build entry", async () => {
    const changed = edited(base.manifest, (m) => {
      m.project.build.prefab = "f".repeat(64);
    });
    expect(await liveCompatKey(liveCompat(changed))).not.toBe(
      await liveCompatKey(liveCompat(base.manifest)),
    );
  });

  it("takes the formats, the build and the game, whatever their key order", async () => {
    const compat = liveCompat(base.manifest);
    expect(Object.keys(compat)).toEqual(["formats", "build", "game"]);
    expect(compat.formats).toEqual({ scene: ENGINE_FORMATS.scene, prefab: ENGINE_FORMATS.prefab });
    const reversed = {
      game: compat.game,
      build: Object.fromEntries(Object.entries(compat.build).reverse()),
      formats: { prefab: compat.formats.prefab, scene: compat.formats.scene },
    };
    expect(await liveCompatKey(reversed)).toBe(await liveCompatKey(compat));
  });
});

describe("checkSceneVersion", () => {
  it("is empty for a version that fits, with the texts and without", () => {
    expect(checkSceneVersion(base.manifest, base.version)).toEqual([]);
    expect(checkSceneVersion(base.manifest, base.version, base.texts, { registry })).toEqual([]);
  });

  const refused: [string, (f: Fixture) => [ReleaseManifest, SceneVersion], unknown[][]][] = [
    [
      "1: another project",
      ({ manifest, version }) => [manifest, { ...version, project: "other" }],
      [["live-incompatible", "game", "/project"]],
    ],
    [
      "1: another game configuration",
      ({ manifest, version }) => [
        manifest,
        edited(version, (m) => {
          m.compat.game.configHash = "1d2e3f4a5b6c7d8e";
        }),
      ],
      [["live-incompatible", "game", "/compat/game"]],
    ],
    [
      "2: another scene format",
      ({ manifest, version }) => [
        manifest,
        edited(version, (m) => {
          m.compat.formats.scene += 1;
        }),
      ],
      [["live-incompatible", "formats", "/compat/formats/scene"]],
    ],
    [
      "3: another build",
      ({ manifest, version }) => [
        edited(manifest, (m) => {
          m.project.build.scene = "e".repeat(64);
        }),
        version,
      ],
      [["live-incompatible", "build", "/compat/build/scene"]],
    ],
    [
      "4: an unlisted scene",
      ({ manifest, version }) => [
        edited(manifest, (m) => {
          m.flow.scenes = m.flow.scenes.filter((s) => s.id !== "level-1");
        }),
        version,
      ],
      [["live-scene-unlisted", null, "/scene"]],
    ],
    [
      "4: another sublevel flag",
      ({ manifest, version }) => [
        manifest,
        edited(version, (m) => {
          m.entry.sublevel = true;
        }),
      ],
      [["live-scene-unlisted", null, "/entry/sublevel"]],
    ],
    [
      "5: physics on a build without Rapier",
      ({ manifest, version }) => [
        manifest,
        edited(version, (m) => {
          m.entry.physics = "rapier";
        }),
      ],
      [["live-physics", null, "/entry/physics"]],
    ],
    [
      "6: a changed shared asset",
      ({ manifest, version }) => [
        edited(manifest, (m) => {
          m.assets.tiles!.sha256 = "a".repeat(64);
        }),
        version,
      ],
      [["live-asset-conflict", null, "/assets/tiles/sha256"]],
    ],
    [
      "8: a prefab entry doesn't carry",
      ({ manifest, version }) => [
        manifest,
        edited(version, (m) => {
          m.entry.prefabs = ["gate", "post"];
        }),
      ],
      [["schema", null, "/entry/prefabs/1"]],
    ],
    [
      "8: an unsorted bundle",
      ({ manifest, version }) => [
        manifest,
        edited(version, (m) => {
          m.assets.reeds = { ...m.assets.tiles!, key: "k9", path: "art/reeds.png" };
          m.entry.bundle.entries = ["tiles", "reeds"];
        }),
      ],
      [["schema", null, "/entry/bundle/entries/1"]],
    ],
  ];
  for (const [rule, make, want] of refused)
    it(`refuses rule ${rule} with its code, detail.rule and path`, () => {
      const [manifest, version] = make(base);
      const issues = checkSceneVersion(manifest, version);
      expect(where(issues)).toEqual(want);
      for (const issue of issues) {
        expect(issue.severity).toBe("error");
        // Every refusal says what to do, except a version made for another game.
        if (issue.detail?.rule === "game") expect(issue.hint).toBeUndefined();
        else expect(issue.hint?.length).toBeGreaterThan(0);
        expect(issue.line, issue.code).toBeTypeOf("number");
        expect(issue.message.length).toBeGreaterThan(0);
      }
    });

  it("lets a version carry art new to the release, and the changed scene and prefabs", () => {
    const v = edited(base.version, (m) => {
      m.assets.reeds = { ...m.assets.tiles!, key: "k9", path: "art/reeds.png" };
    });
    const m = edited(base.manifest, (r) => {
      r.assets.gate!.sha256 = "b".repeat(64);
    });
    expect(checkSceneVersion(m, v)).toEqual([]);
  });

  it("words its messages with the host's names, or the defaults", () => {
    const [m, v] = refused[3]![1](base);
    const named = checkSceneVersion(m, v, undefined, {
      names: { version: "level-1@4", release: "v7" },
    });
    expect(named[0]?.message).toBe(
      "level-1@4 was made for another build of the game: its entity types or data kinds differ from v7's.",
    );
    const unlisted = refused[4]![1](base);
    expect(checkSceneVersion(...unlisted)[0]?.message).toBe(
      "The release doesn't list the scene level-1, so it can't be updated live.",
    );
  });

  it("7: with the texts, a reference to an asset the version doesn't carry is asset-missing", () => {
    const v = edited(base.version, (m) => {
      delete m.assets.tiles;
      m.entry.bundle = { entries: [], bytes: 0 };
    });
    expect(checkSceneVersion(base.manifest, v)).toEqual([]);
    const issues = checkSceneVersion(base.manifest, v, base.texts, { registry });
    expect(issues.map((i) => [i.code, i.entityIds[0], i.got])).toEqual([
      ["asset-missing", "level-1", "tiles"],
    ]);
    expect(issues[0]?.line).toBeTypeOf("number");
  });

  it("7: a carried doc without its text is asset-missing", () => {
    const texts = new Map(base.texts);
    texts.delete(base.version.assets.gate!.sha256);
    expect(where(checkSceneVersion(base.manifest, base.version, texts, { registry }))).toEqual([
      ["asset-missing", null, "/assets/gate/sha256"],
    ]);
  });
});

describe("sceneVersionSnapshot", () => {
  it("pins exactly the version's assets and passes checkSnapshot", async () => {
    const snap = await sceneVersionSnapshot(base.version);
    expect(Object.keys(snap.assets)).toEqual(["gate", "level-1", "tiles"]);
    expect(snap).toMatchObject({ project: "fixture", engine: ENGINE_VERSION, at: 0 });
    expect(snap.assets.tiles).toMatchObject({ bytes: base.version.assets.tiles!.bytes });
    expect((await parseProjectSnapshot(snap)).ok).toBe(true);
    const store = memoryContentStore();
    for (const text of base.texts.values()) await store.put(new TextEncoder().encode(text));
    const kinds = createKindRegistry();
    expect(await checkSnapshot(snap, store, kinds, { registry, project: null })).toEqual([]);
  });

  it("hashes the same content the same, whatever `at`", async () => {
    const a = await sceneVersionSnapshot(base.version);
    const b = await sceneVersionSnapshot(structuredClone(base.version));
    expect(b.hash).toBe(a.hash);
    const other = await sceneVersionSnapshot(
      edited(base.version, (m) => {
        m.assets.tiles!.bytes += 1;
      }),
    );
    expect(other.hash).not.toBe(a.hash);
  });
});

describe("findSceneVersion", () => {
  it("finds a version by id, null when the host doesn't have it", async () => {
    const id = await sceneVersionId(base.version);
    const held = [{ id, version: base.version, number: 4 }];
    expect(findSceneVersion(id, held)?.number).toBe(4);
    expect(findSceneVersion("0".repeat(64), held)).toBeNull();
  });
});

describe("readSceneVersion", () => {
  it("parses, validates and expands the scene with its prefabs", () => {
    const read = readSceneVersion(base.version, base.texts, registry, null);
    expect(read.ok, JSON.stringify(read)).toBe(true);
    if (!read.ok) return;
    expect([...read.prefabs.keys()]).toEqual(["gate"]);
    expect(read.def.name).toBe("level-1");
    expect(read.scene.entities.map((e) => e.id)).toEqual(
      expect.arrayContaining(["start", "gate-1/bar"]),
    );
  });

  it("returns a validation error as an issue", async () => {
    const f = await fixture({
      ...LEVEL,
      entities: [...LEVEL.entities!, { id: "start", type: "marker", at: [2, 2] }],
    });
    const read = readSceneVersion(f.version, f.texts, registry, null);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    const errors = read.issues.filter((i) => i.severity === "error");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.every((i) => typeof i.code === "string" && i.message.length > 0)).toBe(true);
  });

  it("refuses a reference to an asset the version doesn't carry", () => {
    const v = edited(base.version, (m) => {
      delete m.assets.tiles;
    });
    const read = readSceneVersion(v, base.texts, registry, null);
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.issues.map((i) => i.code)).toContain("asset-missing");
  });

  it("refuses a missing text, a parse error, and another game", () => {
    const missing = readSceneVersion(base.version, new Map(), registry, null);
    expect(missing.ok).toBe(false);
    if (!missing.ok)
      expect(missing.issues.map((i) => [i.code, i.path])).toEqual([
        ["asset-missing", "/entry/prefabs/0"],
        ["asset-missing", "/scene"],
      ]);
    const texts = new Map(base.texts);
    texts.set(base.version.assets["level-1"]!.sha256, "{");
    const broken = readSceneVersion(base.version, texts, registry, null);
    expect(broken.ok).toBe(false);
    const other = readSceneVersion(base.version, base.texts, registry, {
      id: "another",
    } as never);
    expect(other.ok).toBe(false);
    if (!other.ok)
      expect(where(other.issues)).toEqual([["live-incompatible", "game", "/compat/game"]]);
  });

  it("reads the same scene from the same texts whatever id order they came in", () => {
    const reversed = new Map([...base.texts].reverse() as [AssetId, string][]);
    const a = readSceneVersion(base.version, base.texts, registry, null);
    const b = readSceneVersion(base.version, reversed, registry, null);
    expect(a).toEqual(b);
  });
});
