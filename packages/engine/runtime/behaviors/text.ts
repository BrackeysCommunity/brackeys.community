import { drawText, type SceneView, type TextVisual, type ViewLayer } from "../../context";
import { bindTo, type BehaviorSystem, type BehaviorSystemFactory } from "../../game/behaviors";
import {
  measureFont,
  richSource,
  TEXT,
  TEXT_COLOR_DEFAULT,
  TEXT_SIZE_DEFAULT,
  textBoxShape,
  textDirection,
  textFontOf,
  type TextBlock,
  type TextHandle,
  type TextShown,
} from "../../game/behaviors/text";
import type { JsonValue } from "../../game/types";
import { pxPerMetreOf } from "../../game/units";
import type { RuntimeEntity } from "../../scene/types";
import { entityHomeLayer } from "../../systems/bodies";
import { measureText } from "../../text/measure";
import { parseRichText, type TextVars } from "../../text/rich";
import { bracketKey } from "../../text/strings";
import { samePose, type Pose } from "../poses";
import { spawnPose } from "../spawn-pose";

/**
 * What the text system answers by entity id; its handle binds `set` and
 * `setKey`. Like the sprite system it has no `step`: `settle` runs after the
 * game's `afterStep`, so a pose written this tick reaches the view with it.
 */
export type TextSystem = BehaviorSystem<TextBlock> & {
  /** Shows `text` in place of the block's until the block changes; ignored without a text block. */
  set(entityId: string, text: string): void;
  /** Shows `key`'s text, filled from `vars`, until the block changes; ignored without a text block. */
  setKey(entityId: string, key: string, vars?: TextVars): void;
  /** Re-poses every text whose entity's pose changed since it was last posed. */
  settle(): void;
};

/** The view id an entity's text draws under. */
export const textViewId = (entityId: string): string => `${entityId}#${TEXT.name}`;

type Attached = {
  entity: RuntimeEntity;
  block: TextBlock;
  layer: ViewLayer;
  /** What `set` or `setKey` gave, shown in place of the block's text. */
  shown: TextShown | undefined;
  disabled: boolean;
  /** The pose-index pose the text was last posed from. */
  applied: Readonly<Pose> | null;
};

const FALLBACK_ALPHA = 0.6;

const sameVars = (a: TextVars | undefined, b: TextVars | undefined): boolean => {
  const ka = Object.keys(a ?? {});
  return ka.length === Object.keys(b ?? {}).length && ka.every((k) => a![k] === b?.[k]);
};

const sameShown = (a: TextShown | undefined, b: TextShown): boolean => {
  if (!a) return false;
  if ("text" in a || "text" in b) return "text" in a && "text" in b && a.text === b.text;
  return a.key === b.key && sameVars(a.vars, b.vars);
};

/** A saved `set` or `setKey`, or null for a value that isn't one. */
function readShown(state: JsonValue): TextShown | null {
  if (state === null || typeof state !== "object" || Array.isArray(state)) return null;
  if (typeof state.text === "string") return { text: state.text };
  if (typeof state.key !== "string") return null;
  const vars = state.vars;
  if (vars === undefined) return { key: state.key };
  if (vars === null || typeof vars !== "object" || Array.isArray(vars)) return null;
  const entries = Object.entries(vars);
  if (!entries.every(([, v]) => typeof v === "string" || typeof v === "number")) return null;
  return { key: state.key, vars: Object.fromEntries(entries) as Record<string, string | number> };
}

/**
 * The `text` behavior's system: visual only, built with a view and never
 * headless. It draws each block once through the view's `text` member (the
 * fallback box without one), again when the block changes or a `set` or
 * `setKey` replaces what it shows, and never on a locale change: the view
 * holds the locale's table and resolves a key text itself. The visual is
 * data only. It keeps no pose of its own: the text sits at the entity's
 * pose-index pose, so a block on a child follows its parent.
 */
export const createTextSystem: BehaviorSystemFactory = (ctx) => {
  if (ctx.view === null)
    throw new Error("the text system draws through a view; headless runs build none");
  const view: SceneView = ctx.view;
  const pxPerMetre = pxPerMetreOf(ctx.registry);
  const project = ctx.project;
  const asset = project ? (id: string) => project.asset(id) : undefined;
  const attached = new Map<string, Attached>();

  function visualOf(a: Attached): TextVisual {
    const { block } = a;
    const shown: TextShown | TextBlock = a.shown ?? block;
    const key = "key" in shown ? shown.key : undefined;
    const vars = a.shown ? ("key" in a.shown ? a.shown.vars : undefined) : block.vars;
    const rich = block.rich === true;
    const font = textFontOf(asset, block.font);
    const size = block.size ?? TEXT_SIZE_DEFAULT;
    // A key's own text is the view's to resolve; its bracketed key sizes the fallback box.
    const source = key === undefined ? ("text" in shown && shown.text) || "" : bracketKey(key);
    const lines = parseRichText(richSource(source, rich), vars).lines;
    const color = block.color ?? TEXT_COLOR_DEFAULT;
    return {
      ...(key === undefined
        ? { lines }
        : { key, ...(vars ? { vars: { ...vars } } : {}), ...(rich ? { rich } : {}) }),
      font,
      size,
      color,
      align: block.align ?? "center",
      anchor: block.anchor ? [block.anchor[0], block.anchor[1]] : [0.5, 0.5],
      ...(block.wrap !== undefined ? { wrap: block.wrap } : {}),
      ...(block.outline ? { outline: { ...block.outline } } : {}),
      direction: textDirection(lines),
      fallback: {
        shape: textBoxShape(
          measureText(lines, measureFont(font), size, block.wrap),
          block.anchor,
          pxPerMetre,
        ),
        style: { stroke: color, strokeAlpha: FALLBACK_ALPHA },
      },
    };
  }

  function place(id: string, a: Attached, pose: Readonly<Pose>, snap: boolean): void {
    view.pose(textViewId(id), pose.x, pose.y, pose.rot, snap);
    a.applied = pose;
  }

  function draw(id: string, a: Attached): void {
    if (a.disabled) return;
    drawText(view, textViewId(id), visualOf(a), a.layer);
  }

  function show(id: string, a: Attached): void {
    draw(id, a);
    view.depth?.(textViewId(id), a.entity.z ?? 0);
    place(id, a, ctx.poses.get(id) ?? spawnPose(a.entity, ctx.registry), true);
  }

  function attach(id: string, block: TextBlock, entity: RuntimeEntity): void {
    const a: Attached = {
      entity,
      block,
      layer: entityHomeLayer(ctx, id, entity),
      shown: undefined,
      disabled: false,
      applied: null,
    };
    attached.set(id, a);
    show(id, a);
  }

  function hide(id: string): void {
    if (!attached.delete(id)) return;
    view.remove(textViewId(id));
  }

  function replace(id: string, shown: TextShown): void {
    const a = attached.get(id);
    if (!a || sameShown(a.shown, shown)) return;
    a.shown = shown;
    draw(id, a);
  }

  const system: TextSystem = {
    attach,
    update: (id, block, _prev, entity) => {
      const a = attached.get(id);
      if (!a) return attach(id, block, entity);
      a.entity = entity;
      a.block = block;
      a.layer = entityHomeLayer(ctx, id, entity);
      a.shown = undefined;
      if (!a.disabled) show(id, a);
    },
    detach: hide,
    disable(id) {
      const a = attached.get(id);
      if (!a || a.disabled) return;
      a.disabled = true;
      view.remove(textViewId(id));
    },
    enable(id) {
      const a = attached.get(id);
      if (!a?.disabled) return;
      a.disabled = false;
      show(id, a);
    },
    set: (id, text) => replace(id, { text }),
    setKey: (id, key, vars) => replace(id, vars ? { key, vars: { ...vars } } : { key }),
    settle() {
      for (const [id, a] of attached) {
        if (a.disabled) continue;
        const pose = ctx.poses.get(id);
        if (!pose || (a.applied && samePose(pose, a.applied))) continue;
        const prev = ctx.poses.prev(id);
        place(id, a, pose, prev !== undefined && samePose(prev, pose));
      }
    },
    save(id) {
      const shown = attached.get(id)?.shown;
      if (!shown) return undefined;
      if ("text" in shown) return { text: shown.text };
      const state: { [k: string]: JsonValue } = { key: shown.key };
      if (shown.vars) state.vars = { ...shown.vars };
      return state;
    },
    restore(id, state) {
      const shown = readShown(state);
      if (shown) replace(id, shown);
    },
    handle: (id): TextHandle => bindTo(system, id, ["set", "setKey"]),
    clear() {
      for (const id of [...attached.keys()]) hide(id);
    },
    size: () => attached.size,
  };
  return system as BehaviorSystem;
};
