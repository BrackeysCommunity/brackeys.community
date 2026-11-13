import { ENGINE_TOOL_IDS, type Registry } from "../game/types";
import { pxPerMetreOf } from "../game/units";
import type { GridCells } from "../scene/grid";
import { growOverGrid, type SpriteAssetLookup } from "../scene/render-geometry";
import { CHILD_SEPARATOR } from "../scene/resolve";
import { gridFieldsOf } from "../scene/schema";
import { aabb, aabbUnion } from "../scene/shape-geometry";
import type {
  Aabb,
  EntityDef,
  GridSettings,
  OpBatch,
  Pt,
  Ref,
  SceneDefinition,
  ShapeObj,
} from "../scene/types";
import { TOOL_PRIORITY, type ToolEvent, type ToolRouter } from "../tool-router";
import type { Vec2 } from "../types";
import { boxTool, circleTool } from "./builtin/draw";
import { penTool, waypointsTool } from "./builtin/polyline";
import { selectTool } from "./builtin/select";
import { panTool, rotateTool } from "./builtin/transform";
import { copySelection, cutSelection, duplicateSelection, pasteFragment } from "./clipboard";
import {
  deleteBatch,
  flipBatch,
  groupBatch,
  hierarchyDown,
  hierarchyUp,
  nudgeBatch,
  nudgeDelta,
  quarterTurnTargets,
  rotateSelectionBatch,
  selectAllRefs,
  turnBatch,
  ungroupBatch,
  zOrderBatch,
} from "./commands";
import { createGesturePreview, type PreviewRuntime } from "./gesture";
import { pathFollowPath } from "./gizmos/behavior-marks";
import type { KeyContext } from "./keymap";
import type { EditorSession } from "./session";
import { roundPt } from "./snap";
import {
  createSpatialIndex,
  entityGeometry,
  geometryOfRef,
  editSpriteBox,
  type EditGeometry,
} from "./spatial-index";
import { setHover } from "./store";
import {
  DEFAULT_SNAP,
  type EditorTool,
  type EditorToolContext,
  type EditorToolDef,
  type OverlayTone,
  type SnapSettings,
  type SpatialIndex,
  type ToolKeyEvent,
  type ToolModifiers,
  type ToolOption,
  type ToolOverlay,
  type ToolPointerEvent,
} from "./tools";

/** Presses this close in time (ms) and space (screen px) count as one multi-click. */
export const MULTI_CLICK_MS = 500;
/** The shortest gap between two cursor positions sent to other editors, as canvases throttle theirs. */
export const CURSOR_THROTTLE_MS = 40;
export const MULTI_CLICK_PX = 5;
/** How much one wheel notch (`deltaY` 100) zooms when no tool takes the wheel. */
export const WHEEL_ZOOM = 1.15;

/** The engine's tools, one fresh list per call: select, pan, box, circle, pen, waypoints, rotate. */
export function builtinTools(): EditorToolDef[] {
  return [selectTool, panTool, boxTool, circleTool, penTool, waypointsTool, rotateTool];
}

export type ToolLayers = { hidden: ReadonlySet<string>; locked: ReadonlySet<string> };

export type ToolHostOptions = {
  session: EditorSession;
  /** The shell's router; the host registers one pointer consumer at `TOOL_PRIORITY.editor`. */
  router: ToolRouter;
  /** Router screen px to world metres: the shell's `screenToWorld`. */
  toWorld: (screen: Vec2) => Pt;
  /** Screen px per metre now. */
  scale: () => number;
  /**
   * A runtime to show previews in as well as the overlay. The editor leaves
   * it out, so the edit world only ever holds committed state.
   */
  runtime?: PreviewRuntime | null;
  /** The game's tools (`GameDefinition.editor.tools()`, loaded); an engine id or a repeated id throws. */
  gameTools?: readonly EditorToolDef[];
  /** Replacements for built-in tools, by their engine id (a box tool drawing another type). */
  engineTools?: readonly EditorToolDef[];
  snap?: SnapSettings;
  layers?: { hidden?: Iterable<string>; locked?: Iterable<string> };
  /** Pans the camera by a screen-px drag (the pan tool, Space, the middle button). */
  pan?: (screenDelta: Pt) => void;
  /** Zooms about a screen point, for wheel turns no tool takes. */
  zoomAt?: (screen: Pt, factor: number) => void;
  /** Frames a world rect (the `frame` command). */
  frame?: (rect: Aabb) => void;
  /** After anything the overlay, cursor or key context depend on changed. */
  onChange?: () => void;
  /** Clock for multi-click detection; default `performance.now`. */
  now?: () => number;
  /** The tool to start with; default `select`. */
  tool?: string;
  /**
   * Asset info for sizing sprite boxes (`ProjectRuntimeView.asset`), read at
   * each re-index; call `reindex` when its answers change.
   */
  asset?: SpriteAssetLookup;
};

export type ToolHost = {
  /** Picks a tool and passes it `arg` as a command; false for an unknown id. */
  setTool(id: string, arg?: string): boolean;
  /** The active tool's id. */
  tool(): string;
  /** Every tool the host can pick: the engine's, then the game's. */
  tools(): readonly EditorToolDef[];
  /** What to draw this frame: the selection's outlines (as previewed) and the active tool's overlay. */
  overlay(): ToolOverlay;
  /** The active tool's setting (`overlay().option`), without building the selection's outlines. */
  option(): ToolOption | undefined;
  /** The canvas cursor the active tool asks for. */
  cursor(): string | undefined;
  /** The parts of the keymap's context the host knows. */
  keyContext(): Pick<
    KeyContext,
    "gesture" | "subObject" | "tool" | "quarterTurns" | "hasSelection"
  >;
  /**
   * A key press or release for the active tool (the pen's Enter and
   * Backspace); call it before resolving the keymap and stop when it returns
   * true. An unclaimed Enter enters point editing; releasing Space ends a
   * held pan.
   */
  key(e: ToolKeyEvent): boolean;
  /**
   * A keymap command or a host button: `tool:<id>[:<arg>]` picks a tool;
   * anything else goes to the active tool first, then the host's defaults
   * (nudge, rotate, turn, flip, select-all, group, ungroup, bring-forward,
   * send-backward, hierarchy, delete,
   * duplicate, toggle-snap, frame, undo, redo, pan-hold and Escape's
   * commands). True when it applied.
   */
  command(command: string): boolean;
  /** Escape: cancels the gesture, else leaves point editing, else drops the tool, else clears the selection. */
  cancel(): boolean;
  snap(): SnapSettings;
  setSnap(patch: Partial<SnapSettings>): void;
  layers(): ToolLayers;
  setLayers(patch: { hidden?: Iterable<string>; locked?: Iterable<string> }): void;
  /** The spatial index the tools pick from, kept current with the session. */
  index(): SpatialIndex;
  /** Rebuilds the index, for when the `asset` lookup's answers changed. */
  reindex(): void;
  /** The selection as clipboard text; empty with nothing selected. */
  copy(): string;
  /** The selection's clipboard text, removing it in one batch; empty with nothing selected. */
  cut(): string;
  /** Pastes clipboard text centred at `at` (default the last pointer position) in one batch. */
  paste(text: string, at?: Pt): boolean;
  /** Copies the selection one grid step down and right, in one batch. */
  duplicate(): boolean;
  /** The box around the selection; `null` when nothing selected has geometry. */
  selectionBounds(): Aabb | null;
  /** Applies the active tool's overlay offer (**Convert to chain**). */
  acceptOffer(): boolean;
  /** The last pointer position in world metres; `null` before any. */
  pointerWorld(): Pt | null;
  subscribe(listener: () => void): () => void;
  destroy(): void;
};

// ─── Outlines ───────────────────────────────────────────

/** Outline marks as the overlay draws them. */
export type OutlineMarks = Required<Pick<ToolOverlay, "outlines" | "points">>;

export type OutlineLook = {
  registry: Registry;
  /** Asset info for sizing sprite boxes (`ProjectRuntimeView.asset`); without it a box is its block's size or 32×32. */
  asset?: SpriteAssetLookup;
  /** Whether a point entity carrying a sprite marks its point as well as the box; default true. */
  spritePoints?: boolean;
};

/** The look outlines are drawn and bounded with, sizing sprite boxes by `asset` when given. */
export const outlineLook = (registry: Registry, asset?: SpriteAssetLookup): OutlineLook => ({
  registry,
  ...(asset ? { asset } : {}),
});

const boxShape = (b: Aabb): ShapeObj => ({
  type: "box",
  cx: (b.minX + b.maxX) / 2,
  cy: (b.minY + b.maxY) / 2,
  hw: (b.maxX - b.minX) / 2,
  hh: (b.maxY - b.minY) / 2,
  rotDeg: 0,
});

const ptsBox = (pts: readonly Pt[]): Aabb | null =>
  pts.reduce<Aabb | null>((b, [x, y]) => {
    const p = { minX: x, minY: y, maxX: x, maxY: y };
    return b ? aabbUnion(b, p) : p;
  }, null);

/** The box over a grid entity's origin and filled cells, as the renderers bound it; null without cells. */
function gridBox(grid: GridSettings, at: Pt, e: EntityDef, registry: Registry): Aabb | null {
  const origin: Aabb = { minX: at[0], minY: at[1], maxX: at[0], maxY: at[1] };
  let box = origin;
  for (const field of gridFieldsOf(registry.types.get(e.type))) {
    const value = e[field];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    try {
      box = growOverGrid(box, grid, at, [{ value: value as GridCells }]);
    } catch {
      // A half-typed grid value outlines nothing rather than throwing.
    }
  }
  return box === origin ? null : box;
}

/**
 * One entity's or bulk row's marks as the scene draws it, posed by `g`:
 * its shape, its sprite's box, its grid cells' box, and without a shape its point.
 */
function geometryMarks(
  def: SceneDefinition,
  g: EditGeometry,
  type: string,
  entity: EntityDef | undefined,
  tone: OverlayTone,
  owner: Ref,
  out: OutlineMarks,
  look: OutlineLook,
): void {
  if (g.shape) out.outlines.push({ shape: g.shape, tone, ref: owner });
  const sprite = editSpriteBox(look.registry, type, g, entity?.behaviors, look.asset);
  if (sprite) out.outlines.push({ shape: sprite.shape, tone, ref: owner });
  const grid = def.settings?.grid;
  const cells =
    !g.shape && g.at && grid && entity ? gridBox(grid, g.at, entity, look.registry) : null;
  if (cells) out.outlines.push({ shape: boxShape(cells), tone, ref: owner });
  if (!g.shape && g.at && (!sprite || look.spritePoints !== false))
    out.points.push({ at: g.at, tone, ref: owner });
}

/** The entities `ref` names in `def`: the entity itself, or an instance's children. */
function entitiesOfRef(def: SceneDefinition, ref: Ref): EntityDef[] {
  const entities = def.entities ?? [];
  const own = entities.find((e) => e.id === ref);
  if (own) return [own];
  const prefix = `${ref}${CHILD_SEPARATOR}`;
  return entities.filter((e) => e.id.startsWith(prefix));
}

/** Whether `ref` names an instance (or a nested one) rather than an entity of `def`. */
function isComposite(def: SceneDefinition, ref: Ref): boolean {
  const named = entitiesOfRef(def, ref);
  return named.length > 0 && named[0]!.id !== ref;
}

/**
 * Appends `ref`'s outlines in `def` (the resolved view, as previewed) to
 * `out`, each in its world pose: an entity's or bulk row's own geometry,
 * or for an instance, every child it resolves to. Sprite boxes are posed
 * from `def`'s geometry, so they follow a preview. Outlines carry `ref`.
 */
export function outlinesOfRef(
  def: SceneDefinition,
  ref: Ref,
  tone: OverlayTone,
  out: OutlineMarks,
  look: OutlineLook,
): void {
  const { registry } = look;
  const own = geometryOfRef(def, registry, ref);
  if (own) {
    const entity = own.bulk ? undefined : (def.entities ?? []).find((e) => e.id === ref);
    geometryMarks(def, own, own.type, entity, tone, ref, out, look);
    return;
  }
  for (const e of entitiesOfRef(def, ref)) {
    const t = registry.types.get(e.type);
    if (t) geometryMarks(def, entityGeometry(t, e), e.type, e, tone, ref, out, look);
  }
}

/**
 * The box around what `refs` outline in `def`, an instance's children for an
 * instance; `null` when none of them draws. Framing and revealing a selection
 * go by it, so they show what its outline shows.
 */
export function outlineBounds(
  def: SceneDefinition,
  refs: readonly Ref[],
  look: OutlineLook,
): Aabb | null {
  const marks: OutlineMarks = { outlines: [], points: [] };
  for (const ref of refs) outlinesOfRef(def, ref, "selected", marks, look);
  return marksBounds(marks.outlines, marks.points);
}

/**
 * The box framing `refs` goes to: their `outlineBounds` grown over the paths
 * their entities travel (a path field's and a `path-follow` block's
 * waypoints), so framing an entity on a path shows its whole route.
 */
export function frameBounds(
  def: SceneDefinition,
  refs: readonly Ref[],
  look: OutlineLook,
): Aabb | null {
  const { registry } = look;
  const route: Pt[] = [];
  for (const ref of refs) {
    for (const e of entitiesOfRef(def, ref)) {
      const t = registry.types.get(e.type);
      if (!t) continue;
      route.push(...(entityGeometry(t, e).pts ?? []));
      route.push(...(pathFollowPath(def, registry, e.id)?.pts ?? []));
    }
  }
  const box = outlineBounds(def, refs, look);
  const travelled = ptsBox(route);
  return box && travelled ? aabbUnion(box, travelled) : (box ?? travelled);
}

/** The box around a set of marks; `null` for none. */
export function marksBounds(
  outlines: OutlineMarks["outlines"],
  points: OutlineMarks["points"],
): Aabb | null {
  let box = ptsBox(points.map((p) => p.at));
  for (const o of outlines) box = box ? aabbUnion(box, aabb(o.shape)) : aabb(o.shape);
  return box;
}

const modsOf = (n: Partial<Record<"shiftKey" | "altKey" | "ctrlKey" | "metaKey", boolean>>) => ({
  shift: n.shiftKey === true,
  alt: n.altKey === true,
  mod: n.ctrlKey === true || n.metaKey === true,
});

/** A router key event as a tool sees it. */
export function toolKeyEventOf(e: Extract<ToolEvent, { kind: "key" }>): ToolKeyEvent {
  return { type: e.type, key: e.key, repeat: e.native.repeat === true, ...modsOf(e.native) };
}

const isSpace = (key: string) => key === " " || key === "Space" || key === "Spacebar";

/**
 * Runs the editor's tools on a session: takes the canvas's pointer events
 * from the router, keeps a spatial index current, previews gestures in the
 * overlay (and in `runtime` when given one) and commits each as one batch,
 * and carries the commands the keymap resolves. Framework-free; the site draws `overlay()`
 * and calls `key` and `command` from its keymap consumer.
 */
export function createToolHost(opts: ToolHostOptions): ToolHost {
  const { session, router } = opts;
  const registry = session.registry;
  const listeners = new Set<() => void>();
  const now = opts.now ?? (() => performance.now());
  let lastCursorAt = -Infinity;

  const defs = new Map<string, EditorToolDef>();
  for (const t of builtinTools()) defs.set(t.id, t);
  for (const t of opts.engineTools ?? []) {
    if (!(ENGINE_TOOL_IDS as readonly string[]).includes(t.id))
      throw new Error(`engine tool "${t.id}" replaces no engine tool`);
    defs.set(t.id, t);
  }
  const gameIds = new Set<string>();
  for (const t of opts.gameTools ?? []) {
    if ((ENGINE_TOOL_IDS as readonly string[]).includes(t.id))
      throw new Error(`game tool "${t.id}" reuses an engine tool id`);
    if (gameIds.has(t.id)) throw new Error(`game tool "${t.id}" is listed twice`);
    gameIds.add(t.id);
    defs.set(t.id, t);
  }

  let snap: SnapSettings = { ...(opts.snap ?? DEFAULT_SNAP) };
  let layers: ToolLayers = {
    hidden: new Set(opts.layers?.hidden ?? []),
    locked: new Set(opts.layers?.locked ?? []),
  };
  const index = createSpatialIndex({
    keyOf: (r) => session.keyOf(r),
    ...(opts.asset ? { asset: opts.asset } : {}),
  });
  index.rebuild(session.getResolved(), registry);
  const gesture = createGesturePreview({
    registry,
    getDoc: () => session.getResolved(),
    runtime: opts.runtime,
  });

  let activeId = "";
  let active: EditorTool | null = null;
  let subObject = false;
  /** The tool to go back to when a held Space is released. */
  let held: string | null = null;
  let pressed: number | null = null;
  let lastPress: { t: number; at: Vec2; button: number; clicks: number } | null = null;
  let middlePan: Vec2 | null = null;
  let cursorWorld: Pt | null = null;
  let destroyed = false;

  function emit(): void {
    if (destroyed) return;
    opts.onChange?.();
    for (const l of listeners) l();
  }

  function commit(batch: OpBatch, o?: { selectionAfter?: Ref[] }): boolean {
    gesture.preview(null);
    const result = session.dispatch(batch, {
      resolved: true,
      ...(o?.selectionAfter ? { selectionAfter: o.selectionAfter } : {}),
    });
    emit();
    return result.ok;
  }

  const selection = () => session.store.state.selection;

  const ctx: EditorToolContext = {
    registry,
    getDoc: () => session.getResolved(),
    selection,
    select(refs, mode) {
      session.select(refs, mode);
      emit();
    },
    hover: (ref) => setHover(session.store, ref),
    commit,
    preview(batch) {
      gesture.preview(batch);
      emit();
    },
    previewDoc: () => gesture.def(),
    scale: () => opts.scale(),
    snap: () => snap,
    index: () => index,
    layers: () => layers,
    invalidate: emit,
    setTool: (id) => void setTool(id),
    setSubObject(on) {
      if (subObject === on) return;
      subObject = on;
      emit();
    },
    shareGhost: (ghost) => session.setGhost(ghost),
    ...(opts.pan ? { pan: opts.pan } : {}),
  };

  function setTool(id: string, arg?: string): boolean {
    const def = defs.get(id);
    if (!def || destroyed) return false;
    if (id !== activeId || !active) {
      const old = active;
      active = null;
      old?.cancel?.();
      old?.destroy?.();
      gesture.preview(null);
      session.setGhost(undefined);
      subObject = false;
      activeId = id;
      active = def.create(ctx);
      session.setTool(id);
      session.store.setState((s) => ({ ...s, tool: id }));
    }
    if (arg !== undefined) active.command?.(arg);
    emit();
    return true;
  }

  // ─── Pointer input ──────────────────────────────────────

  function pointer(e: Extract<ToolEvent, { kind: "pointer" }>): boolean {
    const world = opts.toWorld(e.screen);
    const screen: Pt = [e.screen.x, e.screen.y];
    cursorWorld = world;
    const mods: ToolModifiers = modsOf(e.native);

    if (middlePan || (e.type === "down" && e.button === 1 && opts.pan)) {
      if (e.type === "down") middlePan = e.screen;
      else if (e.type === "move" && middlePan) {
        opts.pan?.([e.screen.x - middlePan.x, e.screen.y - middlePan.y]);
        middlePan = e.screen;
      } else if (e.type === "up") middlePan = null;
      return true;
    }

    let clicks = 1;
    if (e.type === "down") {
      const t = now();
      const p = lastPress;
      const near =
        p !== null &&
        p.button === e.button &&
        t - p.t <= MULTI_CLICK_MS &&
        Math.hypot(e.screen.x - p.at.x, e.screen.y - p.at.y) <= MULTI_CLICK_PX;
      clicks = near ? p.clicks + 1 : 1;
      lastPress = { t, at: e.screen, button: e.button, clicks };
      pressed = e.button;
    } else if (lastPress) clicks = lastPress.clicks;

    const event: ToolPointerEvent = {
      type: e.type,
      world,
      screen,
      button: e.type === "move" && pressed !== null ? pressed : e.button,
      deltaY: e.deltaY,
      clicks,
      ...mods,
    };
    if (e.type === "up") pressed = null;
    if (e.type === "move") {
      const t = now();
      if (t - lastCursorAt >= CURSOR_THROTTLE_MS) {
        lastCursorAt = t;
        session.setCursor(roundPt(world, pxPerMetreOf(registry)));
      }
    }

    const claimed = active?.pointer?.(event) ?? false;
    if (!claimed && e.type === "wheel" && opts.zoomAt && e.deltaY !== 0) {
      opts.zoomAt(screen, WHEEL_ZOOM ** (-e.deltaY / 100));
      return true;
    }
    return claimed;
  }

  const editing = () => !destroyed && session.store.state.mode === "edit";

  const unregister = router.register({
    id: "editor-tools",
    priority: TOOL_PRIORITY.editor,
    // Moves are seen but never claimed, so the shell still tracks the pointer (`pointerWorld`).
    accepts(e) {
      if (e.kind !== "pointer" || !editing()) return false;
      if (e.type === "move") {
        pointer(e);
        return false;
      }
      return true;
    },
    handle(e) {
      if (e.kind === "pointer") pointer(e);
    },
  });

  // The overlay outlines the selection and the hover, which the panels change too.
  let seen = session.store.state;
  const unwatchStore = session.store.subscribe(() => {
    const next = session.store.state;
    if (next.hover === seen.hover && next.selection === seen.selection) return;
    seen = next;
    emit();
  });

  const unsubscribe = session.subscribe((e) => {
    const view = session.getResolved();
    if (e.touched.length === 0 || view !== e.doc) index.rebuild(view, registry);
    else index.update(view, registry, e.touched);
    emit();
  });

  // ─── Commands ───────────────────────────────────────────

  function apply(batch: OpBatch | null, selectionAfter?: Ref[]): boolean {
    return batch !== null && commit(batch, selectionAfter ? { selectionAfter } : undefined);
  }

  function selectRefs(refs: Ref[] | null): boolean {
    if (!refs) return false;
    ctx.select(refs);
    return true;
  }

  function dropGesture(): void {
    if (active?.gesture?.()) active.cancel?.();
  }

  function cancel(): boolean {
    if (!active) return false;
    if (active.gesture?.() || subObject || active.subObject?.()) {
      if (active.cancel?.()) return true;
      if (subObject) {
        subObject = false;
        emit();
        return true;
      }
    }
    if (activeId !== "select") {
      if (active.cancel?.()) return true;
      held = null;
      return setTool("select");
    }
    if (selection().length > 0) {
      ctx.select([]);
      return true;
    }
    return false;
  }

  function defaults(command: string): boolean {
    const def = session.getResolved();
    const sel = selection();
    const ppm = pxPerMetreOf(registry);
    const delta = nudgeDelta(command, ppm);
    if (delta) return apply(nudgeBatch(sel, delta, ppm));
    switch (command) {
      case "rotate-cw":
      case "rotate-ccw": {
        const deg = (command === "rotate-cw" ? 1 : -1) * (snap.angleDeg > 0 ? snap.angleDeg : 15);
        return apply(rotateSelectionBatch(def, registry, sel, deg));
      }
      case "turn-cw":
      case "turn-ccw":
        return apply(turnBatch(session.getDoc(), sel, command === "turn-cw" ? 1 : -1));
      case "flip-x":
      case "flip-y":
        return apply(flipBatch(session.getDoc(), sel, command === "flip-x" ? "x" : "y"));
      case "select-all":
        return selectRefs(selectAllRefs(def, index, layers));
      case "group":
        return apply(groupBatch(def, sel));
      case "ungroup":
        return apply(ungroupBatch(def, sel));
      case "bring-forward":
        return apply(zOrderBatch(sel, 1));
      case "send-backward":
        return apply(zOrderBatch(sel, -1));
      case "hierarchy-up":
        return selectRefs(hierarchyUp(def, registry, sel));
      case "hierarchy-down":
        return selectRefs(hierarchyDown(def, registry, sel));
      case "delete":
        return apply(deleteBatch(sel));
      case "duplicate":
        return host.duplicate();
      case "toggle-snap":
        host.setSnap({ enabled: !snap.enabled });
        return true;
      case "frame": {
        if (!opts.frame) return false;
        const [minX, minY, maxX, maxY] = def.bounds;
        opts.frame(frameBounds(def, sel, look()) ?? { minX, minY, maxX, maxY });
        return true;
      }
      case "undo":
      case "redo": {
        dropGesture();
        const ok = command === "undo" ? session.undo() : session.redo();
        emit();
        return ok;
      }
      case "pan-hold":
        if (held !== null || activeId === "pan") return true;
        held = activeId;
        return setTool("pan");
      case "cancel-gesture":
      case "leave-sub-object":
      case "clear-tool":
      case "clear-selection":
        return cancel();
      default:
        return false;
    }
  }

  /** A game's tool (a placement ghost) keeps `e` for itself, so only the engine's tools turn instances. */
  function quarterTurns(): boolean {
    const sel = selection();
    if (sel.length === 0 || gameIds.has(activeId)) return false;
    const t = quarterTurnTargets(session.getDoc(), sel);
    return t.rest.length === 0 && t.instances.length + t.groups.length > 0;
  }

  const look = (): OutlineLook => outlineLook(registry, opts.asset);

  /**
   * The overlay's outlines: the selection's, the shared hover's and the
   * marquee's would-be selection. While a drag previews, the selection is
   * outlined where the preview puts it, over a ghost of where it started.
   */
  function selectionOverlay(own: ToolOverlay): ToolOverlay {
    const previewed = gesture.def();
    const committed = session.getResolved();
    const def = previewed ?? committed;
    const sel = selection();
    const ghost: OutlineMarks = { outlines: [], points: [] };
    const outline = look();
    if (previewed) for (const ref of sel) outlinesOfRef(committed, ref, "ghost", ghost, outline);
    const marks: OutlineMarks = { outlines: [], points: [] };
    for (const ref of sel) outlinesOfRef(def, ref, "selected", marks, outline);
    const bounds =
      sel.length > 1 || (sel.length === 1 && isComposite(def, sel[0]!))
        ? marksBounds(marks.outlines, marks.points)
        : null;
    if (previewed) {
      marks.outlines = [...ghost.outlines, ...marks.outlines.map((o) => ({ ...o, preview: true }))];
      marks.points = [...ghost.points, ...marks.points.map((p) => ({ ...p, preview: true }))];
    }
    const taken = new Set(sel);
    const gesturing = active?.gesture?.() ?? false;
    const hover = session.store.state.hover;
    if (!gesturing && hover !== null && !taken.has(hover))
      outlinesOfRef(def, hover, "hover", marks, outline);
    for (const ref of own.marquee?.hits ?? [])
      if (!taken.has(ref)) outlinesOfRef(def, ref, "hover", marks, outline);
    return { ...marks, ...(bounds ? { bounds } : {}) };
  }

  const host: ToolHost = {
    setTool,
    tool: () => activeId,
    tools: () => [...defs.values()],
    overlay() {
      const own = active?.overlay?.() ?? {};
      const sel = selectionOverlay(own);
      const outlines = [...(sel.outlines ?? []), ...(own.outlines ?? [])];
      const points = [...(sel.points ?? []), ...(own.points ?? [])];
      return {
        ...own,
        ...(outlines.length > 0 ? { outlines } : {}),
        ...(points.length > 0 ? { points } : {}),
        ...(sel.bounds ? { bounds: sel.bounds } : {}),
      };
    },
    option: () => active?.overlay?.()?.option,
    cursor: () => active?.cursor?.(),
    keyContext: () => ({
      gesture: active?.gesture?.() ?? false,
      subObject: subObject || (active?.subObject?.() ?? false),
      tool: activeId,
      quarterTurns: quarterTurns(),
      hasSelection: selection().length > 0,
    }),
    key(e) {
      if (active?.key?.(e)) return true;
      if (e.type === "up" && isSpace(e.key) && held !== null) {
        const back = held;
        held = null;
        return setTool(back);
      }
      if (e.type === "down" && e.key === "Enter" && !e.shift && !e.alt && !e.mod)
        return host.command("enter-sub-object");
      return false;
    },
    command(command) {
      if (destroyed) return false;
      const pick = /^tool:([^:]+)(?::(.*))?$/.exec(command);
      if (pick) {
        held = null;
        return setTool(pick[1]!, pick[2]);
      }
      if (active?.command?.(command)) {
        emit();
        return true;
      }
      return defaults(command);
    },
    cancel,
    snap: () => snap,
    setSnap(patch) {
      snap = { ...snap, ...patch };
      emit();
    },
    layers: () => layers,
    setLayers(patch) {
      layers = {
        hidden: patch.hidden ? new Set(patch.hidden) : layers.hidden,
        locked: patch.locked ? new Set(patch.locked) : layers.locked,
      };
      emit();
    },
    index: () => index,
    reindex() {
      index.rebuild(session.getResolved(), registry);
      emit();
    },
    copy: () =>
      selection().length > 0
        ? copySelection(session.getDoc(), selection(), registry, session.getPrefabs())
        : "",
    cut() {
      const sel = selection();
      if (sel.length === 0) return "";
      const { text, batch } = cutSelection(session.getDoc(), sel, registry, session.getPrefabs());
      return commit(batch) ? text : "";
    },
    paste(text, at) {
      const result = pasteFragment(text, {
        def: session.getDoc(),
        registry,
        prefabs: session.getPrefabs(),
        snap,
        ...((at ?? cursorWorld) ? { at: at ?? cursorWorld! } : {}),
      });
      return result.ok && commit(result.batch, { selectionAfter: result.select });
    },
    duplicate() {
      const sel = selection();
      if (sel.length === 0) return false;
      const result = duplicateSelection(session.getDoc(), sel, registry, snap.step, {
        prefabs: session.getPrefabs(),
      });
      return result.ok && commit(result.batch, { selectionAfter: result.select });
    },
    selectionBounds: () => outlineBounds(session.getResolved(), selection(), look()),
    acceptOffer: () => host.command("accept-offer"),
    pointerWorld: () => cursorWorld,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() {
      if (destroyed) return;
      active?.cancel?.();
      active?.destroy?.();
      active = null;
      gesture.preview(null);
      session.setGhost(undefined);
      destroyed = true;
      unregister();
      unsubscribe();
      unwatchStore();
      listeners.clear();
    },
  };

  setTool(opts.tool && defs.has(opts.tool) ? opts.tool : "select");
  return host;
}
