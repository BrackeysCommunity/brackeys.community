import { existsSync, readdirSync, readFileSync } from "node:fs";

import { createRegistry, withProject } from "../../../game/define";
import type { GameDefinition, Registry } from "../../../game/types";
import { MATERIAL_KIND } from "../../kinds/material";
import type { AssetEntry, AssetId } from "../../types";
import { assetIdOfPath, projectView } from "../../view";

/** The engine's home project, `src/engine/scenes/`. */
export const ENGINE_HOME = new URL("../../../scenes/", import.meta.url);

/** The material assets of the engine's home, as entries and their JSON by id. */
export function engineHomeMaterials(): { entries: AssetEntry[]; values: Map<AssetId, unknown> } {
  const dir = new URL("materials/", ENGINE_HOME);
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")) : [];
  const entries: AssetEntry[] = [];
  const values = new Map<AssetId, unknown>();
  for (const file of files.sort()) {
    const path = `materials/${file}`;
    const id = assetIdOfPath(path)!;
    entries.push({ key: id, id, kind: MATERIAL_KIND, path, created: { at: 0, by: "disk" } });
    values.set(id, JSON.parse(readFileSync(new URL(file, dir), "utf8")));
  }
  return { entries, values };
}

/** `game`'s registry (the engine's alone without one) with the engine home's materials, which its scenes name. */
export function engineHomeRegistry(game: GameDefinition | null = null): Registry {
  const { entries, values } = engineHomeMaterials();
  const view = projectView({
    meta: { projectId: "engine", layout: 1, name: "Engine" },
    assets: Object.fromEntries(entries.map((e) => [e.key, e])),
    history: {},
    code: {},
    build: {},
  });
  return withProject(createRegistry(game), view, values);
}
