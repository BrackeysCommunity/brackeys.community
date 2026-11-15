import { assetInfo } from "../project/asset-info";
import type { SynthFile } from "../project/kinds/synth";
import type { AssetId, ProjectView } from "../project/types";
import { synthDurationMs } from "./synth";

/**
 * A sound variant's length, ms: a synth patch's as `synthDurationMs` gives
 * it (`synth` finds the patch), else an audio clip's from its header meta;
 * null for a sound or an id whose length isn't known.
 */
export function soundLeafMs(
  view: ProjectView | null,
  id: AssetId,
  synth: (id: AssetId) => SynthFile | undefined,
): number | null {
  const patch = synth(id);
  if (patch) return synthDurationMs(patch);
  return (view && assetInfo(view, id)?.audio?.durationMs) ?? null;
}
