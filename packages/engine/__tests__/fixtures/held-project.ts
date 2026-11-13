import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import type { ExportInput } from "../../export/plan";
import { createRegistry, withProject } from "../../game/define";
import type { GameDefinition } from "../../game/types";
import { heldProject, type HeldFile } from "../../project/runtime-view";
import type { AssetSidecar } from "../../project/sidecar";
import { jsonValues, snapshotProject } from "../../project/snapshot";
import type { ProjectFile } from "../../project/types";
import type { SceneDefinition } from "../../scene/types";

/** A project as a host holds it: docs by their JSON, binaries by their sidecars, and each doc's text by path. */
export type HeldFiles = { files: HeldFile[]; texts: Map<string, string> };

const SIDECAR = ".asset.json";

/** Every file under `dir` as a host holds it: docs by their JSON and text, binaries by their sidecars. */
export function readHeld(dir: string): HeldFiles {
  const files: HeldFile[] = [];
  const texts = new Map<string, string>();
  const walk = (at: string) => {
    for (const name of readdirSync(at).sort()) {
      const full = join(at, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      const path = relative(dir, full).split("\\").join("/");
      if (path.endsWith(SIDECAR) || path === "jams.project.json") continue;
      let sidecar: AssetSidecar | null = null;
      try {
        sidecar = JSON.parse(readFileSync(full + SIDECAR, "utf8")) as AssetSidecar;
      } catch {
        sidecar = null;
      }
      if (!path.endsWith(".json")) {
        files.push({ path, sidecar });
        continue;
      }
      const text = readFileSync(full, "utf8");
      texts.set(path, text);
      files.push({ path, json: JSON.parse(text), sidecar });
    }
  };
  walk(dir);
  return { files, texts };
}

export const CC0 = { spdx: "CC0-1.0", author: "Test authors" };

/** A PNG's sidecar: `size`×`size` pixels, `bytes` long. */
export const png = (
  id: string,
  sha: string,
  bytes: number,
  size: number,
  licence?: AssetSidecar["licence"],
): AssetSidecar => ({
  kind: "asset-sidecar",
  v: 1,
  key: `key-${id}`,
  id,
  sha256: sha,
  bytes,
  meta: { format: "png", width: size, height: size },
  ...(licence ? { licence } : {}),
});

/** A physics-free scene with one spawn marker, using `assets`. */
export const scene = (name: string, assets: string[] = []): SceneDefinition =>
  ({
    v: 4,
    name,
    bounds: [0, 0, 6.4, 3.84],
    settings: { physics: "none" },
    ...(assets.length > 0 ? { assets } : {}),
    entities: [{ id: "start", type: "marker", at: [1, 1], tags: ["spawn"] }],
  }) as SceneDefinition;

/**
 * A physics-free project: two listed scenes (yard, the start, and hall), two
 * unlisted ones (cellar, which a check names, and attic), a checks file and
 * its input script, and three textures (rocks without a licence, unused
 * reached only by attic).
 */
export function physicsFreeFiles(): HeldFiles {
  const docs: Record<string, unknown> = {
    "scene-list.json": {
      kind: "scene-list",
      v: 1,
      start: "yard",
      scenes: [{ scene: "yard", title: "Yard" }, { scene: "hall" }],
    },
    "game-settings.json": { kind: "game-settings", v: 2, engine: {}, game: {} },
    "yard.json": scene("yard", ["tiles"]),
    "hall.json": scene("hall", ["rocks", "tiles"]),
    "cellar.json": scene("cellar"),
    "attic.json": scene("attic", ["unused"]),
    "yard.checks.json": {
      v: 3,
      checks: [
        {
          id: "down",
          kind: "reaches",
          result: "script-end",
          expect: { scene: "cellar" },
          script: "walk.script.json",
        },
      ],
    },
    "walk.script.json": { v: 2, scene: "yard", steps: [{ wait: 1 }] },
  };
  const texts = new Map<string, string>();
  const files: HeldFile[] = [];
  for (const [path, json] of Object.entries(docs)) {
    texts.set(path, `${JSON.stringify(json, null, 2)}\n`);
    files.push({ path, json });
  }
  files.push(
    { path: "art/tiles.png", sidecar: png("tiles", "a".repeat(64), 300, 16, CC0) },
    { path: "art/rocks.png", sidecar: png("rocks", "b".repeat(64), 200, 16) },
    { path: "art/unused.png", sidecar: png("unused", "c".repeat(64), 100, 16, CC0) },
  );
  return { files, texts };
}

export const FREE_PROJECT: ProjectFile = {
  kind: "project",
  v: 1,
  id: "free",
  name: "Free",
  game: null,
};

/** The export input of `held`: the project read as held files, its doc texts by id, a snapshot of it. */
export async function heldInput(
  project: ProjectFile,
  held: HeldFiles,
  game: GameDefinition,
  target: ExportInput["target"] = "web",
): Promise<ExportInput> {
  const { view, kinds } = heldProject(held.files, createRegistry(game), {
    projectId: project.id,
    name: project.name,
  });
  const texts = new Map<string, string>();
  for (const entry of view.byId.values())
    if (entry.sha256 === undefined) {
      const text = held.texts.get(entry.path);
      if (text !== undefined) texts.set(entry.id, text);
    }
  const values = jsonValues(texts);
  const settings = [...view.byId.values()].find((e) => e.kind === "game-settings");
  const engine = ((settings && (values.get(settings.id) as { engine?: object })?.engine) ??
    {}) as Record<string, unknown>;
  return {
    project,
    view,
    texts,
    kinds,
    registry: withProject(createRegistry(game), view, values),
    game,
    engine,
    target,
    snapshot: await snapshotProject(view, texts, view.state.build),
  };
}
