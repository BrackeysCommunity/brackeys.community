import {
  placementEditorTool,
  type EditorToolDef,
  type PlacementTemplate,
} from "@jams/engine/editor";
import { aabb, type Aabb, type Pt, type SceneDefinition } from "@jams/engine/scene";

import { CONSTRUCTS_TOOL } from "./edit-keys";
import { PLAYER_HEIGHT, PLAYER_WIDTH } from "./entities/player";
import {
  CONSTRUCT_CONFIGS,
  CONSTRUCT_TYPES,
  constructShape,
  type ConstructType,
} from "./entities/shaper-constructs";
import { TYPE } from "./type-names";

type ConstructTemplate = PlacementTemplate & { id: ConstructType };

const TEMPLATES: readonly ConstructTemplate[] = CONSTRUCT_TYPES.map((type) => {
  const { label, color, rotatable } = CONSTRUCT_CONFIGS[type];
  return {
    id: type,
    label,
    shape: constructShape(type),
    style: { fill: color, stroke: color, alpha: 0.3, strokeAlpha: 0.8 },
    rotatable,
  };
});

/** The box the player fills standing on each spawn (spawns are its feet). */
function spawnBoxes(def: SceneDefinition): Aabb[] {
  const feet: Pt[] = [
    ...(def.entities ?? []).filter((e) => e.type === TYPE.spawn).map((e) => e.at as Pt),
    ...(Array.isArray(def[TYPE.spawn]) ? (def[TYPE.spawn] as Pt[]) : []),
  ];
  return feet.map(([x, y]) => ({
    minX: x - PLAYER_WIDTH / 2,
    minY: y - PLAYER_HEIGHT,
    maxX: x + PLAYER_WIDTH / 2,
    maxY: y,
  }));
}

const overlaps = (a: Aabb, b: Aabb) =>
  a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;

/**
 * Places Shaper constructs as scene entities in edit mode. Pre-placed
 * constructs ignore the Shaper's cooldown and per-round limits, so the only
 * warning beside the engine's bounds check is a construct over a spawn.
 */
const constructsTool = placementEditorTool<ConstructTemplate>({
  id: CONSTRUCTS_TOOL,
  label: "Constructs",
  description: "Place Shaper constructs: 1-6 pick one, the wheel turns it, click places it.",
  templates: TEMPLATES,
  toEntity: (template, at, rotDeg) => {
    const rot = ((rotDeg % 360) + 360) % 360;
    return { type: TYPE.construct, construct: template.id, at, ...(rot !== 0 ? { rot } : {}) };
  },
  validate({ shape }, ctx) {
    const box = aabb(shape);
    return spawnBoxes(ctx.getDoc()).some((s) => overlaps(box, s))
      ? { valid: false, reason: "Overlaps a spawn" }
      : { valid: true };
  },
});

/** The platformer's editor tools, loaded when an editor opens. */
export const PLATFORMER_EDITOR_TOOLS: readonly EditorToolDef[] = [constructsTool];
