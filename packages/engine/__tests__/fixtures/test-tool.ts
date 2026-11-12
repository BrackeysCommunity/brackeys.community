import { placementEditorTool } from "../../editor/placement";
import {
  DEFAULT_SNAP,
  defineEditorTool,
  type EditorToolContext,
  type SnapSettings,
  type ToolPointerEvent,
} from "../../editor/tools";
import { createRegistry, defineGame } from "../../game/define";
import type { Registry } from "../../game/types";
import { pxPerMetreOf } from "../../game/units";
import { applyOps } from "../../scene/ops";
import type { OpBatch, Pt, Ref, SceneDefinition } from "../../scene/types";
import { snapToPixel } from "../../scene/units";
import { testGame } from "./test-game";

/**
 * Draws a solid chain: press, drag through points, release. One stroke is
 * one batch; Escape mid-stroke drops it with none.
 */
export const testStrokeTool = defineEditorTool({
  id: "test-stroke",
  label: "Stroke",
  description: "Drag to draw a solid chain.",
  create(ctx) {
    let pts: Pt[] | null = null;
    const ppm = pxPerMetreOf(ctx.registry);
    const grid = ([x, y]: Pt): Pt => {
      const { enabled, step } = ctx.snap();
      const snap = (v: number) => (enabled ? Math.round(v / step) * step : snapToPixel(v, ppm));
      return [snap(x), snap(y)];
    };
    const batch = (stroke: Pt[]): OpBatch => ({
      label: "Stroke",
      ops: [{ op: "add", entity: { type: "solid", shape: ["chain", ...stroke.flat()] } }],
    });
    const drop = () => {
      pts = null;
      ctx.preview(null);
    };
    return {
      pointer(e) {
        if (e.type === "down" && e.button === 0) {
          pts = [grid(e.world)];
          return true;
        }
        if (!pts) return false;
        if (e.type === "move") {
          const p = grid(e.world);
          const last = pts.at(-1)!;
          if (p[0] !== last[0] || p[1] !== last[1]) pts.push(p);
          if (pts.length > 1) ctx.preview(batch(pts));
          return true;
        }
        if (e.type === "up") {
          const stroke = pts;
          drop();
          if (stroke.length > 1) ctx.commit(batch(stroke));
          return true;
        }
        return false;
      },
      cancel() {
        if (!pts) return false;
        drop();
        return true;
      },
      gesture: () => pts !== null,
    };
  },
});

/** Half a crate's side, in metres. */
const CRATE_HALF = 0.2;

/** Places 0.4 m crates (props). */
export const testCrateTool = placementEditorTool({
  id: "test-crate",
  label: "Crates",
  description: "Click to place a crate.",
  templates: [
    {
      id: "crate",
      label: "Crate",
      shape: { type: "box", cx: 0, cy: 0, hw: CRATE_HALF, hh: CRATE_HALF, rotDeg: 0 },
    },
  ],
  toEntity: (_template, [x, y], rotDeg) => ({
    type: "prop",
    shape: ["box", x, y, CRATE_HALF, CRATE_HALF, rotDeg],
    density: 1,
    restitution: 0,
  }),
});

/** The test game with the test tools. */
export const testGameWithTools = defineGame({
  ...testGame,
  editor: { tools: () => Promise.resolve([testStrokeTool, testCrateTool]) },
});

export type FakeToolContext = EditorToolContext & {
  readonly commits: OpBatch[];
  readonly previews: (OpBatch | null)[];
  readonly selected: Ref[][];
  doc: SceneDefinition;
};

/** An `EditorToolContext` over a plain document that records commits and previews; commits apply. */
export function fakeToolContext(
  registry: Registry,
  doc: SceneDefinition,
  snap: SnapSettings = DEFAULT_SNAP,
): FakeToolContext {
  const commits: OpBatch[] = [];
  const previews: (OpBatch | null)[] = [];
  const selected: Ref[][] = [];
  let selection: Ref[] = [];
  const ctx: FakeToolContext = {
    commits,
    previews,
    selected,
    doc,
    registry,
    getDoc: () => ctx.doc,
    selection: () => selection,
    select(refs) {
      selection = refs;
      selected.push(refs);
    },
    commit(batch, opts) {
      const result = applyOps(ctx.doc, batch, registry);
      if (!result.ok) return false;
      commits.push(batch);
      ctx.doc = result.def;
      if (opts?.selectionAfter) ctx.select(opts.selectionAfter);
      return true;
    },
    preview: (batch) => void previews.push(batch),
    scale: () => 1,
    snap: () => snap,
    index: () => ({ query: () => [], get: () => undefined, entries: () => [], size: 0 }),
    layers: () => ({ hidden: new Set(), locked: new Set() }),
    invalidate() {},
    setTool() {},
    setSubObject() {},
    shareGhost() {},
  };
  return ctx;
}

/** A pointer event with no modifiers. */
export function pointer(
  type: ToolPointerEvent["type"],
  world: Pt,
  rest: Partial<ToolPointerEvent> = {},
): ToolPointerEvent {
  return {
    type,
    world,
    button: 0,
    deltaY: 0,
    clicks: 1,
    shift: false,
    alt: false,
    mod: false,
    ...rest,
  };
}

export const toolRegistry = createRegistry(testGameWithTools);
