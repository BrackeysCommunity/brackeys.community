/**
 * The Shaper's play-mode preview: number keys pick a construct, the ghost
 * follows the pointer, the wheel rotates it. Placing and removing don't
 * touch the simulation: they send `shaper-place` and `shaper-remove`
 * commands, which the runtime applies on the next tick (and a replay
 * applies from the recording).
 */

import type { Vec2 } from "@jams/engine";
import {
  createPlacementTool,
  degToRad,
  type GameCommand,
  type PlacementGhost,
  type SceneView,
  type Style,
} from "@jams/engine/game";
import { roundLength, type Bounds, type ShapeObj } from "@jams/engine/scene";

import type { GrappleAnchorSystem } from "../entities/grapple-anchor";
import {
  CONSTRUCT_CONFIGS,
  constructShape,
  type ConstructSystem,
  type ConstructType,
  type PlacementValidation,
} from "../entities/shaper-constructs";
import { PLATFORMER_LAYERS } from "../layers";

export {
  validatePlacement,
  zeroCounts,
  type PlacementValidation,
} from "../entities/shaper-constructs";

export const SHAPER_PLACE = "shaper-place";
export const SHAPER_REMOVE = "shaper-remove";

// ─── Shaper system ───────────────────────────────────────

/** The view id of the placement ghost; `#` keeps it apart from scene and bulk ids. */
const PREVIEW_ID = "~shaper#preview";
/** The ghost's opacity over the construct it previews. */
const PREVIEW_ALPHA = 0.4;
/** Degrees per scroll notch: whole degrees, so the ghost turns as far as the command's `rot`. */
const ROTATE_STEP_DEG = 9;
/** How far outside a construct's outline a right click still removes it, metres. */
const PICK_SLACK = 0.1;

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

/** Whether `at` lies on construct `type` centred at `centre`, turned `rotation` radians, within `slack`. */
export function coversPoint(
  type: ConstructType,
  centre: Vec2,
  rotation: number,
  at: Vec2,
  slack = 0,
): boolean {
  const shape = constructShape(type);
  const dx = at.x - centre.x;
  const dy = at.y - centre.y;
  if (shape.type === "circle") return dx * dx + dy * dy <= (shape.r + slack) ** 2;
  if (shape.type !== "box") return false;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const lx = dx * cos + dy * sin;
  const ly = -dx * sin + dy * cos;
  return Math.abs(lx) <= shape.hw + slack && Math.abs(ly) <= shape.hh + slack;
}

export type ShaperSystem = {
  /** Current mode: true = placing objects, false = runner control */
  isActive: () => boolean;
  setActive: (active: boolean) => void;
  /** Currently selected construct type */
  getSelectedType: () => ConstructType | null;
  selectType: (type: ConstructType) => void;
  clearSelection: () => void;
  /** Each tick, with the world-space pointer; the ghost shows only while active. */
  updatePreview: (mouseWorldPos: Vec2, dtMs?: number) => void;
  /** Sends a `shaper-place` for the ghost when this tick's rules allow it. */
  place: () => PlacementValidation;
  /** Sends a `shaper-remove` for the Shaper's construct under the pointer; false when there is none. */
  remove: () => boolean;
  /** The Shaper's construct at `at`, the latest placed first. */
  removableAt: (at: Vec2) => string | undefined;
  /** The Shaper's construct under the pointer. */
  hovered: () => string | undefined;
  /** Rotate preview (scroll wheel delta) */
  rotatePreview: (delta: number) => void;
  destroy: () => void;
};

export type ShaperDeps = {
  view: SceneView | null;
  /** Read for the placement rules and the constructs a right click can remove. */
  constructs: ConstructSystem;
  /** The grapple anchors, so a placed anchor is picked by its grapple point. */
  anchors: GrappleAnchorSystem;
  /** The scene's bounds: the ghost hides outside them, where nothing can be placed. */
  bounds: Bounds;
  /** Queues a command for the next tick; omitted, placing and removing send nothing. */
  send?: (command: GameCommand) => boolean;
};

export function createShaperSystem({
  view,
  constructs,
  anchors,
  bounds,
  send,
}: ShaperDeps): ShaperSystem {
  let active = false;
  let pointer: Vec2 = { x: 0, y: 0 };
  let sent = false;

  const pose = ({ at, rotation }: PlacementGhost<ConstructType>) =>
    view?.pose(PREVIEW_ID, at.x, at.y, rotation);

  const placement = createPlacementTool<ConstructType>({
    rotatable: (type) => CONSTRUCT_CONFIGS[type].rotatable,
    rotateStep: degToRad(ROTATE_STEP_DEG),
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
    validate: ({ template, at }) => constructs.checkShape(template, at),
    commit({ template, at, rotation }) {
      sent =
        send?.({
          name: SHAPER_PLACE,
          args: {
            type: template,
            at: [roundLength(at.x), roundLength(at.y)],
            rot: Math.round((rotation * 180) / Math.PI),
          },
        }) ?? false;
    },
  });

  function setActive(a: boolean): void {
    active = a;
    if (!a) placement.hide();
  }

  function place(): PlacementValidation {
    if (!placement.selected()) return { valid: false, reason: "No construct selected" };
    sent = false;
    const check = placement.place();
    if (check.valid && !sent) return { valid: false, reason: "The command was refused" };
    return check;
  }

  function removableAt(at: Vec2): string | undefined {
    const ids = constructs.shaped();
    const anchor = anchors.findClosest(at, PICK_SLACK + CONSTRUCT_CONFIGS.grapple_anchor.hw);
    if (anchor && ids.includes(anchor.id)) return anchor.id;
    for (let i = ids.length - 1; i >= 0; i--) {
      const info = constructs.get(ids[i]!);
      if (!info) continue;
      const rotation = CONSTRUCT_CONFIGS[info.construct].rotatable ? info.rotation : 0;
      if (coversPoint(info.construct, info.position, rotation, at, PICK_SLACK)) return info.id;
    }
    return undefined;
  }

  return {
    isActive: () => active,
    setActive,
    getSelectedType: placement.selected,
    selectType: placement.select,
    clearSelection: placement.clear,
    updatePreview(mouseWorldPos: Vec2) {
      pointer = { x: mouseWorldPos.x, y: mouseWorldPos.y };
      const [minX, minY, maxX, maxY] = bounds;
      const inside =
        pointer.x >= minX && pointer.x <= maxX && pointer.y >= minY && pointer.y <= maxY;
      placement.move(mouseWorldPos, active && inside);
    },
    place,
    hovered: () => removableAt(pointer),
    remove() {
      const id = removableAt(pointer);
      if (id === undefined || !send) return false;
      return send({ name: SHAPER_REMOVE, args: { id } });
    },
    removableAt,
    rotatePreview: placement.rotate,
    destroy: placement.destroy,
  };
}
