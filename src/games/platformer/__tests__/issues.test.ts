// @vitest-environment node
import { readFileSync } from "node:fs";

import {
  applyOps,
  createRegistry,
  parseSceneOrThrow,
  sceneHash,
  validateScene,
  type SceneDefinition,
  type SceneOp,
} from "@jams/engine/scene";
import { describe, expect, it } from "vite-plus/test";

import { platformerGame, PLATFORMER_ISSUES } from "..";

const registry = createRegistry(platformerGame);
const yard = parseSceneOrThrow(
  readFileSync(new URL("../scenes/test-yard.json", import.meta.url), "utf8"),
  registry,
);

function edit(ops: SceneOp[], def: SceneDefinition = yard): SceneDefinition {
  const result = applyOps(def, { base: sceneHash(def), ops }, registry, { validate: "none" });
  if (!result.ok) throw new Error(result.issue.message);
  return result.def;
}

const codes = (def: SceneDefinition) => validateScene(def, registry).map((i) => i.code);

describe("platformer issue codes", () => {
  it("registers every code under the platformer namespace", () => {
    for (const code of Object.keys(PLATFORMER_ISSUES)) {
      expect(code).toMatch(/^platformer\//);
      expect(registry.issueCodes[code]).toEqual(
        PLATFORMER_ISSUES[code as keyof typeof PLATFORMER_ISSUES],
      );
    }
  });

  it("platformer/spawn-missing: no spawn point", () => {
    expect(codes(yard)).not.toContain("platformer/spawn-missing");
    expect(codes(edit([{ op: "remove", refs: ["~spawn:0"] }]))).toContain(
      "platformer/spawn-missing",
    );
  });

  it("platformer/spawn-overlap: two spawns closer than a player", () => {
    const issues = validateScene(
      edit([{ op: "addBulk", key: "spawn", points: [[980, 1020]] }]),
      registry,
    );
    const overlap = issues.find((i) => i.code === "platformer/spawn-overlap");
    expect(overlap).toMatchObject({
      severity: "error",
      path: "/spawn/1",
      entityIds: ["~spawn:1", "~spawn:0"],
    });
    const apart = edit([{ op: "addBulk", key: "spawn", points: [[1040, 1020]] }]);
    expect(codes(apart)).not.toContain("platformer/spawn-overlap");
  });

  it("platformer/wind-rotation: a rotated wind zone, fixed by unrotating it", () => {
    const def = edit([
      {
        op: "add",
        entity: { id: "gust", type: "construct", construct: "wind_zone", at: [300, 900], rot: 45 },
      },
    ]);
    const issue = validateScene(def, registry).find((i) => i.code === "platformer/wind-rotation");
    expect(issue).toMatchObject({ severity: "warn", entityIds: ["gust"] });
    expect(codes(edit(issue!.fix!.ops, def))).not.toContain("platformer/wind-rotation");
  });

  it("platformer/no-goal: neither a goal nor an exit", () => {
    expect(codes(yard)).not.toContain("platformer/no-goal");
    expect(codes(edit([{ op: "remove", refs: ["cheese", "hole"] }]))).toContain(
      "platformer/no-goal",
    );
  });

  it("platformer/no-kill-plane: no hazard across the bounds", () => {
    expect(codes(yard)).toContain("platformer/no-kill-plane");
    const covered = edit([
      {
        op: "add",
        entity: { id: "floor-lava", type: "hazard", shape: ["box", 1000, 1190, 3000, 8] },
      },
    ]);
    expect(codes(covered)).not.toContain("platformer/no-kill-plane");
  });

  it("every fixable code carries a fix that clears it and adds no error", () => {
    const broken = edit([
      {
        op: "add",
        entity: { id: "gust", type: "construct", construct: "wind_zone", at: [300, 900], rot: 45 },
      },
    ]);
    const issues = validateScene(broken, registry);
    const errors = new Set(issues.filter((i) => i.severity === "error").map((i) => i.code));
    // spawn-in-solid needs the physics world; physical.test.ts applies its fix.
    const fixable = Object.entries(PLATFORMER_ISSUES)
      .filter(([code, info]) => info.fixable && code !== "platformer/spawn-in-solid")
      .map(([code]) => code);
    expect(fixable.length).toBeGreaterThan(0);
    for (const code of fixable) {
      const issue = issues.find((i) => i.code === code);
      expect(issue?.fix, code).toBeDefined();
      const fixed = applyOps(broken, issue!.fix!, registry);
      expect(fixed.ok, code).toBe(true);
      if (!fixed.ok) continue;
      expect(fixed.issues.map((i) => i.code)).not.toContain(code);
      expect(fixed.issues.filter((i) => i.severity === "error" && !errors.has(i.code))).toEqual([]);
    }
  });
});
