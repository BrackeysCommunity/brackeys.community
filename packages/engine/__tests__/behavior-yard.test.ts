// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../game/define";
import type { Registry } from "../game/types";
import { runChecks } from "../headless/run-checks";
import { namedPrefabs } from "../project/bundle";
import { parseChecks, type ChecksFile } from "../scene/checks";
import { expandScene } from "../scene/expand";
import { parseScene } from "../scene/parse";
import { resolveScene } from "../scene/resolve";
import type { PrefabLibrary, SceneDefinition } from "../scene/types";
import type { RapierModule } from "../types";
import { readPrefabFiles } from "../vite/project-files";

const scenesDir = new URL("../scenes/", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, scenesDir), "utf8");

let rapier: RapierModule;
let registry: Registry;
let scene: SceneDefinition;
let prefabs: PrefabLibrary;
let checks: ChecksFile;

beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
  registry = createRegistry(null);
  const parsed = parseScene(read("behavior-yard.json"), registry);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  scene = parsed.def;
  const files = await readPrefabFiles(fileURLToPath(scenesDir), registry);
  expect(files.problems).toEqual([]);
  prefabs = files.prefabs;
  const parsedChecks = parseChecks(read("behavior-yard.checks.json"), registry);
  if (!parsedChecks.ok) throw new Error(JSON.stringify(parsedChecks.issues));
  checks = parsedChecks.file;
});

describe("behavior-yard.json", () => {
  it("names no game: the standard behaviors carry it alone", () => {
    expect(scene.game ?? null).toBeNull();
  });

  it("carries no assets header: its spawner's prefab brings the crate art into its bundle", () => {
    expect(scene.assets).toBeUndefined();
    const drop = scene.entities?.find((e) => e.id === "crate-drop");
    expect(drop?.behaviors).toMatchObject({ spawner: { prefab: "crate" } });
    const expanded = expandScene(scene, registry, { prefabs });
    const named = namedPrefabs(expanded.entities, registry, (id) => prefabs.get(id));
    expect([...named.keys()]).toEqual(["crate"]);
    expect(named.get("crate")?.entities?.[0]?.behaviors).toMatchObject({
      sprite: { asset: "crates" },
    });
  });

  it("passes every check headless under the gameless engine registry, none skipped", () => {
    const report = runChecks({ rapier, scene, prefabs, registry, checks, readFile: read });
    expect(report.results.map((r) => [r.id, r.kind])).toEqual([
      ["valid", "valid"],
      ["reaches-goal", "reaches"],
      ["chain-holds", "reaches"],
      ["courier-arrives", "reaches"],
      ["ledge-route", "reaches"],
    ]);
    for (const r of report.results) {
      expect(r.skipped, r.id).toBeUndefined();
      expect(r.pass, `${r.id}: ${r.message}`).toBe(true);
    }
    expect(report.ok).toBe(true);
  });

  it("plays its input script to the end with the side hero beside the goal, having entered it", () => {
    const goal = checks.checks.find((c) => c.id === "reaches-goal");
    expect(goal).toMatchObject({
      result: "script-end",
      expect: {
        near: { id: "runner/hero", to: "goal" },
        event: { type: "sensor:enter", entityId: "goal", other: "runner/hero" },
      },
    });
    const report = runChecks({
      rapier,
      scene,
      prefabs,
      registry,
      checks: { ...checks, checks: [goal!] },
      readFile: read,
    });
    const [result] = report.results;
    expect(result?.pass, result?.message).toBe(true);
  });

  it("gives the runner its exposed jumpHeight, unshadowed by an override", () => {
    const runner = scene.instances?.find((i) => i.id === "runner");
    expect(runner?.params).toEqual({ jumpHeight: 2 });
    const hero = resolveScene(scene, registry, prefabs).entities?.find(
      (e) => e.id === "runner/hero",
    );
    const side = (hero?.behaviors as Record<string, { jumpHeight?: number }> | undefined)?.[
      "character-side-view"
    ];
    expect(side?.jumpHeight).toBe(2);
    expect(scene.entities?.find((e) => e.id === "about")?.text).toContain("jumpHeight 2");
  });

  it("fails ledge-route when the runner can't jump high enough to land on the ledge", () => {
    const ledge = checks.checks.find((c) => c.id === "ledge-route")!;
    const low = {
      ...scene,
      instances: scene.instances?.map((i) =>
        i.id === "runner" ? { ...i, params: { jumpHeight: 1 } } : i,
      ),
    };
    const report = runChecks({
      rapier,
      scene: low,
      prefabs,
      registry,
      checks: { ...checks, checks: [ledge] },
      readFile: read,
    });
    const [result] = report.results;
    expect(result?.pass).toBe(false);
    expect(result?.message).toMatch(/expect\.event/);
  });

  it("follows the runner at weight 1 and the walker at 0.1, as its note says", () => {
    const targets = (resolveScene(scene, registry, prefabs).entities ?? []).flatMap((e) => {
      const behaviors = e.behaviors as
        | Record<string, { weight?: number; seat?: number }>
        | undefined;
      const block = behaviors?.["camera-target"];
      return block ? [[e.id, block.weight ?? 1, block.seat ?? null]] : [];
    });
    expect(targets).toEqual([
      ["runner/hero", 1, null],
      ["walker/hero", 0.1, 1],
    ]);
    const about = scene.entities?.find((e) => e.id === "about")?.text;
    expect(about).toContain("weighted centre");
  });

  it("fails reaches-goal when the hero only stands still", () => {
    const goal = checks.checks.find((c) => c.id === "reaches-goal")!;
    const report = runChecks({
      rapier,
      scene,
      prefabs,
      registry,
      checks: {
        ...checks,
        checks: [{ ...goal, script: { v: 2, scene: "behavior-yard", steps: [{ wait: 600 }] } }],
      },
      readFile: read,
    });
    const [result] = report.results;
    expect(result?.pass).toBe(false);
    expect(result?.message).toMatch(/expect\.(near|event)/);
  });
});
