// @vitest-environment node
import { readFileSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import * as Y from "yjs";

import { resolveClips } from "../anim/clips";
import { cameraRegionsOf, regionFor } from "../camera/regions";
import { docToScene, sceneToDoc } from "../collab/convert";
import { docToPrefab, prefabToDoc } from "../collab/prefab-doc";
import type { AnimBlock } from "../game/behaviors/anim";
import type { EmitterBlock } from "../game/behaviors/emitter";
import { LIFETIME, type LifetimeBlock } from "../game/behaviors/lifetime";
import { OCCUPANT } from "../game/behaviors/occupant";
import type { SpawnerBlock, SpawnerSystem } from "../game/behaviors/spawner";
import { SPRITE, type SpriteBlock } from "../game/behaviors/sprite";
import { tweenChannels, tweenTargetProblem, type TweenBlock } from "../game/behaviors/tween";
import { createRegistry, defineGame, ENGINE_BEHAVIORS, withProject } from "../game/define";
import { parseSaveFile } from "../game/save-file";
import { PRIMITIVE_TYPES, type GameDefinition, type Registry } from "../game/types";
import { pxPerMetreOf } from "../game/units";
import { loadHeadless } from "../headless/load";
import { runPlaytest } from "../headless/playtest";
import type { PlaytestReport } from "../headless/playtest-types";
import { recordingDivergence, replayRecording } from "../headless/recording";
import { runChecks } from "../headless/run-checks";
import { validatePhysical } from "../headless/validate-physical";
import { assetInfo } from "../project/asset-info";
import { sceneBundle } from "../project/bundle";
import { memoryContentStore } from "../project/content-store";
import {
  docKindJsonSchema,
  formatAssetDoc,
  parseAssetDoc,
  type DocKindDef,
} from "../project/kinds";
import {
  ANIMATION_KIND,
  animationIssues,
  animationKind,
  type AnimationFile,
} from "../project/kinds/animation";
import { ATLAS_KIND } from "../project/kinds/atlas";
import { DATA_TABLE_KIND } from "../project/kinds/data-table";
import {
  EMITTER_KIND,
  emitterIssues,
  emitterKind,
  type EmitterFile,
} from "../project/kinds/emitter";
import { GAME_SETTINGS_KIND } from "../project/kinds/game-settings";
import { INPUT_MAP_KIND } from "../project/kinds/input-map";
import { inputScriptKind } from "../project/kinds/input-script";
import { MATERIAL_KIND } from "../project/kinds/material";
import { SAVE_KIND } from "../project/kinds/save";
import { SCENE_LIST_KIND, type SceneListEntry } from "../project/kinds/scene-list";
import { TEXTURE_KIND } from "../project/kinds/texture";
import { runtimeView } from "../project/runtime-view";
import { snapshotProject } from "../project/snapshot";
import type { AssetEntry, AssetId, ProjectView } from "../project/types";
import { projectView } from "../project/view";
import { ANIM_FRAME } from "../runtime/behaviors/anim";
import { createSceneRuntime } from "../runtime/runtime";
import { ENTITY_DESTROYED, SENSOR_ENTER, SPAWNER_SPAWNED, type StepEvent } from "../runtime/types";
import { parseChecks, type ChecksFile, type ReachesCheck } from "../scene/checks";
import { expandScene } from "../scene/expand";
import { formatPrefab, formatScene } from "../scene/format";
import { parseInputScript, scriptSeatLimit, UI_ACTION_HINT } from "../scene/input-script";
import { parseScene } from "../scene/parse";
import { prefabsUsedBy } from "../scene/prefab";
import { paramTargetValues } from "../scene/prefab-params";
import { drawnEntities, oneWayEdge } from "../scene/render-geometry";
import { resolvePrefab, valueAtPath } from "../scene/resolve";
import { SHAPE_TYPES } from "../scene/shapes";
import type { PrefabLibrary, Pt, RuntimeEntity, SceneDefinition, ShapeObj } from "../scene/types";
import { sublevelIssue, validateScene } from "../scene/validate";
import type { SolidSystem } from "../systems/bodies";
import type { RapierModule } from "../types";
import {
  createProjectFileAdapter,
  readFileProject,
  readPrefabFiles,
  type FileProject,
  type ProjectFileAdapter,
  type ProjectScan,
} from "../vite/project-files";
import {
  AVATAR_SPEED,
  CARD_TABLE,
  CEILING,
  MENU_ACTION,
  testGame,
  uiTestGame,
} from "./fixtures/test-game";

const scenesDir = new URL("../scenes/", import.meta.url);
const scenesPath = fileURLToPath(scenesDir);
const text = readFileSync(new URL("kitchen-sink.json", scenesDir), "utf8");
const checksText = readFileSync(new URL("kitchen-sink.checks.json", scenesDir), "utf8");

type Body = [id: string, x: number, y: number, rot: number];
const MOVING = [
  "ball",
  "crate",
  "shelf-box",
  "carrier",
  "deck",
  "deck-zone",
  "orbit",
  "room-1/door-1/panel",
  "rider",
  "door-2/panel",
  "upright",
];

/** A game with no actor whose snapshot is every moving body's pose, so a replay's digest covers the world. */
const watcher = defineGame<Body[]>({
  id: "watcher",
  types: [],
  actions: [],
  collisionGroups: { dynamic: { collidesWith: ["sensor"] } },
  createRuntime(ctx) {
    return {
      snapshot: () =>
        MOVING.map((id): Body => {
          const [handle] = ctx.tags.handlesOf(id);
          const c = handle === undefined ? null : ctx.physics!.world.getCollider(handle);
          const p = c?.translation() ?? { x: NaN, y: NaN };
          return [id, p.x, p.y, c?.rotation() ?? NaN];
        }),
    };
  },
});

let rapier: RapierModule;
let def: SceneDefinition;
let prefabs: PrefabLibrary;
let prefabTexts: Map<string, string>;
let checks: ChecksFile;
let cacheDir: string;
let project: FileProject;
let adapter: ProjectFileAdapter;
let scan: ProjectScan;
let view: ProjectView;
/** Every doc asset's JSON by id, as its file holds it. */
let values: Map<AssetId, unknown>;
/** The engine's and the test game's registries with the project's material assets overlaid. */
let engine: Registry;
let game: Registry;
/** The test game with a UI-only action and a type-wide one-way type, overlaid the same way. */
let uiGame: Registry;
const overlaid = (g: GameDefinition | null) => withProject(createRegistry(g), view, values);

beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
  cacheDir = await mkdtemp(join(tmpdir(), "kitchen-sink-"));
  project = await readFileProject(scenesPath, { cacheDir });
  const bare = await createProjectFileAdapter(project).scan();
  view = projectView(bare.state, project.kinds);
  values = new Map();
  for (const entry of docEntries())
    values.set(entry.id, JSON.parse(await readFile(join(scenesPath, entry.path), "utf8")));
  engine = overlaid(null);
  game = overlaid(testGame);
  uiGame = overlaid(uiTestGame);
  adapter = createProjectFileAdapter({ ...project, registry: engine });
  scan = await adapter.scan();
  view = projectView(scan.state, project.kinds);

  const parsed = parseScene(text, engine);
  if (!parsed.ok) throw new Error(parsed.issues.map((i) => i.message).join("\n"));
  def = parsed.def;
  const files = await readPrefabFiles(scenesPath, engine);
  expect(files.problems).toEqual([]);
  prefabs = files.prefabs;
  prefabTexts = files.texts;
  const parsedChecks = parseChecks(checksText, engine);
  if (!parsedChecks.ok) throw new Error(JSON.stringify(parsedChecks.issues));
  checks = parsedChecks.file;
});

afterAll(() => rm(cacheDir, { recursive: true, force: true }));

const entities = () => def.entities ?? [];
const expanded = (scene: SceneDefinition = def) => expandScene(scene, engine, { prefabs });
/** The world x of an expanded entity: its point, its shape's centre, or that centre at a path's first point. */
function centreX(e: RuntimeEntity): number {
  const at = e.at as Pt | undefined;
  if (at) return at[0];
  const cx = (e.shape as { cx: number }).cx;
  const path = e.path as { pts: Pt[] } | undefined;
  return (path?.pts[0]?.[0] ?? 0) + cx;
}
const entriesOf = (kind: string): AssetEntry[] =>
  [...view.byId.values()].filter((e) => e.kind === kind);
/** Every asset kept as text, not by content hash. */
const docEntries = (): AssetEntry[] =>
  [...view.byId.values()].filter((e) => e.sha256 === undefined);
/** Each entity carrying a sprite, with its block. */
const sprites = (): [RuntimeEntity, SpriteBlock][] =>
  expanded().entities.flatMap((e) => {
    const block = (e.behaviors as Record<string, unknown> | undefined)?.[SPRITE.name];
    return block ? [[e, block as SpriteBlock]] : [];
  });
/** The block named `name` on the scene's entity `id`. */
const blockOf = <T>(id: string, name: string): T =>
  (entities().find((e) => e.id === id)?.behaviors as Record<string, unknown> | undefined)?.[
    name
  ] as T;
const atlasTool = (id: string) => (view.byId.get(id)?.meta as { tool?: string } | undefined)?.tool;

/** A snapshot of the project, its doc texts in a memory store; blobs are pinned by hash, size and meta, their bytes left out. */
async function pinned() {
  const store = memoryContentStore();
  const texts = new Map<AssetId, string>();
  for (const entry of docEntries()) {
    const text = await readFile(join(scenesPath, entry.path), "utf8");
    texts.set(entry.id, text);
    await store.put(new TextEncoder().encode(text));
  }
  return { snapshot: await snapshotProject(view, texts, scan.state.build), store };
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(path)));
    else out.push(path);
  }
  return out;
}

describe("kitchen-sink.json", () => {
  describe("covers", () => {
    it("every engine primitive", () => {
      expect(new Set(entities().map((e) => e.type))).toEqual(new Set(PRIMITIVE_TYPES));
    });

    it("every engine behavior but occupant, which the grid-only grid-yard carries, each standard one on its own std- entity", () => {
      const carried = new Set(expanded().entities.flatMap((e) => Object.keys(e.behaviors ?? {})));
      const engineNames = ENGINE_BEHAVIORS.map((b) => b.name).filter((n) => n !== OCCUPANT.name);
      expect(carried).toEqual(new Set(engineNames));
      const grid = JSON.parse(readFileSync(new URL("grid-yard.json", scenesDir), "utf8")) as {
        entities?: { behaviors?: Record<string, unknown> }[];
      };
      expect(grid.entities?.some((e) => e.behaviors?.[OCCUPANT.name])).toBe(true);
      const standard: Record<string, string> = {
        collider: "std-collider",
        body: "std-body",
        "player-input": "std-player-input",
        "character-top-down": "std-top-down",
        "character-side-view": "std-side-view",
        "camera-target": "std-camera-target",
        spawner: "std-spawner",
        "nav-agent": "std-nav-agent",
        "path-follow": "std-path-follow",
        "force-area": "std-force-area",
        joint: "std-joint",
      };
      for (const [name, id] of Object.entries(standard)) {
        expect(engineNames, name).toContain(name);
        const e = entities().find((x) => x.id === id);
        expect(e?.behaviors, id).toHaveProperty([name]);
      }
    });

    it("every shape form in bulk, a rotated box among them", () => {
      const rows = def.solid as unknown[][];
      expect(new Set(rows.map((r) => r[0]))).toEqual(new Set(SHAPE_TYPES));
      expect(rows.some((r) => r[0] === "box" && typeof r[5] === "number" && r[5] !== 0)).toBe(true);
    });

    it("a node with three children", () => {
      const sizes = entities()
        .filter((e) => e.type === "node")
        .map((n) => entities().filter((e) => e.parent === n.id).length);
      expect(sizes.some((n) => n >= 3)).toBe(true);
    });

    it("two prefabs placed twice each, one instance overriding a child field", () => {
      for (const id of prefabsUsedBy(def, prefabs)) expect(prefabs.has(id), id).toBe(true);
      const twice = prefabsUsedBy(def).filter(
        (id) => def.instances!.filter((i) => i.prefab === id).length >= 2,
      );
      expect(twice.length).toBeGreaterThanOrEqual(2);
      expect(def.instances!.some((i) => Object.keys(i.overrides ?? {}).length > 0)).toBe(true);
    });

    it("a turned and flipped node whose children expand turned and flipped", () => {
      const node = entities().find((e) => e.type === "node" && e.rot !== undefined && e.flip);
      expect(node).toBeDefined();
      const children = entities().filter((e) => e.parent === node!.id);
      expect(children.length).toBeGreaterThanOrEqual(3);
      const byId = new Map(expanded().entities.map((e) => [e.id, e]));
      for (const c of children)
        expect(byId.get(c.id)?.transform ?? null, c.id).toEqual(
          c.type === "note" ? null : { rot: node!.rot, flip: true },
        );
    });

    it("a turned node with a child, which loads turned with it", () => {
      const node = entities().find(
        (e) =>
          e.type === "node" &&
          typeof e.rot === "number" &&
          e.rot !== 0 &&
          !e.flip &&
          entities().some((c) => c.parent === e.id && Array.isArray(c.at)),
      );
      expect(node).toBeDefined();
      const child = entities().find((e) => e.parent === node!.id && Array.isArray(e.at))!;
      const rt = createSceneRuntime({ rapier, view: null, game: null, registry: engine, prefabs });
      expect(rt.load(expanded()).ok).toBe(true);
      expect(rt.ctx.tree.parent(child.id)).toBe(node!.id);
      const n = rt.ctx.poses.get(node!.id)!;
      const c = rt.ctx.poses.get(child.id)!;
      const [lx, ly] = child.at as Pt;
      const turn = ((node!.rot as number) * Math.PI) / 180;
      expect(n.rot).toBeCloseTo(turn, 9);
      expect(c.x).toBeCloseTo(n.x + lx * Math.cos(turn) - ly * Math.sin(turn), 6);
      expect(c.y).toBeCloseTo(n.y + lx * Math.sin(turn) + ly * Math.cos(turn), 6);
      expect(c.rot).toBeCloseTo(turn, 9);
      rt.destroy();
    });

    it("a child of an instance's child, which goes where the instance goes", () => {
      const child = entities().find(
        (e) => typeof e.parent === "string" && e.parent.split("/").length === 2,
      );
      expect(child, "an entity whose parent is an instance's child").toBeDefined();
      const parent = child!.parent as string;
      const instance = parent.split("/")[0]!;
      expect(def.instances!.some((i) => i.id === instance)).toBe(true);
      const rt = createSceneRuntime({ rapier, view: null, game: null, registry: engine, prefabs });
      expect(rt.load(expanded()).ok).toBe(true);
      expect(rt.ctx.tree.parent(child!.id)).toBe(parent);
      expect(rt.ctx.tree.parent(parent)).toBe(instance);
      const offset = (id: string) => {
        const p = rt.ctx.poses.get(id)!;
        const i = rt.ctx.poses.get(instance)!;
        return [p.x - i.x, p.y - i.y];
      };
      const before = offset(child!.id);
      const at = rt.ctx.poses.get(instance)!;
      rt.ctx.setPose(instance, at.x + 1, at.y - 2, 0);
      rt.step(rt.ctx.time.tickMs, []);
      expect(offset(child!.id)[0]).toBeCloseTo(before[0]!, 6);
      expect(offset(child!.id)[1]).toBeCloseTo(before[1]!, 6);
      expect(rt.ctx.poses.get(child!.id)!.x).toBeCloseTo(at.x + 1 + before[0]!, 6);
      rt.destroy();
    });

    it("a flipped instance of an asymmetric prefab, its children mirrored about its x", () => {
      const flipped = def.instances!.find((i) => i.flip && i.rot === undefined)!;
      expect(flipped).toBeDefined();
      const { flip: _, ...unturned } = flipped;
      const plain: SceneDefinition = {
        ...def,
        instances: def.instances!.map((i) => (i === flipped ? unturned : i)),
      };
      const xs = (scene: SceneDefinition) =>
        new Map(
          expanded(scene)
            .entities.filter((e) => e.id.startsWith(`${flipped.id}/`))
            .map((e) => [e.id, centreX(e)]),
        );
      const mirrored = xs(def);
      const unflipped = xs(plain);
      expect(mirrored.size).toBeGreaterThanOrEqual(3);
      const ax = flipped.at[0];
      for (const [child, x] of mirrored) expect(x, child).toBe(2 * ax - unflipped.get(child)!);
      expect([...unflipped.values()].some((x) => x !== ax)).toBe(true);
      for (const e of expanded().entities.filter((e) => e.id.startsWith(`${flipped.id}/`)))
        expect(e.transform, e.id).toEqual({ rot: 0, flip: true });
    });

    it("a three-level prefab from the project's prefab assets, expanding to the doc's ids", () => {
      const assets = new Set(entriesOf("prefab").map((e) => e.id));
      const deep = def.instances!.filter((i) => {
        const r = resolvePrefab(i.prefab, prefabs, engine);
        return r.ok && r.prefab.children.some((c) => c.child.split("/").length >= 3);
      });
      expect(deep.length).toBeGreaterThanOrEqual(1);
      const fileIds = expanded().entities.map((e) => e.id);
      const fromDoc = docToScene(sceneToDoc(JSON.parse(text) as SceneDefinition));
      expect(expanded(fromDoc).entities.map((e) => e.id)).toEqual(fileIds);
      for (const inst of deep) {
        const r = resolvePrefab(inst.prefab, prefabs, engine);
        if (!r.ok) throw new Error(r.issue.message);
        for (const id of r.prefab.uses) expect(assets.has(id), id).toBe(true);
        const ids = r.prefab.children
          .filter((c) => c.kind === "entity")
          .map((c) => `${inst.id}/${c.child}`);
        expect(fileIds).toEqual(expect.arrayContaining(ids));
      }
    });

    it("a variant placed, its base's children with its overrides", () => {
      const variants = prefabsUsedBy(def).filter((id) => typeof prefabs.get(id)?.base === "string");
      expect(variants.length).toBeGreaterThanOrEqual(1);
      for (const id of variants) {
        const variant = prefabs.get(id)!;
        expect(Object.keys(variant.overrides ?? {}).length, id).toBeGreaterThan(0);
        const r = resolvePrefab(id, prefabs, engine);
        const base = resolvePrefab(variant.base!, prefabs, engine);
        if (!r.ok || !base.ok) throw new Error(`${id} doesn't resolve`);
        expect(r.prefab.children.map((c) => c.child)).toEqual(
          expect.arrayContaining(base.prefab.children.map((c) => c.child)),
        );
        expect(r.prefab.uses).toContain(variant.base);
      }
    });

    it("an instance setting params its prefab exposes, which reach the targets", () => {
      const withParams = def.instances!.filter((i) => Object.keys(i.params ?? {}).length > 0);
      expect(withParams.length).toBeGreaterThanOrEqual(1);
      const byId = new Map(expanded().entities.map((e) => [e.id, e]));
      for (const inst of withParams) {
        const r = resolvePrefab(inst.prefab, prefabs, engine);
        if (!r.ok) throw new Error(r.issue.message);
        for (const [name, value] of Object.entries(inst.params!)) {
          const param = r.prefab.params[name];
          expect(param, name).toBeDefined();
          for (const [target, want] of paramTargetValues(param!, value)) {
            const dot = target.indexOf(".");
            const child = byId.get(`${inst.id}/${target.slice(0, dot)}`);
            expect(valueAtPath(child, target.slice(dot + 1)), target).toEqual(want);
          }
        }
      }
    });

    it("a param with a value map, its mapped target taking the mapped value", () => {
      const byId = new Map(expanded().entities.map((e) => [e.id, e]));
      const mapped = def.instances!.flatMap((inst) => {
        const r = resolvePrefab(inst.prefab, prefabs, engine);
        if (!r.ok) return [];
        return Object.entries(inst.params ?? {}).flatMap(([name, value]) => {
          const param = r.prefab.params[name];
          return Object.keys(param?.map ?? {}).map((target) => ({
            inst,
            param: param!,
            value,
            target,
          }));
        });
      });
      expect(mapped.length).toBeGreaterThanOrEqual(1);
      for (const { inst, param, value, target } of mapped) {
        const want = param.map![target]![String(value)];
        expect(want, target).toBeDefined();
        expect(want, target).not.toEqual(value);
        const dot = target.indexOf(".");
        const child = byId.get(`${inst.id}/${target.slice(0, dot)}`);
        expect(valueAtPath(child, target.slice(dot + 1)), target).toEqual(want);
      }
    });

    it("a child ref: an entity under a follower inside a nested instance", () => {
      const byId = new Map(expanded().entities.map((e) => [e.id, e]));
      const refs = entities().filter(
        (e) => typeof e.parent === "string" && e.parent.split("/").length >= 3,
      );
      expect(refs.length).toBeGreaterThanOrEqual(1);
      for (const e of refs) {
        const target = e.parent as string;
        expect(target.split("/").length, target).toBeGreaterThanOrEqual(3);
        expect(byId.get(target)?.type, target).toBe("follower");
      }
    });

    it("z on entities, on instances and inside a prefab, summed down the levels", () => {
      expect(entities().some((e) => typeof e.z === "number" && e.z !== 0)).toBe(true);
      expect(def.instances!.some((i) => typeof i.z === "number" && i.z !== 0)).toBe(true);
      const nested = [...prefabs.values()].flatMap((p) => p.instances ?? []);
      expect(nested.some((i) => typeof i.z === "number" && i.z !== 0)).toBe(true);
      const zOf = new Map(expanded().entities.map((e) => [e.id, e.z ?? 0]));
      for (const inst of def.instances!.filter((i) => i.z !== undefined))
        for (const [id, z] of zOf) if (id.startsWith(`${inst.id}/`)) expect(z, id).toBe(inst.z);
    });

    it("an assets header naming live project assets", () => {
      expect(def.assets?.length ?? 0).toBeGreaterThanOrEqual(1);
      for (const id of def.assets!) expect(view.byId.has(id), id).toBe(true);
      expect(def.assets).toEqual([...new Set(def.assets)].sort());
    });

    it("a sprite cut from a TexturePacker atlas's frame", () => {
      const cut = sprites().filter(
        ([, b]) => b.frame !== undefined && atlasTool(b.asset!) === "texturepacker",
      );
      expect(cut.length).toBeGreaterThanOrEqual(1);
      for (const [e, b] of cut) {
        expect(view.byId.get(b.asset!)?.kind, e.id).toBe(ATLAS_KIND);
        expect(assetInfo(view, b.asset!, b.frame)?.rect, e.id).toBeDefined();
      }
    });

    it("a sprite cut from an Aseprite sheet's frame", () => {
      const cut = sprites().filter(
        ([, b]) => b.frame !== undefined && atlasTool(b.asset!) === "aseprite",
      );
      expect(cut.length).toBeGreaterThanOrEqual(1);
      for (const [e, b] of cut)
        expect(assetInfo(view, b.asset!, b.frame)?.rect, e.id).toBeDefined();
    });

    it("an entity with a lifetime block", () => {
      const timed = entities().filter(
        (e) => (e.behaviors as Record<string, unknown> | undefined)?.[LIFETIME.name],
      );
      expect(timed.map((e) => e.id)).toEqual(["spark"]);
      const block = (timed[0]!.behaviors as Record<string, LifetimeBlock>)[LIFETIME.name]!;
      expect(block.ticks).toBeGreaterThan(0);
      expect(block.then ?? "destroy").toBe("destroy");
    });

    it("a reaches check whose expect holds an exists and a count", () => {
      const withExpect = checks.checks.filter(
        (c): c is ReachesCheck => c.kind === "reaches" && c.expect !== undefined,
      );
      expect(withExpect.map((c) => c.id)).toEqual(["fades", "nav-step", "nav-check", "parented"]);
      expect(withExpect[0]!.expect).toEqual({
        exists: expect.any(String),
        count: expect.objectContaining({ type: "decor" }),
      });
    });

    it("a reaches check sending a nav agent with a script's nav step, and one with its own nav", () => {
      const reaches = checks.checks.filter((c): c is ReachesCheck => c.kind === "reaches");
      const step = reaches.find((c) => c.id === "nav-step")!;
      const steps = (step.script as { steps: Record<string, unknown>[] }).steps;
      expect(steps[0]).toEqual({ nav: { id: "std-nav-agent", to: [22.6, 3.5] } });
      const own = reaches.find((c) => c.id === "nav-check")!;
      expect(own.nav).toEqual([{ id: "std-nav-agent", to: [22.6, 3.5] }]);
      const agent = entities().find((e) => e.id === "std-nav-agent")!;
      expect(Object.keys(agent.behaviors ?? {})).toEqual(["nav-agent"]);
    });

    it("a sprite drawing a whole texture, on a decor", () => {
      const whole = sprites().filter(
        ([e, b]) => e.type === "decor" && view.byId.get(b.asset!)?.kind === TEXTURE_KIND,
      );
      expect(whole.length).toBeGreaterThanOrEqual(1);
      for (const [, b] of whole) expect(b.frame).toBeUndefined();
    });

    it("a sprite with its own tint and blend", () => {
      expect(
        sprites().some(
          ([, b]) => b.tint !== undefined && b.blend !== undefined && b.blend !== "normal",
        ),
      ).toBe(true);
    });

    it("a sprite on an entity whose material lends its render tint", () => {
      const tinted = sprites().filter(
        ([e, b]) =>
          b.tint === undefined &&
          typeof e.material === "string" &&
          engine.materials.get(e.material)?.tint !== undefined,
      );
      expect(tinted.length).toBeGreaterThanOrEqual(1);
      const material = values.get(tinted[0]![0].material as string) as {
        render?: { tint?: string };
      };
      expect(material.render?.tint).toMatch(/^#[0-9a-f]{6}$/);
    });

    it("a solid and a sensor under a follower", () => {
      const followers = new Set(
        entities()
          .filter((e) => e.type === "follower")
          .map((e) => e.id),
      );
      const attached = entities()
        .filter((e) => typeof e.parent === "string" && followers.has(e.parent))
        .map((e) => e.type);
      expect(attached).toEqual(expect.arrayContaining(["solid", "sensor"]));
    });

    it("a nav walk area with a block hole inside it", () => {
      const nav = entities().filter((e) => e.type === "nav");
      const bounds = (e: (typeof nav)[number]) => {
        const pts = (e.shape as unknown[]).slice(1) as number[];
        const xs = pts.filter((_, i) => i % 2 === 0);
        const ys = pts.filter((_, i) => i % 2 === 1);
        return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] as const;
      };
      const walks = nav.filter((e) => (e.mode ?? "walk") === "walk").map(bounds);
      const holes = nav.filter((e) => e.mode === "block").map(bounds);
      expect(walks.length).toBeGreaterThanOrEqual(1);
      expect(holes.length).toBeGreaterThanOrEqual(1);
      for (const [x0, y0, x1, y1] of holes)
        expect(walks.some(([a, b, c, d]) => x0 > a && y0 > b && x1 < c && y1 < d)).toBe(true);
    });

    it('a one-way solid open on its "left" side', () => {
      expect(entities().some((e) => e.type === "solid" && e.oneWay === "left")).toBe(true);
    });

    it("a prop with fixedRotation", () => {
      expect(entities().some((e) => e.type === "prop" && e.fixedRotation === true)).toBe(true);
    });

    it("an animation over the hero atlas with idle from its tag and a once clip raising an event over a hit shape set", () => {
      const block = blockOf<AnimBlock>("std-anim", "anim");
      expect(view.byId.get(block.source)?.kind).toBe(ANIMATION_KIND);
      const file = values.get(block.source) as AnimationFile;
      const atlas = assetInfo(view, file.atlas);
      expect(atlas?.kind).toBe(ATLAS_KIND);
      expect(animationIssues(file, atlas)).toEqual([]);
      const { clips, issues } = resolveClips({ animation: file }, atlas!, { rate: 60 });
      expect(issues).toEqual([]);
      const tagged = file.clips.find((c) => c.tag !== undefined)!;
      expect(atlas!.tags?.map((t) => t.name)).toContain(tagged.tag);
      expect(clips.get(tagged.name)?.frames.length).toBeGreaterThan(1);
      expect(block.clip).toBe(tagged.name);
      const once = [...clips.values()].filter((c) => c.loop === "once");
      expect(once.length).toBeGreaterThanOrEqual(1);
      expect(once.some((c) => c.frames.some((f) => f.events.length > 0))).toBe(true);
      expect(once.some((c) => c.frames.some((f) => (f.shapes.hit?.length ?? 0) > 0))).toBe(true);
      expect(blockOf<SpriteBlock>("std-anim", SPRITE.name).asset).toBe(file.atlas);
    });

    it("a decor with a tween block its target can take", () => {
      expect(entities().find((x) => x.id === "std-tween")?.type).toBe("decor");
      const block = blockOf<TweenBlock>("std-tween", "tween");
      for (const spec of block.tweens)
        expect(
          tweenTargetProblem({ type: "decor", posable: true }, tweenChannels(spec), true),
        ).toBeNull();
    });

    it("an emitter drawing the sparks preset from the project's atlas, which parses with no issues", () => {
      const block = blockOf<EmitterBlock>("std-emitter", "emitter");
      expect(block.preset).toBe("sparks");
      expect(view.byId.get(block.preset)?.kind).toBe(EMITTER_KIND);
      const file = values.get(block.preset) as EmitterFile;
      expect(file.texture).toBeDefined();
      expect(emitterIssues(file, assetInfo(view, file.texture!))).toEqual([]);
    });

    it("a camera region framing the camera target where it stands", () => {
      const regions = cameraRegionsOf(expanded().entities, engine);
      expect(regions.map((r) => r.id)).toEqual(["framing"]);
      const target = entities().find((x) => x.id === "std-camera-target")!;
      const [x, y] = target.at as Pt;
      expect(regionFor([{ at: { x, y } }], regions)?.id).toBe("framing");
      expect(def.settings?.camera).toBeDefined();
    });

    it("a note per region", () => {
      expect(entities().filter((e) => e.type === "note").length).toBeGreaterThanOrEqual(5);
    });

    it("a solid of the project's material asset, which validates and has physics", () => {
      const materials = new Set(entriesOf(MATERIAL_KIND).map((e) => e.id));
      const solids = entities().filter(
        (e) => e.type === "solid" && typeof e.material === "string" && materials.has(e.material),
      );
      expect(solids.length).toBeGreaterThanOrEqual(1);
      const kind = project.kinds.get(MATERIAL_KIND) as DocKindDef;
      for (const id of new Set(solids.map((e) => e.material as string))) {
        const parsed = parseAssetDoc(kind, values.get(id), { registry: engine, project: view });
        expect(parsed.ok && parsed.issues).toEqual([]);
        expect(engine.materials.get(id)?.restitution).toBeGreaterThan(0);
      }
      expect(createRegistry().materials.size).toBe(0);
    });

    it("a game-settings doc and a data table of a table the test game declares", () => {
      expect(entriesOf(GAME_SETTINGS_KIND)).toHaveLength(1);
      const tables = entriesOf(DATA_TABLE_KIND);
      expect(tables.length).toBeGreaterThanOrEqual(1);
      for (const entry of [...entriesOf(GAME_SETTINGS_KIND), ...tables]) {
        const kind = project.kinds.get(entry.kind) as DocKindDef;
        const parsed = parseAssetDoc(kind, values.get(entry.id), { registry: game, project: view });
        expect(parsed.ok && parsed.issues, entry.id).toEqual([]);
      }
      expect(tables.map((e) => (values.get(e.id) as { table: string }).table)).toContain(
        CARD_TABLE,
      );
      expect(Object.keys(testGame.tables ?? {})).toContain(CARD_TABLE);
    });

    it("an input map that parses with no issues under the engine and the test game", () => {
      const maps = entriesOf(INPUT_MAP_KIND);
      expect(maps).toHaveLength(1);
      const kind = project.kinds.get(INPUT_MAP_KIND) as DocKindDef;
      for (const registry of [engine, game]) {
        const parsed = parseAssetDoc(kind, values.get(maps[0]!.id), { registry, project: view });
        expect(parsed.ok && parsed.issues).toEqual([]);
      }
    });

    // The engine project is gameless, so a UI-only action's binding and a game's one-way type can't
    // live in its files: the next three tests build their case from the files in memory.
    it("an input map that binds a UI-only action under a game declaring one, the schema marking it", () => {
      const map = values.get(entriesOf(INPUT_MAP_KIND)[0]!.id) as Record<string, unknown>;
      const kind = project.kinds.get(INPUT_MAP_KIND) as DocKindDef;
      expect(uiGame.uiActionNames).toEqual([MENU_ACTION]);
      const bound = {
        ...map,
        actions: [{ action: MENU_ACTION, bindings: [{ device: "key", code: "KeyP" }] }],
      };
      const parsed = parseAssetDoc(kind, bound, { registry: uiGame, project: view });
      expect(parsed.ok && parsed.issues).toEqual([]);
      const schema = docKindJsonSchema(kind, { registry: uiGame, project: view }) as {
        properties: Record<string, { items: { properties: Record<string, unknown> } }>;
      };
      expect(schema.properties.actions!.items.properties.action).toMatchObject({
        anyOf: [{ enum: ["left", "right", "push"] }, { enum: [MENU_ACTION], "x-ui": true }],
      });
      const gameless = parseAssetDoc(kind, bound, { registry: engine, project: view });
      expect(gameless.issues.map((i) => i.code)).toEqual(["binding-unknown"]);
    });

    it("a script over the scene naming the UI-only action, refused with the hint", () => {
      const parsed = parseInputScript(
        { v: 2, scene: "kitchen-sink", steps: [{ hold: ["right", MENU_ACTION], for: 30 }] },
        uiGame,
      );
      expect(parsed.ok).toBe(false);
      if (parsed.ok) return;
      expect(parsed.issues).toEqual([
        expect.objectContaining({ path: "/steps/0/hold/1", hint: UI_ACTION_HINT }),
      ]);
      const settles = checks.checks.find((c): c is ReachesCheck => c.id === "settles")!;
      expect(parseInputScript(settles.script, uiGame).ok).toBe(true);
    });

    it("a two-seat check whose tracks fit the seats the input map gives the gameless engine", () => {
      const raw = JSON.parse(checksText) as { checks: { id: string }[] };
      expect(raw.checks.map((c) => c.id)).toContain("two-seats");
      const twoSeats = checks.checks.find((c): c is ReachesCheck => c.id === "two-seats")!;
      const { players: own, ...script } = twoSeats.script as { players?: number };
      const map = values.get(entriesOf(INPUT_MAP_KIND)[0]!.id) as {
        players: { max: number; join: "auto" };
      };
      expect(own).toBe(map.players.max);
      expect(scriptSeatLimit(engine)).toBe(1);
      expect(scriptSeatLimit(engine, map.players)).toBe(2);
      expect(parseInputScript(script, engine, map.players).ok).toBe(true);
      const bare = parseInputScript(script, engine);
      expect(!bare.ok && bare.issues.map((i) => i.path)).toEqual(["/tracks/1/player"]);
    });

    it("type-wide one-way solids that draw the side the solid system lands actors on", () => {
      expect(uiGame.types.get(CEILING.type)?.oneWay).toBe("down");
      const retyped = ["ledge", "shelf-board", "side-wall"];
      const own = Object.fromEntries(
        entities()
          .filter((e) => retyped.includes(e.id))
          .map((e) => [e.id, e.oneWay]),
      );
      expect(own).toEqual({ ledge: true, "shelf-board": undefined, "side-wall": "left" });
      const scene: SceneDefinition = {
        ...def,
        entities: entities().map((e) =>
          retyped.includes(e.id) ? { ...e, type: CEILING.type } : e,
        ),
      };
      const expandedScene = expandScene(scene, uiGame, { prefabs });
      const drawn = Object.fromEntries(
        drawnEntities(expandedScene, uiGame)
          .filter((d) => retyped.includes(d.id))
          .map((d) => [d.id, oneWayEdge(d)?.side]),
      );
      expect(drawn).toEqual({ ledge: "down", "shelf-board": "down", "side-wall": "left" });
      const rt = createSceneRuntime({ rapier, view: null, game: uiTestGame, registry: uiGame });
      expect(rt.load(expandedScene).ok).toBe(true);
      for (const id of retyped)
        expect(rt.ctx.tags.get(rt.ctx.tags.handlesOf(id)[0]!)?.oneWaySide, id).toBe(drawn[id]);
      rt.destroy();
    });
  });

  it("validates with no errors, structural and physical", () => {
    const issues = [
      ...validateScene(def, engine, { prefabs }),
      ...validatePhysical({ rapier, scene: def, registry: engine, prefabs }),
    ];
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("validates against the project view with no issue at all, no asset-* or sprite-* among them", () => {
    expect(validateScene(def, engine, { prefabs, project: view })).toEqual([]);
  });

  it("bundles exactly the three textures its sprites cut, each once, with no issues", () => {
    const { bundle, issues } = sceneBundle(expanded(), def, prefabs, view, project.kinds, engine);
    expect(issues).toEqual([]);
    const textures = entriesOf(TEXTURE_KIND);
    expect(textures).toHaveLength(3);
    expect(bundle.entries).toEqual(
      textures
        .map((t) => ({ id: t.id, kind: TEXTURE_KIND, sha256: t.sha256, bytes: t.bytes }))
        .sort((a, b) => (a.id < b.id ? -1 : 1)),
    );
    expect(bundle.bytes).toBe(textures.reduce((sum, t) => sum + t.bytes!, 0));
  });

  it("loads its decor headless with a pose and no collider", () => {
    const decor = entities().filter((e) => e.type === "decor");
    expect(decor.length).toBeGreaterThan(0);
    const rt = createSceneRuntime({ rapier, view: null, game: null, registry: engine });
    expect(rt.load(expanded()).ok).toBe(true);
    for (const d of decor) {
      const [x, y] = d.at as Pt;
      expect(rt.ctx.poses.get(d.id)).toEqual({ x, y, rot: 0 });
      expect(rt.ctx.tags.handlesOf(d.id)).toEqual([]);
    }
    expect(rt.stats().perType.decor).toBe(decor.length);
    rt.destroy();
  });

  it("expands and loads its camera region headless with no collider, the scene's camera settings kept", () => {
    const regions = expanded().entities.filter((e) => e.type === "camera-region");
    expect(regions.map((e) => e.id)).toEqual(["framing"]);
    expect(expanded().settings.camera).toEqual({ damping: 0.2 });
    const rt = createSceneRuntime({ rapier, view: null, game: null, registry: engine });
    expect(rt.load(expanded()).ok).toBe(true);
    for (const e of regions) expect(rt.ctx.tags.handlesOf(e.id)).toEqual([]);
    expect(rt.stats().perType["camera-region"]).toBe(regions.length);
    rt.destroy();
  });

  it("plays its animation, tween and emitter headless: the clip walks its tag and the once clip's event and hit shape, the decor bobs", () => {
    const rt = createSceneRuntime({
      rapier,
      view: null,
      game: null,
      registry: engine,
      project: runtimeView(view, values, engine),
    });
    expect(rt.load(expanded()).ok).toBe(true);
    const tween = entities().find((e) => e.id === "std-tween")!;
    const [tx, ty] = tween.at as Pt;
    const to = blockOf<TweenBlock>("std-tween", "tween").tweens[0]!.to.y!;
    const frames = new Set<string>();
    let lowest = ty;
    for (let i = 0; i < 120; i++) {
      rt.step(rt.ctx.time.tickMs, []);
      frames.add(rt.ctx.anim.state("std-anim")!.frame);
      const pose = rt.ctx.poses.get("std-tween")!;
      expect(pose.x).toBe(tx);
      expect(pose.y).toBeLessThanOrEqual(ty + 1e-9);
      lowest = Math.min(lowest, pose.y);
    }
    expect(frames).toEqual(new Set(["hero-0", "hero-1"]));
    expect(lowest).toBeCloseTo(to, 2);

    rt.ctx.anim.play("std-anim", "jab");
    const raised: unknown[] = [];
    let hit = 0;
    for (let i = 0; i < 30; i++) {
      for (const e of rt.step(rt.ctx.time.tickMs, []).events)
        if (e.type === ANIM_FRAME && e.entityId === "std-anim") raised.push(e.data);
      hit = Math.max(hit, rt.ctx.anim.shapes("std-anim", "hit").length);
    }
    expect(raised).toContainEqual(expect.objectContaining({ clip: "jab", event: "strike" }));
    expect(hit).toBe(1);
    expect(rt.ctx.anim.state("std-anim")?.clip).toBe("idle");
    rt.destroy();
  });

  it("loads its walk area and hole headless with no collider, and ctx.nav paths around the hole", () => {
    const nav = entities().filter((e) => e.type === "nav");
    expect(nav.some((e) => (e.mode ?? "walk") === "walk")).toBe(true);
    const holes = nav.filter((e) => e.mode === "block");
    expect(holes.length).toBeGreaterThanOrEqual(1);
    const rt = createSceneRuntime({ rapier, view: null, game: null, registry: engine });
    expect(rt.load(expanded()).ok).toBe(true);
    for (const e of nav) expect(rt.ctx.tags.handlesOf(e.id)).toEqual([]);
    expect(rt.stats().perType.nav).toBe(nav.length);
    // Metres: the scene's v4 form holds the walk area in metres.
    const from = { x: 22.5, y: 3.5 };
    const to = { x: 19.5, y: 5 };
    const path = rt.ctx.nav!.path(from, to)!;
    expect(path[0]).toEqual(from);
    expect(path.at(-1)).toEqual(to);
    expect(path.length).toBeGreaterThan(2);
    for (const hole of holes) {
      const pts = (hole.shape as unknown[]).slice(1) as number[];
      const xs = pts.filter((_, i) => i % 2 === 0);
      const ys = pts.filter((_, i) => i % 2 === 1);
      const box = {
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY: Math.min(...ys),
        maxY: Math.max(...ys),
      };
      const centre = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
      expect(rt.ctx.nav!.contains(centre), hole.id).toBe(false);
      const strictlyInside = (p: { x: number; y: number }) =>
        p.x > box.minX && p.x < box.maxX && p.y > box.minY && p.y < box.maxY;
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1]!;
        const b = path[i]!;
        for (let k = 0; k <= 64; k++) {
          const p = { x: a.x + ((b.x - a.x) * k) / 64, y: a.y + ((b.y - a.y) * k) / 64 };
          expect(strictlyInside(p), `${hole.id} at ${p.x},${p.y}`).toBe(false);
        }
      }
      const corner = (p: { x: number; y: number }) =>
        (p.x === box.minX || p.x === box.maxX) && (p.y === box.minY || p.y === box.maxY);
      expect(path.some(corner), `the path hugs a corner of ${hole.id}`).toBe(true);
    }
    rt.destroy();
  });

  it('loads its "left" one-way solid tagged with its side, holding an actor on its left and letting one through from the right', () => {
    const left = entities().filter((e) => e.type === "solid" && e.oneWay === "left");
    expect(left.length).toBeGreaterThanOrEqual(1);
    const rt = createSceneRuntime({ rapier, view: null, game: null, registry: engine });
    expect(rt.load(expanded()).ok).toBe(true);
    const solids = rt.ctx.system<SolidSystem>("solid")!;
    for (const e of left) {
      const [cx, cy, hw] = (e.shape as number[]).slice(1) as [number, number, number];
      expect(rt.ctx.tags.get(rt.ctx.tags.handlesOf(e.id)[0]!)).toMatchObject({
        oneWay: true,
        oneWaySide: "left",
      });
      const actor = (x: number) => ({ minX: x - 5, maxX: x + 5, minY: cy - 5, maxY: cy + 5 });
      solids.gateOneWaySides(actor(cx - hw - 10), false);
      expect(solids.isHidden(e.id), `${e.id} with the actor on its left`).toBe(false);
      solids.gateOneWaySides(actor(cx + hw + 10), false);
      expect(solids.isHidden(e.id), `${e.id} with the actor on its right`).toBe(true);
      solids.gateOneWaySides(actor(cx - hw - 10), true);
      expect(solids.isHidden(e.id), `${e.id} with the actor passing`).toBe(true);
    }
    rt.destroy();
  });

  it("has a prop with fixedRotation that never turns, where the same prop without it tips over", () => {
    const fixed = entities().filter((e) => e.type === "prop" && e.fixedRotation === true);
    expect(fixed.length).toBeGreaterThanOrEqual(1);
    const DT = 1000 / 60;
    const turns = (scene: SceneDefinition): Map<string, number[]> => {
      const rt = createSceneRuntime({ rapier, view: null, game: null, registry: engine });
      expect(rt.load(expanded(scene)).ok).toBe(true);
      const bodies = fixed.map((e) => {
        const [handle] = rt.ctx.tags.handlesOf(e.id);
        return [e.id, rt.ctx.physics!.world.getCollider(handle!)!.parent()!] as const;
      });
      const rots = new Map(bodies.map(([id]) => [id, [] as number[]]));
      for (let i = 0; i < 120; i++) {
        rt.step(DT, []);
        for (const [id, body] of bodies) rots.get(id)!.push(body.rotation());
      }
      rt.destroy();
      return rots;
    };
    const free: SceneDefinition = {
      ...def,
      entities: entities().map((e) => {
        if (e.fixedRotation !== true) return e;
        const { fixedRotation: _, ...rest } = e;
        return rest;
      }),
    };
    const held = turns(def);
    const loose = turns(free);
    for (const { id } of fixed) {
      expect(
        held.get(id)!.every((r) => r === 0),
        id,
      ).toBe(true);
      expect(Math.max(...loose.get(id)!.map(Math.abs)), id).toBeGreaterThan(0.3);
    }
  });

  it("has a spawner that spawns a shape type by type with fields, each spawn's box at the spawn point with a collider there", () => {
    const shaped = entities().flatMap((e) => {
      const block = (e.behaviors as Record<string, unknown> | undefined)?.spawner as
        | SpawnerBlock
        | undefined;
      return block?.type !== undefined && block.fields?.shape !== undefined
        ? [[e, block] as const]
        : [];
    });
    expect(shaped.map(([e]) => e.id)).toEqual(["std-spawner"]);
    const [[source, block]] = shaped as [(typeof shaped)[number]];
    const [form, ox, oy, hw, hh] = block.fields!.shape as [string, number, number, number, number];
    expect(form).toBe("box");
    const rt = createSceneRuntime({ rapier, view: null, game: null, registry: engine });
    expect(rt.load(expanded()).ok).toBe(true);
    const spawned: StepEvent[] = [];
    for (let i = 0; i < 300; i++)
      for (const e of rt.step(rt.ctx.time.tickMs, []).events)
        if (e.type === SPAWNER_SPAWNED) spawned.push(e);
    expect(spawned).toHaveLength(block.cap);
    expect(rt.ctx.behavior<SpawnerSystem>("spawner")!.live(source.id)).toEqual(
      spawned.map((e) => e.other),
    );
    const [sx, sy] = source.at as Pt;
    for (const e of spawned) {
      expect(e.at).toEqual({ x: sx, y: sy });
      const spawn = rt.ctx.get(e.other!)!;
      expect(spawn.type).toBe(block.type);
      expect(spawn).not.toHaveProperty("at");
      const box = spawn.shape as Extract<ShapeObj, { type: "box" }>;
      expect([box.type, box.hw, box.hh]).toEqual(["box", hw, hh]);
      expect(box.cx).toBeCloseTo(sx + ox, 5);
      expect(box.cy).toBeCloseTo(sy + oy, 5);
      const [handle] = rt.ctx.tags.handlesOf(e.other!);
      const at = rt.ctx.physics!.world.getCollider(handle!)!.translation();
      expect(at.x).toBeCloseTo(sx + ox, 5);
      expect(at.y).toBeCloseTo(sy + oy, 5);
    }
    rt.destroy();
  });

  it("is canonical, and formatting is idempotent", () => {
    const once = formatScene(def).text;
    expect(once).toBe(text);
    const again = parseScene(once, engine);
    expect(again.ok && formatScene(again.def).text).toBe(text);
    for (const [id, prefab] of prefabs) expect(formatPrefab(prefab)).toBe(prefabTexts.get(id));
  });

  it("is byte-identical file → doc → file, prefabs included, also after the doc crosses the wire", () => {
    const doc = sceneToDoc(JSON.parse(text) as SceneDefinition);
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
    for (const d of [doc, remote]) expect(formatScene(docToScene(d)).text).toBe(text);
    for (const [id, prefab] of prefabs) {
      const pdoc = prefabToDoc(prefab);
      const wire = new Y.Doc();
      Y.applyUpdate(wire, Y.encodeStateAsUpdate(pdoc));
      for (const d of [pdoc, wire]) expect(formatPrefab(docToPrefab(d))).toBe(prefabTexts.get(id));
    }
  });

  it("records 300 ticks and replays them to the same result and digest", () => {
    const registry = overlaid(watcher);
    const run = runPlaytest<Body[]>({
      rapier,
      game: watcher,
      registry,
      scene: def,
      prefabs,
      script: { v: 1, scene: "kitchen-sink", steps: [{ wait: 300 }] },
    });
    if (run.blocked) throw new Error(`blocked: ${JSON.stringify(run)}`);
    const report = run as PlaytestReport<Body[]>;
    expect(report.outcome.result).toBe("script-end");
    expect(report.ticks).toBe(300);
    expect(report.final!.flat().every((v) => typeof v === "string" || Number.isFinite(v))).toBe(
      true,
    );
    expect(report.events).toContainEqual(
      expect.objectContaining({ type: SENSOR_ENTER, entityId: "zone", other: "ball" }),
    );
    expect(report.events.filter((e) => e.type === ENTITY_DESTROYED)).toEqual([
      expect.objectContaining({ entityId: "spark" }),
    ]);

    const replay = replayRecording<Body[]>({
      rapier,
      game: watcher,
      registry,
      scene: def,
      prefabs,
      recording: JSON.parse(JSON.stringify(report.recording)),
    });
    if (replay.blocked) throw new Error(`blocked: ${JSON.stringify(replay)}`);
    expect(replay.warnings).toEqual([]);
    expect(replay.divergence).toBeNull();
    expect(replay.matches).toBe(true);
    expect(recordingDivergence(report.recording, replay.recording)).toBeNull();
    expect(replay.recording.end).toBe(report.recording.end);
    expect(replay.final).toEqual(report.final);
  });

  it("gives the material's physics to the solid that names it, and a test-game run loaded by snapshot reads the table and settings", async () => {
    const material = entities().find((e) => e.type === "solid" && typeof e.material === "string")!;
    const physics = engine.materials.get(material.material as string)!;
    const seen: unknown[] = [];
    const reading = defineGame({
      ...testGame,
      createRuntime(ctx) {
        const inner = testGame.createRuntime(ctx);
        return {
          ...inner,
          onLoad(loaded) {
            inner.onLoad?.(loaded);
            const [handle] = ctx.tags.handlesOf(material.id);
            const collider = handle === undefined ? null : ctx.physics!.world.getCollider(handle);
            seen.push(
              [collider?.friction(), collider?.restitution()],
              ctx.project?.settings,
              ctx.project?.table(CARD_TABLE),
            );
          },
        };
      },
    });
    const { snapshot, store } = await pinned();
    const loaded = await loadHeadless({
      snapshot,
      store,
      scene: def.name,
      registry: overlaid(reading),
    });
    const run = runPlaytest({
      rapier,
      game: reading,
      ...loaded,
      script: { v: 1, scene: "kitchen-sink", steps: [{ wait: 1 }] },
    });
    if (run.blocked) throw new Error(`blocked: ${JSON.stringify(run)}`);
    const [surface, settings, rows] = seen;
    expect(surface).toEqual([
      expect.closeTo(physics.friction, 6),
      expect.closeTo(physics.restitution, 6),
    ]);
    expect(settings).toEqual({ avatarSpeed: AVATAR_SPEED });
    expect(rows).toEqual([
      { id: "fireball", cost: 3, damage: 5 },
      { id: "heal", cost: 2, damage: 0 },
    ]);
  });

  it("loads by snapshot and plays headless with fetch stubbed to throw, never calling it", async () => {
    const fetch = vi.fn(() => {
      throw new Error("a headless load fetched");
    });
    vi.stubGlobal("fetch", fetch);
    try {
      const { snapshot, store } = await pinned();
      const loaded = await loadHeadless({ snapshot, store, scene: def.name, registry: game });
      expect(loaded.project?.asset("crates")?.kind).toBe(ATLAS_KIND);
      let sized = 0;
      for (const [e, b] of sprites()) {
        if (b.asset === undefined) continue;
        const want = assetInfo(view, b.asset, b.frame) ?? undefined;
        if (want?.size) sized++;
        expect(loaded.project?.asset(b.asset, b.frame), e.id).toEqual(want);
      }
      expect(sized).toBeGreaterThanOrEqual(2);
      const run = runPlaytest({
        rapier,
        game: testGame,
        ...loaded,
        script: { v: 1, scene: "kitchen-sink", steps: [{ wait: 120 }] },
      });
      if (run.blocked) throw new Error(`blocked: ${JSON.stringify(run)}`);
      expect((run as PlaytestReport<unknown>).ticks).toBe(120);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  describe("checks", () => {
    it("pass headless under the engine registry, the touches check skipped", () => {
      const report = runChecks({
        rapier,
        scene: def,
        prefabs,
        registry: engine,
        checks,
        readFile: (path) => readFileSync(new URL(path, scenesDir), "utf8"),
      });
      expect(report.results.map((r) => [r.id, r.kind, r.pass, r.skipped !== undefined])).toEqual([
        ["valid", "valid", true, false],
        ["settles", "reaches", true, false],
        ["fades", "reaches", true, false],
        ["ball-in-zone", "touches", true, true],
        ["nav-step", "reaches", true, false],
        ["nav-check", "reaches", true, false],
        ["two-seats", "reaches", true, false],
        ["parented", "reaches", true, false],
      ]);
      expect(report.ok).toBe(true);
    });

    it("fail the expect while the lifetime entity is still there", () => {
      const fades = checks.checks.find((c) => c.id === "fades") as ReachesCheck;
      const lifetime = (
        entities().find((e) => e.id === "spark")!.behaviors as Record<string, LifetimeBlock>
      )[LIFETIME.name]!;
      const early: ReachesCheck = {
        ...fades,
        script: { v: 1, scene: "kitchen-sink", steps: [{ wait: lifetime.ticks! - 10 }] },
      };
      const report = runChecks({
        rapier,
        scene: def,
        prefabs,
        registry: engine,
        checks: { ...checks, checks: [early] },
        readFile: (path) => readFileSync(new URL(path, scenesDir), "utf8"),
      });
      const [result] = report.results;
      expect(result?.pass).toBe(false);
      expect(result?.message).toContain("expect.count");
    });

    it("all pass under the test game, the touches check run", () => {
      const unskipped: ChecksFile = {
        ...checks,
        checks: checks.checks.map(({ skip: _, ...check }) => check),
      };
      const report = runChecks({
        rapier,
        scene: def,
        prefabs,
        registry: game,
        checks: unskipped,
        readFile: (path) => readFileSync(new URL(path, scenesDir), "utf8"),
      });
      expect(report.results.map((r) => r.kind)).toEqual([
        "valid",
        "reaches",
        "reaches",
        "touches",
        "reaches",
        "reaches",
        "reaches",
        "reaches",
      ]);
      for (const r of report.results) {
        expect(r.skipped, r.id).toBeUndefined();
        expect(r.pass, `${r.id}: ${r.message}`).toBe(true);
      }
    });
  });
});

describe("the engine project", () => {
  it("scans with no problems: docs keyed by id or by their sidecar, each blob with a sidecar naming its key, its art CC0", async () => {
    expect(scan.problems).toEqual([]);
    expect(scan.state.meta).toMatchObject({ projectId: "engine", name: "Engine" });
    const entries = Object.values(scan.state.assets);
    expect(new Set(entries.map((e) => e.kind))).toEqual(
      new Set([
        "scene",
        "prefab",
        "checks",
        MATERIAL_KIND,
        GAME_SETTINGS_KIND,
        INPUT_MAP_KIND,
        inputScriptKind.kind,
        SCENE_LIST_KIND,
        DATA_TABLE_KIND,
        animationKind.kind,
        emitterKind.kind,
        TEXTURE_KIND,
        ATLAS_KIND,
        SAVE_KIND,
      ]),
    );
    const blobs = entries.filter((e) => e.sha256 !== undefined);
    expect(blobs.map((e) => e.path).sort()).toEqual([
      "art/backdrop.png",
      "art/crates.json",
      "art/crates.png",
      "art/hero.json",
      "art/hero.png",
      "saves/grid-yard.save.json",
    ]);
    const sidecars = (await walk(scenesPath))
      .filter((p) => p.endsWith(".asset.json"))
      .map((p) => p.slice(scenesPath.length))
      .sort();
    const sided = new Set(sidecars.map((p) => p.slice(0, -".asset.json".length)));
    for (const e of blobs) expect(sided.has(e.path), e.path).toBe(true);
    for (const e of entries) {
      expect(e.created).toEqual({ at: 0, by: "disk" });
      if (!sided.has(e.path)) {
        expect(e.key, e.path).toBe(e.id);
        continue;
      }
      const sidecar = JSON.parse(
        await readFile(join(scenesPath, `${e.path}.asset.json`), "utf8"),
      ) as { key: string; id: string; sha256?: string; licence?: { spdx?: string } };
      expect(sidecar, e.path).toMatchObject({ key: e.key, id: e.id });
      expect(sidecar.sha256, e.path).toBe(e.sha256);
      if (e.path.startsWith("art/")) expect(sidecar.licence?.spdx, e.path).toBe("CC0-1.0");
    }
    expect([...sided].sort()).toEqual(
      entries
        .map((e) => e.path)
        .filter((p) => sided.has(p))
        .sort(),
    );
  });

  it("lists a sublevel that attaches beside grid-yard, and refuses it beside a Rapier scene", () => {
    const list = values.get("scene-list") as { start: string; scenes: SceneListEntry[] };
    const subs = list.scenes.filter((e) => e.sublevel === true);
    expect(subs.map((e) => e.scene)).toEqual(["grid-annex"]);
    expect(list.start).not.toBe("grid-annex");
    const scene = (name: string) => {
      const parsed = parseScene(readFileSync(new URL(`${name}.json`, scenesDir), "utf8"), engine);
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
      return expandScene(parsed.def, engine, { prefabs });
    };
    const annex = scene("grid-annex");
    const judge = (main: string, at: Pt) =>
      sublevelIssue(scene(main), annex, {
        scene: "grid-annex",
        list: list.scenes,
        label: "annex",
        at,
        pxPerMetre: pxPerMetreOf(engine),
      });
    expect(judge("grid-yard", [6.4, 0])).toBeNull();
    expect(judge("grid-yard", [6.5, 0])?.detail).toMatchObject({ reason: "grid" });
    expect(judge("kitchen-sink", [0, 0])?.detail).toMatchObject({ reason: "physics" });
  });

  it("holds a save fixture of grid-yard that a headless run starts from and names", async () => {
    const [entry, ...more] = entriesOf(SAVE_KIND);
    expect(more).toEqual([]);
    expect(entry).toMatchObject({
      path: "saves/grid-yard.save.json",
      meta: { scene: "grid-yard" },
    });
    const text = await readFile(join(scenesPath, entry!.path), "utf8");
    const parsed = parseSaveFile(text);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    expect(parsed.file).toMatchObject({ depth: "world", slot: "grid-yard", meta: { savedAt: 0 } });
    const { snapshot, store } = await pinned();
    const loaded = await loadHeadless(
      { snapshot, store, scene: "grid-yard", registry: engine },
      { fromSave: text },
    );
    expect(loaded.fromSave?.sha256).toBe(entry!.sha256);
    const run = runPlaytest({
      rapier,
      game: null,
      ...loaded,
      script: { v: 2, seed: 1, steps: [{ wait: 10 }] },
    });
    if (run.blocked) throw new Error(`blocked: ${JSON.stringify(run)}`);
    expect(run.recording.fromSave).toEqual({ slot: "grid-yard", sha256: entry!.sha256 });
  });

  it("round-trips every doc asset byte-identically through its doc and back, also across the wire", async () => {
    for (const entry of Object.values(scan.state.assets).filter((e) => e.sha256 === undefined)) {
      const kind = project.kinds.get(entry.kind) as DocKindDef;
      const file = await readFile(join(scenesPath, entry.path), "utf8");
      const name = adapter.docNameOf(entry);
      const doc = new Y.Doc();
      await adapter.loadDoc(name, doc);
      const remote = new Y.Doc();
      Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
      for (const d of [doc, remote])
        expect(formatAssetDoc(kind, adapter.valueOf(name, d)), entry.path).toBe(file);
    }
  });
});
