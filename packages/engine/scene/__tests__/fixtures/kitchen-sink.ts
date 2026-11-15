import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { textFontOf } from "../../../game/behaviors/text";
import { createRegistry, withProject } from "../../../game/define";
import { localeFont, localeSettingsOf } from "../../../project/kinds/strings";
import { runtimeView } from "../../../project/runtime-view";
import { projectView } from "../../../project/view";
import { stringTableData } from "../../../text/strings";
import {
  createProjectFileAdapter,
  readFileProject,
  readPrefabFiles,
} from "../../../vite/project-files";
import { parseSceneOrThrow } from "../../parse";

/**
 * The engine project's kitchen sink with its prefabs, and what it is drawn
 * with: the project view, the registry, and the default locale's strings and
 * font, as `scene render` passes them.
 */
export async function loadKitchenSink() {
  const dir = fileURLToPath(new URL("../../../scenes/", import.meta.url));
  const cacheDir = await mkdtemp(join(tmpdir(), "kitchen-sink-render-"));
  try {
    const project = await readFileProject(dir, { cacheDir });
    const { state } = await createProjectFileAdapter(project).scan();
    const view = projectView(state, project.kinds);
    const values = new Map<string, unknown>();
    for (const entry of view.byId.values())
      if (entry.sha256 === undefined)
        values.set(entry.id, JSON.parse(await readFile(join(dir, entry.path), "utf8")));
    const registry = withProject(createRegistry(), view, values);
    const { prefabs } = await readPrefabFiles(dir, registry);
    const scene = parseSceneOrThrow(values.get("kitchen-sink"), registry, {
      prefab: (id) => prefabs.get(id),
    });
    const runtime = runtimeView(view, values, registry, project.kinds);
    const locales = localeSettingsOf(runtime.engine.locales);
    const font = textFontOf((id) => runtime.asset(id), localeFont(locales, locales.default));
    const strings = stringTableData(runtime, locales.default, font);
    return { scene, view, registry, prefabs, strings };
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
}
