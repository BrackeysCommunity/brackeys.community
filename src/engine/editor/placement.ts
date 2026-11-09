import type { Style } from "../game/types";
import { createPlacementTool, type PlacementCheck, type PlacementGhost } from "../placement";
import { aabb, translateShape } from "../scene/shape-geometry";
import type { Aabb, EntityInput, Pt, SceneDefinition, ShapeObj } from "../scene/types";
import type { Vec2 } from "../types";
import { nextFreeId } from "./clipboard";
import type { EditorTool, EditorToolContext, EditorToolDef, ToolOverlay } from "./tools";

// ─── As an editor tool ───────────────────────────────────

/** Something an editor placement tool places: its outline in its own frame, centred on 0, 0. */
export type PlacementTemplate = {
  /** What `tool:<toolId>:<id>` picks; also the stem of the placed entity's id (`bounce_pad` → `bounce-pad-2`). */
  id: string;
  label: string;
  shape: ShapeObj;
  style?: Style;
  rotatable?: boolean;
};

export type PlacementEditorToolOptions<T extends PlacementTemplate> = {
  id: string;
  label: string;
  description: string;
  templates: readonly T[];
  /** The entity a placement adds, at a whole-pixel centre and whole-degree rotation. */
  toEntity(template: T, at: Pt, rotDeg: number, ctx: EditorToolContext): EntityInput;
  /**
   * A game's warnings beside the engine's bounds check (a spawn overlap).
   * Only a warning: an invalid result marks the ghost, and the placement
   * still commits, because gameplay rules belong to play, not the editor.
   */
  validate?(placed: PlacedTemplate<T>, ctx: EditorToolContext): PlacementCheck;
};

/** A ghost as the editor places it: whole pixels and degrees, and its world shape. */
export type PlacedTemplate<T> = { template: T; at: Pt; rotDeg: number; shape: ShapeObj };

const DEG = Math.PI / 180;

function rotatePt([x, y]: Pt, rad: number): Pt {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [x * c - y * s, x * s + y * c];
}

/** A template's local shape turned by `rotDeg` about its origin and moved to `at`. */
export function placedShape(shape: ShapeObj, at: Pt, rotDeg: number): ShapeObj {
  let turned: ShapeObj;
  switch (shape.type) {
    case "box":
    case "capsule":
      turned = { ...shape, rotDeg: shape.rotDeg + rotDeg };
      break;
    case "circle":
      turned = shape;
      break;
    default:
      turned = { type: shape.type, pts: shape.pts.map((p) => rotatePt(p, rotDeg * DEG)) };
  }
  return translateShape(turned, at);
}

/** A template id as an entity id stem: lowercase, anything else a hyphen. */
const idStem = (id: string) =>
  id
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "entity";

const OUT_OF_BOUNDS = "Out of bounds";

/**
 * The engine's check on anything about to land in a scene (a placement
 * ghost, a drop, a drawn shape): it has to fit inside the scene's bounds.
 */
export function boundsCheck(box: Aabb, def: SceneDefinition): PlacementCheck {
  const [minX, minY, maxX, maxY] = def.bounds;
  return box.minX >= minX && box.minY >= minY && box.maxX <= maxX && box.maxY <= maxY
    ? { valid: true }
    : { valid: false, reason: OUT_OF_BOUNDS };
}

/**
 * An editor tool that places templates as scene entities: `tool:<id>:<template>`
 * picks one, the ghost follows the snapped pointer, the wheel (or the
 * rotate commands) turns a rotatable one by the snap angle, a left click
 * commits one `add` batch, and right click or Escape drops the template
 * without a batch.
 */
export function placementEditorTool<T extends PlacementTemplate>(
  opts: PlacementEditorToolOptions<T>,
): EditorToolDef {
  return {
    id: opts.id,
    label: opts.label,
    description: opts.description,
    create(ctx): EditorTool {
      const placed = (g: PlacementGhost<T>): PlacedTemplate<T> => {
        const at: Pt = [g.at.x, g.at.y];
        const rotDeg = Math.round(g.rotation / DEG);
        return {
          template: g.template,
          at,
          rotDeg,
          shape: placedShape(g.template.shape, at, rotDeg),
        };
      };
      const warning = (p: PlacedTemplate<T>): PlacementCheck => {
        const inside = boundsCheck(aabb(p.shape), ctx.getDoc());
        if (!inside.valid) return inside;
        return opts.validate?.(p, ctx) ?? { valid: true };
      };
      const redraw = () => ctx.invalidate();
      const placement = createPlacementTool<T>({
        draw: { show: redraw, pose: redraw, hide: redraw },
        rotatable: (t) => t.rotatable !== false,
        rotateStep: DEG,
        validate: () => ({ valid: true }),
        commit(g) {
          const { template, at, rotDeg } = placed(g);
          const entity = opts.toEntity(template, at, rotDeg, ctx);
          const taken = new Set((ctx.getDoc().entities ?? []).map((e) => e.id));
          const id = entity.id ?? nextFreeId(idStem(template.id), taken);
          ctx.commit(
            { label: `Place ${template.label}`, ops: [{ op: "add", entity: { ...entity, id } }] },
            { selectionAfter: [id] },
          );
        },
      });

      function snapped(world: Pt, free: boolean): Vec2 {
        const snap = ctx.snap();
        const grid = (v: number) =>
          !free && snap.enabled ? Math.round(v / snap.step) * snap.step : Math.round(v);
        return { x: grid(world[0]), y: grid(world[1]) };
      }

      /** One notch is the snap angle; `free` (Shift) turns by a degree. */
      const turn = (dir: 1 | -1, free = false) => {
        placement.rotate(dir * (free ? 1 : ctx.snap().angleDeg));
        ctx.invalidate();
      };

      return {
        command(command) {
          if (command === "rotate-cw" || command === "rotate-ccw") {
            if (!placement.selected()) return false;
            turn(command === "rotate-cw" ? 1 : -1);
            return true;
          }
          const template = opts.templates.find((t) => t.id === command);
          if (!template) return false;
          placement.select(template);
          return true;
        },
        pointer(e) {
          if (e.type === "move") {
            placement.move(snapped(e.world, e.mod));
            return placement.selected() !== null;
          }
          if (!placement.selected()) return false;
          if (e.type === "wheel") {
            if (e.deltaY !== 0) turn(e.deltaY > 0 ? 1 : -1, e.shift);
            return true;
          }
          if (e.type !== "down") return e.type === "up";
          if (e.button === 2) {
            placement.clear();
            return true;
          }
          if (e.button !== 0) return false;
          placement.move(snapped(e.world, e.mod));
          placement.place();
          return true;
        },
        cancel() {
          if (!placement.selected()) return false;
          placement.clear();
          return true;
        },
        overlay(): ToolOverlay {
          const g = placement.ghost();
          if (!g) return {};
          const p = placed(g);
          const check = warning(p);
          return {
            ghosts: [
              {
                shape: p.shape,
                ...(p.template.style ? { style: p.template.style } : {}),
                valid: check.valid,
                ...(check.reason ? { reason: check.reason } : {}),
              },
            ],
          };
        },
        cursor: () => (placement.selected() ? "crosshair" : undefined),
        destroy: placement.destroy,
      };
    },
  };
}
