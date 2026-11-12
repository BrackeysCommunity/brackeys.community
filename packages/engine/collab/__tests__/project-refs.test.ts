import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";
import { z } from "zod";

import { createRegistry, defineGame } from "../../game/define";
import { assetField, pointField } from "../../game/fields";
import type { FieldEnv } from "../../game/types";
import {
  createKindRegistry,
  defineAssetKind,
  parseAssetDoc,
  type DocKindDef,
  type DocLayout,
} from "../../project/kinds";
import { dataTableKind } from "../../project/kinds/data-table";
import { gameSettingsKind } from "../../project/kinds/game-settings";
import { ENGINE_ASSET_KINDS } from "../../project/kinds/index";
import { sceneListKind, type SceneListFile } from "../../project/kinds/scene-list";
import type { ProjectOp, ProjectOpBatch } from "../../project/ops";
import { buildRefIndex, referencedTrash } from "../../project/refs";
import type { AssetEntry, AssetId, ProjectState } from "../../project/types";
import { projectView } from "../../project/view";
import { rng } from "../../scene/__tests__/fixtures/random-ops";
import { INPUT_SCRIPT_LAYOUT } from "../../scene/format";
import { parseScene } from "../../scene/parse";
import { SCENE_FORMAT_VERSION, type Prefab, type SceneDefinition } from "../../scene/types";
import { docToScene, prefabHeaderMap, sceneToDoc } from "../convert";
import { sequentialKeys } from "../keys";
import { layoutFromDoc, layoutToDoc } from "../layout";
import { readLog } from "../log";
import { prefabToDoc } from "../prefab-doc";
import { applyProjectBatch, applyRepairs } from "../project-apply";
import { readProject, seedProjectDoc } from "../project-doc";
import { readProjectLog } from "../project-log";
import {
  createProjectSession,
  memoryDocHost,
  type PrefabWriter,
  type ProjectSession,
} from "../project-session";
import type { DocOrigin } from "../types";
import { ada, bo } from "./helpers";
import { SimProject } from "./sim-network";

// ─── A project whose levels name prefabs and whose atlas names a texture ──

const LEVEL_LAYOUT: DocLayout = {
  as: "map",
  fields: { instances: { as: "keyed", item: { as: "map", rest: { as: "atomic" } } } },
  rest: { as: "atomic" },
};
type Level = { v: 1; instances: { id: string; prefab: string }[] };

const level = defineAssetKind({
  storage: "doc",
  kind: "level",
  title: "Level",
  description: "Prefab placements.",
  match: { suffixes: [".level.json"] },
  version: 1,
  schemaId: "urn:jams-engine:level:v1",
  schema: () =>
    z.looseObject({
      v: z.literal(1),
      instances: z.array(z.looseObject({ id: z.string(), prefab: z.string() })),
    }),
  layout: LEVEL_LAYOUT,
  empty: () => ({ v: 1, instances: [] }),
  refs: (value: Level) =>
    value.instances.map((inst) => ({
      pointer: `/instances/@${inst.id}/prefab`,
      id: inst.prefab,
      kinds: ["prefab"],
    })),
});

const kinds = createKindRegistry(null, [...ENGINE_ASSET_KINDS, level]);
const registry = createRegistry();
const H = (c: string) => c.repeat(64);
const PREFABS = ["crate", "gate"] as const;
const TEXTURES = ["tiles", "bricks"] as const;
const LEVELS = ["l1", "l2"] as const;

const entry = (id: string, kind: string, path: string, extra: Partial<AssetEntry> = {}) =>
  ({ key: id, id, kind, path, created: { at: 0, by: "seed" }, ...extra }) satisfies AssetEntry;

const seedState: ProjectState = {
  meta: { projectId: "p", layout: 1, name: "P" },
  assets: Object.fromEntries(
    [
      ...PREFABS.map((id) => entry(id, "prefab", `prefabs/${id}.json`)),
      ...TEXTURES.map((id) => entry(id, "texture", `art/${id}.png`, { sha256: H("a"), bytes: 4 })),
      entry("sheet", "atlas", "art/sheet.atlas.json", {
        sha256: H("b"),
        bytes: 4,
        import: { texture: "tiles" },
      }),
      ...LEVELS.map((id) => entry(id, "level", `levels/${id}.level.json`)),
    ].map((e) => [e.key, e]),
  ),
  history: {},
  code: {},
  build: {},
};

const seedLevels: Record<string, Level> = {
  l1: { v: 1, instances: [{ id: "a", prefab: "gate" }] },
  l2: { v: 1, instances: [] },
};

function seeds(): Record<string, Y.Doc> {
  const out: Record<string, Y.Doc> = {};
  const project = new Y.Doc();
  project.clientID = 1;
  seedProjectDoc(project, seedState, { kind: "migration" });
  out["project:p"] = project;
  for (const id of LEVELS) {
    const doc = new Y.Doc();
    doc.clientID = 1;
    layoutToDoc(doc, LEVEL_LAYOUT, seedLevels[id], { kind: "migration" });
    out[`asset:p.${id}`] = doc;
  }
  return out;
}

/** A `SimProject` with a copy per client and one more, the project's one writer. */
function simProject(clients: number, seed: number) {
  const sim = new SimProject(clients + 1, rng(seed), seeds());
  return {
    net: sim,
    rand: sim.rand,
    join: (i: number, origin: DocOrigin) =>
      createProjectSession({ project: "p", openDoc: sim.openDoc(i), origin, registry, kinds }),
    /** The one writer's copy of a doc. */
    server: (name: string) => sim.doc(name, clients),
  };
}

const cy: DocOrigin = { kind: "user", userId: "cy" };

async function applied(s: ProjectSession, ops: ProjectOp[], label?: string) {
  const r = await applyProjectBatch(s, { v: 1, ...(label ? { label } : {}), ops }, s.origin);
  if (!r.ok) throw new Error(`op ${r.opIndex}: ${r.issue.message}`);
  return r;
}

/** Live levels' values by id, as a client or the one writer holds them. */
function levelValues(state: ProjectState, doc: (name: string) => Y.Doc): Map<AssetId, unknown> {
  const out = new Map<AssetId, unknown>();
  for (const e of Object.values(state.assets))
    if (!e.deleted && e.kind === "level")
      out.set(e.id, layoutFromDoc(doc(`asset:p.${e.key}`), LEVEL_LAYOUT));
  return out;
}

function refsOf(state: ProjectState, doc: (name: string) => Y.Doc) {
  const view = projectView(state, kinds);
  return {
    view,
    index: buildRefIndex(view, levelValues(state, doc), kinds, { registry, project: view }),
  };
}

const sessionDoc = (s: ProjectSession) => (name: string) => s.get(name)!.doc;

// ─── Reference integrity ─────────────────────────────────

describe("reference integrity", () => {
  it(
    "a rename or move during concurrent referrer edits leaves no dangling ref",
    { timeout: 30_000 },
    async () => {
      let partitions = 0;
      for (const seed of [1, 2, 3, 4, 5]) {
        const sim = simProject(3, seed);
        const [mover, b, c] = await Promise.all([
          sim.join(0, ada),
          sim.join(1, bo),
          sim.join(2, cy),
        ]);
        for (const s of [b, c]) for (const id of LEVELS) await s.open(`asset:p.${id}`);
        const pick = <T>(list: readonly T[]) => list[Math.floor(sim.rand() * list.length)]!;
        let placed = 1;
        for (let step = 0; step < 24; step++) {
          const moving = pick([...PREFABS, ...TEXTURES]);
          const at = mover.view().byId.get(moving)!;
          const name = at.path.slice(at.path.lastIndexOf("/") + 1);
          await applied(
            mover,
            sim.rand() < 0.5
              ? [{ op: "moveAsset", ids: [moving], to: `moved-${step}/` }]
              : [{ op: "renameAsset", id: moving, file: `s${step}-${name}` }],
          );
          for (const [i, s] of [b, c].entries()) {
            const into = pick(LEVELS);
            await applied(s, [
              {
                op: "editAsset",
                id: into,
                edits: [
                  { insert: "/instances", value: { id: `c${i}-${step}`, prefab: pick(PREFABS) } },
                ],
              },
            ]);
            placed++;
            if (sim.rand() < 0.5)
              await applied(s, [
                { op: "setImport", id: "sheet", set: { texture: pick(TEXTURES) } },
              ]);
          }
          sim.net.deliver(Math.floor(sim.rand() * 3));
          sim.net.weather(0.15, 0.2);
        }
        sim.net.settle();

        const states = [mover, b, c].map((s) => readProject(s.projectDoc));
        expect(states[1], `seed ${seed}`).toEqual(states[0]);
        expect(states[2], `seed ${seed}`).toEqual(states[0]);
        for (const s of [b, c]) {
          const { view, index } = refsOf(readProject(s.projectDoc), sessionDoc(s));
          expect(index.dangling(), `seed ${seed}`).toEqual([]);
          for (const id of [...PREFABS, ...TEXTURES])
            expect(view.byId.get(id)?.path).not.toBe(seedState.assets[id]!.path);
          const instances = LEVELS.flatMap(
            (id) => (layoutFromDoc(s.get(`asset:p.${id}`)!.doc, LEVEL_LAYOUT) as Level).instances,
          );
          expect(instances, `seed ${seed}: no placement lost`).toHaveLength(placed);
        }
        partitions += sim.net.partitions;
        for (const s of [mover, b, c]) s.destroy();
      }
      expect(partitions, "the runs must cut clients off").toBeGreaterThan(5);
    },
  );

  it(
    "a delete racing a new reference ends restored, with asset-in-use, never dangling",
    { timeout: 30_000 },
    async () => {
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const sim = simProject(2, seed);
        const [a, b] = await Promise.all([sim.join(0, ada), sim.join(1, bo)]);
        for (const id of LEVELS) await b.open(`asset:p.${id}`);

        if (seed % 2 === 1) sim.net.partition([seed % 3]);
        await applied(a, [{ op: "deleteAsset", id: "crate" }]);
        await applied(b, [
          {
            op: "editAsset",
            id: "l1",
            edits: [{ insert: "/instances", value: { id: "b1", prefab: "crate" } }],
          },
        ]);
        for (let step = 0; step < 4; step++) sim.net.weather(0.2, 0.2);
        sim.net.settle();
        const raced = refsOf(readProject(b.projectDoc), sessionDoc(b));
        expect(raced.view.byId.has("crate")).toBe(false);
        expect(raced.index.dangling().map((i) => [i.code, i.got, i.entityIds])).toEqual([
          ["asset-missing", "crate", ["l1"]],
        ]);

        // The project's one writer, on store: restore what a live doc it holds still names.
        const server = sim.server("project:p");
        const stored = refsOf(readProject(server), sim.server);
        const restore = referencedTrash(stored.view, stored.index);
        expect(restore).toEqual(["crate"]);
        const repair = { kind: "repair", reason: "asset-in-use" } as const;
        const fixed = applyRepairs(server, { restore, origin: repair, now: 5 });
        expect([fixed.wrote, fixed.restored]).toEqual([true, ["crate"]]);
        expect(applyRepairs(server, { restore, origin: repair }).wrote).toBe(false);
        sim.net.settle();

        for (const s of [a, b]) {
          const state = readProject(s.projectDoc);
          expect(state.assets.crate!.deleted).toBeUndefined();
          const log = readProjectLog(s.projectDoc).at(-1)!;
          expect([log.actor, log.label]).toEqual([repair, "Restore crate"]);
        }
        expect(refsOf(readProject(b.projectDoc), sessionDoc(b)).index.dangling()).toEqual([]);

        const again = await applyProjectBatch(
          a,
          { v: 1, ops: [{ op: "deleteAsset", id: "crate" }] },
          ada,
        );
        expect(again.ok || [again.issue.code, again.issue.detail]).toEqual([
          "asset-in-use",
          { referrers: [{ id: "l1", pointer: "/instances/@b1/prefab" }] },
        ]);
        for (const s of [a, b]) s.destroy();
      }
    },
  );
});

// ─── changeAssetId as one cross-doc batch ────────────────

describe("changeAssetId", () => {
  const yard: SceneDefinition = {
    v: 2,
    name: "yard",
    bounds: [0, 0, 1000, 1000],
    instances: [{ id: "g1", prefab: "gate", at: [100, 900] }],
    entities: [{ id: "start", type: "marker", at: [10, 10] }],
  };
  const gate: Prefab = {
    kind: "prefab",
    v: 2,
    id: "gate",
    entities: [{ id: "top", type: "marker", at: [0, -40] }],
  };

  function world(extra: AssetEntry[] = []) {
    const host = memoryDocHost();
    const state: ProjectState = {
      ...seedState,
      assets: {
        ...seedState.assets,
        yard: entry("yard", "scene", "levels/yard.json"),
        walk: entry("walk", "input-script", "levels/walk.script.json"),
        ...Object.fromEntries(extra.map((e) => [e.key, e])),
      },
    };
    seedProjectDoc(host.doc("project:p"), state, { kind: "migration" });
    for (const id of LEVELS)
      layoutToDoc(host.doc(`asset:p.${id}`), LEVEL_LAYOUT, seedLevels[id], { kind: "migration" });
    sceneToDoc(yard, { doc: host.doc("scene:p.yard"), key: sequentialKeys("srv") });
    for (const prefab of [gate, { ...gate, id: "crate" }])
      prefabToDoc(prefab, { doc: host.doc(`asset:p.${prefab.id}`), key: sequentialKeys("pf") });
    layoutToDoc(
      host.doc("asset:p.walk"),
      INPUT_SCRIPT_LAYOUT,
      { v: 1, scene: "yard", steps: [{ wait: 60 }] },
      { kind: "migration" },
    );
    const join = (origin: DocOrigin) =>
      createProjectSession({
        project: "p",
        openDoc: host.client().openDoc,
        origin,
        registry,
        kinds,
      });
    return { host, join };
  }

  it("writes the entry, the prefab's header and every referrer in one step", async () => {
    const { host, join } = world();
    const a = await join(ada);
    const r = await applied(a, [{ op: "changeAssetId", id: "gate", to: "door" }], "Rename gate");
    expect(r.docs).toEqual(["asset:p.gate", "asset:p.l1", "scene:p.yard", "project:p"]);
    expect(r.entry?.docs.map((d) => d.doc)).toEqual(r.docs);

    expect(readProject(host.doc("project:p")).assets.gate!.id).toBe("door");
    expect(prefabHeaderMap(host.doc("asset:p.gate")).get("id")).toBe("door");
    expect(readLog(host.doc("asset:p.gate")).at(-1)).toMatchObject({
      label: "Rename gate",
      keys: ["@header"],
      before: { "@header": { id: "gate" } },
    });
    expect(docToScene(host.doc("scene:p.yard")).instances).toEqual([
      { id: "g1", prefab: "door", at: [100, 900] },
    ]);
    expect((layoutFromDoc(host.doc("asset:p.l1"), LEVEL_LAYOUT) as Level).instances).toEqual([
      { id: "a", prefab: "door" },
    ]);
    const { index } = refsOf(readProject(host.doc("project:p")), (name) => host.doc(name));
    expect(index.referrers("door")).toEqual([
      { id: "l1", kind: "level", pointer: "/instances/@a/prefab" },
    ]);

    expect(a.undo()?.docs).toEqual(r.docs);
    expect(readProject(host.doc("project:p")).assets.gate!.id).toBe("gate");
    expect(prefabHeaderMap(host.doc("asset:p.gate")).get("id")).toBe("gate");
    expect(docToScene(host.doc("scene:p.yard")).instances![0]!.prefab).toBe("gate");
    a.destroy();
  });

  it("rewrites binary referrers and docs that name a scene", async () => {
    const { host, join } = world();
    const a = await join(ada);
    await applied(a, [
      { op: "changeAssetId", id: "tiles", to: "tileset" },
      { op: "changeAssetId", id: "yard", to: "court" },
    ]);
    const state = readProject(host.doc("project:p"));
    expect(state.assets.sheet!.import).toEqual({ texture: "tileset" });
    expect(state.assets.yard!.id).toBe("court");
    expect(layoutFromDoc(host.doc("asset:p.walk"), INPUT_SCRIPT_LAYOUT)).toMatchObject({
      scene: "court",
    });
    a.destroy();
  });

  it("fails as a whole, writing nothing, when one referrer can't take the new id", async () => {
    const take = entry("take", "recording", "levels/take.recording.json", {
      sha256: H("c"),
      bytes: 4,
      meta: { scene: "yard", ticks: 1, sceneHash: "0".repeat(16) },
    });
    const { host, join } = world([take]);
    const a = await join(ada);
    const before = Y.encodeStateVector(host.doc("asset:p.walk"));
    const r = await applyProjectBatch(
      a,
      { v: 1, ops: [{ op: "changeAssetId", id: "yard", to: "court" }] } satisfies ProjectOpBatch,
      ada,
    );
    expect(r.ok || [r.opIndex, r.issue.code, r.issue.entityIds]).toEqual([
      0,
      "asset-kind",
      ["take"],
    ]);
    expect(readProject(host.doc("project:p")).assets.yard!.id).toBe("yard");
    expect(Y.encodeStateVector(host.doc("asset:p.walk"))).toEqual(before);
    expect(readProjectLog(host.doc("project:p"))).toEqual([]);
    expect(a.canUndo()).toBe(false);
    a.destroy();
  });

  it("refuses a delete while a doc names the asset, and trashes it with force", async () => {
    const { host, join } = world();
    const a = await join(ada);
    const r = await applyProjectBatch(a, { v: 1, ops: [{ op: "deleteAsset", id: "gate" }] }, ada);
    expect(r.ok || r.issue.detail).toEqual({
      referrers: [
        { id: "l1", pointer: "/instances/@a/prefab" },
        { id: "yard", pointer: "/instances/@g1/prefab" },
      ],
    });
    const forced = await applied(a, [{ op: "deleteAsset", id: "gate", force: true }]);
    expect(forced.issues.map((i) => [i.code, i.entityIds])).toEqual([
      ["asset-missing", ["l1"]],
      ["asset-missing", ["yard"]],
    ]);
    expect(readProject(host.doc("project:p")).assets.gate!.deleted).toBeDefined();
    a.destroy();
  });
});

describe("changeAssetId with prefab referrers", () => {
  const surfaces = createRegistry(
    defineGame({
      id: "surfaces",
      types: [],
      materials: {},
      settings: {},
      actions: [],
      createRuntime: () => ({ snapshot: () => null }),
    }),
    {
      materials: { rubber: { description: "Bouncy.", physics: { friction: 1, restitution: 0.9 } } },
    },
  );
  const ramp: Prefab = {
    kind: "prefab",
    v: 2,
    game: "surfaces",
    id: "ramp",
    entities: [{ id: "slope", type: "solid", shape: ["box", 0, 0, 10, 10], material: "rubber" }],
  };

  async function world(prefabWriter?: PrefabWriter) {
    const host = memoryDocHost();
    seedProjectDoc(
      host.doc("project:p"),
      {
        ...seedState,
        assets: {
          ramp: entry("ramp", "prefab", "prefabs/ramp.json"),
          rubber: entry("rubber", "material", "materials/rubber.json"),
        },
      },
      { kind: "migration" },
    );
    prefabToDoc(ramp, { doc: host.doc("asset:p.ramp"), key: sequentialKeys("pf") });
    const s = await createProjectSession({
      project: "p",
      openDoc: host.client().openDoc,
      origin: ada,
      registry: surfaces,
      kinds,
      ...(prefabWriter ? { prefabWriter } : {}),
    });
    return { host, s };
  }

  it("plans each prefab's rewrite with the prefab writer and writes it in the batch", async () => {
    const asked: unknown[] = [];
    const wrote: unknown[] = [];
    const { host, s } = await world({
      async plan({ op, index, entry }) {
        asked.push({ op, index, id: entry.id });
        return {
          ok: true,
          docs: ["asset:p.ramp"],
          write: (origin) => {
            wrote.push(origin);
            return [{ doc: "asset:p.ramp", entry: "planned" }];
          },
        };
      },
    });
    const r = await applied(s, [{ op: "changeAssetId", id: "rubber", to: "bouncy" }]);
    expect(asked).toEqual([
      {
        op: {
          op: "editScene",
          id: "ramp",
          ops: [{ op: "update", ref: "slope", set: { material: "bouncy" } }],
        },
        index: 0,
        id: "ramp",
      },
    ]);
    expect(wrote).toEqual([ada]);
    expect(r.docs).toEqual(["asset:p.ramp", "project:p"]);
    expect(readProject(host.doc("project:p")).assets.rubber!.id).toBe("bouncy");
    s.destroy();
  });

  it("moves a scene's bulk entries to the material's new key and rewrites its fields, nothing left dangling", async () => {
    const host = memoryDocHost();
    const yard: SceneDefinition = {
      v: 2,
      game: "surfaces",
      name: "yard",
      bounds: [0, 0, 1000, 1000],
      entities: [
        { id: "ledge", type: "solid", shape: ["box", 500, 500, 50, 10], material: "rubber" },
      ],
      "solid:rubber": [
        ["box", 100, 900, 50, 10],
        ["box", 300, 900, 50, 10],
      ],
    };
    const state: ProjectState = {
      ...seedState,
      assets: {
        yard: entry("yard", "scene", "levels/yard.json"),
        rubber: entry("rubber", "material", "materials/rubber.json"),
      },
    };
    seedProjectDoc(host.doc("project:p"), state, { kind: "migration" });
    sceneToDoc(yard, { doc: host.doc("scene:p.yard"), key: sequentialKeys("srv") });
    const s = await createProjectSession({
      project: "p",
      openDoc: host.client().openDoc,
      origin: ada,
      registry: surfaces,
      kinds,
    });

    const before = await applyProjectBatch(
      s,
      { v: 1, ops: [{ op: "deleteAsset", id: "rubber" }] },
      ada,
    );
    expect(before.ok || before.issue.detail).toEqual({
      referrers: [
        { id: "yard", pointer: "/entities/@ledge/material" },
        { id: "yard", pointer: "/solid:rubber" },
      ],
    });

    const r = await applied(s, [{ op: "changeAssetId", id: "rubber", to: "bouncy" }]);
    expect(r.docs).toEqual(["scene:p.yard", "project:p"]);
    const after = docToScene(host.doc("scene:p.yard"));
    expect(after["solid:bouncy"]).toEqual(yard["solid:rubber"]);
    expect(after["solid:rubber"]).toBeUndefined();
    expect(after.entities![0]!.material).toBe("bouncy");

    const moved = readProject(host.doc("project:p"));
    const view = projectView(moved, kinds);
    const renamed = createRegistry(surfaces.game, {
      materials: { bouncy: { description: "Bouncy.", physics: { friction: 1, restitution: 0.9 } } },
    });
    const index = buildRefIndex(view, new Map([["yard", after]]), kinds, {
      registry: renamed,
      project: view,
    });
    expect(index.dangling()).toEqual([]);
    expect(index.referrers("bouncy").map((ref) => ref.pointer)).toEqual([
      "/entities/@ledge/material",
      "/solid:bouncy",
    ]);
    expect(parseScene(after, renamed).ok).toBe(true);

    expect(s.undo()?.docs).toEqual(r.docs);
    expect(docToScene(host.doc("scene:p.yard"))["solid:rubber"]).toEqual(yard["solid:rubber"]);
    s.destroy();
  });

  it("fails the whole batch when the prefab writer refuses", async () => {
    const { host, s } = await world();
    const r = await applyProjectBatch(
      s,
      { v: 1, ops: [{ op: "changeAssetId", id: "rubber", to: "bouncy" }] },
      ada,
    );
    expect(r.ok || [r.issue.code, r.issue.entityIds]).toEqual(["op-invalid", ["ramp"]]);
    expect(readProject(host.doc("project:p")).assets.rubber!.id).toBe("rubber");
    expect(readProjectLog(host.doc("project:p"))).toEqual([]);
    s.destroy();
  });
});

// ─── Asset fields ────────────────────────────────────────

describe("references through asset fields", () => {
  const fieldEnv: FieldEnv = {
    materials: [],
    materialDefs: new Map(),
    types: [],
    assets: () => [],
  };
  const art = createRegistry(
    defineGame({
      id: "art",
      types: [
        {
          type: "sign",
          description: "A sign with a picture.",
          base: "marker",
          fields: (env) => ({
            at: pointField("Where it stands."),
            skin: assetField(env, "texture", "Its picture.").optional(),
          }),
        },
      ],
      settings: { backdrop: assetField(fieldEnv, "texture", "The backdrop.").optional() },
      tables: {
        card: { description: "Cards.", row: { art: assetField(fieldEnv, "texture", "Its art.") } },
      },
      projectSettings: { icon: assetField(fieldEnv, "texture", "The game's icon.").optional() },
      actions: [],
      createRuntime: () => ({ snapshot: () => null }),
    }),
  );
  const PAINTS = ["paint", "wall"] as const;
  const TABLE_LAYOUT = dataTableKind.layout as DocLayout;
  const SETTINGS_LAYOUT = gameSettingsKind.layout as DocLayout;
  const sign = (id: string, skin: string) => ({ id, type: "sign", at: [10, 10], skin });
  const court: SceneDefinition = {
    v: 2,
    game: "art",
    name: "court",
    bounds: [0, 0, 1000, 1000],
    settings: { backdrop: "paint" },
    assets: ["paint", "wall"],
    entities: [sign("s0", "paint")],
  };
  const deck = { kind: "data-table", v: 1, table: "card", rows: [{ id: "fire", art: "paint" }] };
  const settings = { kind: "game-settings", v: 1, engine: {}, game: { icon: "paint" } };
  const state: ProjectState = {
    meta: { projectId: "p", layout: 1, name: "P" },
    assets: Object.fromEntries(
      [
        entry("court", "scene", "levels/court.json"),
        entry("deck", "data-table", "data/deck.json"),
        entry("settings", "game-settings", "settings.json"),
        ...PAINTS.map((id) => entry(id, "texture", `art/${id}.png`, { sha256: H("a"), bytes: 4 })),
        entry("boom", "audio", "sfx/boom.wav", { sha256: H("b"), bytes: 4 }),
      ].map((e) => [e.key, e]),
    ),
    history: {},
    code: {},
    build: {},
  };

  function seed(doc: (name: string) => Y.Doc): void {
    seedProjectDoc(doc("project:p"), state, { kind: "migration" });
    sceneToDoc(court, { doc: doc("scene:p.court"), key: sequentialKeys("srv") });
    layoutToDoc(doc("asset:p.deck"), TABLE_LAYOUT, deck, { kind: "migration" });
    layoutToDoc(doc("asset:p.settings"), SETTINGS_LAYOUT, settings, { kind: "migration" });
  }

  /** Every live referrer's value, as a client or the one writer holds it. */
  function values(at: ProjectState, doc: (name: string) => Y.Doc): Map<AssetId, unknown> {
    const out = new Map<AssetId, unknown>();
    for (const e of Object.values(at.assets)) {
      if (e.deleted) continue;
      if (e.kind === "scene") out.set(e.id, docToScene(doc(`scene:p.${e.key}`)));
      if (e.kind === "data-table")
        out.set(e.id, layoutFromDoc(doc(`asset:p.${e.key}`), TABLE_LAYOUT));
      if (e.kind === "game-settings")
        out.set(e.id, layoutFromDoc(doc(`asset:p.${e.key}`), SETTINGS_LAYOUT));
    }
    return out;
  }

  function indexOf(at: ProjectState, doc: (name: string) => Y.Doc) {
    const view = projectView(at, kinds);
    return buildRefIndex(view, values(at, doc), kinds, { registry: art, project: view });
  }

  it(
    "a rename or move during concurrent edits of a scene using the asset leaves nothing dangling",
    { timeout: 30_000 },
    async () => {
      let partitions = 0;
      for (const seedNo of [1, 2, 3, 4]) {
        const initial: Record<string, Y.Doc> = {};
        seed((name) => {
          const doc = (initial[name] ??= new Y.Doc());
          doc.clientID = 1;
          return doc;
        });
        const sim = new SimProject(4, rng(seedNo), initial);
        const join = (i: number, origin: DocOrigin) =>
          createProjectSession({
            project: "p",
            openDoc: sim.openDoc(i),
            origin,
            registry: art,
            kinds,
          });
        const [mover, b, c] = await Promise.all([join(0, ada), join(1, bo), join(2, cy)]);
        for (const s of [b, c])
          for (const name of ["scene:p.court", "asset:p.deck", "asset:p.settings"])
            await s.open(name);
        const pick = <T>(list: readonly T[]) => list[Math.floor(sim.rand() * list.length)]!;
        let signs = 1;
        for (let step = 0; step < 16; step++) {
          const moving = pick(PAINTS);
          const at = mover.view().byId.get(moving)!;
          const name = at.path.slice(at.path.lastIndexOf("/") + 1);
          await applied(
            mover,
            sim.rand() < 0.5
              ? [{ op: "moveAsset", ids: [moving], to: `moved-${step}/` }]
              : [{ op: "renameAsset", id: moving, file: `s${step}-${name}` }],
          );
          for (const [i, s] of [b, c].entries()) {
            const ops =
              sim.rand() < 0.5
                ? [{ op: "add" as const, entity: sign(`c${i}-${step}`, pick(PAINTS)) }]
                : [{ op: "update" as const, ref: "s0", set: { skin: pick(PAINTS) } }];
            if (ops[0]!.op === "add") signs++;
            await applied(s, [{ op: "editScene", id: "court", ops }]);
          }
          sim.deliver(Math.floor(sim.rand() * 3));
          sim.weather(0.15, 0.2);
        }
        sim.settle();

        const states = [mover, b, c].map((s) => readProject(s.projectDoc));
        expect(states[1], `seed ${seedNo}`).toEqual(states[0]);
        expect(states[2], `seed ${seedNo}`).toEqual(states[0]);
        for (const s of [b, c]) {
          const index = indexOf(readProject(s.projectDoc), sessionDoc(s));
          expect(index.dangling(), `seed ${seedNo}`).toEqual([]);
          const skins = PAINTS.flatMap((id) =>
            index.referrers(id).filter((r) => r.id === "court" && r.pointer.endsWith("/skin")),
          );
          expect(skins, `seed ${seedNo}: every sign still names a live texture`).toHaveLength(
            signs,
          );
        }
        partitions += sim.partitions;
        for (const s of [mover, b, c]) s.destroy();
      }
      expect(partitions, "the runs must cut clients off").toBeGreaterThan(3);
    },
  );

  async function world() {
    const host = memoryDocHost();
    seed((name) => host.doc(name));
    const s = await createProjectSession({
      project: "p",
      openDoc: host.client().openDoc,
      origin: ada,
      registry: art,
      kinds,
    });
    return { host, s };
  }

  it("changeAssetId of a texture rewrites settings, the header, fields and rows in one batch", async () => {
    const { host, s } = await world();
    const r = await applied(s, [{ op: "changeAssetId", id: "paint", to: "pigment" }], "Rename");
    expect(r.docs).toEqual(["scene:p.court", "asset:p.deck", "asset:p.settings", "project:p"]);
    const after = docToScene(host.doc("scene:p.court"));
    expect(after.settings).toEqual({ backdrop: "pigment" });
    expect(after.assets).toEqual(["pigment", "wall"]);
    expect(after.entities![0]!.skin).toBe("pigment");
    expect(layoutFromDoc(host.doc("asset:p.deck"), TABLE_LAYOUT)).toMatchObject({
      rows: [{ id: "fire", art: "pigment" }],
    });
    expect(layoutFromDoc(host.doc("asset:p.settings"), SETTINGS_LAYOUT)).toMatchObject({
      game: { icon: "pigment" },
    });
    const index = indexOf(readProject(host.doc("project:p")), (name) => host.doc(name));
    expect(index.dangling()).toEqual([]);
    expect(index.referrers("paint")).toEqual([]);

    expect(s.undo()?.docs).toEqual(r.docs);
    expect(docToScene(host.doc("scene:p.court")).settings).toEqual({ backdrop: "paint" });
    s.destroy();
  });

  it("refuses to delete a texture in use, and a forced delete leaves referrers parsing with asset-missing", async () => {
    const { host, s } = await world();
    const refused = await applyProjectBatch(
      s,
      { v: 1, ops: [{ op: "deleteAsset", id: "paint" }] },
      ada,
    );
    expect(refused.ok || [refused.issue.code, refused.issue.detail]).toEqual([
      "asset-in-use",
      {
        referrers: [
          { id: "court", pointer: "/assets/0" },
          { id: "court", pointer: "/entities/@s0/skin" },
          { id: "court", pointer: "/settings/backdrop" },
          { id: "deck", pointer: "/rows/@fire/art" },
          { id: "settings", pointer: "/game/icon" },
        ],
      },
    ]);

    const forced = await applied(s, [{ op: "deleteAsset", id: "paint", force: true }]);
    expect(forced.issues.map((i) => [i.code, i.entityIds, i.path])).toEqual([
      ["asset-missing", ["court"], "/assets/0"],
      ["asset-missing", ["court"], "/entities/@s0/skin"],
      ["asset-missing", ["court"], "/settings/backdrop"],
      ["asset-missing", ["deck"], "/rows/@fire/art"],
      ["asset-missing", ["settings"], "/game/icon"],
    ]);
    const at = readProject(host.doc("project:p"));
    expect(at.assets.paint!.deleted).toBeDefined();
    const doc = (name: string) => host.doc(name);
    const env = { registry: art, project: projectView(at, kinds) };
    const scene = docToScene(doc("scene:p.court"));
    expect(parseScene(scene, art).ok).toBe(true);
    for (const [kind, name, layout] of [
      [dataTableKind, "asset:p.deck", TABLE_LAYOUT],
      [gameSettingsKind, "asset:p.settings", SETTINGS_LAYOUT],
    ] as const)
      expect(parseAssetDoc(kind as DocKindDef, layoutFromDoc(doc(name), layout), env).ok).toBe(
        true,
      );
    const dangling = indexOf(at, doc).dangling();
    expect(dangling.map((i) => i.code)).toEqual(Array(5).fill("asset-missing"));
    expect(dangling[0]!.message).toContain("in the trash");
    s.destroy();
  });
});

// ─── A scene list's references ───────────────────────────

describe("a scene list's references", () => {
  const LIST_LAYOUT = sceneListKind.layout as DocLayout;
  const SCENES = ["yard", "ford", "cellar", "result"] as const;
  const listState: ProjectState = {
    meta: { projectId: "p", layout: 1, name: "P" },
    assets: Object.fromEntries(
      [
        ...SCENES.map((id) => entry(id, "scene", `levels/${id}.json`)),
        entry("list", "scene-list", "scene-list.json"),
      ].map((e) => [e.key, e]),
    ),
    history: {},
    code: {},
    build: {},
  };
  const startList: SceneListFile = {
    kind: "scene-list",
    v: 1,
    start: "yard",
    scenes: [
      { scene: "yard", title: "Yard" },
      { scene: "cellar", sublevel: true },
      { scene: "result" },
    ],
  };
  const sceneDef = (name: string): SceneDefinition => ({
    v: SCENE_FORMAT_VERSION,
    name,
    bounds: [0, 0, 10, 10],
    entities: [],
  });

  function seedList(doc: (name: string) => Y.Doc): void {
    seedProjectDoc(doc("project:p"), listState, { kind: "migration" });
    for (const id of SCENES)
      sceneToDoc(sceneDef(id), { doc: doc(`scene:p.${id}`), key: sequentialKeys("srv") });
    layoutToDoc(doc("asset:p.list"), LIST_LAYOUT, startList, { kind: "migration" });
  }

  const listOf = (doc: (name: string) => Y.Doc) =>
    layoutFromDoc(doc("asset:p.list"), LIST_LAYOUT) as SceneListFile;
  const listed = (doc: (name: string) => Y.Doc) => listOf(doc).scenes.map((e) => e.scene);

  function listRefs(state: ProjectState, doc: (name: string) => Y.Doc) {
    const view = projectView(state, kinds);
    const values = new Map<AssetId, unknown>();
    for (const e of Object.values(state.assets))
      if (!e.deleted && e.kind === "scene-list") values.set(e.id, listOf(doc));
    return { view, index: buildRefIndex(view, values, kinds, { registry, project: view }) };
  }

  function simList(clients: number, seed: number) {
    const initial: Record<string, Y.Doc> = {};
    seedList((name) => {
      const doc = (initial[name] ??= new Y.Doc());
      doc.clientID = 1;
      return doc;
    });
    const sim = new SimProject(clients + 1, rng(seed), initial);
    return {
      sim,
      join: (i: number, origin: DocOrigin) =>
        createProjectSession({ project: "p", openDoc: sim.openDoc(i), origin, registry, kinds }),
      server: (name: string) => sim.doc(name, clients),
    };
  }

  it(
    "renaming a listed scene during a concurrent reorder keeps the entry",
    { timeout: 30_000 },
    async () => {
      let partitions = 0;
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const { sim, join } = simList(2, seed);
        const [mover, sorter] = await Promise.all([join(0, ada), join(1, bo)]);
        for (const s of [mover, sorter]) await s.open("asset:p.list");
        const ids: Record<string, string> = { yard: "yard", cellar: "cellar", result: "result" };
        let reorders = 0;
        for (let step = 0; step < 12; step++) {
          const scene = (["yard", "cellar", "result"] as const)[step % 3]!;
          const id = ids[scene]!;
          const at = mover.view().byId.get(id)!;
          const roll = sim.rand();
          if (roll < 0.4) {
            ids[scene] = `${scene}-${step}`;
            await applied(mover, [{ op: "changeAssetId", id, to: ids[scene]! }]);
          } else if (roll < 0.7)
            await applied(mover, [
              {
                op: "renameAsset",
                id,
                file: `s${step}-${at.path.slice(at.path.lastIndexOf("/") + 1)}`,
              },
            ]);
          else await applied(mover, [{ op: "moveAsset", ids: [id], to: `moved-${step}/` }]);

          // A copy holding updates that wait on earlier ones reads a half-applied change; a person sorting waits it out.
          const held = sessionDoc(sorter)("asset:p.list").store;
          if (held.pendingStructs === null && held.pendingDs === null) {
            const current = listOf(sessionDoc(sorter)).scenes;
            const reordered = [...current].sort(() => sim.rand() - 0.5);
            await applied(sorter, [
              { op: "editAsset", id: "list", edits: [{ set: "/scenes", value: reordered }] },
            ]);
            reorders++;
          }
          sim.deliver(Math.floor(sim.rand() * 3));
          sim.weather(0.2, 0.2);
        }
        sim.settle();

        const states = [mover, sorter].map((s) => readProject(s.projectDoc));
        expect(states[1], `seed ${seed}`).toEqual(states[0]);
        for (const s of [mover, sorter]) {
          const doc = sessionDoc(s);
          expect(listed(doc).sort(), `seed ${seed}: every entry kept`).toEqual(
            Object.values(ids).sort(),
          );
          expect(listOf(doc).start).toBe(ids.yard);
          const kept = listOf(doc).scenes;
          expect(kept.find((e) => e.scene === ids.yard)).toEqual({
            scene: ids.yard,
            title: "Yard",
          });
          expect(kept.find((e) => e.scene === ids.cellar)).toEqual({
            scene: ids.cellar,
            sublevel: true,
          });
          const { index } = listRefs(readProject(s.projectDoc), doc);
          expect(index.dangling(), `seed ${seed}`).toEqual([]);
          expect(index.referrers(ids.yard!).map((r) => r.pointer)).toEqual(
            expect.arrayContaining(["/start"]),
          );
        }
        expect(listOf(sessionDoc(sorter))).toEqual(listOf(sessionDoc(mover)));
        expect(reorders, `seed ${seed}: the sorter reorders`).toBeGreaterThan(6);
        partitions += sim.partitions;
        for (const s of [mover, sorter]) s.destroy();
      }
      expect(partitions, "the runs must cut clients off").toBeGreaterThan(3);
    },
  );

  it("changeAssetId of the start scene rewrites start and the entry in one batch", async () => {
    const host = memoryDocHost();
    seedList((name) => host.doc(name));
    const a = await createProjectSession({
      project: "p",
      openDoc: host.client().openDoc,
      origin: ada,
      registry,
      kinds,
    });
    const doc = (name: string) => host.doc(name);
    const r = await applied(a, [{ op: "changeAssetId", id: "yard", to: "court" }], "Rename yard");
    expect(r.docs).toContain("asset:p.list");
    expect(r.docs.at(-1)).toBe("project:p");
    expect(listOf(doc)).toEqual({
      ...startList,
      start: "court",
      scenes: [{ scene: "court", title: "Yard" }, ...startList.scenes.slice(1)],
    });
    const logged = readLog(host.doc("asset:p.list"));
    expect(logged, "one history entry on the list for both sites").toHaveLength(1);
    expect(logged[0]).toMatchObject({ label: "Rename yard", actor: ada });
    expect(readProjectLog(host.doc("project:p"))).toHaveLength(1);
    expect(r.entry?.docs.map((d) => d.doc)).toEqual(r.docs);
    const { index } = listRefs(readProject(host.doc("project:p")), doc);
    expect(index.dangling()).toEqual([]);
    expect(index.referrers("court").map((ref) => ref.pointer)).toEqual([
      "/scenes/0/scene",
      "/start",
    ]);

    expect(a.undo()?.docs).toEqual(r.docs);
    expect(listOf(doc)).toEqual(startList);
    expect(readProject(host.doc("project:p")).assets.yard!.id).toBe("yard");
    a.destroy();
  });

  it(
    "deleting a listed scene while another client adds it to the list ends asset-in-use",
    { timeout: 30_000 },
    async () => {
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const { sim, join, server } = simList(2, seed);
        const [a, b] = await Promise.all([join(0, ada), join(1, bo)]);
        for (const s of [a, b]) await s.open("asset:p.list");

        if (seed % 2 === 1) sim.partition([seed % 3]);
        await applied(a, [{ op: "deleteAsset", id: "ford" }]);
        await applied(b, [
          {
            op: "editAsset",
            id: "list",
            edits: [{ insert: "/scenes/-", value: { scene: "ford", title: "Ford" } }],
          },
        ]);
        for (let step = 0; step < 4; step++) sim.weather(0.2, 0.2);
        sim.settle();
        const raced = listRefs(readProject(b.projectDoc), sessionDoc(b));
        expect(raced.view.byId.has("ford")).toBe(false);
        expect(raced.index.dangling().map((i) => [i.code, i.got, i.entityIds])).toEqual([
          ["asset-missing", "ford", ["list"]],
        ]);

        const stored = listRefs(readProject(server("project:p")), server);
        const restore = referencedTrash(stored.view, stored.index);
        expect(restore).toEqual(["ford"]);
        const repair = { kind: "repair", reason: "asset-in-use" } as const;
        expect(
          applyRepairs(server("project:p"), { restore, origin: repair, now: 5 }).restored,
        ).toEqual(["ford"]);
        sim.settle();

        for (const s of [a, b]) {
          expect(readProject(s.projectDoc).assets.ford!.deleted).toBeUndefined();
          const log = readProjectLog(s.projectDoc).at(-1)!;
          expect([log.actor, log.label]).toEqual([repair, "Restore ford"]);
          expect(listed(sessionDoc(s))).toEqual(["yard", "cellar", "result", "ford"]);
        }
        expect(listRefs(readProject(b.projectDoc), sessionDoc(b)).index.dangling()).toEqual([]);

        const again = await applyProjectBatch(
          a,
          { v: 1, ops: [{ op: "deleteAsset", id: "ford" }] },
          ada,
        );
        expect(again.ok || [again.issue.code, again.issue.detail]).toEqual([
          "asset-in-use",
          { referrers: [{ id: "list", pointer: "/scenes/3/scene" }] },
        ]);
        for (const s of [a, b]) s.destroy();
      }
    },
  );
});
