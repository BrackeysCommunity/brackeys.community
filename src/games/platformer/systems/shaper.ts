/**
 * Shaper placement system — manages the Shaper's object placement flow.
 *
 * When in Shaper mode:
 *   - Number keys (1-6) select construct type
 *   - Mouse shows placement preview (ghost) at cursor
 *   - Scroll wheel rotates preview (for rotatable constructs)
 *   - Left click places the construct
 *   - Right click or Escape cancels selection
 *
 * The ghost, rotate and place mechanics are the engine's placement tool;
 * the Shaper adds its gameplay rules: cooldown, max per round, position
 * within the scene bounds. For now, single-player only (no server validation).
 */

import type { Vec2 } from "@jams/engine";
import { createPlacementTool, type PlacementCheck, type PlacementGhost } from "@jams/engine/game";
import type { SceneView, Style } from "@jams/engine/game";
import type { Bounds, ShapeObj } from "@jams/engine/scene";

import type { GrappleAnchorSystem } from "../entities/grapple-anchor";
import {
  CONSTRUCT_CONFIGS,
  CONSTRUCT_TYPES,
  constructShape,
  type ConstructSystem,
  type ConstructType,
} from "../entities/shaper-constructs";
import { PLATFORMER_LAYERS } from "../layers";

// ─── Placement validation ────────────────────────────────

export type PlacementValidation = PlacementCheck;

const PLACEMENT_COOLDOWN_MS = 500; // ms between placements

export function validatePlacement(
  type: ConstructType,
  position: Vec2,
  placedCounts: Record<ConstructType, number>,
  lastPlacementTimeMs: number,
  currentTimeMs: number,
  bounds: Bounds,
): PlacementValidation {
  const config = CONSTRUCT_CONFIGS[type];

  // Cooldown
  if (currentTimeMs - lastPlacementTimeMs < PLACEMENT_COOLDOWN_MS) {
    const remaining =
      Math.ceil((PLACEMENT_COOLDOWN_MS - (currentTimeMs - lastPlacementTimeMs)) / 100) / 10;
    return { valid: false, reason: `Cooldown: ${remaining}s` };
  }

  // Max per round
  if ((placedCounts[type] ?? 0) >= config.maxPerRound) {
    return { valid: false, reason: `Max ${config.label}s reached (${config.maxPerRound})` };
  }

  const [minX, minY, maxX, maxY] = bounds;
  if (position.x < minX || position.x > maxX || position.y < minY || position.y > maxY) {
    return { valid: false, reason: "Out of bounds" };
  }

  return { valid: true };
}

// ─── Shaper system ───────────────────────────────────────

/** The view id of the placement ghost; `#` keeps it apart from scene and bulk ids. */
const PREVIEW_ID = "~shaper#preview";
/** The ghost's opacity over the construct it previews. */
const PREVIEW_ALPHA = 0.4;
/** Radians per scroll notch, about 8.6°. */
const ROTATE_STEP = 0.15;

function previewLook(type: ConstructType, shape: ShapeObj): Style {
  const { color } = CONSTRUCT_CONFIGS[type];
  const round = shape.type === "circle";
  return {
    fill: color,
    stroke: color,
    alpha: (round ? 0.3 : 0.2) * PREVIEW_ALPHA,
    strokeAlpha: 0.6 * PREVIEW_ALPHA,
    strokeWidth: round ? 2 : 1,
  };
}

/** A count of 0 for every construct type. */
export function zeroCounts(): Record<ConstructType, number> {
  return Object.fromEntries(CONSTRUCT_TYPES.map((t) => [t, 0])) as Record<ConstructType, number>;
}

export type ShaperSystem = {
  /** Current mode: true = placing objects, false = runner control */
  isActive: () => boolean;
  setActive: (active: boolean) => void;
  /** Currently selected construct type */
  getSelectedType: () => ConstructType | null;
  selectType: (type: ConstructType) => void;
  clearSelection: () => void;
  /** Placement preview — call each tick with world-space mouse position */
  updatePreview: (mouseWorldPos: Vec2, dtMs: number) => void;
  /** Attempt to place at current preview position */
  place: () => PlacementValidation;
  /** Rotate preview (scroll wheel delta) */
  rotatePreview: (delta: number) => void;
  /** Ids of the constructs placed this round */
  getPlacedConstructs: () => readonly string[];
  /** Remove everything placed this round; the scene's own constructs stay */
  clearAll: () => void;
  destroy: () => void;
};

export type ShaperDeps = {
  view: SceneView | null;
  constructs: ConstructSystem;
  anchors: GrappleAnchorSystem;
  bounds: Bounds;
};

export function createShaperSystem({
  view,
  constructs,
  anchors,
  bounds,
}: ShaperDeps): ShaperSystem {
  let active = false;
  let lastPlacementTimeMs = -Infinity;
  let elapsedMs = 0;

  const placedConstructs: string[] = [];
  const placedCounts = zeroCounts();

  const pose = ({ at, rotation }: PlacementGhost<ConstructType>) =>
    view?.pose(PREVIEW_ID, at.x, at.y, rotation);

  const placement = createPlacementTool<ConstructType>({
    rotatable: (type) => CONSTRUCT_CONFIGS[type].rotatable,
    rotateStep: ROTATE_STEP,
    draw: {
      show(ghost) {
        if (!view) return;
        const shape = constructShape(ghost.template);
        view.draw(PREVIEW_ID, shape, previewLook(ghost.template, shape), PLATFORMER_LAYERS.preview);
        pose(ghost);
      },
      pose,
      hide: () => view?.remove(PREVIEW_ID),
    },
    validate: ({ template, at }) =>
      validatePlacement(template, at, placedCounts, lastPlacementTimeMs, elapsedMs, bounds),
    commit({ template, at, rotation }) {
      placedConstructs.push(constructs.place(template, at, rotation));
      placedCounts[template]++;
      lastPlacementTimeMs = elapsedMs;
    },
  });

  function setActive(a: boolean): void {
    active = a;
    if (!a) placement.hide();
  }

  function place(): PlacementValidation {
    if (!placement.selected()) return { valid: false, reason: "No construct selected" };
    return placement.place();
  }

  function clearAll(): void {
    placedConstructs.length = 0;
    Object.assign(placedCounts, zeroCounts());
    constructs.clearRuntime();
    anchors.clearRuntime();
  }

  return {
    isActive: () => active,
    setActive,
    getSelectedType: placement.selected,
    selectType: placement.select,
    clearSelection: placement.clear,
    updatePreview(mouseWorldPos: Vec2, dtMs: number) {
      elapsedMs += dtMs;
      placement.move(mouseWorldPos, active);
    },
    place,
    rotatePreview: placement.rotate,
    getPlacedConstructs: () => placedConstructs,
    clearAll,
    destroy: placement.destroy,
  };
}
