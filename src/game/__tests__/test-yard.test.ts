// @vitest-environment node
import { readFileSync } from "node:fs";

import { beforeAll, describe, expect, it } from "vite-plus/test";

import { runProbe } from "../headless/headless";
import { expandScene } from "../scene/expand";
import { parseScene } from "../scene/parse";
import type { SceneDefinition } from "../scene/types";
import { validateScene } from "../scene/validate";
import type { RapierModule } from "../types";
import { testYard } from "./fixtures/test-yard.expanded";

const text = readFileSync(new URL("../scenes/test-yard.json", import.meta.url), "utf8");

let rapier: RapierModule;
let def: SceneDefinition;

beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
  const parsed = parseScene(text);
  if (!parsed.ok) throw new Error(parsed.issues.map((i) => i.message).join("\n"));
  def = parsed.def;
});

describe("test-yard.json", () => {
  it("expands to the hand-built runtime fixture", () => {
    expect(expandScene(def)).toEqual(testYard());
  });

  it("has no validation errors", () => {
    expect(validateScene(def).filter((i) => i.severity === "error")).toEqual([]);
  });

  it("moves right and lands on an entity id when move_right is held", () => {
    const report = runProbe({ rapier, scene: expandScene(def), ticks: 120, hold: ["move_right"] });
    expect(report.load.ok).toBe(true);
    expect(report.final.position.x).toBeGreaterThan(def.spawn[0]![0]);
    const landed = report.events.find((e) => e.type === "landed");
    expect(landed?.entityId).toMatch(/^(~[a-z:]+:\d+|[a-z0-9][a-z0-9-]*)$/);
    expect(expandScene(def).entities.map((e) => e.id)).toContain(landed?.entityId);
  });
});
