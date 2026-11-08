// @vitest-environment node
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { GLOW, LAMP, PLAIN, testGame } from "../../__tests__/fixtures/test-game";
import { defineBehavior } from "../../game/behaviors";
import { createRegistry, defineGame } from "../../game/define";
import { assetField } from "../../game/fields";
import type { Registry } from "../../game/types";
import { validatePhysical } from "../../headless/validate-physical";
import type { AssetEntry } from "../../project/types";
import { projectView } from "../../project/view";
import type { RapierModule } from "../../types";
import { formatScene } from "../format";
import { ISSUE_CODES } from "../issues";
import { applyOps } from "../ops";
import { parseScene } from "../parse";
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
import { validateScene, type ValidateOptions } from "../validate";
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
  assets: { "k-boom": asset("boom", "sound") },
  history: {},
  code: {},
  build: {},
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
const FIXTURES: Record<EngineIssueCode, (() => SceneIssue[]) | null> = {
  schema: () => parsed({ ...scene(), bounds: [0, 0, 10] }),
  "unknown-key": () => parsed({ ...scene(), sold: [] }),
  "unknown-type": () => parsed(scene({}, [{ id: "x", type: "crate", at: [0, 0] }])),
  "unknown-game": () => parsed({ ...scene(), game: "nope" }),
  "bad-shape": () => parsed(scene({ solid: [["box", 0, 0, -1, 2]] })),
  "bad-id": () => parsed(scene({}, [{ id: "Bad Id", type: "marker", at: [0, 0] }])),
  "version-newer": () => parsed({ ...scene(), v: 99 }),
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
  "non-integer": () => validated(scene({ solid: [["box", 500.5, 920, 400, 20]] })),
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
  // The other project codes come from the project model, not the scene tools these fixtures run.
  "asset-in-use": null,
  "asset-id-taken": null,
  "path-taken": null,
  "hash-mismatch": null,
  "code-skew": null,
  "asset-too-large": null,
  "import-failed": null,
  "quota-exceeded": null,
};

/** `applyOps` codes point into the batch, which has no line map. */
const OP_CODES: readonly EngineIssueCode[] = [
  "stale-base",
  "ref-not-found",
  "op-invalid",
  "id-taken",
];

describe("the engine's issue table", () => {
  it("has a fixture for every registered code", () => {
    expect(Object.keys(FIXTURES).sort()).toEqual([...ENGINE_ISSUE_CODE_LIST].sort());
  });

  for (const code of ENGINE_ISSUE_CODE_LIST) {
    const fixture = FIXTURES[code];
    if (!fixture) continue;
    it(`${code}: emitted with a path, a line, a hint, and a fix when fixable`, () => {
      const issues = fixture();
      const hits = issues.filter((i) => i.code === code);
      expect(hits.length, JSON.stringify(issues)).toBeGreaterThan(0);
      for (const issue of hits) {
        expect(issue.severity).toBe(ISSUE_CODES[code].severity);
        expect(typeof issue.path, code).toBe("string");
        expect(issue.hint?.length, code).toBeGreaterThan(0);
        expect(issue.message.length).toBeGreaterThan(0);
        if (!OP_CODES.includes(code)) expect(issue.line, code).toBeTypeOf("number");
        if (ISSUE_CODES[code].fixable) expect(issue.fix, code).toBeDefined();
      }
    });
  }

  it("every code any tool emits on the fixtures is registered, with a hint", () => {
    const yard = JSON.parse(engineYardText) as SceneDefinition;
    const all = [...Object.values(FIXTURES).flatMap((f) => f?.() ?? []), ...validated(yard)];
    for (const issue of all) {
      const info = fake.issueCodes[issue.code];
      expect(info, issue.code).toBeDefined();
      expect(info?.hint.length).toBeGreaterThan(0);
    }
  });
});
