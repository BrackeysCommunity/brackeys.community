import { describe, expect, it } from "vite-plus/test";

import type { Registry } from "../../game/types";
import { applyOps } from "../ops";
import { parseSceneOrThrow } from "../parse";
import type { EntityDef, SceneDefinition, SceneIssue, ShapeTuple } from "../types";
import { validateScene } from "../validate";
import { engine, engineYardText, fake } from "./fixtures/fake-game";

/** Park–Miller, so a failure names a seed that reproduces it. */
function rng(seed: number) {
  let s = seed % 2147483647 || 1;
  const next = () => (s = (s * 16807) % 2147483647) / 2147483647;
  return {
    int: (n: number) => Math.floor(next() * n),
    pick: <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)]!,
  };
}

type Rng = ReturnType<typeof rng>;
type Mutation = (def: SceneDefinition, r: Rng) => void;

const solids = (def: SceneDefinition) => def.solid as ShapeTuple[];
const entities = (def: SceneDefinition) => (def.entities ??= []);
const freshId = (def: SceneDefinition, stem: string) => {
  const ids = new Set(entities(def).map((e) => e.id));
  let n = 1;
  while (ids.has(`${stem}-${n}`)) n++;
  return `${stem}-${n}`;
};

const MUTATIONS: Record<string, Mutation> = {
  halfPixel(def, r) {
    const row = r.pick(solids(def));
    row[1 + r.int(2)] = (row[1 + r.int(2)] as number) + 0.5;
  },
  offEdge(def, r) {
    const [, , maxX, maxY] = def.bounds;
    solids(def).push(["box", maxX + r.int(300), maxY - r.int(200), 10 + r.int(40), 10]);
  },
  repeatPathPoint(def, r) {
    const lift = entities(def).find((e) => e.type === "follower");
    if (!lift) return;
    const pts = (lift.path as { pts: [number, number][] }).pts;
    const k = r.int(pts.length);
    pts.splice(k, 0, [...pts[k]!]);
  },
  repeatChainPoint(def, r) {
    const x = 100 + r.int(800);
    solids(def).push(["chain", x, 900, x + 50, 900, x + 50, 900, x + 120, 880]);
  },
  concaveSolid(def, r) {
    const x = 100 + r.int(800);
    solids(def).push(["poly", x, 800, x + 200, 800, x + 100, 850, x + 200, 900, x, 900]);
  },
  concaveProp(def, r) {
    const x = 100 + r.int(800);
    const shape = ["poly", x, 700, x + 60, 700, x + 30, 720, x + 60, 760, x, 760];
    entities(def).push({
      id: freshId(def, "rock"),
      type: "prop",
      shape,
      density: 1,
      restitution: 0,
    } as EntityDef);
  },
};

/** Issues are the same issue when their code and the entities they name match. */
const key = (i: SceneIssue) => `${i.code} ${i.entityIds.join(",")}`;

function checkFixes(def: SceneDefinition, registry: Registry, label: string) {
  const before = validateScene(def, registry);
  const errorsBefore = new Set(before.filter((i) => i.severity === "error").map(key));
  for (const issue of before) {
    if (!issue.fix) continue;
    const applied = applyOps(def, issue.fix, registry);
    expect(applied.ok, `${label}: ${issue.code} fix failed: ${JSON.stringify(applied)}`).toBe(true);
    if (!applied.ok) continue;
    const after = applied.issues;
    expect(after.map(key), `${label}: ${issue.code} fix left the issue`).not.toContain(key(issue));
    const newErrors = after.filter((i) => i.severity === "error" && !errorsBefore.has(key(i)));
    expect(newErrors, `${label}: ${issue.code} fix added errors`).toEqual([]);
  }
  return before;
}

describe("validator fixes", () => {
  it("clear their issue and add no error, on randomly broken scenes", () => {
    const yard = parseSceneOrThrow(engineYardText, engine);
    const names = Object.keys(MUTATIONS);
    const fixed = new Set<string>();
    for (let seed = 1; seed <= 150; seed++) {
      const r = rng(seed);
      const def = structuredClone(yard);
      const applied = Array.from({ length: 1 + r.int(3) }, () => r.pick(names));
      for (const name of applied) MUTATIONS[name]!(def, r);
      for (const issue of checkFixes(def, engine, `seed ${seed} [${applied.join(", ")}]`))
        if (issue.fix) fixed.add(issue.code);
    }
    expect([...fixed].sort()).toEqual(
      ["chain-invalid", "non-integer", "out-of-bounds", "path-degenerate", "poly-invalid"].sort(),
    );
  });

  it("clear reference issues in a game's scene", () => {
    const def: SceneDefinition = {
      v: 1,
      game: "fake",
      name: "refs",
      bounds: [0, 0, 1000, 1000],
      flag: [[800, 900]],
      entities: [
        { id: "start", type: "marker", at: [500, 900] },
        { id: "a", type: "door", shape: ["box", 100, 100, 5, 20], opens: "gone", speed: 1 },
        { id: "b", type: "door", shape: ["box", 200, 100, 5, 20], opens: "start", speed: 1 },
      ],
    };
    const codes = checkFixes(def, fake, "refs").map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["dangling-ref", "ref-type"]));
  });
});
