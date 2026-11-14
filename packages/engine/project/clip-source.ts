import type { AssetInfo } from "./asset-info";
import { ANIMATION_KIND, type AnimationFile, type ClipSource } from "./kinds/animation";
import type { ProjectRuntimeView } from "./runtime-view";
import type { AssetId } from "./types";

/**
 * What an `anim` block's `source` plays in `project`: the animation doc of
 * that id over its atlas, else the atlas of that id with its tags as clips;
 * null when the atlas isn't there.
 */
export function clipSourceIn(
  project: Pick<ProjectRuntimeView, "asset" | "doc">,
  source: AssetId,
): { source: ClipSource; atlas: AssetInfo } | null {
  const doc = project.doc?.<AnimationFile>(ANIMATION_KIND, source);
  const atlas = project.asset(doc ? doc.atlas : source);
  if (!atlas) return null;
  return { source: doc ? { animation: doc } : { atlas }, atlas };
}
