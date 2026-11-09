import type { OpBatch, Pt, Ref, SceneDefinition } from "../../scene/types";
import { targetsOf } from "../commands";
import { convertToChainFix } from "../gizmos/batch";
import { dragHandle, moveTarget } from "../gizmos/drag";
import type { DragOptions, GizmoEdit } from "../gizmos/edit";
import { hitHandle, selectionHandles, targetHandles } from "../gizmos/handles";
import { dragSelection, selectionBox } from "../gizmos/multi";
import { gizmoTarget, type GizmoTarget } from "../gizmos/target";
import { removeVertices } from "../gizmos/vertices";
import { removeWaypoints } from "../gizmos/waypoints";
import { cycleHit, marqueeSelect, pickAt } from "../picking";
import type { SelectMode } from "../selection";
import {
  defineEditorTool,
  type EditorToolContext,
  type GizmoHandle,
  type ToolOverlay,
  type ToolPointerEvent,
} from "../tools";
import { PICK_TOL_PX } from "./polyline";

/** Screen px a press must travel before it becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;

type Drag =
  /** A press on an entity that hasn't moved far enough to drag yet. */
  | { kind: "press"; from: Pt; ref: Ref; wasSelected: boolean; plain: boolean }
  | { kind: "move"; from: Pt; targets: GizmoTarget[]; edit: GizmoEdit | null }
  | {
      kind: "handle";
      from: Pt;
      handle: GizmoHandle;
      targets: GizmoTarget[];
      multi: boolean;
      edit: GizmoEdit | null;
    }
  | { kind: "marquee"; from: Pt; to: Pt; touch: boolean; mode: SelectMode; hits: Ref[] };

/** Poly and chain outlines, and anything on a path, have points to edit. */
const hasPoints = (t: GizmoTarget | undefined): t is GizmoTarget =>
  t !== undefined &&
  (t.path !== undefined || t.shape?.type === "poly" || t.shape?.type === "chain");

const rectOf = (a: Pt, b: Pt) => ({
  minX: Math.min(a[0], b[0]),
  minY: Math.min(a[1], b[1]),
  maxX: Math.max(a[0], b[0]),
  maxY: Math.max(a[1], b[1]),
});

const moveBy = (batch: OpBatch | null): Pt | null => {
  const op = batch?.ops[0];
  return batch?.ops.length === 1 && op?.op === "move" ? op.by : null;
};

/**
 * The select tool (`V`): click, Shift-add, Mod-toggle, Alt-cycle and marquee
 * selection; dragging moves the selection; handles resize and rotate one
 * entity, or move and rotate a multi-selection; a double-click (or the
 * host's `enter-sub-object`) edits a poly's, chain's or path's points. Each
 * drag previews and commits one batch on release.
 */
export const selectTool = defineEditorTool({
  id: "select",
  label: "Select",
  description:
    "Click to select, Shift to add, Ctrl/Cmd to toggle, Alt to cycle; drag to move or marquee; double-click to edit points.",
  create(ctx: EditorToolContext) {
    let drag: Drag | null = null;
    let sub: { ref: Ref; points: number[] } | null = null;
    let offer: { label: string; batch: OpBatch; ref: Ref } | null = null;
    let hover: { ref?: Ref; handle?: GizmoHandle } = {};
    let cursorAt: Pt = [0, 0];

    const pickOpts = () => ({ tolPx: PICK_TOL_PX, scale: ctx.scale(), layers: ctx.layers() });
    const dragOpts = (e: ToolPointerEvent): DragOptions => ({
      mods: { shift: e.shift, alt: e.alt, mod: e.mod },
      snap: ctx.snap(),
      scale: ctx.scale(),
      index: ctx.index(),
    });
    const selectedTargets = (doc = ctx.getDoc()) => targetsOf(doc, ctx.registry, ctx.selection());
    const subTarget = (doc = ctx.getDoc()) =>
      sub ? gizmoTarget(doc, ctx.registry, sub.ref) : undefined;

    function setSub(next: typeof sub) {
      sub = next;
      ctx.setSubObject(next !== null);
      ctx.invalidate();
    }

    /** Point editing, dropped once its entity is no longer the selection. */
    function liveSub() {
      const sel = ctx.selection();
      if (sub && (sel.length !== 1 || sel[0] !== sub.ref)) {
        sub = null;
        ctx.setSubObject(false);
      }
      return sub;
    }

    /**
     * The handles a press can grab now, and whether they belong to a
     * multi-selection; in `doc`'s state, the previewed one during a drag.
     */
    function handlesNow(doc: SceneDefinition = ctx.getDoc()): {
      handles: GizmoHandle[];
      targets: GizmoTarget[];
      multi: boolean;
    } {
      const scale = ctx.scale();
      const st = liveSub() && subTarget(doc);
      if (sub && st) {
        const handles = targetHandles(st, { scale, subObject: true }).map((h) => {
          const index = Number(h.id.slice(h.id.indexOf(":") + 1));
          return h.kind !== "insert" && sub!.points.includes(index) ? { ...h, active: true } : h;
        });
        return { handles, targets: [st], multi: false };
      }
      const targets = selectedTargets(doc);
      if (targets.length === 1) {
        return { handles: targetHandles(targets[0]!, { scale }), targets, multi: false };
      }
      if (targets.length > 1) {
        return { handles: selectionHandles(selectionBox(targets), scale), targets, multi: true };
      }
      return { handles: [], targets, multi: false };
    }

    function enterSub(): boolean {
      const sel = ctx.selection();
      const t = sel.length === 1 ? gizmoTarget(ctx.getDoc(), ctx.registry, sel[0]!) : undefined;
      if (!hasPoints(t)) return false;
      setSub({ ref: t.ref, points: [] });
      return true;
    }

    function dropDrag() {
      if (drag && (drag.kind === "move" || drag.kind === "handle")) {
        ctx.preview(null);
        ctx.shareGhost(undefined);
      }
      drag = null;
      ctx.invalidate();
    }

    function down(e: ToolPointerEvent): boolean {
      offer = null;
      ctx.hover?.(null);
      const world = e.world;
      const { handles, targets, multi } = handlesNow();
      const hit = hitHandle(handles, world, ctx.scale());

      const editing = liveSub();
      if (editing) {
        if (hit) {
          const index = Number(hit.id.slice(hit.id.indexOf(":") + 1));
          if (hit.kind === "vertex" || hit.kind === "waypoint") {
            const has = editing.points.includes(index);
            editing.points = e.shift
              ? has
                ? editing.points.filter((i) => i !== index)
                : [...editing.points, index]
              : has
                ? editing.points
                : [index];
          }
          drag = { kind: "handle", from: world, handle: hit, targets, multi: false, edit: null };
          ctx.invalidate();
          return true;
        }
        setSub(null);
      }

      const picks = pickAt(ctx.index(), world, pickOpts());
      const sel = ctx.selection();
      if (e.clicks >= 2 && sel.length === 1 && picks.some((p) => p.ref === sel[0]) && enterSub()) {
        return true;
      }
      if (hit && !(e.alt && hit.kind !== "move")) {
        drag = { kind: "handle", from: world, handle: hit, targets, multi, edit: null };
        ctx.invalidate();
        return true;
      }
      if (e.alt && picks.length > 0) {
        const next = cycleHit(picks, sel.length === 1 ? sel[0] : undefined);
        if (next !== undefined) ctx.select([next]);
        return true;
      }
      const top = picks[0]?.ref;
      if (top !== undefined) {
        const wasSelected = sel.includes(top);
        if (e.mod) ctx.select([top], "toggle");
        else if (e.shift) ctx.select([top], "add");
        else if (!wasSelected) ctx.select([top]);
        drag = { kind: "press", from: world, ref: top, wasSelected, plain: !e.mod && !e.shift };
        return true;
      }
      const mode: SelectMode = e.shift ? "add" : e.mod ? "toggle" : "replace";
      drag = { kind: "marquee", from: world, to: world, touch: e.alt, mode, hits: [] };
      return true;
    }

    function move(e: ToolPointerEvent): boolean {
      cursorAt = e.world;
      if (!drag) {
        const { handles } = handlesNow();
        const handle = hitHandle(handles, e.world, ctx.scale());
        const ref = handle ? undefined : pickAt(ctx.index(), e.world, pickOpts())[0]?.ref;
        ctx.hover?.(ref ?? null);
        if (handle?.id !== hover.handle?.id || ref !== hover.ref) {
          hover = { ...(handle ? { handle } : {}), ...(ref !== undefined ? { ref } : {}) };
          ctx.invalidate();
        }
        return false;
      }
      if (drag.kind === "press") {
        const far = Math.hypot(e.world[0] - drag.from[0], e.world[1] - drag.from[1]);
        if (far * ctx.scale() < DRAG_THRESHOLD_PX || !ctx.selection().includes(drag.ref))
          return true;
        drag = { kind: "move", from: drag.from, targets: selectedTargets(), edit: null };
      }
      if (drag.kind === "marquee") {
        drag.to = e.world;
        const far = Math.hypot(e.world[0] - drag.from[0], e.world[1] - drag.from[1]);
        drag.hits =
          far * ctx.scale() < DRAG_THRESHOLD_PX
            ? []
            : marqueeSelect(ctx.index(), rectOf(drag.from, drag.to), {
                touch: drag.touch,
                layers: ctx.layers(),
              });
        ctx.invalidate();
        return true;
      }
      const opts = dragOpts(e);
      const { targets } = drag;
      const only = targets.length === 1 ? targets[0]! : undefined;
      if (drag.kind === "move") {
        drag.edit = only
          ? moveTarget(only, drag.from, e.world, { ...opts, mods: { ...opts.mods, alt: false } })
          : dragSelection(targets, "move", drag.from, e.world, opts);
      } else {
        drag.edit =
          only && !drag.multi
            ? dragHandle(only, drag.handle.id, drag.from, e.world, opts)
            : dragSelection(targets, drag.handle.id, drag.from, e.world, opts);
      }
      const batch = drag.edit?.batch ?? null;
      ctx.preview(batch);
      const by = moveBy(batch);
      const keys = targets.flatMap((t) => {
        const key = ctx.index().get(t.ref)?.key;
        return key === undefined ? [] : [key];
      });
      ctx.shareGhost(by ? { keys, by } : undefined);
      ctx.invalidate();
      return true;
    }

    function up(e: ToolPointerEvent): boolean {
      const d = drag;
      if (!d) return false;
      if (d.kind === "press") {
        drag = null;
        if (d.plain && d.wasSelected && ctx.selection().length > 1) ctx.select([d.ref]);
        return true;
      }
      if (d.kind === "marquee") {
        drag = null;
        const far = Math.hypot(e.world[0] - d.from[0], e.world[1] - d.from[1]);
        if (far * ctx.scale() < DRAG_THRESHOLD_PX) {
          if (d.mode === "replace") ctx.select([]);
        } else {
          const refs = marqueeSelect(ctx.index(), rectOf(d.from, e.world), {
            touch: d.touch,
            layers: ctx.layers(),
          });
          ctx.select(refs, d.mode);
        }
        ctx.invalidate();
        return true;
      }
      const edit = d.edit;
      dropDrag();
      if (!edit?.batch) return true;
      const ok = ctx.commit(edit.batch);
      if (ok && sub && d.kind === "handle" && d.handle.kind === "insert") sub.points = [];
      const ref = d.targets[0]?.ref;
      if (ok && edit.concave && ref !== undefined) {
        const fix = convertToChainFix(ctx.getDoc(), ctx.registry, ref);
        if (fix) offer = { label: "Convert to chain", batch: fix, ref };
      }
      ctx.invalidate();
      return true;
    }

    function deletePoints(): boolean {
      const t = subTarget();
      if (!sub || !t) return false;
      if (sub.points.length > 0) {
        const edit = t.path ? removeWaypoints(t, sub.points) : removeVertices(t, sub.points);
        if (edit?.batch && ctx.commit(edit.batch)) sub.points = [];
        ctx.invalidate();
      }
      return true;
    }

    return {
      pointer(e) {
        if (e.type === "down") return e.button === 0 ? down(e) : false;
        if (e.type === "move") return move(e);
        if (e.type === "up") return up(e);
        return false;
      },
      command(command) {
        switch (command) {
          case "enter-sub-object":
            return sub === null && enterSub();
          case "delete-points":
            return deletePoints();
          case "accept-offer": {
            if (!offer) return false;
            const { batch } = offer;
            offer = null;
            ctx.commit(batch);
            ctx.invalidate();
            return true;
          }
          default:
            return false;
        }
      },
      cancel() {
        if (drag) {
          dropDrag();
          return true;
        }
        offer = null;
        if (sub) {
          setSub(null);
          return true;
        }
        return false;
      },
      gesture: () => drag !== null && drag.kind !== "press",
      subObject: () => liveSub() !== null,
      overlay(): ToolOverlay {
        const out: ToolOverlay = {};
        const sel = ctx.selection();
        if (offer && !sel.includes(offer.ref)) offer = null;
        if (offer) out.offer = { label: offer.label, batch: offer.batch };
        if (drag?.kind === "marquee") {
          out.marquee = { rect: rectOf(drag.from, drag.to), touch: drag.touch, hits: drag.hits };
          return out;
        }
        if (drag && (drag.kind === "move" || drag.kind === "handle")) {
          const edit = drag.edit;
          const shown = ctx.previewDoc?.() ?? null;
          const grabbed = drag.kind === "handle" ? drag.handle.id : undefined;
          const { handles } = handlesNow(shown ?? undefined);
          if (handles.length > 0)
            out.handles = handles.map((h) => (h.id === grabbed ? { ...h, active: true } : h));
          if (!edit) return out;
          // The host outlines the previewed selection; a shape it can't show, or an invalid one, is drawn here.
          if (edit.shape && (edit.concave || !shown))
            out.outlines = [
              { shape: edit.shape, tone: edit.concave ? "invalid" : "selected", preview: true },
            ];
          if (edit.pts) {
            out.polylines = [
              {
                pts: edit.pts,
                closed: drag.targets[0]?.path?.loop === true,
                dashed: true,
                numbered: true,
                tone: "selected",
              },
            ];
          }
          if (edit.guides?.length) out.guides = edit.guides;
          out.readout = { at: cursorAt, text: edit.readout };
          return out;
        }
        const { handles, targets } = handlesNow();
        if (handles.length > 0) out.handles = handles;
        const path = targets.length === 1 ? targets[0]!.path : undefined;
        if (path) {
          out.polylines = [
            { pts: path.pts, closed: path.loop, dashed: true, numbered: true, tone: "selected" },
          ];
        }
        // A host that shares hover draws it with the selection; this is for one that doesn't.
        const hovered =
          !ctx.hover && hover.ref !== undefined && !sel.includes(hover.ref)
            ? ctx.index().get(hover.ref)
            : undefined;
        if (hovered) {
          if (Array.isArray(hovered.geometry))
            out.points = [{ at: hovered.geometry, tone: "hover" }];
          else out.outlines = [{ shape: hovered.geometry, tone: "hover" }];
        }
        return out;
      },
      cursor() {
        if (drag?.kind === "handle") return drag.handle.cursor ?? "grabbing";
        if (drag?.kind === "move") return "grabbing";
        return hover.handle?.cursor ?? (hover.ref !== undefined ? "pointer" : undefined);
      },
      destroy() {
        ctx.hover?.(null);
        dropDrag();
        if (sub) setSub(null);
      },
    };
  },
});
