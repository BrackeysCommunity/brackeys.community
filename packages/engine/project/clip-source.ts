import type { AssetInfo } from "./asset-info";
import {
  ANIMATION_KIND,
  sourceClipNames,
  type AnimationFile,
  type ClipSource,
} from "./kinds/animation";
import { ATLAS_KIND } from "./kinds/atlas";
import type { ProjectRuntimeView } from "./runtime-view";
import type { AssetId } from "./types";

/** Where an `anim` block's `source` is read from: blob infos, and docs when the reader has them. */
export type ClipSourceLookup = Pick<ProjectRuntimeView, "asset" | "doc">;

const animationOf = (project: ClipSourceLookup, source: AssetId) =>
  project.doc?.<AnimationFile>(ANIMATION_KIND, source);

/**
 * What an `anim` block's `source` plays in `project`: the animation doc of
 * that id over its atlas, else the atlas of that id with its tags as clips;
 * null when the atlas isn't there.
 */
export function clipSourceIn(
  project: ClipSourceLookup,
  source: AssetId,
): { source: ClipSource; atlas: AssetInfo } | null {
  const doc = animationOf(project, source);
  const atlas = project.asset(doc ? doc.atlas : source);
  if (!atlas) return null;
  return { source: doc ? { animation: doc } : { atlas }, atlas };
}

/**
 * The clips an `anim` block's `source` offers, in file order, and what it
 * is: an animation doc's clips, else an atlas's tags. Null when neither can
 * be read: no such doc (or no `doc` to read it with), and no atlas with tags.
 * The scene validator and the inspector both list clips through here.
 */
export function sourceClipsIn(
  project: ClipSourceLookup,
  source: AssetId,
): { what: "animation" | "atlas"; names: string[] } | null {
  const animation = animationOf(project, source);
  if (animation) return { what: "animation", names: sourceClipNames({ animation }) };
  const atlas = project.asset(source);
  if (atlas?.kind !== ATLAS_KIND || !atlas.tags) return null;
  return { what: "atlas", names: sourceClipNames({ atlas }) };
}
