// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { testGame } from "../../__tests__/fixtures/test-game";
import { createRegistry } from "../../game/define";
import { compileInputScript } from "../../headless/compile-input-script";
import { parseAssetDoc, validateAssetDoc } from "../kinds";
import type { KindEnv } from "../kinds/define";
import { INPUT_MAP_KIND, type InputMapFile } from "../kinds/input-map";
import { inputScriptKind, kindInputMap } from "../kinds/input-script";
import { runtimeView } from "../runtime-view";
import type { AssetEntry, AssetId } from "../types";
import { projectView } from "../view";

const registry = createRegistry(testGame);

const entry = (id: string, kind: string, path: string): AssetEntry => ({
  key: id,
  id,
  kind,
  path,
  created: { at: 0, by: "test" },
});

const view = projectView({
  meta: { projectId: "test", layout: 1, name: "Test" },
  assets: {
    controls: entry("controls", INPUT_MAP_KIND, "input-map.json"),
    run: entry("run", inputScriptKind.kind, "run.script.json"),
  },
  history: {},
  code: {},
  build: {},
});

const MAP: InputMapFile = { kind: INPUT_MAP_KIND, v: 1, players: { max: 3, join: "auto" } };

/** Drives seat 2, which only the map's three seats give: the test game has one. */
const SCRIPT = {
  v: 2,
  tracks: [
    { player: 0, steps: [{ hold: ["right"], for: 5 }] },
    { player: 2, steps: [{ hold: ["left"], for: 5 }] },
  ],
};

const values = new Map<AssetId, unknown>([["controls", MAP]]);
const withMap: KindEnv = {
  registry,
  project: view,
  inputMap: kindInputMap(view, (id) => values.get(id), registry),
};
const bare: KindEnv = { registry, project: view };

const seatIssue = (issues: readonly { path?: string }[]) =>
  issues.some((i) => i.path === "/tracks/1/player");

describe("input scripts judged with the project input map's seats", () => {
  it("kindInputMap reads the map in effect as a run does", () => {
    expect(withMap.inputMap).toEqual(runtimeView(view, values, registry).inputMap);
    expect(kindInputMap(view, () => undefined, registry)).toBeNull();
  });

  it("a script driving a seat only the map gives validates in the kind", () => {
    expect(validateAssetDoc(inputScriptKind, SCRIPT, withMap)).toEqual([]);
    const parsed = parseAssetDoc(inputScriptKind, JSON.stringify(SCRIPT), withMap);
    expect(parsed.ok && parsed.issues).toEqual([]);
  });

  it("without the map the same seat is past the game's", () => {
    expect(seatIssue(validateAssetDoc(inputScriptKind, SCRIPT, bare))).toBe(true);
    const parsed = parseAssetDoc(inputScriptKind, JSON.stringify(SCRIPT), bare);
    expect(seatIssue(parsed.issues)).toBe(true);
  });

  it("the kind and a run's compile judge seats by one rule", () => {
    const run = runtimeView(view, values, registry);
    const compiled = compileInputScript(SCRIPT, registry, undefined, run.inputMap?.players);
    expect(compiled.ok).toBe(true);
    const unmapped = compileInputScript(SCRIPT, registry);
    expect(unmapped.ok).toBe(false);
    if (!unmapped.ok) expect(seatIssue(unmapped.issues)).toBe(true);
  });
});
