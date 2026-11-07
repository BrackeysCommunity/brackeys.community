import { createRegistry } from "@jams/engine/game";
import { parseSceneOrThrow, renderSceneAscii, renderSceneSvg } from "@jams/engine/scene";

import { coinGame } from "./coin-game";

const registry = createRegistry(coinGame);

/** A labelled schematic of the area around one entity, and the whole scene as text. */
export function picture(text: string, around: string): { svg: string; ascii: string } {
  const scene = parseSceneOrThrow(text, registry);
  return {
    svg: renderSceneSvg(scene, { registry, around, margin: 200, labels: "entities" }),
    ascii: renderSceneAscii(scene, { registry }),
  };
}
