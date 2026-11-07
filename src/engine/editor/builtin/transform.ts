import type { OpBatch, Pt } from "../../scene/types";
import { rotationPivot, targetsOf } from "../commands";
import { dragAngle } from "../gizmos/drag";
import { rotateTargetsBatch } from "../gizmos/multi";
import { readAngle } from "../gizmos/readout";
import type { GizmoTarget } from "../gizmos/target";
import { pickAt } from "../picking";
import { snapAngle } from "../snap";
import { defineEditorTool, type ToolOverlay } from "../tools";
import { PICK_TOL_PX } from "./polyline";

/**
 * The rotate tool (`R`): a drag anywhere turns the selection about its
 * centre, snapped to the snap angle (Shift: free), as one batch on release.
 * With nothing selected a click selects the topmost entity.
 */
export const rotateTool = defineEditorTool({
  id: "rotate",
  label: "Rotate",
  description: "Drag to rotate the selection about its centre; Shift rotates freely.",
  create(ctx) {
    let drag: {
      from: Pt;
      about: Pt;
      targets: GizmoTarget[];
      deg: number;
      batch: OpBatch | null;
      at: Pt;
    } | null = null;
    const drop = () => {
      if (drag) ctx.preview(null);
      drag = null;
      ctx.invalidate();
    };
    return {
      pointer(e) {
        if (e.type === "down") {
          if (e.button !== 0) return false;
          const targets = targetsOf(ctx.getDoc(), ctx.registry, ctx.selection());
          const about = rotationPivot(targets);
          if (!about) {
            const top = pickAt(ctx.index(), e.world, {
              tolPx: PICK_TOL_PX,
              scale: ctx.scale(),
              layers: ctx.layers(),
            })[0];
            ctx.select(top ? [top.ref] : []);
            return true;
          }
          drag = { from: e.world, about, targets, deg: 0, batch: null, at: e.world };
          return true;
        }
        if (!drag) return false;
        if (e.type === "move") {
          drag.at = e.world;
          drag.deg =
            Math.round(snapAngle(dragAngle(drag.about, drag.from, e.world), ctx.snap(), e.shift)) +
            0;
          drag.batch = rotateTargetsBatch(drag.targets, drag.about, drag.deg);
          ctx.preview(drag.batch);
          ctx.invalidate();
          return true;
        }
        if (e.type === "up") {
          const batch = drag.batch;
          drop();
          if (batch) ctx.commit(batch);
          return true;
        }
        return false;
      },
      cancel() {
        if (!drag) return false;
        drop();
        return true;
      },
      gesture: () => drag !== null,
      overlay(): ToolOverlay {
        if (!drag) return {};
        return {
          guides: [{ from: drag.about, to: drag.at }],
          readout: { at: drag.at, text: readAngle(drag.deg) },
        };
      },
      cursor: () => (drag ? "grabbing" : "grab"),
    };
  },
});

/**
 * The pan tool (`H`, or Space held): a drag moves the view with the
 * pointer through the host's camera.
 */
export const panTool = defineEditorTool({
  id: "pan",
  label: "Pan",
  description: "Drag to pan the view.",
  create(ctx) {
    let last: Pt | null = null;
    return {
      pointer(e) {
        if (e.type === "down") {
          if (!e.screen || !ctx.pan) return false;
          last = e.screen;
          return true;
        }
        if (!last) return false;
        if (e.type === "move" && e.screen) {
          ctx.pan?.([e.screen[0] - last[0], e.screen[1] - last[1]]);
          last = e.screen;
          return true;
        }
        if (e.type === "up") {
          last = null;
          return true;
        }
        return false;
      },
      cancel() {
        if (!last) return false;
        last = null;
        return true;
      },
      gesture: () => last !== null,
      cursor: () => (last ? "grabbing" : "grab"),
    };
  },
});
