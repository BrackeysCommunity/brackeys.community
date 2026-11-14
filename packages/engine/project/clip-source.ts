import { assetInfo, type AssetInfo } from "./asset-info";
import {
  ANIMATION_KIND,
  sourceAnimation,
  sourceClipNames,
  type AnimFrameDef,
  type AnimationFile,
  type ClipDef,
  type ClipSource,
} from "./kinds/animation";
import { ATLAS_KIND } from "./kinds/atlas";
import type { ProjectRuntimeView } from "./runtime-view";
import type { AssetId, ProjectView } from "./types";

/** Where an `anim` block's `source` is read from: blob infos, and docs when the reader has them. */
export type ClipSourceLookup = Pick<ProjectRuntimeView, "asset" | "doc">;

/**
 * A `ClipSourceLookup` over `view`'s blob infos as they are now, with
 * `doc` (a runtime view's) reading animation docs: what the scene validator
 * and the inspector read an `anim` block's source through.
 */
export function clipLookupOf(view: ProjectView, doc?: ProjectRuntimeView["doc"]): ClipSourceLookup {
  return { asset: (id) => assetInfo(view, id) ?? undefined, ...(doc ? { doc } : {}) };
}

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

/** The atlas tag `clip` plays; undefined when it names none or the atlas lacks it. */
export const tagOf = (clip: ClipDef, atlas: AssetInfo) =>
  clip.tag === undefined ? undefined : atlas.tags?.find((t) => t.name === clip.tag);

/** A clip's frames: its tag's (reversed for a reverse tag), each replaced by `frames` at its index, then the rest of `frames`. */
export function clipFrames(clip: ClipDef, atlas: AssetInfo): readonly AnimFrameDef[] {
  const own = clip.frames ?? [];
  const tag = tagOf(clip, atlas);
  if (!tag) return own;
  const tagged = (atlas.frames ?? []).slice(tag.from, tag.to + 1);
  if (tag.direction === "reverse") tagged.reverse();
  const base = tagged.map((frame, i): AnimFrameDef => own[i] ?? { frame });
  return [...base, ...own.slice(base.length)];
}

/**
 * What a sprite needs to draw an `anim` block's frames, which it draws from
 * its own asset: the atlas `source` plays over, the first frame of `clip`
 * (else of the atlas), and the frames the source's clips play that `drawn`
 * (the sprite's asset; undefined for none) lacks, empty when it has them
 * all. Null when the source can't be read. The scene validator's
 * `anim-atlas-mismatch` and the inspector's Add behavior and source picker
 * all ask here.
 */
export function animSpriteOf(
  project: ClipSourceLookup,
  source: AssetId,
  clip: string | undefined,
  drawn: AssetId | undefined,
): { atlas: AssetId; frame: string | undefined; missing: string[] } | null {
  const found = clipSourceIn(project, source);
  if (!found) return null;
  const { atlas } = found;
  const clips = sourceAnimation(found.source).clips;
  const picked = clips.find((c) => c.name === clip);
  const frame = (picked && clipFrames(picked, atlas)[0]?.frame) ?? atlas.frames?.[0];
  if (drawn === atlas.id) return { atlas: atlas.id, frame, missing: [] };
  const has = new Set(drawn === undefined ? [] : (project.asset(drawn)?.frames ?? []));
  const missing = new Set<string>();
  for (const c of clips)
    for (const f of clipFrames(c, atlas)) if (!has.has(f.frame)) missing.add(f.frame);
  return { atlas: atlas.id, frame, missing: [...missing] };
}
