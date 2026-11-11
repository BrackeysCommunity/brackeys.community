import { createRegistry } from "@jams/engine/game";
import { applyOps, formatScene, parseScene, sceneHash, validateScene } from "@jams/engine/scene";

import { coinGame } from "./coin-game";

const registry = createRegistry(coinGame);

/** Moves a coin 0.32 m right and returns the canonical text, or the issues that stopped it. */
export function nudgeCoin(text: string, id: string): string | string[] {
  const parsed = parseScene(text, registry);
  if (!parsed.ok) return parsed.issues.map((i) => `${i.code}: ${i.message}`);

  const result = applyOps(
    parsed.def,
    { ops: [{ op: "move", refs: [id], by: [0.32, 0] }] },
    registry,
  );
  if (!result.ok) return [`${result.issue.code}: ${result.issue.message}`];

  const warnings = validateScene(result.def, registry).filter((i) => i.severity !== "error");
  for (const w of warnings) console.warn(`${w.code} at ${w.path}: ${w.message}`);
  console.log(`${sceneHash(parsed.def)} → ${result.hash}`);
  return formatScene(result.def).text;
}
