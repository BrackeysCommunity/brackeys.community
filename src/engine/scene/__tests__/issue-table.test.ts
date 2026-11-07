// @vitest-environment node
import { beforeAll, describe, expect, it } from "vite-plus/test";

import type { Registry } from "../../game/types";
import { validatePhysical } from "../../headless/validate-physical";
import type { RapierModule } from "../../types";
import { formatScene } from "../format";
import { ISSUE_CODES } from "../issues";
import { applyOps } from "../ops";
import { parseScene } from "../parse";
import {
  ENGINE_ISSUE_CODE_LIST,
  type EngineIssueCode,
  type EntityDef,
  type SceneDefinition,
  type SceneIssue,
} from "../types";
import { validateScene } from "../validate";
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
function validated(def: SceneDefinition, registry: Registry = engine): SceneIssue[] {
  return validateScene(def, registry, { lines: formatScene(def).lines });
}

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
  // Prefabs don't exist in format v1 yet.
  "prefab-unknown": null,
  "unused-override": null,
  // Layer visibility is editor state, not stored in the scene.
  "hidden-layer": null,
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
