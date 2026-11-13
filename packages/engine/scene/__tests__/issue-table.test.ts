// @vitest-environment node
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { GLOW, LAMP, PLAIN, testGame } from "../../__tests__/fixtures/test-game";
import { budgetIssues, DEFAULT_EXPORT_BUDGET, measureBudget } from "../../export/budget";
import { planContent } from "../../export/content";
import { assetCredits } from "../../export/credits";
import { planIcons } from "../../export/icons";
import { checkItchLayout } from "../../export/itch";
import { defineBehavior } from "../../game/behaviors";
import { createRegistry, defineGame, withProject } from "../../game/define";
import { assetField } from "../../game/fields";
import { parseSaveFile, type SaveFile } from "../../game/save-file";
import type { Registry } from "../../game/types";
import { runChecks } from "../../headless/run-checks";
import { validatePhysical } from "../../headless/validate-physical";
import { createKindRegistry, parseAssetDoc } from "../../project/kinds";
import { gameSettingsKind } from "../../project/kinds/game-settings";
import { sceneListIssues, sceneListKind } from "../../project/kinds/scene-list";
import { checkProjectBatch } from "../../project/ops";
import { heldProject } from "../../project/runtime-view";
import { jsonValues, snapshotProject } from "../../project/snapshot";
import type { AssetEntry } from "../../project/types";
import { projectView } from "../../project/view";
import { createSceneRuntime } from "../../runtime/runtime";
import { captureSave } from "../../runtime/save-state";
import { createSaveSlots } from "../../saves/slots";
import { memorySaveStore, type SaveStore } from "../../saves/store";
import type { RapierModule } from "../../types";
import { expandScene } from "../expand";
import { formatScene } from "../format";
import { ISSUE_CODES } from "../issues";
import { applyOps } from "../ops";
import { locatePointer, parseScene } from "../parse";
import {
  ENGINE_ISSUE_CODE_LIST,
  PREFAB_MAX_DEPTH,
  type EngineIssueCode,
  type EntityDef,
  type InstanceDef,
  type Prefab,
  type PrefabLibrary,
  type SceneDefinition,
  type SceneIssue,
} from "../types";
import { sublevelUseIssues, validateScene, type ValidateOptions } from "../validate";
import { engine, engineYardText, fake } from "./fixtures/fake-game";

function scene(over: Partial<SceneDefinition> = {}, extra: EntityDef[] = []): SceneDefinition {
  return {
    v: 1,
    name: "t",
    bounds: [0, 0, 1000, 1000],
    solid: [["box", 500, 920, 400, 20]],
    entities: [{ id: "start", type: "marker", at: [500, 900], tags: ["spawn"] }, ...extra],
    ...over,
  };
}

/** Parse issues for `raw`, given as text so they carry lines. */
function parsed(raw: unknown, registry: Registry = engine): SceneIssue[] {
  return parseScene(JSON.stringify(raw, null, 2), registry).issues;
}

/** Validator issues, with lines from the canonical text. */
function validated(
  def: SceneDefinition,
  registry: Registry = engine,
  opts: Omit<ValidateOptions, "lines"> = {},
): SceneIssue[] {
  return validateScene(def, registry, { ...opts, lines: formatScene(def).lines });
}

const asset = (id: string, kind: string): AssetEntry => ({
  key: `k-${id}`,
  id,
  kind,
  path: `${id}.${kind}`,
  created: { at: 0, by: "t" },
});
const project = projectView({
  meta: { projectId: "p", layout: 2, name: "P" },
  assets: {
    "k-boom": asset("boom", "sound"),
    "k-hero": {
      ...asset("hero", "atlas"),
      sha256: "b".repeat(64),
      meta: {
        tool: "aseprite",
        frames: { "idle-0": { x: 0, y: 0, w: 16, h: 16 } },
        tags: [],
        slices: [],
        order: ["idle-0"],
      },
    },
  },
  history: {},
  code: {},
  build: {},
});
const sprited = (id: string, sprite: Record<string, unknown>): EntityDef => ({
  id,
  type: "marker",
  at: [100, 100],
  behaviors: { sprite },
});
const env = { materials: [], materialDefs: new Map(), types: [], assets: () => [] };
const scored = createRegistry(
  defineGame({
    id: "scored",
    types: [],
    settings: { theme: assetField(env, "music", "The scene's music.").optional() },
    actions: [],
    createRuntime: () => ({ snapshot: () => null }),
  }),
);

/** A game whose one physical check needs physics. */
const needy = createRegistry(
  defineGame({
    id: "needy",
    types: [],
    actions: [],
    physicalChecks: [
      {
        id: "rapier-only",
        description: "Reads the Rapier world.",
        needsPhysics: true,
        run: () => [],
      },
    ],
    createRuntime: () => ({ snapshot: () => null }),
  }),
);

/** The test game plus a behavior that requires its glow. */
const behaving = createRegistry(
  defineGame({
    ...testGame,
    behaviors: [
      ...(testGame.behaviors ?? []),
      defineBehavior({
        name: "test-game/halo",
        description: "A ring around the glow.",
        fields: {},
        requires: [GLOW.name],
      }),
    ],
  }),
);
const carrying = (type: string, behaviors: Record<string, unknown>): SceneDefinition =>
  scene({ game: "test-game" }, [{ id: "thing", type, at: [100, 100], behaviors }]);

const prefab = (id: string, instances?: InstanceDef[]): Prefab => ({
  kind: "prefab",
  v: 3,
  id,
  entities: [{ id: "m", type: "marker", at: [0, 0] }],
  ...(instances ? { instances } : {}),
});
const holding = (id: string, inner: string) =>
  prefab(id, [{ id: `${inner}-1`, prefab: inner, at: [10, 0] }]);
const post = prefab("post");
const variant = (id: string, base: string): Prefab => ({ ...prefab(id), entities: [], base });
/** A prefab as the scene its view validates. */
const view = (p: Prefab): SceneDefinition => ({
  v: 3,
  name: p.id,
  bounds: [-500, -500, 500, 500],
  entities: p.entities,
});
const gate: Prefab = {
  kind: "prefab",
  v: 3,
  id: "gate",
  entities: [{ id: "bell", type: "sensor", shape: ["box", 0, 0, 10, 10] }],
};
const library = (...prefabs: Prefab[]): PrefabLibrary => new Map(prefabs.map((p) => [p.id, p]));
const placing = (id: string) => scene({ instances: [{ id: "i1", prefab: id, at: [300, 300] }] });

let rapier: RapierModule;

beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

/** What a store and the slots over it refuse, gathered once since saving is asynchronous. */
const storeIssues: Partial<Record<EngineIssueCode, SceneIssue[]>> = {};

beforeAll(async () => {
  const file = (slot: string, pad = 0): SaveFile => ({
    kind: "save",
    v: 1,
    game: "fake",
    gameVersion: 1,
    engine: "0.13.0",
    release: null,
    project: null,
    slot,
    meta: { scene: "t", savedAt: 0, playTicks: 0, title: "x".repeat(pad) },
    depth: "progress",
    persist: null,
    scene: { id: "t", runHash: "", sublevels: [] },
    data: null,
  });
  const slotsOver = (store: SaveStore, pad = 0) =>
    createSaveSlots({
      game: { id: "fake" },
      store,
      now: () => 0,
      capture: ({ slot }) => ({ ok: true, file: file(slot, pad) }),
      restore: async () => ({ ok: true }),
    });
  const issueOf = (r: { ok: true } | { ok: false; issue: SceneIssue }) => (r.ok ? [] : [r.issue]);

  storeIssues["save-too-large"] = issueOf(await slotsOver(memorySaveStore(), 70_000).save("big"));
  const one = slotsOver({ ...memorySaveStore(), kind: "host", limits: { maxSlots: 1 } });
  await one.save("first");
  storeIssues["save-slot-limit"] = issueOf(await one.save("second"));
  const refusing: SaveStore = {
    ...memorySaveStore(),
    kind: "host",
    write: async () => {
      throw new Error("quota exceeded");
    },
  };
  storeIssues["save-store-failed"] = issueOf(await slotsOver(refusing).save("s"));
});

/** Physical issues, with lines from the canonical text. */
function physical(def: SceneDefinition): SceneIssue[] {
  return validatePhysical({ rapier, scene: def, registry: engine, lines: formatScene(def).lines });
}

function opIssue(def: SceneDefinition, ops: unknown[], base?: string): SceneIssue[] {
  const r = applyOps(def, { ops, base } as never, engine);
  return r.ok ? r.issues : [r.issue];
}

const rock = (shape: unknown[]): EntityDef => ({
  id: "rock",
  type: "prop",
  shape,
  density: 1,
  restitution: 0,
});

/**
 * One scene per engine code that produces it, through the tool that owns
 * it: `parseScene`, `validateScene` or `applyOps`. `null` marks a code that
 * nothing emits yet; each says why.
 */
const FIXTURES: Record<EngineIssueCode, (() => SceneIssue[] | Promise<SceneIssue[]>) | null> = {
  schema: () => parsed({ ...scene(), bounds: [0, 0, 10] }),
  "unknown-key": () => parsed({ ...scene(), sold: [] }),
  "unknown-type": () => parsed(scene({}, [{ id: "x", type: "crate", at: [0, 0] }])),
  "unknown-game": () => parsed({ ...scene(), game: "nope" }),
  "bad-shape": () => parsed(scene({ solid: [["box", 0, 0, -1, 2]] })),
  "bad-id": () => parsed(scene({}, [{ id: "Bad Id", type: "marker", at: [0, 0] }])),
  "version-newer": () => parsed({ ...scene(), v: 99 }),
  // The v3 → v4 step (scene/migrate.ts) refuses without a registry, or when an override or param
  // names a prefab or child it can't resolve; the hosted service reports it for docs it can't migrate.
  "migration-unresolved": null,
  "dup-id": () => validated(scene({}, [{ id: "start", type: "marker", at: [10, 900] }])),
  "dangling-ref": () =>
    validated(
      scene({ game: "fake", flag: [[800, 900]] }, [
        { id: "door", type: "door", shape: ["box", 100, 100, 5, 20], opens: "gone", speed: 1 },
      ]),
      fake,
    ),
  "ref-type": () =>
    validated(
      scene({ game: "fake", flag: [[800, 900]] }, [
        { id: "door", type: "door", shape: ["box", 100, 100, 5, 20], opens: "start", speed: 1 },
      ]),
      fake,
    ),
  "poly-invalid": () =>
    validated(scene({}, [rock(["poly", 100, 800, 300, 800, 200, 850, 300, 900, 100, 900])])),
  "chain-invalid": () => validated(scene({ solid: [["chain", 0, 900, 100, 900, 100, 900]] })),
  "path-invalid": () =>
    validated(
      scene({}, [
        {
          id: "lift",
          type: "follower",
          shape: ["box", 0, 0, 20, 5],
          path: {
            pts: [
              [100, 100],
              [200, 100],
            ],
            mode: "loop",
            speed: 0,
          },
        },
      ]),
    ),
  "path-degenerate": () =>
    validated(
      scene({}, [
        {
          id: "lift",
          type: "follower",
          shape: ["box", 0, 0, 20, 5],
          path: {
            pts: [
              [100, 100],
              [100, 100],
              [200, 100],
            ],
            mode: "ping_pong",
            speed: 50,
          },
        },
      ]),
    ),
  "non-integer": () => validated(scene({ solid: [["box", 500.005, 920, 400, 20]] })),
  "out-of-bounds": () => validated(scene({ solid: [["box", 500, 990, 400, 20]] })),
  "follower-hits-solid": () =>
    physical(
      scene({}, [
        {
          id: "lift",
          type: "follower",
          shape: ["box", 0, 0, 40, 8],
          path: {
            pts: [
              [500, 700],
              [500, 950],
            ],
            mode: "ping_pong",
            speed: 60,
          },
        },
      ]),
    ),
  "solid-overlap": () =>
    physical(
      scene({
        solid: [
          ["box", 500, 920, 400, 20],
          ["box", 880, 900, 40, 40],
        ],
      }),
    ),
  "prefab-unknown": () => validated(placing("door"), engine, { prefabs: library(post) }),
  "unused-override": () =>
    validated(
      scene({
        instances: [{ id: "p1", prefab: "post", at: [300, 300], overrides: { "nope.at": [1, 1] } }],
      }),
      engine,
      { prefabs: library(post) },
    ),
  // Layer visibility is editor state, not stored in the scene.
  "hidden-layer": null,
  "prefab-cycle": () =>
    validated(placing("room"), engine, {
      prefabs: library(holding("room", "hall"), holding("hall", "room")),
    }),
  "prefab-depth": () =>
    validated(placing("p1"), engine, {
      prefabs: library(
        ...Array.from({ length: PREFAB_MAX_DEPTH + 1 }, (_, k) =>
          k < PREFAB_MAX_DEPTH ? holding(`p${k + 1}`, `p${k + 2}`) : prefab(`p${k + 1}`),
        ),
      ),
    }),
  "variant-base-unknown": () =>
    validated(view(variant("red-post", "pots")), engine, {
      prefabs: library(post, variant("red-post", "pots")),
      prefab: "red-post",
    }),
  "param-unknown": () =>
    validated(
      scene({ instances: [{ id: "p1", prefab: "post", at: [300, 300], params: { tall: 2 } }] }),
      engine,
      { prefabs: library(post) },
    ),
  "layer-unknown": () =>
    validated(scene({}, [{ id: "spot", type: "marker", at: [10, 10], layer: "sky" as never }])),
  "behavior-unknown": () => validated(carrying(LAMP.type, { "test-game/spn": {} }), behaving),
  "behavior-forbidden": () => validated(carrying(PLAIN.type, { "test-game/spin": {} }), behaving),
  "behavior-missing": () => validated(carrying("marker", { "test-game/halo": {} }), behaving),
  "behavior-conflict": () =>
    validated(
      scene({}, [
        {
          id: "hero",
          type: "marker",
          at: [1, 1],
          behaviors: {
            collider: { shape: ["box", 0, 0, 0.2, 0.2] },
            "character-top-down": {},
            "character-side-view": {},
          },
        },
      ]),
    ),
  "character-body-kind": () =>
    validated(
      scene({}, [
        {
          id: "hero",
          type: "marker",
          at: [1, 1],
          behaviors: {
            collider: { shape: ["box", 0, 0, 0.2, 0.2] },
            body: { kind: "dynamic" },
            "character-side-view": {},
          },
        },
      ]),
    ),
  "grid-invalid": () =>
    validated(
      scene({
        settings: {
          grid: { kind: "hex", cell: [32, 28], side: 40, stagger: "x", index: "odd" },
        } as never,
      }),
    ),
  "ref-child-unknown": () =>
    validated(
      scene(
        {
          game: "fake",
          flag: [[800, 900]],
          instances: [{ id: "g1", prefab: "gate", at: [300, 300] }],
        },
        [{ id: "door", type: "door", shape: ["box", 100, 100, 5, 20], opens: "g1/bel", speed: 1 }],
      ),
      fake,
      { prefabs: library(gate) },
    ),
  "stale-base": () =>
    opIssue(
      scene(),
      [{ op: "update", ref: "~solid:0", set: { shape: ["box", 1, 1, 1, 1] } }],
      "0000000000000000",
    ),
  "ref-not-found": () => opIssue(scene(), [{ op: "remove", refs: ["ghost"] }]),
  "op-invalid": () => opIssue(scene(), [{ op: "update", ref: "start" }]),
  "id-taken": () =>
    opIssue(scene(), [{ op: "add", entity: { id: "start", type: "marker", at: [1, 1] } }]),
  "asset-missing": () => validated(scene({ assets: ["bom"] }), engine, { project }),
  "asset-kind": () =>
    validated(scene({ game: "scored", settings: { theme: "boom" } }), scored, { project }),
  "asset-frame-unknown": () =>
    validated(scene({}, [sprited("pic", { asset: "hero", frame: "idel-0" })]), engine, { project }),
  "sprite-no-asset": () =>
    validated(scene({}, [sprited("pic", { scale: 2 })]), engine, { project }),
  "tick-rate-invalid": () =>
    parseAssetDoc(
      gameSettingsKind,
      JSON.stringify({ kind: "game-settings", v: 1, engine: { tickRate: 241 }, game: {} }, null, 2),
      { registry: engine, project: null },
    ).issues,
  "physics-required": () =>
    validated(
      scene({ settings: { physics: "none" } }, [
        {
          id: "crate",
          type: "prop",
          shape: ["box", 200, 200, 20, 20],
          density: 1,
          restitution: 0,
        },
      ]),
    ),
  "physics-skipped": () => {
    const def = scene({ game: "needy", settings: { physics: "none" } });
    return validatePhysical({
      rapier: null,
      scene: def,
      registry: needy,
      lines: formatScene(def).lines,
    });
  },
  "nav-invalid": () =>
    validated(
      scene({}, [
        { id: "bowtie", type: "nav", shape: ["poly", 100, 100, 300, 300, 300, 100, 100, 300] },
      ]),
    ),
  "nav-missing": () =>
    validated(
      scene({}, [{ id: "walker", type: "marker", at: [1, 1], behaviors: { "nav-agent": {} } }]),
    ),
  "joint-ref-type": () =>
    validated(
      scene({}, [
        { id: "post", type: "marker", at: [2, 1] },
        {
          id: "link",
          type: "marker",
          at: [1, 1],
          behaviors: {
            collider: { shape: ["box", 0, 0, 0.2, 0.2] },
            body: {},
            joint: { kind: "revolute", to: "post" },
          },
        },
      ]),
    ),
  "joint-self": () =>
    validated(
      scene({}, [
        {
          id: "link",
          type: "marker",
          at: [1, 1],
          behaviors: {
            collider: { shape: ["box", 0, 0, 0.2, 0.2] },
            body: {},
            joint: { kind: "weld", to: "link" },
          },
        },
      ]),
    ),
  "grid-unreachable": () => {
    const def = scene(
      {
        settings: { grid: { kind: "square", cell: [100, 100] } },
        solid: [["box", 750, 500, 50, 500]],
      },
      [{ id: "exit", type: "marker", at: [900, 900] }],
    );
    const { results } = runChecks({
      rapier: null,
      scene: def,
      registry: engine,
      checks: { v: 3, checks: [{ id: "joined", kind: "connected", from: "start", to: ["exit"] }] },
      readFile: () => "",
    });
    return (results[0]?.detail as { issues?: SceneIssue[] } | undefined)?.issues ?? [];
  },
  // The other project codes come from the project model, not the scene tools these fixtures run.
  "asset-in-use": null,
  "asset-id-taken": null,
  "path-taken": null,
  "hash-mismatch": null,
  "code-skew": null,
  "asset-too-large": null,
  "import-failed": null,
  "quota-exceeded": null,
  // The scaffolder (`game new`) emits it outside the package; scripts/scene's game-new tests cover it.
  "project-id-taken": null,
  "asset-not-trashed": () => {
    const check = checkProjectBatch(
      project.state,
      new Map(),
      { v: 1, ops: [{ op: "purgeAsset", id: "boom" }] },
      {
        registry: engine,
        kinds: createKindRegistry(null, []),
        now: 0,
        by: "t",
        newKey: () => "k-new",
      },
    );
    return check.ok ? [] : [check.issue];
  },
  // Release codes come from a site's release routes, never from the scene tools.
  "release-immutable": null,
  "release-forbidden": null,
  // Binding problems come from `createRegistry` and the input-map kind's schema, not the scene tools.
  "binding-unknown": null,
  "player-unknown": null,
  // Replay warns about a recording from another platform; the scene tools never see one.
  "recording-other-platform": null,
  // Runtime refusals are thrown as `EngineError`s by `ctx.spawn` and `ctx.instantiate`, not reported by the scene tools.
  "spawn-id-invalid": null,
  "prefab-not-spawnable": null,
  // Thrown as `EngineError`s by `ctx.bodies`, not reported by the scene tools.
  "body-missing": null,
  "body-not-dynamic": null,
  "scene-unlisted": () => {
    const checks = {
      v: 3,
      checks: [
        {
          id: "wins",
          kind: "reaches",
          result: "won",
          expect: { scene: "vault" },
          script: { v: 2, steps: [{ wait: 1 }] },
        },
      ],
    };
    const text = JSON.stringify(checks, null, 2);
    const view = projectView({
      meta: { projectId: "p", layout: 2, name: "P" },
      assets: {
        "k-yard": { ...asset("yard", "scene"), path: "levels/yard.json" },
        "k-yard-checks": { ...asset("yard-checks", "checks"), path: "levels/yard.checks.json" },
        "k-flow": { ...asset("flow", "scene-list"), path: "scene-list.json" },
      },
      history: {},
      code: {},
      build: {},
    });
    const values = new Map<string, unknown>([
      ["flow", { kind: "scene-list", v: 1, start: "yard", scenes: [{ scene: "yard" }] }],
      ["yard-checks", checks],
    ]);
    return sceneListIssues(view, values, {
      lineOf: (id, pointer) => (id === "yard-checks" ? locatePointer(text, pointer) : undefined),
    });
  },
  "start-scene-missing": () =>
    parseAssetDoc(
      sceneListKind,
      JSON.stringify(
        {
          kind: "scene-list",
          v: 1,
          start: "cellar",
          scenes: [{ scene: "cellar", sublevel: true }],
        },
        null,
        2,
      ),
      { registry: engine, project: null },
    ).issues,
  "sublevel-invalid": () =>
    sublevelUseIssues(
      scene({ settings: { physics: "none" } }),
      [{ scene: "cellar", label: "cellar", path: "/checks/0/attach", line: 3 }],
      {
        registry: engine,
        library: {
          list: [{ scene: "cellar", sublevel: true }],
          scenes: new Map([
            ["cellar", { def: scene({ settings: { physics: "rapier" } }), prefabs: new Map() }],
          ]),
        },
      },
    ),
  // Save codes come from the save file, the stores and capture, outside the scene tools.
  "save-version-newer": () => {
    const r = parseSaveFile(
      JSON.stringify({
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
      }),
      { id: "fake", saves: { version: 1 } },
    );
    return r.ok ? [] : r.issues;
  },
  "save-too-large": () => storeIssues["save-too-large"] ?? [],
  "save-slot-limit": () => storeIssues["save-slot-limit"] ?? [],
  "save-unsupported": () => {
    const rt = createSceneRuntime({ rapier, view: null, registry: engine });
    try {
      if (!rt.load(expandScene(scene({ settings: { physics: "rapier" } }), engine)).ok) return [];
      const r = captureSave(rt, { depth: "world", slot: "s", now: 0 });
      return r.ok ? [] : [r.issue];
    } finally {
      rt.destroy();
    }
  },
  "save-store-failed": () => storeIssues["save-store-failed"] ?? [],
  // Hosts raise it (a site refusing a signed-out player's save); the engine passes it through.
  "save-forbidden": null,
  // An export icon that isn't a PNG of its size; a build's missing files are checkReleaseManifest's, tested in release.test.ts.
  "export-asset-missing": () =>
    planIcons({
      project: {
        kind: "project",
        v: 1,
        id: "p",
        name: "P",
        game: null,
        export: { icons: { "192": "hero", "512": "boom" } },
      },
      view: project,
    }).issues,
  "export-over-budget": () => {
    const files = [
      {
        path: "assets/music.ogg",
        sha256: "0".repeat(64),
        bytes: 40 * 1024 * 1024,
        role: "asset" as const,
      },
    ];
    const content = {
      start: "s",
      scenes: [],
      projectBundle: { entries: [], bytes: 0 },
      assets: {},
    };
    return budgetIssues(measureBudget(files, content, DEFAULT_EXPORT_BUDGET), files, content);
  },
  "export-itch-layout": () => checkItchLayout([{ path: "game/index.html", bytes: 900 }]),
  "export-target-unsupported": async () => {
    const registry = createRegistry(testGame);
    const { view, kinds } = heldProject([], registry, { projectId: "p", name: "P" });
    const texts = new Map<string, string>();
    const plan = await planContent({
      project: { kind: "project", v: 1, id: "p", name: "P", game: null },
      view,
      texts,
      kinds,
      registry: withProject(registry, view, jsonValues(texts)),
      game: testGame,
      engine: {},
      target: "desktop",
      snapshot: await snapshotProject(view, texts, view.state.build),
    });
    return [...plan.issues];
  },
  "licence-missing": () =>
    assetCredits({
      boom: {
        key: "k-boom",
        kind: "sound",
        path: "boom.sound",
        sha256: "c".repeat(64),
        bytes: 10,
        storage: "blob",
        file: `assets/${"c".repeat(64)}.sound`,
      },
    }).issues,
};

/** Raised below the code's own severity on purpose: an icon that falls back to the default warns. */
const SEVERITY_RAISED: Partial<Record<EngineIssueCode, SceneIssue["severity"]>> = {
  "export-asset-missing": "warn",
};

/** Codes with no line to point at: a sidecar with no licence, a budget or a layout over built files. */
const NO_LINE_CODES: readonly EngineIssueCode[] = [
  "licence-missing",
  "export-over-budget",
  "export-itch-layout",
  "export-target-unsupported",
];

/** A build's target comes from the command line, not from a document a path could point into. */
const NO_PATH_CODES: readonly EngineIssueCode[] = ["export-target-unsupported"];

/** `applyOps` and `checkProjectBatch` codes point into the batch, which has no line map. */
const OP_CODES: readonly EngineIssueCode[] = [
  "stale-base",
  "ref-not-found",
  "op-invalid",
  "id-taken",
  "asset-not-trashed",
];

describe("the engine's issue table", () => {
  it("has a fixture for every registered code", () => {
    expect(Object.keys(FIXTURES).sort()).toEqual([...ENGINE_ISSUE_CODE_LIST].sort());
  });

  for (const code of ENGINE_ISSUE_CODE_LIST) {
    const fixture = FIXTURES[code];
    if (!fixture) continue;
    it(`${code}: emitted with a path, a line, a hint, and a fix when fixable`, async () => {
      const issues = await fixture();
      const hits = issues.filter((i) => i.code === code);
      expect(hits.length, JSON.stringify(issues)).toBeGreaterThan(0);
      for (const issue of hits) {
        expect(issue.severity).toBe(SEVERITY_RAISED[code] ?? ISSUE_CODES[code].severity);
        if (!NO_PATH_CODES.includes(code)) expect(typeof issue.path, code).toBe("string");
        expect(issue.hint?.length, code).toBeGreaterThan(0);
        expect(issue.message.length).toBeGreaterThan(0);
        if (!OP_CODES.includes(code) && !NO_LINE_CODES.includes(code))
          expect(issue.line, code).toBeTypeOf("number");
        if (ISSUE_CODES[code].fixable) expect(issue.fix, code).toBeDefined();
      }
    });
  }

  it("physics-required: its fix applies and leaves the scene without the code", () => {
    const def = scene({ settings: { physics: "none" } }, [
      { id: "crate", type: "prop", shape: ["box", 200, 200, 20, 20], density: 1, restitution: 0 },
    ]);
    const [issue] = validated(def).filter((i) => i.code === "physics-required");
    const applied = applyOps(def, issue!.fix!, engine);
    expect(applied.ok, JSON.stringify(applied)).toBe(true);
    if (!applied.ok) return;
    expect(applied.def.settings?.physics).toBe("rapier");
    expect(validated(applied.def).map((i) => i.code)).not.toContain("physics-required");
  });

  it("character-body-kind: its fix makes the body kinematic and clears the code", () => {
    const def = scene({}, [
      {
        id: "hero",
        type: "marker",
        at: [1, 1],
        behaviors: {
          collider: { shape: ["box", 0, 0, 0.2, 0.2] },
          body: {},
          "character-top-down": {},
        },
      },
    ]);
    const [issue] = validated(def).filter((i) => i.code === "character-body-kind");
    const applied = applyOps(def, issue!.fix!, engine);
    expect(applied.ok, JSON.stringify(applied)).toBe(true);
    if (!applied.ok) return;
    expect(validated(applied.def).map((i) => i.code)).not.toContain("character-body-kind");
  });

  it("every code any tool emits on the fixtures is registered, with a hint", async () => {
    const yard = JSON.parse(engineYardText) as SceneDefinition;
    const emitted = await Promise.all(Object.values(FIXTURES).map((f) => f?.() ?? []));
    const all = [...emitted.flat(), ...validated(yard)];
    for (const issue of all) {
      const info = fake.issueCodes[issue.code];
      expect(info, issue.code).toBeDefined();
      expect(info?.hint.length).toBeGreaterThan(0);
    }
  });
});
