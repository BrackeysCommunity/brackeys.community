// @vitest-environment node
import { readFileSync } from "node:fs";

import type { RapierModule } from "@jams/engine";
import { validatePhysical } from "@jams/engine/headless";
import {
  applyOps,
  createRegistry,
  parseSceneOrThrow,
  sceneHash,
  type SceneDefinition,
  type SceneIssue,
  type SceneOp,
} from "@jams/engine/scene";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { PLATFORMER_ISSUES, platformerGame } from "..";

const registry = createRegistry(platformerGame);
const yard = parseSceneOrThrow(
  readFileSync(new URL("../scenes/test-yard.json", import.meta.url), "utf8"),
  registry,
);

let rapier: RapierModule;

beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

function edit(ops: SceneOp[], def: SceneDefinition = yard): SceneDefinition {
  const result = applyOps(def, { base: sceneHash(def), ops }, registry, { validate: "none" });
  if (!result.ok) throw new Error(result.issue.message);
  return result.def;
}

const physical = (def: SceneDefinition): SceneIssue[] =>
  validatePhysical({ rapier, scene: def, registry }).filter((i) =>
    i.code.startsWith("platformer/"),
  );

const codes = (def: SceneDefinition) => physical(def).map((i) => i.code);

describe("the platformer's physical checks", () => {
  it("finds nothing wrong with test-yard", () => {
    expect(physical(yard)).toEqual([]);
  });

  it("spawn-in-solid: a spawn inside the floor, fixed by dropping it onto the floor", () => {
    const def = edit([{ op: "move", refs: ["~spawn:0"], by: [0, 20] }]);
    const [issue] = physical(def);
    expect(issue).toMatchObject({
      code: "platformer/spawn-in-solid",
      severity: "error",
      path: "/spawn/0",
      entityIds: ["~spawn:0", "~solid:0"],
    });
    expect(issue!.message).toContain("it would land at [960, 1020]");
    const fixed = applyOps(def, issue!.fix!, registry, { validate: "none" });
    expect(fixed.ok && fixed.def.spawn).toEqual([[960, 1020]]);
    expect(fixed.ok && physical(fixed.def)).toEqual([]);
  });

  it("spawn-in-solid: a spawn entity inside a cloud, fixed without a base hash", () => {
    const def = edit([
      { op: "remove", refs: ["~spawn:0"] },
      { op: "add", entity: { id: "start", type: "spawn", at: [960, 920] } },
    ]);
    const [issue] = physical(def);
    expect(issue).toMatchObject({ code: "platformer/spawn-in-solid", path: "/entities/8/at" });
    expect(issue!.entityIds).toContain("~cloud:0");
    expect(issue!.fix!.base).toBeUndefined();
    const fixed = applyOps(def, issue!.fix!, registry, { validate: "none" });
    expect(fixed.ok && physical(fixed.def)).toEqual([]);
  });

  it("spawn-in-hazard and spawn-floating", () => {
    const lava = edit([{ op: "move", refs: ["~spawn:0"], by: [640, 140] }]);
    expect(codes(lava)).toContain("platformer/spawn-in-hazard");
    const sky = edit([{ op: "remove", refs: ["~solid:0"] }]);
    expect(codes(sky)).toEqual(["platformer/spawn-floating"]);
  });

  it("anchor-in-solid and anchor-orphan", () => {
    const buried = edit([{ op: "move", refs: ["~anchor:0"], by: [100, 440] }]);
    expect(physical(buried)).toEqual([
      expect.objectContaining({
        code: "platformer/anchor-in-solid",
        path: "/anchor/0",
        entityIds: ["~anchor:0", "~solid:0"],
      }),
    ]);
    const lonely = edit([{ op: "move", refs: ["~anchor:1"], by: [-2800, -900] }]);
    expect(physical(lonely)).toEqual([
      expect.objectContaining({ code: "platformer/anchor-orphan", path: "/anchor/1" }),
    ]);
  });

  it("cloud-in-solid", () => {
    const def = edit([{ op: "move", refs: ["~cloud:2"], by: [20, 90] }]);
    expect(physical(def)).toEqual([
      expect.objectContaining({
        code: "platformer/cloud-in-solid",
        path: "/cloud/2",
        entityIds: ["~cloud:2", "~solid:4"],
      }),
    ]);
  });

  it("every code it emits is registered", () => {
    for (const code of Object.keys(PLATFORMER_ISSUES))
      expect(registry.issueCodes[code]).toBeDefined();
  });
});
