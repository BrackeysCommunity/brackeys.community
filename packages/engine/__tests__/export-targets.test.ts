// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vite-plus/test";

import { measureBudget } from "../export/budget";
import { planContent } from "../export/content";
import { checkItchLayout } from "../export/itch";
import type { ExportInput } from "../export/plan";
import {
  DEFAULT_BUILD_TARGET,
  DEFAULT_ZIP_TARGET,
  EXPORT_TARGETS,
  exportTarget,
  exportTargetNames,
} from "../export/targets";
import { createRegistry, withProject } from "../game/define";
import { sha256 } from "../project/hash";
import {
  checkReleaseManifest,
  formatReleaseManifest,
  parseReleaseManifest,
  releaseBuildHash,
  type ReleaseFile,
  type ReleaseManifest,
  type ReleaseTarget,
} from "../project/release";
import { heldProject, type HeldFile } from "../project/runtime-view";
import { jsonValues, snapshotProject } from "../project/snapshot";
import type { AssetEntry } from "../project/types";
import { projectView } from "../project/view";
import { AGENT_SURFACE_VERSION } from "../scene/agent-surface";
import { ENGINE_VERSION } from "../version";
import { testGame } from "./fixtures/test-game";

const UNBUILT: ReleaseTarget[] = ["desktop", "mobile"];

/** A one-scene physics-free project, as an export input for `target`. */
async function inputFor(target: ReleaseTarget): Promise<ExportInput> {
  const docs: Record<string, unknown> = {
    "scene-list.json": { kind: "scene-list", v: 1, start: "yard", scenes: [{ scene: "yard" }] },
    "game-settings.json": { kind: "game-settings", v: 2, engine: {}, game: {} },
    "yard.json": {
      v: 4,
      name: "yard",
      bounds: [0, 0, 6.4, 3.84],
      settings: { physics: "none" },
      entities: [{ id: "start", type: "marker", at: [1, 1], tags: ["spawn"] }],
    },
  };
  const files: HeldFile[] = Object.entries(docs).map(([path, json]) => ({ path, json }));
  const { view, kinds } = heldProject(files, createRegistry(testGame), {
    projectId: "targets",
    name: "Targets",
  });
  const texts = new Map<string, string>();
  for (const entry of view.byId.values())
    texts.set(entry.id, `${JSON.stringify(docs[entry.path], null, 2)}\n`);
  return {
    project: { kind: "project", v: 1, id: "targets", name: "Targets", game: null },
    view,
    texts,
    kinds,
    registry: withProject(createRegistry(testGame), view, jsonValues(texts)),
    game: testGame,
    engine: {},
    target,
    snapshot: await snapshotProject(view, texts, view.state.build),
  };
}

/** A manifest written by hand for `target`: one scene, the shell, the code, no PWA. */
async function handWritten(target: ReleaseTarget): Promise<ReleaseManifest> {
  const sceneText = '{ "kind": "scene", "id": "yard" }\n';
  const sceneSha = await sha256(sceneText);
  const files: ReleaseFile[] = [];
  for (const [path, text, role] of [
    ["code/main-3f9a1c.js", "console.log('game')", "code"],
    ["credits.html", "<!doctype html><h1>Credits</h1>", "shell"],
    [`data/${sceneSha}.json`, sceneText, "data"],
    ["index.html", "<!doctype html>", "shell"],
  ] as const)
    files.push({
      path,
      sha256: await sha256(text),
      bytes: new TextEncoder().encode(text).length,
      role,
    });
  const entry: AssetEntry = {
    key: "k1",
    id: "yard",
    kind: "scene",
    path: "scenes/yard.json",
    created: { at: 0, by: "" },
  };
  const view = projectView({
    meta: { projectId: "hand", layout: 1, name: "Hand" },
    assets: { k1: entry },
    history: {},
    code: {},
    build: {},
  });
  const snapshot = await snapshotProject(view, new Map([["yard", sceneText]]), {});
  const assets: ReleaseManifest["assets"] = {
    yard: {
      key: "k1",
      kind: "scene",
      path: "scenes/yard.json",
      sha256: sceneSha,
      bytes: sceneText.length,
      storage: "doc",
      file: `data/${sceneSha}.json`,
    },
  };
  const scenes: ReleaseManifest["flow"]["scenes"] = [
    { id: "yard", physics: "none", prefabs: [], bundle: { entries: [], bytes: 0 } },
  ];
  const projectBundle = { entries: [], bytes: 0 };
  return {
    $schema: "./release.schema.json",
    kind: "release",
    v: 1,
    engine: {
      version: ENGINE_VERSION,
      agentSurface: AGENT_SURFACE_VERSION,
      formats: { scene: 4, prefab: 4, recording: 2, inputScript: 2, save: 1, collabLayout: 3 },
    },
    game: { id: "hand", configHash: null, saveVersion: null },
    project: {
      id: "hand",
      name: "Hand",
      snapshot: snapshot.hash,
      snapshotEngine: snapshot.engine,
      build: {},
    },
    build: {
      hash: await releaseBuildHash(files),
      target,
      rapier: null,
      entry: "code/main-3f9a1c.js",
      files,
    },
    time: { kind: "fixed", rate: 60, catchUp: null, wakeOnPointerMove: false },
    replay: { acrossPlatforms: true },
    flow: { start: "yard", scenes },
    projectBundle,
    assets,
    credits: { assets: [], missing: [], code: [] },
    budget: measureBudget(
      files,
      { start: "yard", scenes, projectBundle, assets },
      {
        codeBytes: 4194304,
        firstLoadBytes: 16777216,
        totalBytes: 104857600,
        fileBytes: 33554432,
      },
    ),
    pwa: null,
  };
}

describe("EXPORT_TARGETS", () => {
  it("has a web row with the PWA and an itch row with itch.io's layout", () => {
    expect(EXPORT_TARGETS).toEqual({
      web: { pwa: true, layout: null },
      itch: { pwa: false, layout: checkItchLayout },
    });
    expect(exportTargetNames()).toEqual(["web", "itch"]);
    expect(DEFAULT_ZIP_TARGET).toBe("itch");
    expect(DEFAULT_BUILD_TARGET).toBe("web");
    for (const t of [DEFAULT_BUILD_TARGET, DEFAULT_ZIP_TARGET])
      expect(exportTarget(t), t).toBeDefined();
    for (const t of UNBUILT) expect(exportTarget(t), t).toBeUndefined();
  });
});

describe("a target with no row", () => {
  let web: ExportInput;
  beforeAll(async () => {
    web = await inputFor("web");
  });

  it("plans web and itch without the code", async () => {
    for (const target of exportTargetNames()) {
      const plan = await planContent({ ...web, target });
      expect(plan.issues.map((i) => i.code)).not.toContain("export-target-unsupported");
    }
  });

  it("plans desktop and mobile as export-target-unsupported, naming the rows", async () => {
    for (const target of UNBUILT) {
      const plan = await planContent({ ...web, target });
      const hits = plan.issues.filter((i) => i.code === "export-target-unsupported");
      expect(hits, target).toHaveLength(1);
      expect(hits[0]!.severity).toBe("error");
      expect(hits[0]!.message).toContain(target);
      expect(hits[0]!.message).toContain("web, itch");
      expect(plan.pwa).toBeNull();
    }
  });

  it("is still a valid manifest target: a hand-written one parses and holds together", async () => {
    for (const target of UNBUILT) {
      const manifest = await handWritten(target);
      const parsed = parseReleaseManifest(formatReleaseManifest(manifest));
      expect(parsed.ok, target).toBe(true);
      if (!parsed.ok) continue;
      expect(parsed.manifest.build.target).toBe(target);
      const files = new Map(manifest.build.files.map((f) => [f.path, f.sha256]));
      expect(await checkReleaseManifest(parsed.manifest, files, { measureBudget }), target).toEqual(
        [],
      );
    }
  });
});

describe("where a target's name appears", () => {
  const engineDir = fileURLToPath(new URL("../", import.meta.url));
  const sources = (dir: string): string[] => {
    const out: string[] = [];
    const walk = (at: string) => {
      for (const name of readdirSync(at).sort()) {
        const full = join(at, name);
        if (statSync(full).isDirectory()) {
          if (name !== "__tests__") walk(full);
        } else if (/\.tsx?$/.test(name)) out.push(full);
      }
    };
    walk(join(engineDir, dir));
    return out;
  };
  const NAMES = ["web", "itch", "desktop", "mobile"].join("|");
  const literal = new RegExp(`(["'\`])(?:${NAMES})\\1`);

  it("is only targets.ts under export/ and standalone/", () => {
    const files = [...sources("export"), ...sources("standalone")];
    expect(files.length).toBeGreaterThan(0);
    const naming = files
      .filter((f) => literal.test(readFileSync(f, "utf8")))
      .map((f) => relative(engineDir, f).split("\\").join("/"));
    expect(naming).toEqual(["export/targets.ts"]);
  });
});
