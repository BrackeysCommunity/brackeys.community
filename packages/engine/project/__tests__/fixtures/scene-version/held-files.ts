import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import type { HeldFiles } from "../../../../__tests__/fixtures/held-project";
import type { HeldFile } from "../../../runtime-view";
import type { AssetSidecar } from "../../../sidecar";
import type { ProjectFile } from "../../../types";

const SIDECAR = ".asset.json";

/** The engine's own project: its scenes, prefabs, art and data under `packages/engine/scenes`. */
export const ENGINE_DIR = fileURLToPath(new URL("../../../../scenes/", import.meta.url));

export const ENGINE_PROJECT: ProjectFile = {
  kind: "project",
  v: 1,
  id: "engine",
  name: "Engine",
  game: null,
};

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
