import { finishExport, planContent, type BuiltCode, type ExportInput } from "@jams/engine/export";
import { createRegistry, withProject } from "@jams/engine/game";
import {
  heldProject,
  sha256,
  snapshotProject,
  type AssetSidecar,
  type HeldFile,
  type ProjectFile,
  type ReleaseTarget,
} from "@jams/engine/project";

import { walkerGame } from "./walker-game";

const LANE: ProjectFile = {
  kind: "project",
  v: 1,
  id: "lane",
  name: "Lane Walk",
  game: { module: "./index.ts", export: "walkerGame" },
  export: { shortName: "Lane", themeColor: "#1b1f2a", background: "#0d0f14" },
};

const texture = (id: string, licence?: AssetSidecar["licence"]): AssetSidecar => ({
  kind: "asset-sidecar",
  v: 1,
  key: `k-${id}`,
  id,
  sha256: id === "moss" ? "a".repeat(64) : "b".repeat(64),
  bytes: 2048,
  meta: { format: "png", width: 32, height: 32 },
  ...(licence ? { licence } : {}),
});

/** The project's files as a host holds them: docs by their JSON, binaries by their sidecars. */
function laneFiles(): { files: HeldFile[]; texts: Map<string, string> } {
  const docs: Record<string, unknown> = {
    "scene-list.json": { kind: "scene-list", v: 1, start: "lane", scenes: [{ scene: "lane" }] },
    "game-settings.json": { kind: "game-settings", v: 2, engine: {}, game: {} },
    "lane.json": {
      v: 4,
      name: "lane",
      bounds: [0, 0, 3.2, 1.92],
      settings: { physics: "none" },
      assets: ["moss", "lamp"],
      entities: [
        { id: "hero", type: "marker", at: [0.48, 0.48], tags: ["hero"] },
        { id: "goal", type: "marker", at: [2.72, 0.48], tags: ["goal"] },
      ],
    },
  };
  const texts = new Map<string, string>();
  const files: HeldFile[] = [];
  for (const [path, json] of Object.entries(docs)) {
    texts.set(path, `${JSON.stringify(json, null, 2)}\n`);
    files.push({ path, json });
  }
  files.push(
    { path: "art/moss.png", sidecar: texture("moss", { spdx: "CC0-1.0", author: "Ada" }) },
    { path: "art/lamp.png", sidecar: texture("lamp") },
  );
  return { files, texts };
}

/** What `game build` hands the planner: the view, the doc texts by id, the registry and a snapshot. */
export async function laneInput(target: ReleaseTarget): Promise<ExportInput> {
  const held = laneFiles();
  const { view, kinds } = heldProject(held.files, createRegistry(walkerGame), {
    projectId: LANE.id,
    name: LANE.name,
  });
  const texts = new Map<string, string>();
  for (const entry of view.byId.values()) {
    const text = held.texts.get(entry.path);
    if (text !== undefined) texts.set(entry.id, text);
  }
  const values = new Map([...texts].map(([id, text]) => [id, JSON.parse(text) as unknown]));
  return {
    project: LANE,
    view,
    texts,
    kinds,
    registry: withProject(createRegistry(walkerGame), view, values),
    game: walkerGame,
    engine: {},
    target,
    snapshot: await snapshotProject(view, texts, view.state.build),
  };
}

/** Stands in for the bundler: `createExportBuild` fills this from Vite's chunks. */
export async function laneCode(): Promise<BuiltCode> {
  const js = "console.log('lane');\n";
  return {
    files: [
      { path: "code/main-1a2b3c.js", sha256: await sha256(js), bytes: js.length, role: "code" },
    ],
    entry: "code/main-1a2b3c.js",
    rapier: null,
    thirdParty: [{ package: "zod", version: "4.1.12", licence: "MIT", notice: "MIT License…" }],
  };
}

/** Plans what ships, then the build's files and its `release.json`, without running a bundler. */
export async function planLane(target: ReleaseTarget = "web") {
  const input = await laneInput(target);
  const content = await planContent(input);
  const plan = await finishExport(content, await laneCode(), input);
  return {
    plan,
    needsRapier: content.needsRapier,
    files: plan.files.map((f) => `${f.path} ${f.role}`),
    issues: plan.issues.map((i) => `${i.severity} ${i.code}`),
  };
}
