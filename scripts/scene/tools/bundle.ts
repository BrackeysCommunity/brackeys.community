import { sceneBundle } from "@jams/engine/project";
import { expandScene } from "@jams/engine/scene";

import { failure, issueLine, openScene, type Tool } from "../context";
import { loadProject } from "./project-show";

export type BundleInput = { scene?: string };

/**
 * The blobs a scene loads before it draws (`sceneBundle` of its expanded
 * entities, settings and asset headers, those of the prefabs it places or
 * a field names included, and the blobs a runtime doc a field names
 * brings), with its `asset-missing` issues; exit 1 when there are any.
 */
export const bundle: Tool<BundleInput> = async (input, ctx) => {
  const opened = await openScene(ctx, input.scene, "bundle");
  if (!opened.ok) return opened.result;
  const { name, def, registry, prefabs, project } = opened;
  if (!project)
    return failure(`${name} isn't in a project, so its asset ids have nothing to resolve in`, {
      scene: name,
    });
  const { view, values } = await loadProject(project);
  const expanded = expandScene(def, registry, { prefabs });
  const { bundle: b, issues } = sceneBundle(expanded, def, prefabs, view, project.kinds, registry, {
    read: (_kind, id) => values.get(id),
  });
  const errors = issues.some((i) => i.severity === "error");
  const rows = b.entries.map((e) => `  ${e.id}  ${e.kind}  ${e.sha256}  ${e.bytes} B`);
  const count = `${b.entries.length} ${b.entries.length === 1 ? "blob" : "blobs"}`;
  return {
    exitCode: errors ? 1 : 0,
    data: { ok: !errors, project: project.file.id, scene: name, bundle: b, issues },
    text: [`${name}: ${count}, ${b.bytes} B`, ...rows, ...issues.map(issueLine)].join("\n"),
  };
};
